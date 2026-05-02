/**
 * Client-side PQ key helpers — Sprint 4 Phase H2 (PQ-Only stub).
 *
 * Mirrors the server's `src/server/lib/pq-crypto.ts` byte-shape contract
 * so that when WASM Dilithium2 lands in a follow-up sprint we can swap
 * the placeholder key generation for real ML-DSA / Dilithium2 without
 * breaking any UI / network code.
 *
 * Until WASM ships:
 *   - generateDilithium2KeyPair() returns a *placeholder* key pair whose
 *     bytes have the correct Dilithium2 lengths (1312 / 2528) so the
 *     server's structural validation passes, but it CANNOT be used to
 *     sign real requests. The matching server-side `verifyPqSignature`
 *     deliberately returns `wasm_unavailable` in this state, so neither
 *     side accidentally treats the placeholder as authoritative.
 *   - We label the downloaded artifact `phase-h2-stub` so future ops
 *     can identify and rotate stub keys cleanly.
 *
 * No external deps: uses Web Crypto + a small base64 helper that mirrors
 * the server-side encoder. Workers / browsers / Node18+ are all happy.
 */

/** Dilithium2 raw public key length (NIST round 3). */
export const DILITHIUM2_PUBKEY_BYTES = 1312;

/** Dilithium2 raw secret key length (NIST round 3). */
export const DILITHIUM2_SECRET_BYTES = 2528;

/** Dilithium2 signature length. Reserved for future use. */
export const DILITHIUM2_SIG_BYTES = 2420;

export interface PqKeyPair {
  /** base64-encoded raw public key bytes — sent to server. */
  publicKey: string;
  /** base64-encoded raw secret key bytes — kept by user, NEVER uploaded. */
  secretKey: string;
  /** Algorithm tag — matches `signature_alg` column. */
  algorithm: 'dilithium2';
  /** Marker so future ops can identify stub keys. */
  phase: 'phase-h2-stub';
  /** ISO timestamp of generation. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// base64 helpers (browser-safe, no Buffer)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Key pair generation (stub)
// ---------------------------------------------------------------------------

/**
 * Generate a Dilithium2-shaped key pair using cryptographically strong
 * randomness. The bytes are the right length for server validation but
 * are NOT a usable Dilithium2 key — see file header.
 *
 * Real implementation lands behind `pq_api_keys_wasm_ready=on`.
 */
export function generateDilithium2KeyPair(): PqKeyPair {
  const pub = new Uint8Array(DILITHIUM2_PUBKEY_BYTES);
  const sec = new Uint8Array(DILITHIUM2_SECRET_BYTES);
  crypto.getRandomValues(pub);
  crypto.getRandomValues(sec);
  return {
    publicKey: bytesToBase64(pub),
    secretKey: bytesToBase64(sec),
    algorithm: 'dilithium2',
    phase: 'phase-h2-stub',
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Download helpers — secret key gets handed to the user exactly once.
// ---------------------------------------------------------------------------

export interface DownloadablePqKey {
  /** filename suggested for the .json download. */
  filename: string;
  /** the JSON text the browser will save. */
  content: string;
}

/**
 * Build the JSON payload the user downloads. We deliberately include
 * the public key alongside the secret so a lost server-side row can be
 * recovered from the user's backup if needed.
 */
export function buildPqKeyDownload(opts: {
  apiKeyId: string;
  apiKey: string;
  label: string;
  keyPair: PqKeyPair;
}): DownloadablePqKey {
  const safeLabel = opts.label.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32) || 'key';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    filename: `quantaex-pq-key-${safeLabel}-${ts}.json`,
    content: JSON.stringify(
      {
        warning:
          'KEEP THIS FILE SECRET. The secret_key inside it CANNOT be recovered. ' +
          'QuantaEx never stores it. If you lose this file you must regenerate the API key.',
        api_key_id: opts.apiKeyId,
        api_key: opts.apiKey,
        label: opts.label,
        algorithm: opts.keyPair.algorithm,
        phase: opts.keyPair.phase,
        created_at: opts.keyPair.createdAt,
        public_key_b64: opts.keyPair.publicKey,
        secret_key_b64: opts.keyPair.secretKey,
        public_key_bytes: DILITHIUM2_PUBKEY_BYTES,
        secret_key_bytes: DILITHIUM2_SECRET_BYTES,
      },
      null,
      2,
    ),
  };
}

/**
 * Trigger a browser download for the given content. No-op on SSR.
 */
export function triggerDownload(file: DownloadablePqKey): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([file.content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Fingerprint helper — short SHA-256 of the public key, for the UI badge.
// ---------------------------------------------------------------------------

export async function publicKeyFingerprint(publicKeyB64: string): Promise<string> {
  try {
    const bin = atob(publicKeyB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const arr = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < 8; i++) {
      const b = arr[i];
      hex += (b < 16 ? '0' : '') + b.toString(16);
    }
    // 16-char fingerprint, grouped 4-4-4-4 for readability.
    return hex.replace(/(.{4})/g, '$1 ').trim();
  } catch {
    return '';
  }
}
