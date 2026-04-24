-- Sprint 3 — S3-3 Stop-Limit orders
-- -----------------------------------------------------------------------------
-- Adds the ability to place a stop-limit order that sits in a pending state
-- until the market's last trade price crosses `stop_price`. When triggered,
-- the order is converted into a regular limit order at `price` and enters
-- the matching engine exactly like a user-placed limit order.
--
-- Data additions:
--   orders.stop_price   REAL        — trigger price (NULL for non-stop orders)
--   orders.triggered_at TEXT        — timestamp of trigger; NULL = not triggered
--
-- Status conventions (enforced in application code):
--   'pending'   — stop order awaiting trigger (funds already locked)
--   'open'      — resting limit order (post-trigger for stops, or user-placed)
--   'partial'/'filled'/'cancelled'  — existing values, unchanged
--
-- Note on `type`: we keep it as a free-form TEXT column (schema already is)
-- and just add 'stop_limit' as an accepted value in the API layer. No
-- CHECK constraint needed.

ALTER TABLE orders ADD COLUMN stop_price   REAL;
ALTER TABLE orders ADD COLUMN triggered_at TEXT;

-- Fast lookup for pending stops per market (matching engine scans these
-- after every trade to check for triggers).
CREATE INDEX IF NOT EXISTS idx_orders_pending_stop
  ON orders(market_id, status, stop_price)
  WHERE status = 'pending';
