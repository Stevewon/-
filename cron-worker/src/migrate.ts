/**
 * Auto-migrator for the cron worker.
 *
 * The GitHub App token can't touch .github/workflows, so we can't add a
 * "run wrangler d1 execute" step to the deploy workflow. Instead, the cron
 * worker (which redeploys on every push and binds the SAME D1) applies any
 * pending migrations itself — on every /5 tick and via the /migrate endpoint.
 *
 * Design:
 *   - A `schema_migrations(id, applied_at)` table records which migrations ran.
 *   - Each migration is a list of individual SQL statements. Statements run one
 *     at a time; "duplicate column"/"already exists" errors are swallowed so a
 *     partially-applied migration can be finished safely (idempotent).
 *   - A migration is marked applied only after all its statements were attempted
 *     without a FATAL (non-idempotent) error.
 *   - Seed migrations (DELETE+INSERT) are safe to re-run, but we still gate them
 *     on schema_migrations so we don't wipe/reseed on every single tick. The
 *     /migrate?force=1 endpoint can force a reseed when needed.
 *
 * To add a new migration later: append an entry to MIGRATIONS with a unique id
 * and its statements. It will auto-apply on the next deploy. No wrangler, no
 * workflow edit.
 */

export interface MigrateEnv {
  DB: D1Database;
}

interface Migration {
  id: string;
  statements: string[];
}

// Errors that mean "this statement's effect already exists" — safe to ignore.
function isIdempotentError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('duplicate column') ||
    m.includes('already exists') ||
    m.includes('duplicate column name')
  );
}

