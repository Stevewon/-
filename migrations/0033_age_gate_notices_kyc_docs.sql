-- ============================================================================
-- Migration 0033 — Age gate (18+) + DB-managed notices + KYC document registry
-- ----------------------------------------------------------------------------
--   1) users.date_of_birth  (TEXT, ISO YYYY-MM-DD) — required for 18+ gate
--      Existing users get NULL until they fill it in. New registrations
--      MUST supply it.
--   2) notices                 — global notice board, admin CRUD-managed
--      Replaces hard-coded NOTICES_KO/NOTICES_EN arrays in NoticePage.tsx.
--      Bilingual title+content; deletable/pinnable.
--   3) kyc_documents           — metadata registry for KYC files stored in R2
--      The actual file lives in the R2 bucket bound as KYC_BUCKET. This
--      table tracks the R2 key (path), original filename, content hash,
--      MIME type, size, and upload metadata, so admins can audit / re-fetch
--      files and so retention policy enforcement is possible.
--
-- IMPORTANT: This migration is self-bootstrapped at worker startup (see
-- src/server/index.ts ageGateNoticesKycDocsBootstrap). Cloudflare Pages
-- cannot run `wrangler d1 migrations apply` from CI.
-- ============================================================================

-- (1) Age gate ----------------------------------------------------------------
-- ISO-8601 string (YYYY-MM-DD). Stored as TEXT so JS Date.parse works
-- universally and so we don't have to deal with sqlite DATE quirks.
ALTER TABLE users ADD COLUMN date_of_birth TEXT;

-- (2) Notices (DB-managed) ----------------------------------------------------
CREATE TABLE IF NOT EXISTS notices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT    NOT NULL DEFAULT 'notice',   -- notice | event | maintenance | listing
  title_ko     TEXT    NOT NULL,
  title_en     TEXT    NOT NULL,
  content_ko   TEXT    NOT NULL,
  content_en   TEXT    NOT NULL,
  pinned       INTEGER NOT NULL DEFAULT 0,          -- boolean 0/1
  published    INTEGER NOT NULL DEFAULT 1,          -- boolean 0/1, set 0 to soft-delete
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by   TEXT,                                -- admin user.id
  CHECK (type IN ('notice','event','maintenance','listing'))
);

CREATE INDEX IF NOT EXISTS idx_notices_published_pinned
  ON notices(published, pinned DESC, created_at DESC);

