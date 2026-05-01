-- ============================================================================
-- Sprint 4 Phase B: QTA Native Chain Integration
-- ----------------------------------------------------------------------------
-- Adds tables to track:
--   * Per-user QTA mainnet deposit addresses (post-quantum signed)
--   * Inbound deposit detections from chain monitor
--   * Outbound withdrawal queue (admin approval -> hot wallet broadcast)
--   * Chain sync state (last scanned block, hot wallet balance, validator info)
--
-- Defaults assumed:
--   - Signature scheme: CRYSTALS-Dilithium3 (NIST PQC standard)
--   - Block time: 2s
--   - Deposit confirmations required: 12
-- ============================================================================

-- ----------------------------------------------------------------------------
-- qta_addresses : per-user deposit address on QTA mainnet
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qta_addresses (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  address       TEXT NOT NULL UNIQUE,
  pubkey        TEXT NOT NULL,           -- post-quantum public key (hex / base58)
  derivation    TEXT,                    -- HD derivation path or key id
  network       TEXT NOT NULL DEFAULT 'qta-mainnet', -- qta-mainnet | qta-testnet
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_qta_addresses_user ON qta_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_qta_addresses_network ON qta_addresses(network, is_active);

-- ----------------------------------------------------------------------------
-- qta_deposits : detected inbound transfers to user addresses
--   status flow: detected -> confirming -> credited (or orphaned)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qta_deposits (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  address         TEXT NOT NULL,
  tx_hash         TEXT NOT NULL,
  block_height    INTEGER,
  amount          TEXT NOT NULL,           -- string to avoid float drift
  confirmations   INTEGER NOT NULL DEFAULT 0,
  required_confs  INTEGER NOT NULL DEFAULT 12,
  status          TEXT NOT NULL DEFAULT 'detected', -- detected | confirming | credited | orphaned
  credited_at     TEXT,
  network         TEXT NOT NULL DEFAULT 'qta-mainnet',
  raw_meta        TEXT,                    -- JSON: raw RPC payload snippet
  created_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  UNIQUE(tx_hash, address),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_qta_deposits_user ON qta_deposits(user_id, status);
CREATE INDEX IF NOT EXISTS idx_qta_deposits_status ON qta_deposits(status, network);
CREATE INDEX IF NOT EXISTS idx_qta_deposits_address ON qta_deposits(address);

-- ----------------------------------------------------------------------------
-- qta_withdrawals : outbound withdrawal queue (admin-approved -> broadcast)
--   status flow: pending -> approved -> broadcasting -> confirmed | failed | rejected
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qta_withdrawals (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  to_address      TEXT NOT NULL,
  amount          TEXT NOT NULL,
  fee             TEXT NOT NULL DEFAULT '0',
  status          TEXT NOT NULL DEFAULT 'pending',
                    -- pending | approved | broadcasting | confirmed | failed | rejected
  tx_hash         TEXT,
  block_height    INTEGER,
  pq_signature    TEXT,                    -- hex of post-quantum signature payload
  approved_by     TEXT,                    -- admin user id
  approved_at     TEXT,
  broadcast_at    TEXT,
  confirmed_at    TEXT,
  rejected_reason TEXT,
  network         TEXT NOT NULL DEFAULT 'qta-mainnet',
  created_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_qta_withdrawals_user ON qta_withdrawals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_qta_withdrawals_status ON qta_withdrawals(status, network);

-- ----------------------------------------------------------------------------
-- qta_chain_state : single-row-per-network sync marker
--   Updated by the cron monitor each tick.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qta_chain_state (
  network            TEXT PRIMARY KEY,         -- 'qta-mainnet' | 'qta-testnet'
  last_scanned_block INTEGER NOT NULL DEFAULT 0,
  head_block         INTEGER NOT NULL DEFAULT 0,
  hot_wallet_addr    TEXT,
  hot_wallet_balance TEXT NOT NULL DEFAULT '0',
  validators_online  INTEGER NOT NULL DEFAULT 0,
  signature_scheme   TEXT NOT NULL DEFAULT 'CRYSTALS-Dilithium3',
  block_time_ms      INTEGER NOT NULL DEFAULT 2000,
  required_confs     INTEGER NOT NULL DEFAULT 12,
  last_tick_at       TEXT,
  last_error         TEXT,
  updated_at         TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

INSERT OR IGNORE INTO qta_chain_state
  (network, signature_scheme, block_time_ms, required_confs)
VALUES
  ('qta-mainnet', 'CRYSTALS-Dilithium3', 2000, 12),
  ('qta-testnet', 'CRYSTALS-Dilithium3', 2000, 6);

-- ----------------------------------------------------------------------------
-- system_markers entries for the admin System tab
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO system_markers (key, value, updated_at) VALUES
  ('qta_chain_integration', 'phase-b-stub', CURRENT_TIMESTAMP),
  ('qta_signature_scheme', 'CRYSTALS-Dilithium3', CURRENT_TIMESTAMP);
