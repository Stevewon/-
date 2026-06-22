import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoutes from './routes/auth';
import marketRoutes from './routes/market';
import orderRoutes from './routes/order';
import walletRoutes from './routes/wallet';
import adminRoutes from './routes/admin';
import notificationRoutes from './routes/notifications';
import noticeRoutes from './routes/notices';
import priceAlertRoutes from './routes/priceAlerts';
import profileRoutes from './routes/profile';
import chainRoutes from './routes/chain';
import riskRoutes from './routes/risk';
import bridgeRoutes from './routes/bridge';
import futuresRoutes from './routes/futures';
import marginRoutes from './routes/margin';
import v1Routes from './routes/v1';
import { installObservability, captureError } from './utils/observability';
import { geoBlock, geoStatusHandler } from './middleware/geo-block';

export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
  // Sprint 3+ observability (all optional)
  SENTRY_DSN?: string;
  LOGFLARE_API_KEY?: string;
  LOGFLARE_SOURCE?: string;
  ENVIRONMENT?: string;
  // Sprint 4 Phase B — QTA native chain integration (all optional, mock by default)
  QTA_CHAIN_DRIVER?: string;        // 'mock' | 'real'
  QTA_NETWORK?: string;             // 'qta-mainnet' | 'qta-testnet'
  QTA_RPC_URL?: string;
  QTA_HOT_WALLET_PRIVATE_KEY?: string;
  // Sprint 4 Phase G — QTA <-> ETH bridge (all optional, mock by default)
  BRIDGE_DRIVER?: string;           // 'mock' | 'real'
  BRIDGE_NETWORK?: string;          // 'mainnet' | 'sepolia'
  ETH_RPC_URL?: string;
  BRIDGE_PRIVATE_KEY?: string;      // bridge custodian wallet (signs mint/burn)
  QQTA_CONTRACT_ADDR?: string;
  // Sprint 6 Phase A — R2 bucket for KYC documents (optional).
  // When this binding is present, KYC document uploads stream to R2 and the
  // returned key is stored in kyc_documents.r2_key. When absent, the code
  // falls back to SHA-256 content-hash tags (no actual storage). Boss must
  // add an r2_buckets entry in wrangler.jsonc to enable R2 storage:
  //   "r2_buckets": [{ "binding": "KYC_BUCKET", "bucket_name": "quantaex-kyc" }]
  KYC_BUCKET?: R2Bucket;
};

export type AppVars = {
  // JWT path sets the slim shape; api-key path sets the extended shape with
  // `via: 'api_key'`. Optional fields keep both call-sites compatible.
  user: {
    id: string;
    email: string;
    role: string;
    tv?: number;
    via?: 'jwt' | 'api_key';
    api_key_id?: string;
  };
  // Sprint 5 Phase I1 — set by src/server/middleware/api-key-auth.ts.
  apiKey?: import('./middleware/api-key-auth').ApiKeyRecord;
  apiKeyBody?: string;
};

export type AppEnv = { Bindings: Env; Variables: AppVars };

const app = new Hono<AppEnv>();

// Sprint 3+ #3: global error / 404 handler + Sentry/Logflare forwarding.
// Install FIRST so any middleware/route that throws is captured.
installObservability(app as any);

// CORS for API routes
app.use('/api/*', cors());

// Sprint 5 Phase G1 — Geo-blocking gate.
// Mounted directly after CORS so cross-origin preflight succeeds, but the
// gate runs before any route handler / auth / self-scheduler. KR/US/CN/JP
// + sanctioned countries get HTTP 451 with code GEO_BLOCKED.
// /api/health* and /api/geo-status are bypassed inside the middleware.
app.use('/api/*', geoBlock());

// Public country probe used by the SPA on first paint to decide whether to
// render the app or the "region blocked" splash. Always reachable.
app.get('/api/geo-status', geoStatusHandler());

// ============================================================================
// Self-scheduling price-alert check
// Runs (at most) once per SELF_SCHEDULE_INTERVAL_MS via waitUntil when an
// incoming API request detects that the last run is stale. This works even on
// Cloudflare Pages Functions (which doesn't support Cron Triggers) because
// each incoming request gets the chance to kick off a background check.
// ============================================================================
const SELF_SCHEDULE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// Sprint 5 Phase D3-α: nonce sweep cadence — hourly is plenty since the
// skew window caps at 600s and we delete rows older than 24h.
const NONCE_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
let lastSelfScheduleAttempt = 0;
let lastNonceSweepAttempt = 0;
// One-shot guard for QKEY listing self-apply (migration 0028).
// Set true after first successful run so warm isolates skip the marker query.
let qkeyBootstrapDone = false;
// One-shot guard for referral QTA→QX switch self-apply (migration 0029).
let referralQxBootstrapDone = false;
// One-shot guard for Google OAuth schema self-apply (migration 0030).
let googleOauthBootstrapDone = false;
let referralMultilevelBootstrapDone = false;
// 2026-05-14: boss-ordered rate change L1=100/L2=50/L3=30 (was 50/30/20).
// Self-bootstrap that idempotently updates the policy markers; new signups
// already credit at the new rate via REFERRER_REWARD_L*_QX. Historical
// `referrals` rows keep their original reward_qta (option A — new only).
let referralRate20260514BootstrapDone = false;
// 2026-06-22: ★★★★★★★ Boss's permanent rule — company-issued amounts
// (sign-up bonus, referral rewards, daily rewards, admin credits) MUST NOT
// be withdrawn externally. Schema-level lock via wallets.available_initial
// (migration 0032). Self-bootstrap that idempotently:
//   1) ADD COLUMN wallets.available_initial REAL DEFAULT 0 (try/catch if exists)
//   2) Pre-launch backfill: SET available_initial = available for every row
//      where available > 0 AND available_initial = 0 (fail-closed). Boss can
//      selectively unlock test/admin accounts via SQL after deploy.
//   3) Stamp marker company_issued_lock_2026_06_22 = migrated_v1 so steady-
//      state cost is one SELECT.
let companyIssuedLockBootstrapDone = false;
// 2026-06-22: Boss-ordered post-launch quality items:
//   (a) Age gate (18+) — adds users.date_of_birth; new registrations must
//       supply it, existing users get NULL and can fill in later.
//   (b) DB-managed notices — drops the hard-coded NOTICES_KO/NOTICES_EN
//       array in NoticePage.tsx in favour of `notices` table that admins
//       can CRUD via the AdminPage > Notices tab. Seeded with the 6
//       legacy notices so users see the same content.
//   (c) KYC document registry — `kyc_documents` table tracks R2 object
//       keys (when R2 binding is present) or SHA-256 content tags
//       (fallback). Replaces single TEXT columns kyc_id_document_url /
//       kyc_address_document_url with a full audit trail (filename,
//       mime, size, uploader IP, timestamp).
// Same self-apply pattern as 0028/0029/0030/0031/0032.
let ageGateNoticesKycDocsBootstrapDone = false;

