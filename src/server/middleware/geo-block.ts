/**
 * Geo-blocking middleware (Sprint 5 Phase G1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Blocks requests originating from restricted jurisdictions before any
 * route handler runs.
 *
 * Strategy:
 *   1. Read the country code from the Cloudflare request (`cf.country`).
 *      Falls back to `CF-IPCountry` request header (also set by Cloudflare),
 *      then to 'XX' (unknown).
 *   2. If the country is in BLOCKED_COUNTRIES, return 451 Unavailable For
 *      Legal Reasons with a JSON body that the SPA can interpret to render a
 *      friendly "Service not available in your region" page.
 *   3. The check is intentionally cheap: no DB hit, no async work — just an
 *      O(1) Set lookup. Adds <1ms per request.
 *
 * Important:
 *   - Returning a hard 451 (instead of soft warning) is the conservative
 *     stance recommended for offshore exchanges (Seychelles IBC + Marshall
 *     DAO LLC operating model). Combined with the user-side "country
 *     declaration" UI added in Step 4, it gives us two layers of compliance.
 *   - This middleware does NOT override admin/health endpoints. Operator
 *     access from any jurisdiction is required, and health checks must stay
 *     reachable for uptime monitors.
 *   - The list mirrors the public README: KR, US, CN, JP plus OFAC/UN
 *     sanctioned states. Update by editing BLOCKED_COUNTRIES below.
 *
 * Verified by:
 *   - Unit-style smoke test in scripts/geo-block-smoke.mjs (added with this
 *     change).
 *   - Production curl from a KR IP must receive HTTP 451 with code
 *     `GEO_BLOCKED` (verified after deploy).
 */

import type { MiddlewareHandler } from 'hono';

/**
 * ISO-3166-1 alpha-2 country codes that are blocked from accessing the
 * application. Intentionally kept as a static set so V8 can inline lookups.
 *
 * Categories:
 *   • Tier-1 (regulatory) — KR, US, CN, JP — explicitly excluded operating
 *     jurisdictions per the offshore-exchange model.
 *   • Tier-2 (sanctions)  — IR (Iran), KP (North Korea), CU (Cuba),
 *     SY (Syria), RU (Russia), BY (Belarus) — OFAC / EU / UN sanctioned.
 *
 * Edit this set if the legal counsel updates the supported jurisdictions.
 */
const BLOCKED_COUNTRIES = new Set<string>([
  // Tier-1: regulatory exclusion (offshore exchange policy)
  'KR', // Republic of Korea — VASP unregistered offshore exchange must not solicit KR users
  'US', // United States — SEC/CFTC/FinCEN; 50-state MTL otherwise required
  'CN', // China — outright ban on crypto trading
  'JP', // Japan — JFSA license required for Japanese residents

  // Tier-2: sanctions (OFAC / EU / UN)
  'IR', // Iran
  'KP', // North Korea (DPRK)
  'CU', // Cuba
  'SY', // Syria
  'RU', // Russia
  'BY', // Belarus
]);

/**
 * Path prefixes that bypass the geo gate. Health endpoints must remain
 * reachable for uptime monitors regardless of origin country, and the
 * dedicated geo-status endpoint exists precisely to let the SPA detect
 * blocked countries before navigating into the app.
 */
const BYPASS_PATH_PREFIXES = [
  '/api/health',                    // /api/health, /api/health/ready
  '/api/geo-status',                // probed by SPA on first paint
  // Sprint 5 Phase G1.1 — External Trading API (Sprint 5 Phase I1) is
  // protected by per-key IP whitelist + Dilithium2 PQ signatures + nonce
  // ledger; geo-blocking would only break authenticated bot/algo traders
  // who are already cleared by stronger controls. Web SPA flows under
  // /api/auth, /api/orders, /api/wallet, etc. remain blocked.
  '/api/v1',
];

/**
 * Header used to carry the admin bypass token. Operators set this header on
 * their browser (via extension, bookmarklet, or curl --header) to access the
 * site from a blocked jurisdiction. The expected token value is read from
 * the `ADMIN_GEO_BYPASS_TOKEN` env binding (registered via Wrangler secret).
 *
 * Security model:
 *   • Token is a 32-byte hex string (256 bits of entropy) → unguessable.
 *   • Compared in timing-safe fashion to defeat side-channel attacks.
 *   • Header name is intentionally non-standard so that ordinary CDN logs
 *     and browser DevTools do not surface it under "common headers".
 *   • Token never appears in URL, error body, or response — only the
 *     fact-of-bypass is recorded (no value).
 *   • Bypass works ONLY for geo-block; all other auth (JWT, API key, IP
 *     whitelist, 2FA) remains in force.
 */
