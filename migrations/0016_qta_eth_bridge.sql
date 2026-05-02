-- ============================================================================
-- Sprint 4 Phase G: QTA <-> ETH Bridge (qQTA wrapped ERC-20)
-- ----------------------------------------------------------------------------
-- Adds tables to track:
--   * Bridge transfers (bidirectional: qta_to_eth | eth_to_qta)
--   * Bridge state (total locked QTA, total minted qQTA, fee config)
--
-- Stub-first design (consistent with Phase B QTA chain stub):
--   - DB-only state machine here; actual ETH RPC submission lands in
--     a follow-up commit (cron-worker driver).
--   - qQTA = wrapped QTA on Ethereum mainnet (ERC-20, 18 decimals).
--
-- State flow per direction:
--   qta_to_eth : pending_lock -> locked -> minting -> minted (or failed)
--   eth_to_qta : pending_burn -> burned -> releasing -> released (or failed)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- bridge_transfers : per-user bridge requests (both directions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_transfers (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  direction       TEXT NOT NULL,             -- qta_to_eth | eth_to_qta
  amount          TEXT NOT NULL,             -- string-decimal QTA / qQTA amount
  fee             TEXT NOT NULL DEFAULT '0', -- string-decimal fee (in source asset)
  qta_address     TEXT,                      -- source/destination on QTA chain
  eth_address     TEXT,                      -- source/destination on Ethereum
  qta_tx_hash     TEXT,                      -- QTA chain tx (lock or release)
  eth_tx_hash     TEXT,                      -- ETH chain tx (mint or burn)
  status          TEXT NOT NULL DEFAULT 'pending_lock',
  -- pending_lock | locked | minting | minted
  -- pending_burn | burned  | releasing | released
  -- failed | cancelled
  failure_reason  TEXT,
  network         TEXT NOT NULL DEFAULT 'mainnet', -- mainnet | sepolia (eth side)
  created_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  completed_at    TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_bridge_xfers_user      ON bridge_transfers(user_id);
CREATE INDEX IF NOT EXISTS idx_bridge_xfers_status    ON bridge_transfers(status);
CREATE INDEX IF NOT EXISTS idx_bridge_xfers_direction ON bridge_transfers(direction, status);
CREATE INDEX IF NOT EXISTS idx_bridge_xfers_eth_tx    ON bridge_transfers(eth_tx_hash);
CREATE INDEX IF NOT EXISTS idx_bridge_xfers_qta_tx    ON bridge_transfers(qta_tx_hash);
CREATE INDEX IF NOT EXISTS idx_bridge_xfers_created   ON bridge_transfers(created_at DESC);

-- ----------------------------------------------------------------------------
-- bridge_state : single-row aggregate per network
--   Tracks total QTA locked vs total qQTA in circulation; should match
--   1:1 minus rounding drift below 1 wei.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_state (
  network            TEXT PRIMARY KEY,         -- mainnet | sepolia
  total_locked       TEXT NOT NULL DEFAULT '0',-- QTA held in bridge custody
  total_minted       TEXT NOT NULL DEFAULT '0',-- qQTA in circulation on ETH
  fee_bps            INTEGER NOT NULL DEFAULT 30, -- 0.30% bridge fee
  min_amount         TEXT NOT NULL DEFAULT '1',-- minimum bridge amount in QTA
  max_amount         TEXT NOT NULL DEFAULT '1000000', -- per-tx ceiling
  qqta_contract_addr TEXT,                     -- qQTA ERC-20 contract on ETH
  custody_qta_addr   TEXT,                     -- bridge-controlled QTA address
  last_eth_block     INTEGER NOT NULL DEFAULT 0,
  last_qta_block     INTEGER NOT NULL DEFAULT 0,
  last_tick_at       TEXT,
  last_error         TEXT,
  updated_at         TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- Seed mainnet + sepolia rows so /api/bridge/state never returns null
INSERT OR IGNORE INTO bridge_state
  (network, total_locked, total_minted, fee_bps, min_amount, max_amount,
   qqta_contract_addr, custody_qta_addr, last_eth_block, last_qta_block)
VALUES
  ('mainnet', '0', '0', 30,  '1', '1000000', NULL, NULL, 0, 0),
  ('sepolia', '0', '0', 30,  '1', '1000000', NULL, NULL, 0, 0);

-- ----------------------------------------------------------------------------
-- system_markers : track Phase G integration phase + admin pause toggle
-- ----------------------------------------------------------------------------
INSERT OR REPLACE INTO system_markers (key, value, updated_at) VALUES
  ('bridge_integration', 'phase-g-stub',  CURRENT_TIMESTAMP),
  ('bridge_paused',      'off',           CURRENT_TIMESTAMP);
