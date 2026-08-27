-- ============================================================================
-- 0051_fee_exemptions.sql
-- ----------------------------------------------------------------------------
-- Owner request (2026-08-27): admin-assignable fee-exemption flags.
-- Four independent conditions the admin can toggle per user via the Admin panel:
--   1. fee_exempt_exchange_holder  거래소 지분권자  → trading fee + withdrawal fee EXEMPT
--   2. fee_exempt_casino_holder    카지노 지분권자  → trading fee + withdrawal fee EXEMPT
--   3. fee_exempt_qx_trade         QX 50만개 이상   → trading fee EXEMPT (only)
--   4. fee_exempt_qx_all           QX 50만개 이상   → trading fee + withdrawal fee EXEMPT
--
-- For the two QX-holder flags (3 & 4), the exemption additionally requires the
-- user to actually hold >= 500,000 QX at fee-computation time (enforced in
-- application code). The exchange/casino holder flags (1 & 2) are unconditional
-- once the admin sets them.
-- ============================================================================

ALTER TABLE users ADD COLUMN fee_exempt_exchange_holder INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN fee_exempt_casino_holder   INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN fee_exempt_qx_trade        INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN fee_exempt_qx_all          INTEGER DEFAULT 0;
