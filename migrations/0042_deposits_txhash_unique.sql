-- 0042_deposits_txhash_unique.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- A3 (fund-flow audit) idempotency hardening.
--
-- `deposits.tx_hash` had no uniqueness guarantee, so a concurrent double-submit
-- of a manual credit (or a chain-watcher catch-up replay) could create two
-- deposit rows for the same on-chain / idempotency tx and double-credit the
-- wallet. A partial UNIQUE index makes duplicate tx_hash inserts fail (and lets
-- `INSERT OR IGNORE` no-op), while still allowing many legacy rows whose
-- tx_hash is NULL.
--
-- NOTE: if this migration fails because pre-existing duplicate tx_hash values
-- exist, de-dupe them first, then re-run. Fresh production DBs apply cleanly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_tx_hash_unique
  ON deposits (tx_hash)
  WHERE tx_hash IS NOT NULL;