-- Seed: copy the 6 hard-coded notices into the DB so users don't lose them
-- when the frontend switches to /api/notices. Insert only if the table is
-- empty (idempotent).
INSERT INTO notices (id, type, title_ko, title_en, content_ko, content_en, pinned, published, created_at)
SELECT * FROM (
  SELECT
    1 AS id, 'notice' AS type,
    'QuantaEX 글로벌 거래소 그랜드 오픈 안내' AS title_ko,
    'QuantaEX Global Exchange Grand Opening' AS title_en,
    'QuantaEX가 글로벌 디지털 자산 거래소로 정식 오픈되었습니다. BTC, ETH, QTA 등 13종의 암호화폐를 USDT 및 USDC 마켓에서 거래하실 수 있습니다. 회원가입 시 100 QX 웰컴 보너스(이메일 인증 후 잠금 해제)가 지급됩니다. 많은 이용 부탁드립니다.' AS content_ko,
    'QuantaEX is now officially open as a global digital-asset exchange. You can trade 13 cryptocurrencies including BTC, ETH, and QTA against USDT and USDC. Sign up to receive a 100 QX welcome bonus, unlocked after email verification. We look forward to your participation.' AS content_en,
    1 AS pinned, 1 AS published, '2026-04-20 00:00:00' AS created_at
  UNION ALL SELECT
    2, 'listing',
    '[신규 상장] QTA (Quanta Token) 상장 안내',
    '[New Listing] QTA (Quanta Token) Listed',
    'QTA (Quanta Token)이 QuantaEX 거래소에 신규 상장되었습니다.' || char(10) || char(10) || '■ 상장일시: 2026년 4월 20일 (일) 00:00 UTC' || char(10) || '■ 거래쌍: QTA/USDT, QTA/USDC' || char(10) || '■ 입출금: 즉시 가능' || char(10) || char(10) || '상장 기념 이벤트로 QTA 거래 수수료 50% 할인이 진행됩니다.',
    'QTA (Quanta Token) has been listed on QuantaEX.' || char(10) || char(10) || '■ Listing Date: April 20, 2026 (Sun) 00:00 UTC' || char(10) || '■ Trading Pairs: QTA/USDT, QTA/USDC' || char(10) || '■ Deposits/Withdrawals: Available immediately' || char(10) || char(10) || 'To celebrate the listing, QTA trading fees are discounted by 50%.',
    1, 1, '2026-04-20 00:00:00'
  UNION ALL SELECT
    3, 'event',
    '[이벤트] 회원가입 웰컴 보너스 이벤트',
    '[Event] Welcome Bonus Giveaway',
    '신규 회원가입 시 다음 보너스를 지급합니다:' || char(10) || char(10) || '• 100 QX (이메일 인증 후 잠금 해제)' || char(10) || char(10) || '※ QX는 회사가 지급하는 프로모션 자산으로 거래소 내에서 거래 및 수수료 할인에 사용될 수 있으며, 외부 출금은 제한됩니다.' || char(10) || char(10) || '이벤트 기간: 2026년 4월 20일 ~ 별도 공지 시까지' || char(10) || char(10) || 'KYC 인증 완료 회원에게는 추가 거래 수수료 할인이 적용됩니다.',
    'New members will receive the following welcome bonus upon registration:' || char(10) || char(10) || '• 100 QX (unlocked after email verification)' || char(10) || char(10) || '※ QX is a promotional asset issued by the Company. It can be used for trading and fee discounts within the exchange but is restricted from external withdrawals.' || char(10) || char(10) || 'Event period: April 20, 2026 ~ until further notice' || char(10) || char(10) || 'KYC-verified members are eligible for additional trading-fee discounts.',
    0, 1, '2026-04-20 00:00:00'
  UNION ALL SELECT
    4, 'notice',
    'KYC 인증 절차 안내',
    'KYC Verification Process Guide',
    '원활한 거래를 위해 KYC 인증을 완료해 주시기 바랍니다.' || char(10) || char(10) || '■ 인증 방법: 마이페이지 > 보안설정 > KYC 인증' || char(10) || '■ 필요 서류: 성명, 연락처, 신분증 번호' || char(10) || '■ 처리 기간: 신청 후 최대 24시간 이내' || char(10) || char(10) || 'KYC 미인증 시 출금이 제한될 수 있습니다.',
    'Please complete your KYC verification for uninterrupted trading.' || char(10) || char(10) || '■ How to verify: My Page > Security Settings > KYC Verification' || char(10) || '■ Required documents: Full name, phone number, ID number' || char(10) || '■ Processing time: Within 24 hours of submission' || char(10) || char(10) || 'Withdrawals may be restricted without KYC verification.',
    0, 1, '2026-04-19 00:00:00'
  UNION ALL SELECT
    5, 'maintenance',
    '[점검 완료] 서버 정기 점검 안내',
    '[Completed] Scheduled Server Maintenance',
    '서버 정기 점검이 완료되었습니다.' || char(10) || char(10) || '■ 점검일시: 2026년 4월 18일 02:00 ~ 04:00 (KST)' || char(10) || '■ 영향 범위: 전 서비스 일시 중단' || char(10) || '■ 현재 상태: 정상 운영 중' || char(10) || char(10) || '이용에 불편을 드려 죄송합니다.',
    'Scheduled server maintenance has been completed.' || char(10) || char(10) || '■ Maintenance window: April 18, 2026, 02:00 ~ 04:00 (KST)' || char(10) || '■ Scope: Temporary suspension of all services' || char(10) || '■ Current status: Normal operation' || char(10) || char(10) || 'We apologize for any inconvenience.',
    0, 1, '2026-04-18 00:00:00'
  UNION ALL SELECT
    6, 'notice',
    '이상 거래 탐지 시스템 업데이트 안내',
    'Anomaly Detection System Update',
    '고객 자산 보호를 위해 이상 거래 탐지 시스템이 업데이트되었습니다.' || char(10) || char(10) || '주요 변경사항:' || char(10) || '• 비정상 대량 주문 자동 차단' || char(10) || '• IP 기반 접속 제한 강화' || char(10) || '• 출금 시 추가 인증 절차 도입',
    'The anomaly detection system has been updated to better protect customer assets.' || char(10) || char(10) || 'Key changes:' || char(10) || '• Automatic blocking of abnormal large orders' || char(10) || '• Enhanced IP-based access restrictions' || char(10) || '• Additional verification steps for withdrawals',
    0, 1, '2026-04-17 00:00:00'
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM notices LIMIT 1);

-- (3) KYC document registry --------------------------------------------------
CREATE TABLE IF NOT EXISTS kyc_documents (
  id           TEXT    PRIMARY KEY,                -- uuid
  user_id      TEXT    NOT NULL,
  kind         TEXT    NOT NULL,                    -- 'id_document' | 'address_document'
  r2_key       TEXT,                                -- R2 object key (NULL = R2 not bound, fallback tag only)
  storage_tag  TEXT    NOT NULL,                    -- always set: 'kyc-doc:<hash>:<size>:<filename>' OR 'r2://<key>'
  content_hash TEXT    NOT NULL,                    -- SHA-256 hex prefix (first 16 chars, for dedup)
  filename     TEXT    NOT NULL,                    -- original filename, truncated to 200 chars
  mime_type    TEXT    NOT NULL,
  size_bytes   INTEGER NOT NULL,
  uploaded_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploaded_ip  TEXT,                                -- audit trail
  CHECK (kind IN ('id_document','address_document')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kyc_docs_user_kind
  ON kyc_documents(user_id, kind, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_kyc_docs_hash
  ON kyc_documents(content_hash);

-- Migration marker
INSERT INTO system_markers (key, value, updated_at)
VALUES ('age_gate_notices_kyc_docs_2026_06_22', 'migrated_v1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