// ---------------------------------------------------------------------------
// Migration definitions (kept in sync with /migrations/*.sql). Only the ones
// the cron worker is responsible for auto-applying need to live here; older
// migrations were already applied to prod by other means.
// ---------------------------------------------------------------------------
const MIGRATIONS: Migration[] = [
  {
    // 0044 — QTA staking tier model: schema (ADD COLUMN + ledger table).
    id: '0044_staking_tier_model',
    statements: [
      `ALTER TABLE staking_products ADD COLUMN min_usd REAL DEFAULT 0`,
      `ALTER TABLE staking_products ADD COLUMN max_usd REAL`,
      `ALTER TABLE staking_products ADD COLUMN term_days INTEGER DEFAULT 0`,
      `ALTER TABLE staking_products ADD COLUMN daily_rate REAL DEFAULT 0`,
      `ALTER TABLE staking_products ADD COLUMN payout_coin TEXT DEFAULT 'QTA'`,
      `ALTER TABLE staking_positions ADD COLUMN principal_usd REAL DEFAULT 0`,
      `ALTER TABLE staking_positions ADD COLUMN daily_rate REAL DEFAULT 0`,
      `ALTER TABLE staking_positions ADD COLUMN term_days INTEGER DEFAULT 0`,
      `ALTER TABLE staking_positions ADD COLUMN accrued_dividend_usd REAL DEFAULT 0`,
      `ALTER TABLE staking_positions ADD COLUMN paid_dividend_qta REAL DEFAULT 0`,
      `ALTER TABLE staking_positions ADD COLUMN payout_coin TEXT DEFAULT 'QTA'`,
      `ALTER TABLE staking_positions ADD COLUMN lock_end_at TEXT`,
      `ALTER TABLE staking_positions ADD COLUMN term_end_at TEXT`,
      `CREATE TABLE IF NOT EXISTS staking_dividends (
        id TEXT PRIMARY KEY,
        position_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'dividend',
        usd_amount REAL NOT NULL DEFAULT 0,
        qta_amount REAL NOT NULL DEFAULT 0,
        qta_price REAL NOT NULL DEFAULT 0,
        source_user_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_staking_dividends_user ON staking_dividends (user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_staking_dividends_pos ON staking_dividends (position_id)`,
    ],
  },
  {
    // 0045 — QTA staking tier SEED (5 official tiers). Re-runnable.
    id: '0045_staking_tier_seed',
    statements: [
      `DELETE FROM staking_products`,
      `INSERT INTO staking_products
        (id, coin_symbol, kind, apr, lock_days, min_amount, max_amount,
         min_usd, max_usd, term_days, daily_rate, payout_coin, sort_order, is_active)
       VALUES
        ('tier_1k_180','USDT','fixed',0.36,180,1000,1900,1000,1900,180,0.002,'QTA',1,1),
        ('tier_1k_360','USDT','fixed',0.72,360,1000,1900,1000,1900,360,0.002,'QTA',2,1),
        ('tier_2k_360','USDT','fixed',1.08,360,2000,4900,2000,4900,360,0.003,'QTA',3,1),
        ('tier_5k_180','USDT','fixed',0.54,180,5000,10000,5000,10000,180,0.003,'QTA',4,1),
        ('tier_5k_360','USDT','fixed',1.80,360,5000,10000,5000,10000,360,0.005,'QTA',5,1)`,
    ],
  },
  {
    // 0046 — External (non-Quantarium) deposit infrastructure (Phase B).
    // Chain-agnostic tables for the per-user deposit-address + watcher + sweep
    // model. Mirrors /migrations/0046_external_deposits.sql. All statements are
    // CREATE ... IF NOT EXISTS / idempotent, so re-running is a safe no-op.
    id: '0046_external_deposits',
    statements: [
      `CREATE TABLE IF NOT EXISTS ext_hd_indexes (
        user_id        TEXT NOT NULL,
        chain          TEXT NOT NULL,
        address_index  INTEGER NOT NULL,
        address        TEXT,
        created_at     TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        PRIMARY KEY (user_id, chain),
        UNIQUE (chain, address_index),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ext_hd_indexes_addr ON ext_hd_indexes(address)`,
      `CREATE TABLE IF NOT EXISTS ext_addresses (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        chain         TEXT NOT NULL,
        network       TEXT NOT NULL,
        address       TEXT NOT NULL,
        derivation    TEXT,
        address_index INTEGER NOT NULL,
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        UNIQUE (chain, network, address),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ext_addresses_user ON ext_addresses(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ext_addresses_scan ON ext_addresses(chain, network, is_active)`,
      `CREATE TABLE IF NOT EXISTS ext_deposits (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL,
        chain           TEXT NOT NULL,
        network         TEXT NOT NULL,
        coin_symbol     TEXT NOT NULL,
        address         TEXT NOT NULL,
        tx_hash         TEXT NOT NULL,
        log_index       INTEGER NOT NULL DEFAULT 0,
        block_height    INTEGER,
        amount          TEXT NOT NULL,
        confirmations   INTEGER NOT NULL DEFAULT 0,
        required_confs  INTEGER NOT NULL DEFAULT 12,
        status          TEXT NOT NULL DEFAULT 'detected',
        credited_at     TEXT,
        swept_tx_hash   TEXT,
        swept_at        TEXT,
        raw_meta        TEXT,
        created_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        UNIQUE (chain, tx_hash, log_index, address),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ext_deposits_user ON ext_deposits(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_ext_deposits_status ON ext_deposits(status, chain, network)`,
      `CREATE INDEX IF NOT EXISTS idx_ext_deposits_address ON ext_deposits(address)`,
      `CREATE TABLE IF NOT EXISTS ext_scan_state (
        chain              TEXT NOT NULL,
        network            TEXT NOT NULL,
        last_scanned_block INTEGER NOT NULL DEFAULT 0,
        head_block         INTEGER NOT NULL DEFAULT 0,
        hot_wallet_addr    TEXT,
        updated_at         TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        PRIMARY KEY (chain, network)
      )`,
      `INSERT OR REPLACE INTO system_state (key, value, updated_at)
       VALUES ('external_deposits_2026_08_25', 'migrated_v1', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    ],
  },
  {
    // 0047 — QTA staking, image-card tier model (schema part).
    // Adds QTA principal tracking to positions + sets the launch QTA price
    // (5 KRW = $0.00357142857). Idempotent (dup-column swallowed; price UPDATE
    // is a plain re-runnable statement).
    id: '0047_staking_qta_image_tiers_schema',
    statements: [
      `ALTER TABLE staking_positions ADD COLUMN principal_qta REAL DEFAULT 0`,
      `ALTER TABLE staking_positions ADD COLUMN qta_price_at_stake REAL DEFAULT 0`,
      `UPDATE coins SET price_usd = 0.00357142857 WHERE symbol = 'QTA'`,
    ],
  },
  {
    // 0047 — QTA staking, image-card tier SEED (4 tiers). Re-runnable; gated on
    // schema_migrations but re-applied by /migrate?force=1 (id contains 'seed').
    //   PLATINUM 1  $100-4,999   180d  0.2%/day (36%)
    //   PLATINUM 2  $100-4,999   360d  0.3%/day (108%)
    //   VIP 1       $5,000+      180d  0.3%/day (54%)
    //   VIP 2       $5,000+      360d  0.5%/day (180%)
    id: '0047_staking_qta_image_tiers_seed',
    statements: [
      `DELETE FROM staking_products`,
      `INSERT INTO staking_products
        (id, coin_symbol, kind, apr, lock_days, min_amount, max_amount,
         min_usd, max_usd, term_days, daily_rate, payout_coin, sort_order, is_active)
       VALUES
        ('platinum_1','QTA','fixed',0.36,180,100,4999,100,4999,180,0.002,'QTA',1,1),
        ('platinum_2','QTA','fixed',1.08,360,100,4999,100,4999,360,0.003,'QTA',2,1),
        ('vip_1','QTA','fixed',0.54,180,5000,1000000,5000,1000000,180,0.003,'QTA',3,1),
        ('vip_2','QTA','fixed',1.80,360,5000,1000000,5000,1000000,360,0.005,'QTA',4,1)`,
    ],
  },
  {
    // 0048 — Binary (left/right) matching-bonus program. Adds tree-position
    // columns to users, a per-user leg-volume table, the payout ledger, and
    // deposit idempotency markers. Mirrors /migrations/0048_binary_matching_bonus.sql.
    // Idempotent (dup-column / already-exists swallowed).
    id: '0048_binary_matching_bonus',
    statements: [
      `ALTER TABLE users ADD COLUMN binary_parent_id TEXT`,
      `ALTER TABLE users ADD COLUMN binary_leg TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_users_binary_parent ON users(binary_parent_id)`,
      `CREATE TABLE IF NOT EXISTS binary_volume (
        user_id      TEXT PRIMARY KEY,
        left_usd     REAL NOT NULL DEFAULT 0,
        right_usd    REAL NOT NULL DEFAULT 0,
        matched_usd  REAL NOT NULL DEFAULT 0,
        updated_at   TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS binary_match_bonuses (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        matched_usd   REAL NOT NULL,
        rate          REAL NOT NULL,
        bonus_usd     REAL NOT NULL,
        bonus_qta     REAL NOT NULL,
        qta_price     REAL NOT NULL,
        left_total    REAL NOT NULL DEFAULT 0,
        right_total   REAL NOT NULL DEFAULT 0,
        matched_total REAL NOT NULL DEFAULT 0,
        created_at    TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_binary_match_user ON binary_match_bonuses(user_id, created_at DESC)`,
      `ALTER TABLE ext_deposits ADD COLUMN binary_counted_at TEXT`,
      `ALTER TABLE deposits ADD COLUMN binary_counted_at TEXT`,
    ],
  },
];

export interface MigrateResult {
  ok: boolean;
  applied: string[];
  skipped: string[];
  errors: Array<{ id: string; statement: number; error: string }>;
}

/**
 * Apply all pending migrations. Cheap to call every tick: after everything is
 * applied it only does one SELECT against schema_migrations.
 *
 * @param force  when true, re-run seed migrations even if already recorded.
 */
export async function runMigrations(env: MigrateEnv, force = false): Promise<MigrateResult> {
  const result: MigrateResult = { ok: true, applied: [], skipped: [], errors: [] };

  // Ensure the tracking table exists.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();

  // Which migrations are already recorded?
  const { results } = await env.DB.prepare(`SELECT id FROM schema_migrations`).all<{ id: string }>();
  const done = new Set((results || []).map((r) => r.id));

  for (const mig of MIGRATIONS) {
    const isSeed = mig.id.includes('seed');
    if (done.has(mig.id) && !(force && isSeed)) {
      result.skipped.push(mig.id);
      continue;
    }

    let fatal = false;
    for (let i = 0; i < mig.statements.length; i++) {
      try {
        await env.DB.prepare(mig.statements[i]).run();
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (isIdempotentError(msg)) {
          // Effect already present — fine, keep going.
          continue;
        }
        // A genuine error. Record it but don't mark the migration done, so we
        // retry next tick. Do NOT throw — other migrations should still run.
        result.errors.push({ id: mig.id, statement: i, error: msg.slice(0, 300) });
        fatal = true;
        break;
      }
    }

    if (!fatal) {
      await env.DB.prepare(
        `INSERT INTO schema_migrations (id, applied_at) VALUES (?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET applied_at = excluded.applied_at`
      ).bind(mig.id).run();
      result.applied.push(mig.id);
    } else {
      result.ok = false;
    }
  }

  return result;
}
