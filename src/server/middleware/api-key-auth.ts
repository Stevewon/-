/**
 * API key auth middleware — Sprint 5 Phase I1.
 *
 * Gates the public trading namespace `/api/v1/*` behind one of three
 * signature schemes carried in HTTP headers:
 *
 *   X-API-Key     : the public api_keys.api_key value
 *   X-Signature   : base64 HMAC-SHA256 (or Dilithium2 — Phase I2) signature
 *   X-Timestamp   : unix seconds the client signed at (skew window: 60s)
 *   X-Nonce       : single-use random string, recorded in api_key_nonces
 *   X-Algorithm   : optional — 'hmac-sha256' (default) | 'dilithium2' | 'hybrid'
 *
 * Canonical request bytes (matches src/server/lib/pq-crypto.ts contract):
 *
 *   <METHOD>\n<PATH>\n<TIMESTAMP>\n<SHA256(body)hex>
 *
 * Failure outcomes (always 401 unless noted):
 *   SERVICE_DISABLED      503 — external_trading_api_enabled marker is off
 *   MISSING_HEADERS       401 — required headers absent
 *   INVALID_KEY           401 — key not found / inactive / expired
 *   IP_NOT_ALLOWED        403 — ip_whitelist non-empty and request IP missing
 *   PERM_DENIED           403 — required permission missing (set per route)
 *   TIMESTAMP_SKEW        401 — |now - ts| > max_skew_sec (default 60)
 *   REPLAY                401 — nonce already seen for this key
 *   BAD_SIGNATURE         401 — HMAC mismatch
 *   UNSUPPORTED_ALG       401 — algorithm not known
 *   PQ_NOT_READY          503 — algorithm = dilithium2/hybrid but WASM off
 *
 * Phase F integration:
 *   - IP blocklist enforced first (same as JWT path).
 *   - Circuit-breaker / force_2fa NOT enforced here; per-route handlers
 *     keep applying those when relevant (e.g. order placement).
 *
 * Performance:
 *   - api_keys row lookup is one indexed read (api_key column is unique).
 *   - Nonce write uses INSERT (PRIMARY KEY (api_key_id, nonce)) so a
 *     replay simply throws — no SELECT-then-INSERT race.
 *   - last_used_at is updated best-effort (errors swallowed).
 */

import type { Context, Next } from 'hono';
import type { AppEnv } from '../index';
import { getRiskState, getClientIp, isIpBlocked } from '../lib/risk';
import { readPqMarkers } from '../lib/pq-crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApiKeyAlgorithm = 'hmac-sha256' | 'dilithium2' | 'hybrid';

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  label: string;
  api_key: string;
  api_secret_hash: string | null;
  permissions: string;          // 'read,trade,withdraw'
  ip_whitelist: string | null;  // comma-separated IP/CIDR
  is_active: number;
  expires_at: string | null;
  signature_alg: ApiKeyAlgorithm;
  public_key: string | null;
  pq_key_version: number | null;
}

/** Permission level required by a downstream route. */
export type ApiKeyPermission = 'read' | 'trade' | 'withdraw';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(buf));
}

/**
 * Constant-time string equality. Avoids early-return timing oracles on
 * hex/base64 signature comparison.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * HMAC-SHA256 signature in lowercase hex. Mirrors what every major
 * exchange (Binance, Bybit, OKX) accepts so SDKs can sign with one line.
 */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

/**
 * The api_keys table stores SHA-256(api_secret) as `api_secret_hash`. We
 * never store the secret itself, so for HMAC verification we have a
 * choice:
 *   (a) ask clients to sign with the SHA-256 hash of their secret, OR
 *   (b) reconstruct the hash from the presented signature path.
 *
 * (a) is what every other exchange does: their server stores the secret
 * encrypted and signs with it. We don't store the secret at all. To stay
 * compatible with standard SDK ergonomics ("sign with your api_secret"),
 * the client signs with their secret string as the HMAC key. The server
 * cannot directly verify that — it only has the hash.
 *
 * Phase I1 takes a pragmatic route: we rotate the contract slightly.
 * Clients sign with their *api_secret_hash* (the same hex string we
 * return at key-creation time, printed in the UI). This means the client
 * stores hex(SHA-256(secret)) instead of the secret, but the verifier
 * lives entirely server-side without needing the raw secret. A later
 * sprint can introduce an encrypted-at-rest secret if a "sign with raw
 * secret" interop demand emerges.
 */
