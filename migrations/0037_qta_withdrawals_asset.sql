-- Migration 0037: add `asset` column to qta_withdrawals.
--
-- WHY: The Quantarium withdrawal queue (0015) was built for the native QTA
-- coin only. Under coin-family wallet routing (boss's 2026-08-13 decision),
-- ALL Quantarium-native assets — the QTA coin plus every token QuantaEX
-- issued on the Quantarium chain (QX, QKEY, ...) — are sent through our own
-- Quantarium SPHINCS+ HD wallet. The cron broadcaster must therefore know
-- whether a queued row is a native value transfer (QTA) or an ERC-20
-- transfer() (QX / QKEY), and against which token contract.
--
-- WHAT: One new column `asset` (default 'QTA' so existing rows keep their
-- meaning). Values: 'QTA' | 'QX' | 'QKEY'. The token contract address and
-- decimals are resolved by the broadcaster from env vars, keyed by asset.
--
-- Marker key: qta_withdrawals_asset_2026_08_13 = migrated_v1

ALTER TABLE qta_withdrawals ADD COLUMN asset TEXT NOT NULL DEFAULT 'QTA';

CREATE INDEX IF NOT EXISTS idx_qta_withdrawals_asset ON qta_withdrawals(asset, status);

-- Marker.
INSERT OR REPLACE INTO system_state (key, value, updated_at)
VALUES (
  'qta_withdrawals_asset_2026_08_13',
  'migrated_v1',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
