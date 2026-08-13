-- Coin price policy — lets QuantaEX steer the price of OUR OWN coins
-- (QTA / QX / QKEY and any future in-house token) instead of leaving them to a
-- blind random walk. Standard external coins (BTC, ETH, ...) ignore all of
-- this; their price always comes from the real market feed.
--
-- Modes (price_mode):
--   'market'  — default. Free random walk around price_usd (legacy behaviour).
--   'peg'     — hold EXACTLY at price_target (a fixed peg). No drift.
--   'target'  — glide smoothly from price_drift_from to price_target between
--               price_drift_start and price_drift_end (epoch ms), then hold.
--   'managed' — random walk constrained to price_center ± price_band_pct%,
--               nudged by price_bias (-1 downward .. +1 upward).
--
-- "Instant jump" is just the admin setting mode='peg' with a new target (or
-- writing price_usd directly), so it needs no extra column.

ALTER TABLE coins ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'market';
ALTER TABLE coins ADD COLUMN price_target REAL;
ALTER TABLE coins ADD COLUMN price_center REAL;
ALTER TABLE coins ADD COLUMN price_band_pct REAL;
ALTER TABLE coins ADD COLUMN price_bias REAL NOT NULL DEFAULT 0;
ALTER TABLE coins ADD COLUMN price_drift_from REAL;
ALTER TABLE coins ADD COLUMN price_drift_start INTEGER;
ALTER TABLE coins ADD COLUMN price_drift_end INTEGER;

INSERT OR REPLACE INTO system_state (key, value, updated_at)
VALUES ('coin_price_policy_2026_08_13', 'migrated_v1', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