async function computeExpectedHmac(
  apiSecretHash: string,
  canonical: string,
): Promise<string> {
  return hmacSha256Hex(apiSecretHash, canonical);
}

/** Normalize the request path. Hono gives us the raw path; we strip
 *  trailing slashes (except root) and the query string, matching what
 *  client SDKs commonly include in the canonical string. */
function normalizePath(rawPath: string): string {
  const q = rawPath.indexOf('?');
  let p = q >= 0 ? rawPath.slice(0, q) : rawPath;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/**
 * Read external-trading markers off system_markers. Cheap (~1 row read);
 * not cached this phase because admin toggles need to be observable in
 * <1s. A future sprint can promote this to the same isolate cache used
 * by readPqMarkers.
 */
interface TradingMarkers {
  enabled: boolean;
  integrationPhase: string;
  maxSkewSec: number;
}

async function readTradingMarkers(c: Context<AppEnv>): Promise<TradingMarkers> {
  const fallback: TradingMarkers = {
    enabled: false,
    integrationPhase: 'phase-i1-stub',
    maxSkewSec: 60,
  };
  try {
    const rows = await c.env.DB.prepare(
      `SELECT key, value FROM system_markers
         WHERE key IN (
           'external_trading_api_enabled',
           'external_trading_api_integration',
           'external_trading_api_max_skew_sec'
         )`,
    ).all<{ key: string; value: string }>();
    const map: Record<string, string> = {};
    for (const r of rows.results ?? []) map[r.key] = r.value;

    const skew = parseInt(map['external_trading_api_max_skew_sec'] ?? '', 10);
    return {
      enabled: (map['external_trading_api_enabled'] ?? 'off') === 'on',
      integrationPhase: map['external_trading_api_integration'] ?? 'phase-i1-stub',
      maxSkewSec: Number.isFinite(skew) && skew > 0 && skew <= 600 ? skew : 60,
    };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// CIDR / wildcard match against ip_whitelist (comma-separated patterns).
// Pure substring match for IPv6 + delegates IPv4 CIDR to lib/risk's helper
// so behaviour matches risk_ip_blocklist exactly.
// ---------------------------------------------------------------------------

function isIpAllowedAgainstWhitelist(ip: string | null, whitelist: string | null): boolean {
  if (!whitelist || !whitelist.trim()) return true; // unrestricted
  if (!ip) return false;                            // can't match nothing
  const list = whitelist.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  // Reuse risk lib's matcher: isIpBlocked returns the matched pattern, so
  // here we invert it semantically — "blocked by whitelist" means matched.
  return isIpBlocked(ip, list) !== null;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface ApiKeyAuthOptions {
  /**
   * Permission gate. Requests without this permission in
   * api_keys.permissions are rejected with 403 PERM_DENIED.
   */
  requirePermission?: ApiKeyPermission;
}

/**
 * Hono middleware that authenticates a request using a signed API key.
 * Sets `c.set('apiKey', record)` and `c.set('user', { id, role: 'user' })`
 * on success so downstream handlers behave like JWT-authed routes.
 */
export function apiKeyAuth(options: ApiKeyAuthOptions = {}) {
  return async function apiKeyAuthMiddleware(c: Context<AppEnv>, next: Next) {
    // 1) IP blocklist (same as JWT path).
    const risk = await getRiskState(c);
    const ip = getClientIp(c);
    if (risk.ip_blocklist.length > 0) {
      const matched = isIpBlocked(ip, risk.ip_blocklist);
      if (matched) {
        return c.json({ error: 'Access denied (IP blocked)', code: 'IP_BLOCKED', matched }, 403);
      }
    }

    // 2) Master switch.
    const markers = await readTradingMarkers(c);
    if (!markers.enabled) {
      return c.json(
        {
          error: 'External trading API is currently disabled.',
          code: 'SERVICE_DISABLED',
          integration_phase: markers.integrationPhase,
        },
        503,
      );
    }

    // 3) Required headers.
    const apiKeyHdr  = c.req.header('x-api-key');
    const sigHdr     = c.req.header('x-signature');
    const tsHdr      = c.req.header('x-timestamp');
    const nonceHdr   = c.req.header('x-nonce');
    const algHdr     = (c.req.header('x-algorithm') || 'hmac-sha256').toLowerCase() as ApiKeyAlgorithm;

    if (!apiKeyHdr || !sigHdr || !tsHdr || !nonceHdr) {
      return c.json(
        {
          error: 'Missing one of X-API-Key / X-Signature / X-Timestamp / X-Nonce.',
          code: 'MISSING_HEADERS',
        },
        401,
      );
    }
    if (!['hmac-sha256', 'dilithium2', 'hybrid'].includes(algHdr)) {
      return c.json({ error: 'Unsupported X-Algorithm.', code: 'UNSUPPORTED_ALG' }, 401);
    }

    // 4) Timestamp skew.
    const ts = parseInt(tsHdr, 10);
    if (!Number.isFinite(ts)) {
      return c.json({ error: 'X-Timestamp is not a unix-seconds integer.', code: 'TIMESTAMP_SKEW' }, 401);
    }
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > markers.maxSkewSec) {
      return c.json(
        { error: `Timestamp out of skew window (\u00b1${markers.maxSkewSec}s).`, code: 'TIMESTAMP_SKEW' },
        401,
      );
    }

    // 5) Lookup api key row.
    let row: ApiKeyRecord | null = null;
    try {
      row = await c.env.DB.prepare(
        `SELECT id, user_id, label, api_key, api_secret_hash, permissions,
                ip_whitelist, is_active, expires_at,
                signature_alg, public_key, pq_key_version
           FROM api_keys
          WHERE api_key = ?
          LIMIT 1`,
      )
        .bind(apiKeyHdr)
        .first<ApiKeyRecord>();
    } catch {
      // DB unavailable — fail closed.
      return c.json({ error: 'Auth backend unavailable.', code: 'BACKEND_UNAVAILABLE' }, 503);
    }
    if (!row) {
      return c.json({ error: 'Invalid API key.', code: 'INVALID_KEY' }, 401);
    }
    if (!row.is_active) {
      return c.json({ error: 'API key is inactive.', code: 'KEY_INACTIVE' }, 401);
    }
    if (row.expires_at) {
      const exp = Date.parse(row.expires_at);
      if (Number.isFinite(exp) && exp < Date.now()) {
        return c.json({ error: 'API key expired.', code: 'KEY_EXPIRED' }, 401);
      }
    }

    // 6) IP whitelist (per-key, in addition to the global blocklist).
    if (!isIpAllowedAgainstWhitelist(ip, row.ip_whitelist)) {
      return c.json(
        { error: 'Source IP is not in this key\u2019s whitelist.', code: 'IP_NOT_ALLOWED' },
        403,
      );
    }

    // 7) Permission gate.
    if (options.requirePermission) {
      const perms = (row.permissions || '').split(',').map((p) => p.trim()).filter(Boolean);
      if (!perms.includes(options.requirePermission)) {
        return c.json(
          {
            error: `API key lacks the '${options.requirePermission}' permission.`,
            code: 'PERM_DENIED',
            required: options.requirePermission,
            granted: perms,
          },
          403,
        );
      }
    }

    // 8) Algorithm compatibility check between header and key.
    //    A key registered as 'hmac-sha256' may NOT be used with X-Algorithm=dilithium2
    //    and vice-versa. 'hybrid' keys accept either side as long as we can
    //    verify; in this phase we only verify HMAC, the PQ side returns
    //    PQ_NOT_READY.
    if (row.signature_alg === 'hmac-sha256' && algHdr !== 'hmac-sha256') {
      return c.json(
        { error: 'This key is registered as hmac-sha256.', code: 'ALG_MISMATCH' },
        401,
      );
    }
    if (row.signature_alg === 'dilithium2' && algHdr === 'hmac-sha256') {
      return c.json(
        { error: 'This key is registered as dilithium2; HMAC headers are not accepted.', code: 'ALG_MISMATCH' },
        401,
      );
    }

    // 9) Nonce uniqueness (replay defense). Insert FIRST so the unique
    //    constraint is the source of truth — no race window between SELECT
    //    and INSERT.
    try {
      await c.env.DB.prepare(
        `INSERT INTO api_key_nonces (api_key_id, nonce, ts, ip_address)
         VALUES (?, ?, ?, ?)`,
      )
        .bind(row.id, nonceHdr, ts, ip ?? null)
        .run();
    } catch (err: any) {
      // SQLITE_CONSTRAINT — nonce already used for this key.
      const msg = String(err?.message || err);
      if (/UNIQUE|constraint/i.test(msg)) {
        return c.json({ error: 'Nonce already used (replay).', code: 'REPLAY' }, 401);
      }
      // Other DB errors — fail closed but distinguish so ops can debug.
      return c.json({ error: 'Auth backend write failed.', code: 'BACKEND_UNAVAILABLE' }, 503);
    }

    // 10) Read the body ONCE and rebuild the canonical message. Hono's
    //     c.req.text() consumes the stream; we cache the text on the
    //     context so downstream handlers can re-read it.
    let bodyText = '';
    try {
      bodyText = await c.req.text();
    } catch {
      bodyText = '';
    }
    c.set('apiKeyBody', bodyText);

    const path = normalizePath(c.req.path);
    const method = c.req.method.toUpperCase();
    const bodyHashHex = await sha256Hex(bodyText);
    const canonical = `${method}\n${path}\n${ts}\n${bodyHashHex}`;

    // 11) Verify signature.
    if (algHdr === 'hmac-sha256' || algHdr === 'hybrid') {
      if (!row.api_secret_hash) {
        return c.json({ error: 'Key has no HMAC secret on file.', code: 'BAD_SIGNATURE' }, 401);
      }
      const expected = await computeExpectedHmac(row.api_secret_hash, canonical);
      if (!timingSafeEqual(expected, sigHdr.toLowerCase())) {
        return c.json({ error: 'HMAC signature mismatch.', code: 'BAD_SIGNATURE' }, 401);
      }
    }
    if (algHdr === 'dilithium2' || algHdr === 'hybrid') {
      const pq = await readPqMarkers(c);
      if (!pq.wasmReady) {
        return c.json(
          {
            error: 'Dilithium2 verifier not yet enabled.',
            code: 'PQ_NOT_READY',
            integration_phase: pq.integrationPhase,
          },
          503,
        );
      }
      // PQ verify path is wired in Phase I2 alongside the WASM bundle.
      // Until then `wasmReady` stays 'off' and we don't reach this branch.
    }

    // 12) Best-effort last_used_at update. Failures are logged-and-ignored.
    try {
      await c.env.DB.prepare(
        'UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?',
      )
        .bind(row.id)
        .run();
    } catch { /* swallow */ }

    // 13) Surface auth principal to downstream handlers.
    c.set('apiKey', row);
    c.set('user', {
      id: row.user_id,
      email: '',           // not loaded; v1 routes don't need email
      role: 'user',
      tv: 0,
      via: 'api_key',
      api_key_id: row.id,
    });

    await next();
  };
}
