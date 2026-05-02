/**
 * Risk marker helpers — Sprint 4 Phase F.
 *
 * Provides cached read access to the risk markers stored in `system_markers`
 * by the admin Risk panel (see src/server/routes/risk.ts). Used by:
 *
 *   - auth middleware  → IP blocklist enforcement (HTTP 403)
 *   - order route      → circuit breaker enforcement on new orders (HTTP 503)
 *   - wallet route     → forced 2FA enforcement on withdrawals (HTTP 401)
 *
 * Markers consumed (read-only here; writes happen in routes/risk.ts):
 *   risk_circuit_breaker        : 'on' | 'off'
 *   risk_circuit_breaker_reason : free text (optional)
 *   risk_force_2fa              : 'on' | 'off'
 *   risk_ip_blocklist           : JSON array of IP / CIDR strings
 *
 * Per-isolate in-memory cache with a short TTL keeps the hot path cheap:
 * each Cloudflare Worker isolate hits D1 at most once every CACHE_TTL_MS,
 * regardless of request volume. Admin mutations call `invalidateRiskCache()`
 * to force a refresh on the next request.
 */

import type { Context } from 'hono';
import type { AppEnv } from '../index';

export interface RiskState {
  circuit_breaker: { enabled: boolean; reason: string | null };
  force_2fa: { enabled: boolean };
  ip_blocklist: string[];
  fetched_at: number;
}

const CACHE_TTL_MS = 30_000; // 30 s — admin actions surface within ~30 s globally
let cached: RiskState | null = null;

function emptyState(): RiskState {
  return {
    circuit_breaker: { enabled: false, reason: null },
    force_2fa: { enabled: false },
    ip_blocklist: [],
    fetched_at: Date.now(),
  };
}

function parseList(s: string | null): string[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Force-refresh on next read. Called by /risk/* mutation endpoints so that
 * admin toggles propagate quickly within a worker isolate.
 */
export function invalidateRiskCache(): void {
  cached = null;
}

/**
 * Read all risk markers, caching for CACHE_TTL_MS. Returns a safe default
 * (everything off, empty blocklist) if D1 is unreachable — fail open is
 * preferable to taking the exchange down on a transient query error.
 */
export async function getRiskState(c: Context<AppEnv>): Promise<RiskState> {
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT key, value FROM system_markers
       WHERE key IN (
         'risk_circuit_breaker',
         'risk_circuit_breaker_reason',
         'risk_force_2fa',
         'risk_ip_blocklist'
       )`
    ).all<{ key: string; value: string }>();

    const map = new Map<string, string>();
    for (const r of results || []) map.set(r.key, r.value);

    cached = {
      circuit_breaker: {
        enabled: map.get('risk_circuit_breaker') === 'on',
        reason: map.get('risk_circuit_breaker_reason') || null,
      },
      force_2fa: { enabled: map.get('risk_force_2fa') === 'on' },
      ip_blocklist: parseList(map.get('risk_ip_blocklist') || null),
      fetched_at: Date.now(),
    };
    return cached;
  } catch {
    // Fail open — never block traffic because of a transient D1 hiccup.
    return emptyState();
  }
}

// ---------------------------------------------------------------------------
// IP / CIDR matching
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

/**
 * Returns true if `ip` matches `pattern`. `pattern` may be:
 *   - a literal IP        ('1.2.3.4', '::1')
 *   - an IPv4 CIDR block  ('10.0.0.0/8', '192.168.1.0/24')
 *   - an IPv6 substring   (best-effort substring match for now)
 */
export function ipMatches(ip: string, pattern: string): boolean {
  if (!ip || !pattern) return false;
  if (ip === pattern) return true;

  if (pattern.includes('/')) {
    const [base, bitsStr] = pattern.split('/');
    const bits = Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
      // Non-IPv4 CIDR — fall back to exact match
      return ip === base;
    }
    const ipInt = ipv4ToInt(ip);
    const baseInt = ipv4ToInt(base);
    if (ipInt === null || baseInt === null) return false;
    if (bits === 0) return true;
    const mask = (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
  }

  // IPv6 (or unrecognised) — best-effort substring match
  if (ip.includes(':') && pattern.includes(':')) {
    return ip.toLowerCase() === pattern.toLowerCase();
  }
  return false;
}

/**
 * Best-effort client-IP extraction. Cloudflare always sets `cf-connecting-ip`
 * for traffic that traverses its edge; we fall back to standard headers for
 * local dev / direct invocations.
 */
export function getClientIp(c: Context<AppEnv>): string | null {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-real-ip') ||
    (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
    null
  );
}

/**
 * Returns the matching blocklist pattern if `ip` is blocked, or null otherwise.
 */
export function isIpBlocked(ip: string | null, blocklist: string[]): string | null {
  if (!ip || !blocklist?.length) return null;
  for (const pattern of blocklist) {
    if (ipMatches(ip, pattern)) return pattern;
  }
  return null;
}
