-- =====================================================================
-- QuantaEX 운영 데이터 초기화 (범위 B: 거래/입금/지갑/스테이킹 데이터만 삭제)
-- 유지: users(회원계정), coins, markets, staking_products(상품설정),
--       fee_tiers, futures_contracts, d1_migrations, system_* 등 설정성 테이블
-- 삭제: 입금/출금/지갑잔액/주문/체결/스테이킹포지션/바이너리/추천보상 등
-- ⚠️ 되돌릴 수 없습니다. 실행 전 반드시 백업하세요.
-- =====================================================================

-- 지갑 잔액 (회원은 유지하되 잔액 전부 0으로 재설정 = 데이터 삭제)
DELETE FROM wallets;

-- 입금 (수동/온체인/외부 전부)
DELETE FROM deposits;
DELETE FROM ext_deposits;
DELETE FROM ext_addresses;
DELETE FROM ext_hd_indexes;
DELETE FROM ext_scan_state;
DELETE FROM qta_deposits;
DELETE FROM qta_addresses;
DELETE FROM qta_hd_indexes;
DELETE FROM qta_withdrawals;

-- 출금
DELETE FROM withdrawals;
DELETE FROM withdraw_whitelist;

-- 주문 / 체결 / 캔들 / TWAP
DELETE FROM orders;
DELETE FROM trades;
DELETE FROM twap_orders;

-- 스테이킹 (포지션/배당 삭제, 상품 정의 staking_products 는 유지)
DELETE FROM staking_positions;
DELETE FROM staking_dividends;

-- 바이너리 / 추천 보상
DELETE FROM binary_volume;
DELETE FROM binary_match_bonuses;
DELETE FROM referrals;

-- 선물 / 마진 (포지션·대출만 삭제, contract 정의는 유지)
DELETE FROM futures_positions;
DELETE FROM futures_funding_rates;
DELETE FROM liquidations;
DELETE FROM margin_accounts;
DELETE FROM margin_loans;

-- 수수료 원장 / 알림 / 감사로그 / 가격알림
DELETE FROM fee_ledger;
DELETE FROM notifications;
DELETE FROM price_alerts;
DELETE FROM admin_audit_logs;

-- 완료: 유지되는 것 = users, coins, markets, staking_products, fee_tiers,
--       futures_contracts, notices, candles(원하면 별도삭제), 각종 설정 테이블