app.use('/api/*', async (c, next) => {
  // Fast path: skip the DB lookup on every request by using an in-memory
  // throttle first (60s). Multiple isolates may race; the DB check is the
  // authoritative guard.
  const now = Date.now();
  if (now - lastSelfScheduleAttempt > 60_000) {
    lastSelfScheduleAttempt = now;

    // Fire-and-forget via ctx.waitUntil so it never blocks the response
    const ctx = c.executionCtx as any;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          try {
            const row = await c.env.DB.prepare(
              "SELECT value FROM system_state WHERE key = 'price_alert_last_run'"
            ).first<{ value: string }>();

            // Auto-seed if the marker row doesn't exist (e.g., fresh DB)
            if (!row) {
              await c.env.DB.prepare(
                "INSERT OR IGNORE INTO system_state (key, value) VALUES ('price_alert_last_run', '0')"
              ).run();
            }

            const last = row ? parseInt(row.value || '0', 10) : 0;
            if (now - last < SELF_SCHEDULE_INTERVAL_MS) return;

            // Optimistic lock: only proceed if we successfully move the
            // marker forward. Other isolates racing will see the already-
            // incremented value and back off.
            const upd = await c.env.DB.prepare(
              `UPDATE system_state SET value = ?, updated_at = CURRENT_TIMESTAMP
               WHERE key = 'price_alert_last_run' AND CAST(value AS INTEGER) = ?`
            ).bind(String(now), last).run();

            // If no row was updated we lost the race
            if (!upd.meta || upd.meta.changes === 0) return;

            const result = await checkPriceAlerts(c.env);
            console.log('[self-scheduler] price-alert check:', result);
          } catch (e) {
            captureError(c as any, e, { where: 'self-scheduler' });
            // On failure, allow next request to retry sooner by rolling
            // back the in-memory throttle
            lastSelfScheduleAttempt = 0;
          }
        })()
      );
    }
  }

  // Sprint 5 Phase D3-α: piggy-back nonce sweep on incoming traffic.
  // Cloudflare Pages does not expose cron triggers, so we reuse the proven
  // self-scheduler pattern with its own marker (last_nonce_sweep_at) and
  // a longer 60-minute cadence so we don't crowd the price-alert tick.
  if (now - lastNonceSweepAttempt > 5 * 60_000) {
    lastNonceSweepAttempt = now;
    const ctx = c.executionCtx as any;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          try {
            const row = await c.env.DB.prepare(
              "SELECT value FROM system_state WHERE key = 'last_nonce_sweep_at'",
            ).first<{ value: string }>();

            if (!row) {
              await c.env.DB.prepare(
                "INSERT OR IGNORE INTO system_state (key, value) VALUES ('last_nonce_sweep_at', '0')",
              ).run();
            }

            const last = row ? parseInt(row.value || '0', 10) : 0;
            if (now - last < NONCE_SWEEP_INTERVAL_MS) return;

            const upd = await c.env.DB.prepare(
              `UPDATE system_state SET value = ?, updated_at = CURRENT_TIMESTAMP
               WHERE key = 'last_nonce_sweep_at' AND CAST(value AS INTEGER) = ?`,
            ).bind(String(now), last).run();

            if (!upd.meta || upd.meta.changes === 0) return;

            const { sweepExpiredNonces } = await import('./lib/nonce-sweep');
            const result = await sweepExpiredNonces(c.env);
            console.log('[self-scheduler] nonce sweep:', result);
          } catch (e) {
            captureError(c as any, e, { where: 'self-scheduler-nonce' });
            lastNonceSweepAttempt = 0;
          }
        })(),
      );
    }
  }

  // ------------------------------------------------------------------
  // One-shot QKEY listing bootstrap (migration 0028 self-apply).
  // Pages workers cannot run `wrangler d1 migrations apply` themselves,
  // and the deploy workflow could not be patched in this rollout due to
  // GitHub App token lacking `workflows` permission. We piggy-back on
  // the existing self-scheduler pattern: the very first request after a
  // cold start checks system_markers for `qkey_listing = live` and, if
  // missing, idempotently inserts the QKEY coin row, the QKEY/USDT and
  // QKEY/USDC market rows, and backfills 0/0 wallets for every user.
  // Uses INSERT OR IGNORE so re-running is safe; the marker prevents
  // even the cheap idempotent statements from being re-run on warm
  // isolates.
  // ------------------------------------------------------------------
  if (!qkeyBootstrapDone) {
    const ctx = c.executionCtx as any;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          try {
            const marker = await c.env.DB.prepare(
              "SELECT value FROM system_markers WHERE key = 'qkey_listing'"
            ).first<{ value: string }>();
            if (marker && marker.value === 'live') {
              qkeyBootstrapDone = true;
              return;
            }
            // Coin row
            await c.env.DB.prepare(
              `INSERT OR IGNORE INTO coins (
                 id, symbol, name, icon, decimals, price_usd, change_24h,
                 volume_24h, high_24h, low_24h, market_cap, is_active, sort_order
               ) VALUES (
                 'c-qkey','QKEY','Cookie',NULL,8,0.01,0,0,0.01,0.01,0,1,12
               )`
            ).run();
            // Market pairs
            await c.env.DB.batch([
              c.env.DB.prepare(
                `INSERT OR IGNORE INTO markets (
                   id, base_coin, quote_coin,
                   min_order_amount, min_order_total,
                   price_decimals, amount_decimals,
                   maker_fee, taker_fee, is_active
                 ) VALUES ('m-qkey-usdt','QKEY','USDT',0.0001,1,6,6,0.001,0.001,1)`
              ),
              c.env.DB.prepare(
                `INSERT OR IGNORE INTO markets (
                   id, base_coin, quote_coin,
                   min_order_amount, min_order_total,
                   price_decimals, amount_decimals,
                   maker_fee, taker_fee, is_active
                 ) VALUES ('m-qkey-usdc','QKEY','USDC',0.0001,1,6,6,0.001,0.001,1)`
              ),
            ]);
            // Backfill 0/0 QKEY wallet for every user that doesn't have one yet
            await c.env.DB.prepare(
              `INSERT OR IGNORE INTO wallets (id, user_id, coin_symbol, available, locked)
               SELECT lower(hex(randomblob(16))), u.id, 'QKEY', 0, 0
               FROM users u
               WHERE NOT EXISTS (
                 SELECT 1 FROM wallets w
                 WHERE w.user_id = u.id AND w.coin_symbol = 'QKEY'
               )`
            ).run();
            // Mark complete (and record that QKEY shares the QTA mainnet)
            await c.env.DB.batch([
              c.env.DB.prepare(
                `INSERT INTO system_markers (key, value, updated_at)
                 VALUES ('qkey_listing','live',CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
              ),
              c.env.DB.prepare(
                `INSERT INTO system_markers (key, value, updated_at)
                 VALUES ('qkey_chain','qta-mainnet',CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
              ),
            ]);
            qkeyBootstrapDone = true;
            console.log('[bootstrap] QKEY listing applied to production D1');
          } catch (e) {
            captureError(c as any, e, { where: 'qkey-bootstrap' });
          }
        })()
      );
    }
  }

  // ------------------------------------------------------------------
  // One-shot referral QTA→QX switch bootstrap (migration 0029 self-apply).
  // Same pattern as the QKEY bootstrap above. The very first request
  // after a cold start checks system_markers for
  // `migration_0029_referral_qx_switch = live` and, if missing,
  // idempotently:
  //   * Reverses 500 QTA already credited per referrals row (clamped).
  //   * Credits 50 QX per referrals row to the referrer.
  //   * For unverified users: clears the legacy 1000 QTA locked welcome
  //     bonus and sets a 100 QX locked welcome bonus instead.
  //   * Sets policy markers (referral_reward_coin=QX,
  //     referral_reward_amount=50, referral_welcome_amount=100).
  // The ALTER TABLE that adds `rewarded_in_qx` to referrals can only run
  // once per database, so it is wrapped in a try/catch — every other
  // statement uses INSERT OR IGNORE / clamped UPDATE / explicit
  // `WHERE rewarded_in_qx = 0`, so re-running is safe.
  // ------------------------------------------------------------------
  if (!referralQxBootstrapDone) {
    const ctx = c.executionCtx as any;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          try {
            const marker = await c.env.DB.prepare(
              "SELECT value FROM system_markers WHERE key = 'migration_0029_referral_qx_switch'"
            ).first<{ value: string }>();
            if (marker && marker.value === 'live') {
              referralQxBootstrapDone = true;
              return;
            }
            // Add the rewarded_in_qx idempotency column. Wrapped in
            // try/catch because ALTER TABLE … ADD COLUMN fails if the
            // column already exists (e.g. partial prior run).
            try {
              await c.env.DB.prepare(
                'ALTER TABLE referrals ADD COLUMN rewarded_in_qx INTEGER NOT NULL DEFAULT 0'
              ).run();
            } catch (_e) {
              // column already exists — fine, continue with the rest.
            }

            // 1) Policy markers
            await c.env.DB.batch([
              c.env.DB.prepare(
                `INSERT INTO system_markers (key, value, updated_at)
                 VALUES ('referral_reward_coin','QX',CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
              ),
              c.env.DB.prepare(
                `INSERT INTO system_markers (key, value, updated_at)
                 VALUES ('referral_reward_amount','50',CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
              ),
              c.env.DB.prepare(
                `INSERT INTO system_markers (key, value, updated_at)
                 VALUES ('referral_welcome_amount','100',CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
              ),
            ]);

            // 2a) Reverse 500 QTA available per referrals row (clamped).
            await c.env.DB.prepare(
              `UPDATE wallets
                  SET available = MAX(0, available - 500)
                WHERE coin_symbol = 'QTA'
                  AND user_id IN (
                    SELECT referrer_id FROM referrals WHERE rewarded_in_qx = 0
                  )`
            ).run();

            // 2b) Ensure each affected referrer has a QX wallet row.
            await c.env.DB.prepare(
              `INSERT OR IGNORE INTO wallets (id, user_id, coin_symbol, available, locked)
               SELECT lower(hex(randomblob(16))), r.referrer_id, 'QX', 0, 0
               FROM (SELECT DISTINCT referrer_id FROM referrals WHERE rewarded_in_qx = 0) r
               WHERE NOT EXISTS (
                 SELECT 1 FROM wallets w
                 WHERE w.user_id = r.referrer_id AND w.coin_symbol = 'QX'
               )`
            ).run();

            // 2c) Credit 50 QX available per referral row to the referrer.
            await c.env.DB.prepare(
              `UPDATE wallets
                  SET available = available + (
                    SELECT COUNT(*) * 50 FROM referrals
                    WHERE referrer_id = wallets.user_id AND rewarded_in_qx = 0
                  )
                WHERE coin_symbol = 'QX'
                  AND user_id IN (
                    SELECT referrer_id FROM referrals WHERE rewarded_in_qx = 0
                  )`
            ).run();

            // 2d) Update reward_qta to 50 and mark rows paid-in-QX.
            await c.env.DB.prepare(
              `UPDATE referrals
                  SET reward_qta = 50, rewarded_in_qx = 1
                WHERE rewarded_in_qx = 0`
            ).run();

            // 3a) Move legacy 1000 QTA locked back to 0 for unverified users.
            await c.env.DB.prepare(
              `UPDATE wallets
                  SET locked = 0
                WHERE coin_symbol = 'QTA'
                  AND locked > 0
                  AND user_id IN (
                    SELECT id FROM users WHERE email_verified_at IS NULL
                  )`
            ).run();

            // 3b) Ensure each unverified user has a QX wallet row.
            await c.env.DB.prepare(
              `INSERT OR IGNORE INTO wallets (id, user_id, coin_symbol, available, locked)
               SELECT lower(hex(randomblob(16))), u.id, 'QX', 0, 0
               FROM users u
               WHERE u.email_verified_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM wallets w
                   WHERE w.user_id = u.id AND w.coin_symbol = 'QX'
                 )`
            ).run();

            // 3c) Set 100 QX locked for each unverified user (only if not yet set).
            await c.env.DB.prepare(
              `UPDATE wallets
                  SET locked = 100
                WHERE coin_symbol = 'QX'
                  AND locked = 0
                  AND user_id IN (
                    SELECT id FROM users WHERE email_verified_at IS NULL
                  )`
            ).run();

            // 4) Mark migration done.
            await c.env.DB.prepare(
              `INSERT INTO system_markers (key, value, updated_at)
               VALUES ('migration_0029_referral_qx_switch','live',CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
            ).run();

            referralQxBootstrapDone = true;
            console.log('[bootstrap] referral QTA→QX switch (0029) applied to production D1');
          } catch (e) {
            captureError(c as any, e, { where: 'referral-qx-bootstrap' });
          }
        })()
      );
    }
  }

  // ------------------------------------------------------------------
  // One-shot Google OAuth schema bootstrap (migration 0030 self-apply).
  // Same pattern as 0028/0029 above. The very first request after a cold
  // start checks system_markers for `migration_0030_google_oauth = live`
  // and, if missing, idempotently:
  //   * Adds 5 nullable columns to users (provider, google_id,
  //     profile_image, auth_type, last_login_at). Each ALTER is wrapped
  //     in its own try/catch because ADD COLUMN fails if the column
  //     already exists (partial prior run).
  //   * Creates the partial UNIQUE INDEX on users(google_id) so a single
  //     Google account cannot be linked to two distinct user rows.
  //   * Sets the policy marker `google_oauth_enabled = true`.
  // ------------------------------------------------------------------
  if (!googleOauthBootstrapDone) {
    const ctx = c.executionCtx as any;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          try {
            const marker = await c.env.DB.prepare(
              "SELECT value FROM system_markers WHERE key = 'migration_0030_google_oauth'"
            ).first<{ value: string }>();
            if (marker && marker.value === 'live') {
              googleOauthBootstrapDone = true;
              return;
            }

            // Add OAuth metadata columns. Each ALTER is wrapped in its
            // own try/catch because SQLite ALTER TABLE ADD COLUMN fails
            // if the column already exists (no IF NOT EXISTS support).
            const addCols: Array<[string, string]> = [
              ['provider',      "ALTER TABLE users ADD COLUMN provider TEXT DEFAULT 'email'"],
              ['google_id',     "ALTER TABLE users ADD COLUMN google_id TEXT"],
              ['profile_image', "ALTER TABLE users ADD COLUMN profile_image TEXT"],
              ['auth_type',     "ALTER TABLE users ADD COLUMN auth_type TEXT DEFAULT 'password'"],
              ['last_login_at', "ALTER TABLE users ADD COLUMN last_login_at TEXT"],
            ];
            for (const [_name, sql] of addCols) {
              try {
                await c.env.DB.prepare(sql).run();
              } catch (_e) {
                // column already exists — fine, continue.
              }
            }

            // Partial unique index — NULLs (non-Google users) are
            // unconstrained, but any non-NULL google_id must be unique.
            try {
              await c.env.DB.prepare(
                `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
                   ON users(google_id)
                   WHERE google_id IS NOT NULL`
              ).run();
            } catch (_e) {
              // index already exists — fine.
            }

            // Policy marker
            await c.env.DB.prepare(
              `INSERT INTO system_markers (key, value, updated_at)
               VALUES ('google_oauth_enabled','true',CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
            ).run();

            // Mark migration done
            await c.env.DB.prepare(
              `INSERT INTO system_markers (key, value, updated_at)
               VALUES ('migration_0030_google_oauth','live',CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
            ).run();

            googleOauthBootstrapDone = true;
            console.log('[bootstrap] Google OAuth schema (0030) applied to production D1');
          } catch (e) {
            captureError(c as any, e, { where: 'google-oauth-bootstrap' });
          }
        })()
      );
    }
  }

  // ------------------------------------------------------------------
  // One-shot Referral multi-level schema bootstrap (migration 0031).
  // Adds `level` column (default 1) to referrals, replaces the old
  // `referred_id UNIQUE` column constraint with `UNIQUE(referred_id,
  // level)` so a single new signup can record up to 3 upline rows
  // (L1/L2/L3) without colliding.
  //
  // SQLite cannot drop a column-level UNIQUE via ALTER, so we rebuild
  // the table:
  //   1) PRAGMA table_info — only proceed if `level` is missing.
  //   2) ALTER TABLE referrals RENAME TO referrals_old
  //   3) CREATE TABLE referrals (new shape with composite UNIQUE)
  //   4) INSERT SELECT ..., 1 AS level FROM referrals_old
  //   5) DROP TABLE referrals_old, recreate indexes
  //   6) Stamp markers: l1=50, l2=30, l3=20, levels=3, migration done
  //
  // Each step is wrapped in try/catch so partial prior runs heal
  // forward. The whole block is gated by the `migration_0031_*` marker
  // so steady-state cost is one SELECT.
  // ------------------------------------------------------------------
  if (!referralMultilevelBootstrapDone) {
    const ctx = c.executionCtx as any;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          try {
            const marker = await c.env.DB.prepare(
              "SELECT value FROM system_markers WHERE key = 'migration_0031_referral_multilevel'"
            ).first<{ value: string }>();
            if (marker && marker.value === 'live') {
              referralMultilevelBootstrapDone = true;
              return;
            }

            // Detect whether the level column already exists. If yes, we
            // skip the rebuild and just stamp markers — keeps re-runs safe.
            let hasLevelColumn = false;
            try {
              const cols = await c.env.DB.prepare(
                "PRAGMA table_info('referrals')"
              ).all<{ name: string }>();
              hasLevelColumn = !!cols.results?.some(r => r.name === 'level');
            } catch (_e) { /* table may not exist on a fresh DB */ }

            if (!hasLevelColumn) {
              // Table rebuild. Each statement is its own prepare.run so we
              // can heal partial prior runs (e.g. a deploy that died after
              // RENAME but before CREATE — in which case referrals would be
              // missing and referrals_old would still be there).

              // 1) Move the old table out of the way (skip if we already
              //    renamed in a partial prior run).
              try {
                await c.env.DB.prepare(
                  `ALTER TABLE referrals RENAME TO referrals_old`
                ).run();
              } catch (_e) {
                // referrals may already be renamed, or the original table
                // may not exist on a fresh DB — both are fine.
              }

              // 2) Create the new shape.
              try {
                await c.env.DB.prepare(
                  `CREATE TABLE IF NOT EXISTS referrals (
                     id              TEXT PRIMARY KEY,
                     referrer_id     TEXT NOT NULL,
                     referred_id     TEXT NOT NULL,
                     referral_code   TEXT NOT NULL,
                     reward_qta      REAL NOT NULL DEFAULT 50,
                     reward_paid_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                     created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                     rewarded_in_qx  INTEGER NOT NULL DEFAULT 1,
                     level           INTEGER NOT NULL DEFAULT 1,
                     UNIQUE(referred_id, level),
                     FOREIGN KEY (referrer_id) REFERENCES users(id),
                     FOREIGN KEY (referred_id) REFERENCES users(id)
                   )`
                ).run();
              } catch (e) {
                console.warn('[bootstrap-0031] CREATE TABLE failed:', e);
              }

              // 3) Copy data from the renamed old table (if it exists),
              //    stamping every legacy row as L1.
              try {
                await c.env.DB.prepare(
                  `INSERT OR IGNORE INTO referrals
                     (id, referrer_id, referred_id, referral_code, reward_qta,
                      reward_paid_at, created_at, rewarded_in_qx, level)
                   SELECT id, referrer_id, referred_id, referral_code, reward_qta,
                          reward_paid_at, created_at, COALESCE(rewarded_in_qx, 1), 1
                   FROM referrals_old`
                ).run();
              } catch (_e) {
                // referrals_old may not exist on a fresh DB — fine.
              }

              // 4) Drop the old table.
              try {
                await c.env.DB.prepare(`DROP TABLE IF EXISTS referrals_old`).run();
              } catch (_e) { /* fine */ }

              // 5) Recreate indexes (the old ones disappeared with the rename).
              for (const sql of [
                `CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id, created_at DESC)`,
                `CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id)`,
                `CREATE INDEX IF NOT EXISTS idx_referrals_level    ON referrals(referrer_id, level, created_at DESC)`,
              ]) {
                try { await c.env.DB.prepare(sql).run(); } catch (_e) { /* fine */ }
              }
            }

            // 6) Stamp policy markers (idempotent).
            //    Note: amounts here represent the CURRENT policy. Historical
            //    rows in `referrals` keep their original reward_qta value, so
            //    a rate change (e.g. 2026-05-14: 50/30/20 → 100/50/30) is
            //    reflected here without touching past data — only new signups
            //    will be credited at the new rate.
            for (const [k, v] of [
              ['referral_reward_l1', '100'],
              ['referral_reward_l2', '50'],
              ['referral_reward_l3', '30'],
              ['referral_levels',    '3'],
            ] as const) {
              try {
                await c.env.DB.prepare(
                  `INSERT INTO system_markers (key, value, updated_at)
                   VALUES (?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
                ).bind(k, v).run();
              } catch (e) {
                console.warn('[bootstrap-0031] marker', k, 'failed:', e);
              }
            }

            // Mark migration done
            await c.env.DB.prepare(
              `INSERT INTO system_markers (key, value, updated_at)
               VALUES ('migration_0031_referral_multilevel','live',CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
            ).run();

            referralMultilevelBootstrapDone = true;
            console.log('[bootstrap] Referral multilevel schema (0031) applied to production D1');
          } catch (e) {
            captureError(c as any, e, { where: 'referral-multilevel-bootstrap' });
          }
        })()
      );
    }
  }

  // ------------------------------------------------------------------
  // 2026-05-14 boss-ordered rate change: L1 50→100, L2 30→50, L3 20→30
  // (option A: new signups only — historical rows untouched).
  //
  // The 0031 bootstrap above already stamps `referral_reward_l1/l2/l3`
  // markers, but only on its first run (gated by `migration_0031_*`).
  // Workers that already cleared 0031 will never see the new values, so
  // we need a separate marker-only bootstrap that refreshes the policy
  // values to today's rate and records a permanent transition marker.
  // Cheap (~2 SELECTs once per worker cold-start); gated by its own
  // module flag and DB marker.
  // ------------------------------------------------------------------
  if (!referralRate20260514BootstrapDone) {
    const ctx = c.executionCtx as any;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          try {
            const marker = await c.env.DB.prepare(
              "SELECT value FROM system_markers WHERE key = 'referral_rate_change_2026_05_14'"
            ).first<{ value: string }>();
            if (marker && marker.value === 'live') {
              referralRate20260514BootstrapDone = true;
              return;
            }

            // Refresh the current-policy markers to today's rate. These are
            // policy snapshots only; per-signup credit amounts live in
            // REFERRER_REWARD_L*_QX in src/server/routes/auth.ts.
            for (const [k, v] of [
              ['referral_reward_l1', '100'],
              ['referral_reward_l2', '50'],
              ['referral_reward_l3', '30'],
              ['referral_levels',    '3'],
            ] as const) {
              try {
                await c.env.DB.prepare(
                  `INSERT INTO system_markers (key, value, updated_at)
                   VALUES (?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
                ).bind(k, v).run();
              } catch (e) {
                console.warn('[bootstrap-rate-2026-05-14] marker', k, 'failed:', e);
              }
            }

            // Record the transition itself so we can audit "from when did
            // the new rate apply?" — value encodes the previous rates for
            // forensic clarity.
            await c.env.DB.prepare(
              `INSERT INTO system_markers (key, value, updated_at)
               VALUES ('referral_rate_change_2026_05_14',
                       'live (prev: l1=50/l2=30/l3=20, new: l1=100/l2=50/l3=30, option A: new signups only)',
                       CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
            ).run();

            referralRate20260514BootstrapDone = true;
            console.log('[bootstrap] Referral rate change (2026-05-14) markers refreshed');
          } catch (e) {
            captureError(c as any, e, { where: 'referral-rate-2026-05-14-bootstrap' });
          }
        })()
      );
    }
  }

  // ------------------------------------------------------------------
  // One-shot company-issued lock bootstrap (migration 0032 self-apply).
  // ★★★★★★★ Boss's permanent rule (2026-06-22):
  // Adds wallets.available_initial column tracking company-issued
  // portion of each wallet. Withdrawable = available - available_initial.
  // Pre-launch backfill: every existing wallet's available_initial is
  // set to its current available (fail-closed). Boss can selectively
  // unlock test accounts via SQL after deploy:
  //   UPDATE wallets SET available_initial = 0
  //   WHERE user_id IN (SELECT id FROM users WHERE email = 'X');
  //
  // Same self-apply pattern as 0028/0029/0030/0031: gated by marker
  // so steady-state cost is one SELECT.
  // ------------------------------------------------------------------
  if (!companyIssuedLockBootstrapDone) {
    const ctx = c.executionCtx as any;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          try {
            const marker = await c.env.DB.prepare(
              "SELECT value FROM system_markers WHERE key = 'company_issued_lock_2026_06_22'"
            ).first<{ value: string }>();
            if (marker && marker.value === 'migrated_v1') {
              companyIssuedLockBootstrapDone = true;
              return;
            }

            // 1) Add the column (no IF NOT EXISTS in SQLite ALTER TABLE).
            try {
              await c.env.DB.prepare(
                `ALTER TABLE wallets ADD COLUMN available_initial REAL DEFAULT 0`
              ).run();
              console.log('[bootstrap] wallets.available_initial column added');
            } catch (_e) {
              // Column already exists from a partial prior run — fine.
            }

            // 2) Index (idempotent).
            try {
              await c.env.DB.prepare(
                `CREATE INDEX IF NOT EXISTS idx_wallets_user_coin
                   ON wallets(user_id, coin_symbol)`
              ).run();
            } catch (_e) { /* ignore */ }

            // 3) Pre-launch backfill: lock the entirety of every existing
            //    balance as company-issued. This is the fail-closed default.
            //    Boss explicitly unlocks test/admin accounts via SQL later.
            const backfillRes = await c.env.DB.prepare(
              `UPDATE wallets
                  SET available_initial = available
                WHERE available > 0
                  AND (available_initial IS NULL OR available_initial = 0)`
            ).run();
            const changed = (backfillRes as any)?.meta?.changes ?? 0;
            console.log(`[bootstrap] company_issued_lock backfill locked ${changed} wallet rows`);

            // 4) Stamp marker.
            await c.env.DB.prepare(
              `INSERT INTO system_markers (key, value, updated_at)
               VALUES ('company_issued_lock_2026_06_22', 'migrated_v1', CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
            ).run();

            companyIssuedLockBootstrapDone = true;
            console.log('[bootstrap] Company-issued lock (0032) applied to production D1');
          } catch (e) {
            captureError(c as any, e, { where: 'company-issued-lock-bootstrap' });
          }
        })()
      );
    }
  }

  // ------------------------------------------------------------------
  // Self-bootstrap for migration 0033 — age gate + notices + KYC doc registry.
  // Adds:
  //   (a) users.date_of_birth TEXT (ISO YYYY-MM-DD) — required at signup
  //   (b) notices table + 6-row seed
  //   (c) kyc_documents table for R2 / SHA-256 tag dual-mode tracking
  // ------------------------------------------------------------------
  if (!ageGateNoticesKycDocsBootstrapDone) {
    const ctx = c.executionCtx as any;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          try {
            const marker = await c.env.DB.prepare(
              "SELECT value FROM system_markers WHERE key = 'age_gate_notices_kyc_docs_2026_06_22'"
            ).first<{ value: string }>();
            if (marker && marker.value === 'migrated_v1') {
              ageGateNoticesKycDocsBootstrapDone = true;
              return;
            }

            // (a) users.date_of_birth — SQLite ALTER TABLE has no IF NOT EXISTS.
            try {
              await c.env.DB.prepare(
                `ALTER TABLE users ADD COLUMN date_of_birth TEXT`
              ).run();
              console.log('[bootstrap] users.date_of_birth column added');
            } catch (_e) { /* already exists */ }

            // (b) notices table.
            try {
              await c.env.DB.prepare(
                `CREATE TABLE IF NOT EXISTS notices (
                  id           INTEGER PRIMARY KEY AUTOINCREMENT,
                  type         TEXT    NOT NULL DEFAULT 'notice',
                  title_ko     TEXT    NOT NULL,
                  title_en     TEXT    NOT NULL,
                  content_ko   TEXT    NOT NULL,
                  content_en   TEXT    NOT NULL,
                  pinned       INTEGER NOT NULL DEFAULT 0,
                  published    INTEGER NOT NULL DEFAULT 1,
                  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  created_by   TEXT,
                  CHECK (type IN ('notice','event','maintenance','listing'))
                )`
              ).run();
            } catch (_e) { /* ignore */ }
            try {
              await c.env.DB.prepare(
                `CREATE INDEX IF NOT EXISTS idx_notices_published_pinned
                   ON notices(published, pinned DESC, created_at DESC)`
              ).run();
            } catch (_e) { /* ignore */ }

            // Seed only if empty.
            const existing = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM notices').first<{ n: number }>();
            if (!existing || (existing.n || 0) === 0) {
              const seeds = [
                {
                  id: 1, type: 'notice', pinned: 1, created_at: '2026-04-20 00:00:00',
                  title_ko: 'QuantaEX 글로벌 거래소 그랜드 오픈 안내',
                  title_en: 'QuantaEX Global Exchange Grand Opening',
                  content_ko: 'QuantaEX가 글로벌 디지털 자산 거래소로 정식 오픈되었습니다. BTC, ETH, QTA 등 13종의 암호화폐를 USDT 및 USDC 마켓에서 거래하실 수 있습니다. 회원가입 시 100 QX 웰컴 보너스(이메일 인증 후 잠금 해제)가 지급됩니다. 많은 이용 부탁드립니다.',
                  content_en: 'QuantaEX is now officially open as a global digital-asset exchange. You can trade 13 cryptocurrencies including BTC, ETH, and QTA against USDT and USDC. Sign up to receive a 100 QX welcome bonus, unlocked after email verification. We look forward to your participation.',
                },
                {
                  id: 2, type: 'listing', pinned: 1, created_at: '2026-04-20 00:00:00',
                  title_ko: '[신규 상장] QTA (Quanta Token) 상장 안내',
                  title_en: '[New Listing] QTA (Quanta Token) Listed',
                  content_ko: 'QTA (Quanta Token)이 QuantaEX 거래소에 신규 상장되었습니다.\n\n■ 상장일시: 2026년 4월 20일 (일) 00:00 UTC\n■ 거래쌍: QTA/USDT, QTA/USDC\n■ 입출금: 즉시 가능\n\n상장 기념 이벤트로 QTA 거래 수수료 50% 할인이 진행됩니다.',
                  content_en: 'QTA (Quanta Token) has been listed on QuantaEX.\n\n■ Listing Date: April 20, 2026 (Sun) 00:00 UTC\n■ Trading Pairs: QTA/USDT, QTA/USDC\n■ Deposits/Withdrawals: Available immediately\n\nTo celebrate the listing, QTA trading fees are discounted by 50%.',
                },
                {
                  id: 3, type: 'event', pinned: 0, created_at: '2026-04-20 00:00:00',
                  title_ko: '[이벤트] 회원가입 웰컴 보너스 이벤트',
                  title_en: '[Event] Welcome Bonus Giveaway',
                  content_ko: '신규 회원가입 시 다음 보너스를 지급합니다:\n\n• 100 QX (이메일 인증 후 잠금 해제)\n\n※ QX는 회사가 지급하는 프로모션 자산으로 거래소 내에서 거래 및 수수료 할인에 사용될 수 있으며, 외부 출금은 제한됩니다.\n\n이벤트 기간: 2026년 4월 20일 ~ 별도 공지 시까지\n\nKYC 인증 완료 회원에게는 추가 거래 수수료 할인이 적용됩니다.',
                  content_en: 'New members will receive the following welcome bonus upon registration:\n\n• 100 QX (unlocked after email verification)\n\n※ QX is a promotional asset issued by the Company. It can be used for trading and fee discounts within the exchange but is restricted from external withdrawals.\n\nEvent period: April 20, 2026 ~ until further notice\n\nKYC-verified members are eligible for additional trading-fee discounts.',
                },
                {
                  id: 4, type: 'notice', pinned: 0, created_at: '2026-04-19 00:00:00',
                  title_ko: 'KYC 인증 절차 안내',
                  title_en: 'KYC Verification Process Guide',
                  content_ko: '원활한 거래를 위해 KYC 인증을 완료해 주시기 바랍니다.\n\n■ 인증 방법: 마이페이지 > 보안설정 > KYC 인증\n■ 필요 서류: 성명, 연락처, 신분증 번호\n■ 처리 기간: 신청 후 최대 24시간 이내\n\nKYC 미인증 시 출금이 제한될 수 있습니다.',
                  content_en: 'Please complete your KYC verification for uninterrupted trading.\n\n■ How to verify: My Page > Security Settings > KYC Verification\n■ Required documents: Full name, phone number, ID number\n■ Processing time: Within 24 hours of submission\n\nWithdrawals may be restricted without KYC verification.',
                },
                {
                  id: 5, type: 'maintenance', pinned: 0, created_at: '2026-04-18 00:00:00',
                  title_ko: '[점검 완료] 서버 정기 점검 안내',
                  title_en: '[Completed] Scheduled Server Maintenance',
                  content_ko: '서버 정기 점검이 완료되었습니다.\n\n■ 점검일시: 2026년 4월 18일 02:00 ~ 04:00 (KST)\n■ 영향 범위: 전 서비스 일시 중단\n■ 현재 상태: 정상 운영 중\n\n이용에 불편을 드려 죄송합니다.',
                  content_en: 'Scheduled server maintenance has been completed.\n\n■ Maintenance window: April 18, 2026, 02:00 ~ 04:00 (KST)\n■ Scope: Temporary suspension of all services\n■ Current status: Normal operation\n\nWe apologize for any inconvenience.',
                },
                {
                  id: 6, type: 'notice', pinned: 0, created_at: '2026-04-17 00:00:00',
                  title_ko: '이상 거래 탐지 시스템 업데이트 안내',
                  title_en: 'Anomaly Detection System Update',
                  content_ko: '고객 자산 보호를 위해 이상 거래 탐지 시스템이 업데이트되었습니다.\n\n주요 변경사항:\n• 비정상 대량 주문 자동 차단\n• IP 기반 접속 제한 강화\n• 출금 시 추가 인증 절차 도입',
                  content_en: 'The anomaly detection system has been updated to better protect customer assets.\n\nKey changes:\n• Automatic blocking of abnormal large orders\n• Enhanced IP-based access restrictions\n• Additional verification steps for withdrawals',
                },
              ];
              for (const s of seeds) {
                try {
                  await c.env.DB.prepare(
                    `INSERT INTO notices (id, type, title_ko, title_en, content_ko, content_en, pinned, published, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
                  ).bind(s.id, s.type, s.title_ko, s.title_en, s.content_ko, s.content_en, s.pinned, s.created_at).run();
                } catch (_e) { /* ignore duplicate */ }
              }
              console.log('[bootstrap] notices seeded (6 rows)');
            }

            // (c) kyc_documents table.
            try {
              await c.env.DB.prepare(
                `CREATE TABLE IF NOT EXISTS kyc_documents (
                  id           TEXT    PRIMARY KEY,
                  user_id      TEXT    NOT NULL,
                  kind         TEXT    NOT NULL,
                  r2_key       TEXT,
                  storage_tag  TEXT    NOT NULL,
                  content_hash TEXT    NOT NULL,
                  filename     TEXT    NOT NULL,
                  mime_type    TEXT    NOT NULL,
                  size_bytes   INTEGER NOT NULL,
                  uploaded_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  uploaded_ip  TEXT,
                  CHECK (kind IN ('id_document','address_document'))
                )`
              ).run();
            } catch (_e) { /* ignore */ }
            try {
              await c.env.DB.prepare(
                `CREATE INDEX IF NOT EXISTS idx_kyc_docs_user_kind
                   ON kyc_documents(user_id, kind, uploaded_at DESC)`
              ).run();
            } catch (_e) { /* ignore */ }
            try {
              await c.env.DB.prepare(
                `CREATE INDEX IF NOT EXISTS idx_kyc_docs_hash
                   ON kyc_documents(content_hash)`
              ).run();
            } catch (_e) { /* ignore */ }

            // Stamp marker.
            await c.env.DB.prepare(
              `INSERT INTO system_markers (key, value, updated_at)
               VALUES ('age_gate_notices_kyc_docs_2026_06_22', 'migrated_v1', CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
            ).run();

            ageGateNoticesKycDocsBootstrapDone = true;
            console.log('[bootstrap] Age gate + notices + KYC docs (0033) applied to production D1');
          } catch (e) {
            captureError(c as any, e, { where: 'age-gate-notices-kyc-docs-bootstrap' });
          }
        })()
      );
    }
  }

  await next();
});

// Routes
app.route('/api/auth', authRoutes);
app.route('/api/market', marketRoutes);
app.route('/api/orders', orderRoutes);
app.route('/api/wallet', walletRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/notifications', notificationRoutes);
// Public notice board (read-only). Admin CRUD lives in /api/admin/notices.
app.route('/api/notices', noticeRoutes);
app.route('/api/price-alerts', priceAlertRoutes);
app.route('/api/profile', profileRoutes);
app.route('/api/chain', chainRoutes);
app.route('/api/risk', riskRoutes);
app.route('/api/bridge', bridgeRoutes);
app.route('/api/futures', futuresRoutes);
app.route('/api/margin', marginRoutes);
app.route('/api/v1', v1Routes);

// ============================================================================
// Health checks (Sprint 3+ #3)
// ----------------------------------------------------------------------------
// /api/health         — liveness: fast, no dependencies, always 200 when up.
// /api/health/ready   — readiness: pings D1 + reports the most recent
//                       price-alert cron tick so monitors can alarm on stale
//                       workers. Returns 503 if DB is unreachable.
// ============================================================================
app.get('/api/health', (c) => c.json({
  status: 'ok',
  service: 'quantaex-api',
  environment: (c.env as any).ENVIRONMENT || 'production',
  timestamp: new Date().toISOString(),
}));

app.get('/api/health/ready', async (c) => {
  const started = Date.now();
  const report: any = {
    status: 'ok',
    service: 'quantaex-api',
    environment: (c.env as any).ENVIRONMENT || 'production',
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, any>,
  };
  // 1. D1 ping — read a single row from system_state (cheap, indexed by PK).
  try {
    const row = await c.env.DB.prepare(
      "SELECT value FROM system_state WHERE key = 'price_alert_last_run'"
    ).first<{ value: string }>();
    report.checks.db = { ok: true, last_cron: row?.value || null };
  } catch (e: any) {
    report.status = 'degraded';
    report.checks.db = { ok: false, error: String(e?.message || e) };
  }
  // 2. Observability sinks configured?
  report.checks.sentry = !!(c.env as any).SENTRY_DSN ? 'configured' : 'disabled';
  report.checks.logflare = !!(c.env as any).LOGFLARE_API_KEY ? 'configured' : 'disabled';
  report.checks.mailer = !!(c.env as any).RESEND_API_KEY ? 'configured' : 'disabled';

  report.elapsed_ms = Date.now() - started;
  return c.json(report, report.status === 'ok' ? 200 : 503);
});

// ===== COIN BASE PRICES (source of truth) =====
const COIN_PRICES: Record<string, number> = {
  BTC: 67250, ETH: 3450, BNB: 605, SOL: 172.5, XRP: 0.625,
  ADA: 0.452, DOGE: 0.0845, DOT: 7.25, AVAX: 38.75, MATIC: 0.865, QTA: 0.0125,
};

// Per-symbol persistent price state
const priceState: Record<string, {
  price: number;
  change24h: number;
  high: number;
  low: number;
  volume: number;
  prevPrice: number;
  trend: number; // -1 to 1, drift bias
  trendDuration: number;
}> = {};

function initPriceState(symbol: string, basePrice: number, quote: string) {
  const key = `${symbol}-${quote}`;
  if (!priceState[key]) {
    // USDT and USDC both peg to ~$1, so the base USD price applies as-is.
    const p = basePrice;
    const jitter = 1 + (Math.random() - 0.5) * 0.02;
    const price = p * jitter;
    priceState[key] = {
      price,
      prevPrice: price,
      change24h: (Math.random() - 0.4) * 6,
      high: price * (1 + Math.random() * 0.03),
      low: price * (1 - Math.random() * 0.03),
      volume: basePrice > 100 ? Math.random() * 8000 + 2000 : Math.random() * 800000 + 100000,
      trend: (Math.random() - 0.5) * 0.6,
      trendDuration: Math.floor(Math.random() * 20) + 5,
    };
  }
  return priceState[key];
}

function tickPrice(key: string) {
  const s = priceState[key];
  if (!s) return;

  s.prevPrice = s.price;

  // Occasionally shift trend direction (market regime change)
  s.trendDuration--;
  if (s.trendDuration <= 0) {
    s.trend = (Math.random() - 0.5) * 0.8;
    s.trendDuration = Math.floor(Math.random() * 30) + 5;
  }

  // Random walk with trend bias, +-0.05% base volatility
  const volatility = 0.0005 + Math.random() * 0.0003;
  const drift = s.trend * 0.0002 + (Math.random() - 0.5) * volatility;

  // Occasional larger moves (1% chance of 0.1-0.3% spike)
  const spike = Math.random() < 0.01 ? (Math.random() - 0.5) * 0.003 : 0;

  s.price *= (1 + drift + spike);
  if (s.price > s.high) s.high = s.price;
  if (s.price < s.low) s.low = s.price;

  // Volume tick
  const baseVol = s.price > 1000 ? 2 + Math.random() * 8 : 1000 + Math.random() * 5000;
  s.volume += baseVol;

  // 24h change drift
  s.change24h += (Math.random() - 0.5) * 0.04 + s.trend * 0.01;
  s.change24h = Math.max(-15, Math.min(15, s.change24h));
}

// Generate realistic orderbook around a price
function generateOrderbook(price: number, _symbol: string) {
  const spread = price * 0.00015; // 0.015% spread (tight)
  const bids: { price: number; amount: number }[] = [];
  const asks: { price: number; amount: number }[] = [];

  const baseAmount = price > 10000 ? 0.2 : price > 1000 ? 1 : price > 100 ? 10 : price > 1 ? 500 : price > 0.01 ? 50000 : 5000000;

  for (let i = 0; i < 25; i++) {
    // Cluster orders near the spread, thin out further away
    const distFactor = 1 + i * 0.3 + Math.random() * 0.2;
    const bidPrice = price - spread * distFactor;
    const askPrice = price + spread * distFactor;

    // Larger orders further from spread (wall-like behavior)
    const sizeMultiplier = 0.2 + Math.random() * 1.8 + (i > 15 ? Math.random() * 3 : 0);
    const bidAmt = baseAmount * sizeMultiplier;
    const askAmt = baseAmount * (0.2 + Math.random() * 1.8 + (i > 15 ? Math.random() * 3 : 0));

    bids.push({
      price: +bidPrice.toPrecision(price > 100 ? 7 : 6),
      amount: +bidAmt.toPrecision(5),
    });
    asks.push({
      price: +askPrice.toPrecision(price > 100 ? 7 : 6),
      amount: +askAmt.toPrecision(5),
    });
  }

  return { bids, asks };
}

// Incrementally update orderbook (small changes each tick)
function tickOrderbook(prevBook: { bids: any[]; asks: any[] }, price: number, _symbol: string) {
  const mutate = (entries: any[], isBid: boolean) => {
    return entries.map((entry) => {
      // 30% chance to adjust amount
      if (Math.random() < 0.3) {
        const change = entry.amount * (Math.random() * 0.2 - 0.1);
        const newAmt = Math.max(entry.amount * 0.1, entry.amount + change);
        return { price: entry.price, amount: +newAmt.toPrecision(5) };
      }
      return entry;
    });
  };

  return {
    bids: mutate(prevBook.bids, true),
    asks: mutate(prevBook.asks, false),
  };
}

// Generate simulated recent trades
function generateRecentTrades(price: number, _symbol: string, count = 30) {
  const trades: any[] = [];
  const baseAmount = price > 10000 ? 0.05 : price > 1000 ? 0.5 : price > 100 ? 5 : price > 1 ? 200 : price > 0.01 ? 20000 : 2000000;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const tradePrice = price * (1 + (Math.random() - 0.5) * 0.001);
    const amount = baseAmount * (0.05 + Math.random() * 2.5);
    const side = Math.random() > 0.47 ? 'buy' : 'sell';
    trades.push({
      id: `sim-${now}-${i}`,
      price: +tradePrice.toPrecision(price > 100 ? 7 : 6),
      amount: +amount.toPrecision(5),
      total: +(tradePrice * amount).toPrecision(7),
      side,
      time: new Date(now - i * (500 + Math.random() * 4000)).toISOString(),
    });
  }
  return trades;
}

// Generate new trades per tick (1-3 trades)
function generateTickTrades(price: number, _symbol: string) {
  const count = Math.random() < 0.3 ? 3 : Math.random() < 0.5 ? 2 : 1;
  const baseAmount = price > 10000 ? 0.05 : price > 1000 ? 0.5 : price > 100 ? 5 : price > 1 ? 200 : price > 0.01 ? 20000 : 2000000;
  const trades: any[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const tradePrice = price * (1 + (Math.random() - 0.5) * 0.0008);
    const amount = baseAmount * (0.01 + Math.random() * 1.5);
    const side = Math.random() > 0.47 ? 'buy' : 'sell';
    trades.push({
      id: `sim-${now}-${Math.random().toString(36).slice(2, 8)}`,
      price: +tradePrice.toPrecision(price > 100 ? 7 : 6),
      amount: +amount.toPrecision(5),
      total: +(tradePrice * amount).toPrecision(7),
      side,
      time: new Date(now - i * 200).toISOString(),
    });
  }
  return trades;
}

// Per-market orderbook/trades cache
const marketCache: Record<string, { orderbook: any; trades: any[] }> = {};

function getMarketCache(key: string, price: number) {
  if (!marketCache[key]) {
    marketCache[key] = {
      orderbook: generateOrderbook(price, key),
      trades: generateRecentTrades(price, key),
    };
  }
  return marketCache[key];
}

// ===== TRUE SSE STREAMING: COMBINED TICKER + MARKET DATA =====
app.get('/api/stream/ticker', async (c) => {
  // Initialize all price states
  for (const [symbol, basePrice] of Object.entries(COIN_PRICES)) {
    initPriceState(symbol, basePrice, 'USDT');
    initPriceState(symbol, basePrice, 'USDC');
  }

  // Get optional market subscription
  const subscribedMarket = c.req.query('market') || '';
  // ?mock=1 allows simulated orderbook/trades to be emitted over SSE
  // (used ONLY by the landing/marketing page for a decorative feed).
  // Real trade page MUST NOT pass mock=1.
  const allowMock = c.req.query('mock') === '1';

  // Try to blend with real DB data (non-blocking)
  try {
    const markets = await c.env.DB.prepare(
      `SELECT m.base_coin, m.quote_coin, c.price_usd FROM markets m JOIN coins c ON c.symbol = m.base_coin WHERE m.is_active = 1`
    ).all();
    for (const m of markets.results as any[]) {
      const key = `${m.base_coin}-${m.quote_coin}`;
      if (priceState[key] && m.price_usd > 0) {
        // USDT/USDC are both ~$1, no FX conversion needed.
        priceState[key].price = priceState[key].price * 0.95 + m.price_usd * 0.05;
      }
    }
  } catch { /* DB might not be available */ }

  // Use ReadableStream with pull-based controller for CF Workers compatibility
  let tickCount = 0;
  const maxTicks = 18;
  const encoder = new TextEncoder();

  const formatEvent = (eventType: string, data: any) => {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  };

  const buildTickers = () => {
    const tickers: Record<string, any> = {};
    for (const [symbol] of Object.entries(COIN_PRICES)) {
      for (const quote of ['USDT', 'USDC']) {
        const key = `${symbol}-${quote}`;
        tickPrice(key);
        const s = priceState[key];
        tickers[key] = {
          last: +s.price.toPrecision(8),
          change: +s.change24h.toFixed(2),
          volume: +s.volume.toFixed(2),
          high: +s.high.toPrecision(8),
          low: +s.low.toPrecision(8),
        };
      }
    }
    return tickers;
  };

  // Fetch real orderbook/trades from D1 for the subscribed market.
  // Returns { bids, asks, trades } or null if market is unknown / DB fails.
  const fetchRealMarketData = async (sym: string) => {
    const [base, quote] = sym.split('-');
    try {
      const market = await c.env.DB.prepare(
        'SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?'
      ).bind(base, quote).first() as any;
      if (!market) return null;
      const { results: bids } = await c.env.DB.prepare(
        `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'buy' AND status IN ('open','partial') GROUP BY price ORDER BY price DESC LIMIT 25`
      ).bind(market.id).all();
      const { results: asks } = await c.env.DB.prepare(
        `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'sell' AND status IN ('open','partial') GROUP BY price ORDER BY price ASC LIMIT 25`
      ).bind(market.id).all();
      const { results: trades } = await c.env.DB.prepare(`
        SELECT t.id, t.price, t.amount, t.total, t.created_at as time,
          CASE WHEN o.side = 'buy' THEN 'buy' ELSE 'sell' END as side
        FROM trades t JOIN orders o ON o.id = t.buy_order_id
        WHERE t.market_id = ? ORDER BY t.created_at DESC LIMIT 50
      `).bind(market.id).all();
      return {
        bids: (bids as any[]) ?? [],
        asks: (asks as any[]) ?? [],
        trades: (trades as any[]) ?? [],
      };
    } catch {
      return null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      // Send initial ticker data
      const tickers = buildTickers();
      controller.enqueue(encoder.encode(formatEvent('tickers', tickers)));

      // Send initial orderbook & trades if subscribed
      if (subscribedMarket) {
        (async () => {
          const real = await fetchRealMarketData(subscribedMarket);
          if (real) {
            controller.enqueue(encoder.encode(formatEvent('orderbook', { bids: real.bids, asks: real.asks, simulated: false })));
            controller.enqueue(encoder.encode(formatEvent('trades', real.trades)));
          } else if (allowMock) {
            const [base, quote] = subscribedMarket.split('-');
            const key = `${base}-${quote}`;
            const state = priceState[key];
            if (state) {
              const cache = getMarketCache(key, state.price);
              controller.enqueue(encoder.encode(formatEvent('orderbook', { ...cache.orderbook, simulated: true })));
              controller.enqueue(encoder.encode(formatEvent('trades', cache.trades)));
            }
          } else {
            // Truthful empty state
            controller.enqueue(encoder.encode(formatEvent('orderbook', { bids: [], asks: [], simulated: false })));
            controller.enqueue(encoder.encode(formatEvent('trades', [])));
          }
        })();
      }

      // Stream loop
      const interval = setInterval(() => {
        tickCount++;
        if (tickCount > maxTicks) {
          clearInterval(interval);
          controller.close();
          return;
        }

        try {
          const tickers = buildTickers();
          controller.enqueue(encoder.encode(formatEvent('tickers', tickers)));

          if (subscribedMarket) {
            (async () => {
              const real = await fetchRealMarketData(subscribedMarket);
              if (real) {
                controller.enqueue(encoder.encode(formatEvent('orderbook', { bids: real.bids, asks: real.asks, simulated: false })));
                // Only push trades delta: since last tick. Simpler: push last 10.
                controller.enqueue(encoder.encode(formatEvent('trades', real.trades.slice(0, 10))));
              } else if (allowMock) {
                const [base, quote] = subscribedMarket.split('-');
                const key = `${base}-${quote}`;
                const state = priceState[key];
                if (state) {
                  const cache = getMarketCache(key, state.price);
                  cache.orderbook = tickCount % 5 === 0
                    ? generateOrderbook(state.price, key)
                    : tickOrderbook(cache.orderbook, state.price, key);
                  const newTrades = generateTickTrades(state.price, key);
                  cache.trades = [...newTrades, ...cache.trades].slice(0, 50);
                  controller.enqueue(encoder.encode(formatEvent('orderbook', { ...cache.orderbook, simulated: true })));
                  controller.enqueue(encoder.encode(formatEvent('trades', newTrades)));
                }
              }
              // If no real data and mock disabled, stay silent — client keeps
              // whatever empty state it started with.
            })().catch(() => {});
          }
        } catch {
          clearInterval(interval);
          try { controller.close(); } catch {}
        }
      }, 1500);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

// ===== ORDERBOOK ENDPOINT =====
// Returns REAL orderbook from DB only.
// Opt-in simulated fallback available via ?mock=1 (landing-page marketing use only).
// Never returns simulated data to the trade UI — empty book is a truthful state
// when there is no real liquidity.
app.get('/api/stream/orderbook/:symbol', async (c) => {
  const symbol = c.req.param('symbol');
  const [base, quote] = symbol.split('-');
  const key = `${base}-${quote}`;
  const allowMock = c.req.query('mock') === '1';

  try {
    const market = await c.env.DB.prepare('SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?').bind(base, quote).first() as any;
    if (market) {
      const { results: realBids } = await c.env.DB.prepare(
        `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'buy' AND status IN ('open','partial') GROUP BY price ORDER BY price DESC LIMIT 25`
      ).bind(market.id).all();
      const { results: realAsks } = await c.env.DB.prepare(
        `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'sell' AND status IN ('open','partial') GROUP BY price ORDER BY price ASC LIMIT 25`
      ).bind(market.id).all();
      return c.json({ bids: realBids ?? [], asks: realAsks ?? [], simulated: false });
    }
  } catch (e) {
    // DB hiccup — fall through
  }

  // Market not found OR DB failure
  if (!allowMock) {
    return c.json({ bids: [], asks: [], simulated: false });
  }

  // Opt-in: landing/marketing page asks for decorative book
  const basePrice = COIN_PRICES[base];
  if (basePrice) initPriceState(base, basePrice, quote);
  const state = priceState[key];
  if (!state) return c.json({ bids: [], asks: [], simulated: false });
  const cache = getMarketCache(key, state.price);
  return c.json({ ...cache.orderbook, simulated: true });
});

// ===== RECENT TRADES ENDPOINT =====
// Returns REAL trades from DB only. Same mock opt-in as above.
app.get('/api/stream/trades/:symbol', async (c) => {
  const symbol = c.req.param('symbol');
  const [base, quote] = symbol.split('-');
  const key = `${base}-${quote}`;
  const allowMock = c.req.query('mock') === '1';

  try {
    const market = await c.env.DB.prepare('SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?').bind(base, quote).first() as any;
    if (market) {
      const { results: realTrades } = await c.env.DB.prepare(`
        SELECT t.id, t.price, t.amount, t.total, t.created_at as time,
          CASE WHEN o.side = 'buy' THEN 'buy' ELSE 'sell' END as side
        FROM trades t JOIN orders o ON o.id = t.buy_order_id
        WHERE t.market_id = ? ORDER BY t.created_at DESC LIMIT 50
      `).bind(market.id).all();
      return c.json(realTrades ?? []);
    }
  } catch (e) {
    // fall through
  }

  if (!allowMock) return c.json([]);

  const basePrice = COIN_PRICES[base];
  if (basePrice) initPriceState(base, basePrice, quote);
  const state = priceState[key];
  if (!state) return c.json([]);
  const cache = getMarketCache(key, state.price);
  return c.json(cache.trades);
});

// Candle seed endpoint
app.get('/api/admin/seed-candles', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Auth required' }, 401);

  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const intervals: Record<string, { seconds: number; count: number }> = {
    '1m': { seconds: 60, count: 500 },
    '5m': { seconds: 300, count: 300 },
    '15m': { seconds: 900, count: 200 },
    '1h': { seconds: 3600, count: 200 },
    '4h': { seconds: 14400, count: 100 },
    '1d': { seconds: 86400, count: 90 },
  };

  const now = Math.floor(Date.now() / 1000);
  let insertCount = 0;

  for (const [symbol, basePrice] of Object.entries(COIN_PRICES)) {
    for (const quote of ['USDT', 'USDC']) {
      const marketId = `m-${symbol.toLowerCase()}-${quote.toLowerCase()}`;
      // USDT and USDC both peg to ~$1
      const price = basePrice;

      for (const [interval, cfg] of Object.entries(intervals)) {
        let currentPrice = price * (0.9 + Math.random() * 0.1);

        for (let i = cfg.count; i >= 0; i--) {
          const openTime = Math.floor((now - i * cfg.seconds) / cfg.seconds) * cfg.seconds;
          const volatility = 0.015;
          const open = currentPrice;
          const changePercent = (Math.random() - 0.48) * volatility;
          const close = open * (1 + changePercent);
          const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.5);
          const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.5);
          const volume = Math.random() * (basePrice > 100 ? 50 : 100000);

          await c.env.DB.prepare(
            'INSERT OR REPLACE INTO candles (market_id, interval, open_time, open, high, low, close, volume) VALUES (?,?,?,?,?,?,?,?)'
          ).bind(marketId, interval, openTime, open, high, low, close, volume).run();

          currentPrice = close;
          insertCount++;
        }
      }
    }
  }

  return c.json({ message: 'Candle data seeded', count: insertCount });
});

async function verifyToken(token: string, secret: string): Promise<any> {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) throw new Error('Invalid token');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBuf = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBuf, new TextEncoder().encode(`${header}.${body}`));
  if (!valid) throw new Error('Invalid signature');
  const payload = JSON.parse(atob(body));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

// ============================================================================
// Scheduled handler: check price alerts (runs via CF cron trigger)
// ============================================================================
export async function checkPriceAlerts(env: Env): Promise<{ checked: number; triggered: number }> {
  // Load active alerts
  const { results: alerts } = await env.DB.prepare(
    `SELECT id, user_id, symbol, direction, target_price, note
     FROM price_alerts WHERE is_active = 1 AND triggered_at IS NULL LIMIT 500`
  ).all<any>();

  if (!alerts || alerts.length === 0) {
    return { checked: 0, triggered: 0 };
  }

  // Load current prices from coins table
  const { results: coins } = await env.DB.prepare(
    'SELECT symbol, price_usd FROM coins WHERE is_active = 1'
  ).all<{ symbol: string; price_usd: number }>();
  const priceMap: Record<string, number> = {};
  for (const c of coins || []) priceMap[c.symbol] = c.price_usd;

  let triggered = 0;
  const notifStmts: D1PreparedStatement[] = [];
  const updateStmts: D1PreparedStatement[] = [];
  const triggeredAt = new Date().toISOString();

  for (const a of alerts) {
    const currentPrice = priceMap[a.symbol];
    if (!(currentPrice > 0)) continue;

    const hit =
      (a.direction === 'above' && currentPrice >= a.target_price) ||
      (a.direction === 'below' && currentPrice <= a.target_price);

    if (!hit) continue;

    triggered++;
    const nid = crypto.randomUUID();
    const arrow = a.direction === 'above' ? '↑' : '↓';
    const title = `Price Alert: ${a.symbol} ${arrow} ${a.target_price}`;
    const msg = `${a.symbol} is now ${currentPrice} USD (target ${a.direction} ${a.target_price})${a.note ? ` — ${a.note}` : ''}.`;

    notifStmts.push(
      env.DB.prepare(
        `INSERT INTO notifications (id, user_id, type, title, message, data)
         VALUES (?, ?, 'price_alert', ?, ?, ?)`
      ).bind(
        nid,
        a.user_id,
        title,
        msg,
        JSON.stringify({
          alert_id: a.id,
          symbol: a.symbol,
          direction: a.direction,
          target_price: a.target_price,
          current_price: currentPrice,
        })
      )
    );

    updateStmts.push(
      env.DB.prepare(
        'UPDATE price_alerts SET triggered_at = ?, is_active = 0 WHERE id = ?'
      ).bind(triggeredAt, a.id)
    );
  }

  if (notifStmts.length > 0) {
    // Batch in chunks
    const all = [...notifStmts, ...updateStmts];
    const CHUNK = 30;
    for (let i = 0; i < all.length; i += CHUNK) {
      await env.DB.batch(all.slice(i, i + CHUNK));
    }
  }

  return { checked: alerts.length, triggered };
}

// Admin-only manual trigger (useful for testing/emergency runs)
app.post('/api/admin/run-price-alert-check', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Auth required' }, 401);
  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
  const result = await checkPriceAlerts(c.env);
  return c.json(result);
});

// Admin: inspect the self-scheduler state
app.get('/api/admin/scheduler-status', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Auth required' }, 401);
  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const row = await c.env.DB.prepare(
    "SELECT value, updated_at FROM system_state WHERE key = 'price_alert_last_run'"
  ).first<{ value: string; updated_at: string }>();

  const activeAlerts = await c.env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM price_alerts WHERE is_active = 1 AND triggered_at IS NULL'
  ).first<{ cnt: number }>();

  const last = row ? parseInt(row.value || '0', 10) : 0;
  const now = Date.now();
  return c.json({
    last_run_ms: last,
    last_run_iso: last > 0 ? new Date(last).toISOString() : null,
    last_updated_at: row?.updated_at || null,
    seconds_since_last_run: last > 0 ? Math.floor((now - last) / 1000) : null,
    interval_seconds: Math.floor(SELF_SCHEDULE_INTERVAL_MS / 1000),
    next_run_due_seconds: last > 0 ? Math.max(0, Math.floor((last + SELF_SCHEDULE_INTERVAL_MS - now) / 1000)) : 0,
    active_alerts: activeAlerts?.cnt || 0,
    server_time: new Date().toISOString(),
  });
});

// SPA fallback (must be registered AFTER all API routes so Hono matches
// specific API paths first and falls through to asset serving only for
// non-API requests)
app.get('*', async (c) => {
  try {
    const env = c.env as any;
    if (env.ASSETS) {
      const url = new URL(c.req.url);
      url.pathname = '/index.html';
      return env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
    }
    return c.text('Not Found', 404);
  } catch {
    return c.text('Not Found', 404);
  }
});

// CF Pages Functions + Workers unified export
export default {
  fetch: app.fetch,
  async scheduled(_event: any, env: Env, ctx: any) {
    // Cloudflare Pages projects manage cron schedules via the dashboard
    // (Settings > Functions > Cron Triggers), so we cannot declare them
    // in wrangler.jsonc. Every tick runs BOTH workloads — price-alert
    // checks (cheap, idempotent) and the nonce sweep (deletes rows older
    // than 24h, no-op when there is nothing to prune). Frequency is
    // therefore controlled by whatever cron schedule the dashboard has
    // registered; the recommended cadence is */15 * * * *.
    ctx.waitUntil(
      checkPriceAlerts(env)
        .then((r) => console.log('[cron] price-alert check:', r))
        .catch((e) => console.error('[cron] price-alert check failed:', e)),
    );
    ctx.waitUntil(
      import('./lib/nonce-sweep')
        .then(({ sweepExpiredNonces }) => sweepExpiredNonces(env))
        .then((r) => console.log('[cron] nonce sweep:', r))
        .catch((e) => console.error('[cron] nonce sweep failed:', e)),
    );
  },
};
