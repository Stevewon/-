-- =====================================================================
-- QuantaEX 완전 초기화 (범위 A: 모든 데이터 테이블 비움)
-- ⚠️⚠️ 회원(users)까지 전부 삭제됩니다 → 처음부터 재가입 필요.
--      코인/마켓/상품 설정도 삭제됩니다 (필요시 이 두 줄은 주석 처리).
--      d1_migrations 는 삭제하지 않습니다 (스키마 관리용).
-- ⚠️ 되돌릴 수 없습니다. 실행 전 반드시 백업하세요.
-- =====================================================================

-- 운영 데이터 (reset_data_only.sql 의 전부)
DELETE FROM wallets;
DELETE FROM deposits;
DELETE FROM ext_deposits;
DELETE FROM ext_addresses;
DELETE FROM ext_hd_indexes;
DELETE FROM ext_scan_state;
DELETE FROM qta_deposits;
DELETE FROM qta_addresses;
DELETE FROM qta_hd_indexes;
DELETE FROM qta_withdrawals;
DELETE FROM withdrawals;
DELETE FROM withdraw_whitelist;
DELETE FROM orders;
DELETE FROM trades;
DELETE FROM twap_orders;
DELETE FROM staking_positions;
DELETE FROM staking_dividends;
DELETE FROM binary_volume;
DELETE FROM binary_match_bonuses;
DELETE FROM referrals;
DELETE FROM futures_positions;
DELETE FROM futures_funding_rates;
DELETE FROM liquidations;
DELETE FROM margin_accounts;
DELETE FROM margin_loans;
DELETE FROM fee_ledger;
DELETE FROM notifications;
DELETE FROM price_alerts;
DELETE FROM admin_audit_logs;

-- 회원 / 세션 / 인증 / 동의 / KYC / 로그인이력 등 (회원 관련 전부)
DELETE FROM user_sessions;
DELETE FROM user_consents;
DELETE FROM user_meta;
DELETE FROM kyc_documents;
DELETE FROM email_verifications;
DELETE FROM login_history;
DELETE FROM login_otps;
DELETE FROM password_resets;
DELETE FROM api_keys;
DELETE FROM api_key_nonces;
DELETE FROM api_key_pq_audit;
DELETE FROM rate_limits;
DELETE FROM users;

-- 상품/시장 설정 (완전 백지화를 원할 때만. 유지하려면 아래 3줄 주석 처리)
-- DELETE FROM staking_products;
-- DELETE FROM markets;
-- DELETE FROM coins;

-- 완료
