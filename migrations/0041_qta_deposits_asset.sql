-- Migration 0041: add `asset` column to qta_deposits.
--
-- WHY: The Quantarium deposit table (0015) was built for the native QTA coin
-- only. The new on-chain deposit scanner (cron-worker scanQtaDeposits) detects
-- inbound transfers for ALL Quantarium-native assets — the QTA coin plus the
-- ERC-20 tokens QuantaEX issued on the Quantarium chain (QX, QKEY). Each
-- detected deposit must record WHICH asset it credits so qtaChainTick can
-- increment the correct wallet (coin_symbol = asset) when the deposit
-- reaches the required confirmations.
--
-- WHAT: One new column `asset` (default 'QTA' so any pre-existing rows keep
-- their meaning). Values: 'QTA' | 'QX' | 'QKEY'.
--
-- Marker key: qta_deposits_asset_2026_08_15 = migrated_v1

ALTER TABLE qta_deposits ADD COLUMN asset TEXT NOT NULL DEFAULT 'QTA';

CREATE INDEX IF NOT EXISTS idx_qta_deposits_asset ON qta_deposits(asset, status);

-- Marker.
INSERT OR REPLACE INTO system_state (key, value, updated_at)
VALUES (
  'qta_deposits_asset_2026_08_15',
  'migrated_v1',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