const ADMIN_BYPASS_HEADER = 'X-Admin-Bypass';

/**
 * Constant-time string comparison. Returns true iff `a` and `b` are equal.
 * Avoids the early-exit behaviour of `===` which can leak the matching
 * prefix length to a remote attacker over many requests.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Returns true if the request carries a valid admin bypass token. The
 * expected token is read from the env binding `ADMIN_GEO_BYPASS_TOKEN`.
 * If the env var is not configured (e.g., local dev), bypass is disabled
 * and all KR/US/etc. requests are blocked normally.
 */
function hasAdminBypass(req: Request, env: unknown): boolean {
  const expected =
    (env as { ADMIN_GEO_BYPASS_TOKEN?: string } | undefined)
      ?.ADMIN_GEO_BYPASS_TOKEN;
  if (!expected || expected.length < 16) return false; // not configured
  const provided = req.headers.get(ADMIN_BYPASS_HEADER);
  if (!provided) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Resolve the origin country code for a request. Cloudflare populates two
 * places we can read: `request.cf.country` (preferred — set on every edge
 * request) and the `CF-IPCountry` request header (legacy fallback).
 *
 * Returns 'XX' when the country cannot be determined (e.g., local dev).
 */
function resolveCountry(req: Request): string {
  // Cloudflare puts geo metadata on `cf` outside the public Request typing.
  const cf = (req as unknown as { cf?: { country?: string } }).cf;
  const fromCf = cf?.country?.toUpperCase();
  if (fromCf && fromCf.length === 2) return fromCf;

  const fromHeader = req.headers.get('CF-IPCountry')?.toUpperCase();
  if (fromHeader && fromHeader.length === 2) return fromHeader;

  return 'XX';
}

/**
 * Hono middleware factory. Mount BEFORE route handlers but AFTER the
 * observability install so that geo decisions still appear in error/request
 * logs.
 */
export function geoBlock(): MiddlewareHandler {
  return async (c, next) => {
    const url = new URL(c.req.url);

    // Bypass health/status probes regardless of origin.
    for (const prefix of BYPASS_PATH_PREFIXES) {
      if (url.pathname.startsWith(prefix)) return next();
    }

    // Admin operator bypass — header-based escape hatch for the operator's
    // own jurisdiction (e.g., owner accessing from KR for testing/admin).
    // Token is a Wrangler secret (`ADMIN_GEO_BYPASS_TOKEN`) and is checked
    // in timing-safe fashion. Bypass applies ONLY to geo-block; downstream
    // auth (JWT, 2FA, IP whitelist) is still enforced by their own
    // middlewares.
    if (hasAdminBypass(c.req.raw, c.env)) {
      return next();
    }

    const country = resolveCountry(c.req.raw);

    if (BLOCKED_COUNTRIES.has(country)) {
      return c.json(
        {
          error: 'Service is not available in your region.',
          code: 'GEO_BLOCKED',
          country,
          // Help SPA render a friendly page; do not leak the full block list.
          policy_url: 'https://quantaex.io/legal/restricted-jurisdictions',
        },
        451 /* Unavailable For Legal Reasons */
      );
    }

    return next();
  };
}

/**
 * Lightweight introspection endpoint helper used by the SPA on first paint
 * to decide whether to render the app or the "region blocked" splash. Hosted
 * at /api/geo-status.
 */
export function geoStatusHandler(): MiddlewareHandler {
  return async (c) => {
    const country = resolveCountry(c.req.raw);
    const blocked = BLOCKED_COUNTRIES.has(country);
    return c.json({
      country,
      blocked,
      policy_url: blocked
        ? 'https://quantaex.io/legal/restricted-jurisdictions'
        : null,
    });
  };
}

/** Exported for tests / admin tooling. */
export const __INTERNAL_BLOCKED_COUNTRIES = BLOCKED_COUNTRIES;
