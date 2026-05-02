/**
 * Post-Quantum cryptography helpers — Sprint 4 Phase H2 (PQ-Only stub).
 *
 * Goal:
 *   Provide a stable, edge-friendly verification API for Dilithium2-signed
 *   API requests. The actual NIST PQC verifier (WASM) is intentionally not
 *   bundled in this phase; it lands in a follow-up sprint behind the
 *   `pq_api_keys_wasm_ready` system_marker.
 *
 * Design rules (carried over from Phase B/G/H1 stub-first approach):
 *   - Public function signatures are final and stable so the route layer
 *     can be wired now and the verifier swapped in later without churn.
 *   - When WASM is unavailable we DO NOT silently pass — we return an
 *     explicit `wasm_unavailable` outcome so the middleware can decide
 *     whether to refuse (`pq_api_keys_required=on`) or fall back to HMAC.
 *   - Backward compatibility: any code path that touches an `hmac-sha256`
 *     key MUST NOT call into this module.
 *
 * Markers consumed (read-only here, written by admin tools):
 *   - pq_api_keys_enabled       : master switch for the PQ pipeline
 *   - pq_api_keys_required      : when 'on', hmac-only keys must be refused
 *   - pq_api_keys_wasm_ready    : 'on' once Dilithium2 WASM is bundled
 *
 * Audit trail (writes go to api_key_pq_audit via logPqVerifyAttempt):
 *   outcome ∈ { ok, bad_signature, expired, replay, unsupported, wasm_unavailable }
 */

import type { Context } from 'hono';
import type { AppEnv } from '../index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PqAlgorithm = 'dilithium2' | 'hybrid';

export type PqVerifyOutcome =
  | 'ok'
  | 'bad_signature'
  | 'expired'
  | 'replay'
  | 'unsupported'
  | 'wasm_unavailable';

export interface PqVerifyInput {
  /** Base64-encoded Dilithium2 public key (as stored in api_keys.public_key). */
  publicKey: string;
  /** Base64-encoded signature provided by the client (X-Signature header). */
  signature: string;
  /**
   * Canonical request bytes. Build via {@link buildCanonicalRequest} so client
   * and server hash the same payload deterministically.
   */
  message: Uint8Array;
  /** Unix seconds; rejected when |now - timestamp| > MAX_SKEW_SEC. */
  timestamp: number;
  /** Algorithm declared in the X-Algorithm header. */
  algorithm: PqAlgorithm;
}

export interface PqVerifyResult {
  ok: boolean;
  outcome: PqVerifyOutcome;
  /** Human-readable detail; safe to log, no PII. */
  detail?: string;
}

