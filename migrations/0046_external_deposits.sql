-- Migration 0046: External (non-Quantarium) deposit infrastructure — Phase B.
--
-- WHY (boss directive 2026-08-25):
--   Users must be able to deposit real USDT/BTC/ETH. The model is the standard
--   exchange "forwarding / sweep" pattern:
--     1. Each user gets a REAL per-user deposit address, derived from a single
--        exchange-held HD mnemonic (one chain family at a time). The user
--        believes it is their own private deposit wallet.
--     2. A background watcher scans each address for inbound transfers and
--        credits the user's internal balance after N confirmations.
--     3. A sweep job moves the funds from the per-user address into the
--        exchange hot wallet (consolidation), paying gas as needed.
--
-- SCOPE OF THIS MIGRATION:
--   Chain-agnostic tables. The first adapter we wire is EVM/ERC20 (Ethereum),
--   because it reuses the same secp256k1 + keccak256 + BIP-32 toolchain already
--   in the repo. TRON/TRC20 and BTC get their own adapters later but share
--   these tables (distinguished by `chain` + `network`).
--
-- SECURITY:
--   - address_index is monotonic & immutable per (user_id, chain). A deleted
--     user's index is NEVER reused (mirrors qta_hd_indexes rationale) so
--     incoming funds can never be mapped to the wrong account.
--   - Private keys are NEVER stored. They are re-derived on demand from the
--     HD mnemonic secret (EXT_HD_WALLET_MNEMONIC) using the stored index.
--
-- Marker key: external_deposits_2026_08_25 = migrated_v1

-- ----------------------------------------------------------------------------
-- ext_hd_indexes : monotonic HD derivation index per (user_id, chain)
--   chain: 'evm' | 'tron' | 'btc' (one HD tree per chain family)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ext_hd_indexes (
  user_id        TEXT NOT NULL,
  chain          TEXT NOT NULL,                       -- evm | tron | btc
  address_index  INTEGER NOT NULL,
  address        TEXT,                                -- cached derived address (checksum)
  created_at     TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (user_id, chain),
  UNIQUE (chain, address_index),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS idx_ext_hd_indexes_addr ON ext_hd_indexes(address);

-- ----------------------------------------------------------------------------
-- ext_addresses : the per-user deposit address shown in the UI
--   One row per (user_id, chain, network). `derivation` is the BIP-44 path.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ext_addresses (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  chain         TEXT NOT NULL,                        -- evm | tron | btc
  network       TEXT NOT NULL,                        -- erc20 | trc20 | bep20 | btc
  address       TEXT NOT NULL,
  derivation    TEXT,                                 -- e.g. m/44'/60'/0'/0/<idx>
  address_index INTEGER NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  UNIQUE (chain, network, address),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_ext_addresses_user ON ext_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_ext_addresses_scan ON ext_addresses(chain, network, is_active);

-- ----------------------------------------------------------------------------
-- ext_deposits : detected inbound transfers to user addresses
--   status: detected -> confirming -> credited (-> swept) | orphaned
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ext_deposits (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  chain           TEXT NOT NULL,
  network         TEXT NOT NULL,
  coin_symbol     TEXT NOT NULL,                      -- USDT | ETH | ...
  address         TEXT NOT NULL,
  tx_hash         TEXT NOT NULL,
  log_index       INTEGER NOT NULL DEFAULT 0,         -- ERC20 transfers: disambiguate multi-transfer txs
  block_height    INTEGER,
  amount          TEXT NOT NULL,                      -- decimal string, avoid float drift
  confirmations   INTEGER NOT NULL DEFAULT 0,
  required_confs  INTEGER NOT NULL DEFAULT 12,
  status          TEXT NOT NULL DEFAULT 'detected',   -- detected | confirming | credited | swept | orphaned
  credited_at     TEXT,
  swept_tx_hash   TEXT,                               -- set once funds moved to hot wallet
  swept_at        TEXT,
  raw_meta        TEXT,
  created_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  UNIQUE (chain, tx_hash, log_index, address),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_ext_deposits_user ON ext_deposits(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ext_deposits_status ON ext_deposits(status, chain, network);
CREATE INDEX IF NOT EXISTS idx_ext_deposits_address ON ext_deposits(address);

-- ----------------------------------------------------------------------------
-- ext_scan_state : per (chain, network) scan cursor + hot-wallet snapshot
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ext_scan_state (
  chain              TEXT NOT NULL,
  network            TEXT NOT NULL,
  last_scanned_block INTEGER NOT NULL DEFAULT 0,
  head_block         INTEGER NOT NULL DEFAULT 0,
  hot_wallet_addr    TEXT,
  updated_at         TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (chain, network)
);

-- Marker.
INSERT OR REPLACE INTO system_state (key, value, updated_at)
VALUES (
  'external_deposits_2026_08_25',
  'migrated_v1',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
