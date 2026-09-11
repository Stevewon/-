-- 2026-09-11: record the TAKER side on each trade so the tape / SSE can show
-- real buy (green) vs sell (red). Old rows stay NULL → derived from price tick.
ALTER TABLE trades ADD COLUMN taker_side TEXT;