export interface CanonicalRequestParts {
  method: string;
  path: string;
  /** ISO timestamp string OR unix seconds as string — caller decides. */
  timestamp: string;
  /** Raw request body (empty string for GET/DELETE without body). */
  body: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reject signatures whose declared timestamp is more than this far from now. */
export const MAX_SKEW_SEC = 60;

/** Dilithium2 raw public key length, NIST round 3 spec. Used for sanity check only. */
export const DILITHIUM2_PUBKEY_BYTES = 1312;

/** Dilithium2 signature length. Sanity check only — does not imply verification. */
export const DILITHIUM2_SIG_BYTES = 2420;

// ---------------------------------------------------------------------------
// Base64 helpers (Workers-safe; no Buffer)
// ---------------------------------------------------------------------------

export function base64Decode(input: string): Uint8Array {
  // atob is available in Workers runtime.
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Canonical request construction
// ---------------------------------------------------------------------------

/**
 * Build the byte sequence that both client and server must hash before
 * signing / verifying. Format is intentionally simple and stable:
 *
 *   <METHOD>\n<PATH>\n<TIMESTAMP>\n<SHA256(body)-hex>
 *
 * Returning the resulting bytes (not a string) keeps callers from doing
 * extra UTF-8 round-trips.
 */
export async function buildCanonicalRequest(parts: CanonicalRequestParts): Promise<Uint8Array> {
  const bodyBytes = new TextEncoder().encode(parts.body ?? '');
  const bodyDigest = await crypto.subtle.digest('SHA-256', bodyBytes);
  const bodyHex = bytesToHex(new Uint8Array(bodyDigest));

  const canonical =
    parts.method.toUpperCase() +
    '\n' +
    parts.path +
    '\n' +
    parts.timestamp +
    '\n' +
    bodyHex;

  return new TextEncoder().encode(canonical);
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Public-key shape sanity check (cheap, runs before WASM is even consulted).
// ---------------------------------------------------------------------------

export function isValidDilithium2PublicKey(pubKeyB64: string | null | undefined): boolean {
  if (!pubKeyB64 || typeof pubKeyB64 !== 'string') return false;
  try {
    const raw = base64Decode(pubKeyB64);
    return raw.length === DILITHIUM2_PUBKEY_BYTES;
  } catch {
    return false;
  }
}

export function isValidDilithium2Signature(sigB64: string | null | undefined): boolean {
  if (!sigB64 || typeof sigB64 !== 'string') return false;
  try {
    const raw = base64Decode(sigB64);
    return raw.length === DILITHIUM2_SIG_BYTES;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Verifier (stub).
//
// Real Dilithium2 verification will be loaded lazily from WASM in a future
// sprint. Until `pq_api_keys_wasm_ready=on` we deliberately return a
// non-OK outcome so the middleware never grants access purely on the
// strength of this stub.
// ---------------------------------------------------------------------------

let _wasmReady: boolean | null = null;

/**
 * Hook for the future WASM loader. Returns false today so callers know
 * the verifier is not yet bundled. Cached per-isolate.
 */
export function isPqWasmAvailable(): boolean {
  if (_wasmReady !== null) return _wasmReady;
  // Future: try { await import('./pq-wasm/dilithium2.wasm') } catch { ... }
  _wasmReady = false;
  return _wasmReady;
}

/**
 * Verify a Dilithium2 signature.
 *
 * Returns `{ ok: false, outcome: 'wasm_unavailable' }` while the WASM
 * verifier is not yet bundled. The middleware MUST treat that as a hard
 * failure when `pq_api_keys_required=on`.
 */
export async function verifyPqSignature(input: PqVerifyInput): Promise<PqVerifyResult> {
  // Cheap structural checks first — no WASM needed to reject malformed input.
  if (!isValidDilithium2PublicKey(input.publicKey)) {
    return { ok: false, outcome: 'bad_signature', detail: 'invalid_public_key_length' };
  }
  if (!isValidDilithium2Signature(input.signature)) {
    return { ok: false, outcome: 'bad_signature', detail: 'invalid_signature_length' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(input.timestamp) || Math.abs(now - input.timestamp) > MAX_SKEW_SEC) {
    return { ok: false, outcome: 'expired', detail: 'timestamp_skew' };
  }

  if (input.algorithm !== 'dilithium2' && input.algorithm !== 'hybrid') {
    return { ok: false, outcome: 'unsupported', detail: 'unknown_algorithm' };
  }

  if (!isPqWasmAvailable()) {
    // Stable contract: never silently succeed.
    return { ok: false, outcome: 'wasm_unavailable', detail: 'dilithium2_wasm_not_bundled' };
  }

  // Placeholder for future implementation:
  //   const wasm = await loadDilithium2();
  //   const ok  = wasm.verify(base64Decode(input.publicKey),
  //                           input.message,
  //                           base64Decode(input.signature));
  //   return { ok, outcome: ok ? 'ok' : 'bad_signature' };
  return { ok: false, outcome: 'wasm_unavailable', detail: 'verifier_not_implemented' };
}

// ---------------------------------------------------------------------------
// Audit log writer
// ---------------------------------------------------------------------------

export interface PqAuditEntry {
  apiKeyId?: string | null;
  apiKeyPrefix?: string | null;
  algorithm: PqAlgorithm;
  outcome: PqVerifyOutcome;
  ipAddress?: string | null;
  userAgent?: string | null;
  detail?: string | null;
}

/**
 * Best-effort insert into api_key_pq_audit. Never throws — audit failures
 * must not break the request path.
 */
export async function logPqVerifyAttempt(
  c: Context<AppEnv>,
  entry: PqAuditEntry,
): Promise<void> {
  try {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO api_key_pq_audit
         (id, api_key_id, api_key_prefix, algorithm, outcome, ip_address, user_agent, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        entry.apiKeyId ?? null,
        entry.apiKeyPrefix ?? null,
        entry.algorithm,
        entry.outcome,
        entry.ipAddress ?? null,
        entry.userAgent ?? null,
        entry.detail ?? null,
      )
      .run();
  } catch (err) {
    // Swallow — see comment above.
    console.warn('[pq-crypto] failed to write audit row', err);
  }
}

// ---------------------------------------------------------------------------
// Marker readers (uncached — admin endpoints can call freely; hot paths
// should use the existing risk cache pattern in a future sprint).
// ---------------------------------------------------------------------------

export interface PqMarkerState {
  enabled: boolean;          // pq_api_keys_enabled
  required: boolean;         // pq_api_keys_required
  wasmReady: boolean;        // pq_api_keys_wasm_ready
  integrationPhase: string;  // pq_api_keys_integration
}

export async function readPqMarkers(c: Context<AppEnv>): Promise<PqMarkerState> {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT key, value FROM system_markers
         WHERE key IN (
           'pq_api_keys_enabled',
           'pq_api_keys_required',
           'pq_api_keys_wasm_ready',
           'pq_api_keys_integration'
         )`,
    ).all<{ key: string; value: string }>();

    const map: Record<string, string> = {};
    for (const r of rows.results ?? []) map[r.key] = r.value;

    return {
      enabled: (map['pq_api_keys_enabled'] ?? 'off') === 'on',
      required: (map['pq_api_keys_required'] ?? 'off') === 'on',
      wasmReady: (map['pq_api_keys_wasm_ready'] ?? 'off') === 'on',
      integrationPhase: map['pq_api_keys_integration'] ?? 'phase-h2-stub',
    };
  } catch {
    // Safe defaults on DB error: PQ off, HMAC continues to work.
    return { enabled: false, required: false, wasmReady: false, integrationPhase: 'phase-h2-stub' };
  }
}
