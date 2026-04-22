# QuantaEX 거래소 기능 전수조사 리포트

**실시 일자**: 2026-04-22
**대상 버전**: main @ `9782854` + PR #12 (auth redesign)
**프로덕션**: https://quantaex.io (Cloudflare Pages + D1)
**목적**: 바이낸스·업비트 수준의 실제 거래소로 서비스하기 위한 **기능 완성도 / 보안 / 컴플라이언스 공백 전수조사**

---

## 📊 0. 요약 — 현재 상태 한눈에

| 영역 | 상태 | 한줄평 |
|------|------|--------|
| 가입·로그인 | 🟡 기본 완성 | 이메일/비밀번호/닉네임 + 1000 QTA 즉시 지급. **이메일 인증·2FA·비밀번호 재설정 전무** |
| 지갑 | 🔴 심각 | 입금이 "시뮬레이션 = 무한 발행" 상태, **실제 체인 연동 0%**. 출금 화이트리스트·2FA·일일한도 전무 |
| 매수/매도 | 🟡 동작함 | 지정가·시장가 매칭 OK. **자기거래 방지(STP)·최소주문수량 검증·수량소수점 라운딩 없음** |
| 호가/차트 | 🟡 혼합 | 실체결이 적어 **시뮬레이션 데이터로 렌더링**. 실시간 WebSocket 없고 SSE 18틱 폴링 |
| KYC | 🔴 장식 | 폼만 있고 **거래/출금에 강제되지 않음**. 문서 업로드 경로·심사 SLA·AML 스크리닝 없음 |
| 관리자 | 🟢 양호 | 대시보드/트렌드/유저·KYC·출금 관리 OK |
| 모바일 UX | 🟡 개선중 | PR #12에서 Binance/Upbit 스타일 개편 진행중 |
| 시세 봇 | 🟢 양호 | Self-scheduler 5분 주기 정상, Phase G 하드닝 완료 |

> **한 줄 결론**: 데모·MVP 수준의 기능은 완성됐지만, **실제 자산을 다루는 거래소로 공개 런칭하기엔 보안·컴플라이언스·자산 흐름 영역에서 런웨이 부족**.

---

## 🔴 1. Critical — 즉시 해결 필요 (런칭 블로커)

### 1.1 입금이 "시뮬레이션 = 사용자 스스로 찍어내기"
- **파일**: `src/server/routes/wallet.ts:72-93`
- **문제**: `POST /api/wallet/deposit` 는 `authMiddleware` 만 걸려 있고, 사용자가 요청한 `amount` 만큼 **지갑에 바로 꽂아주고 가짜 `tx_hash` 생성**.
- **실증**: E2E 테스트에서 `10,000 USDT` 를 아무 증빙 없이 만들어 사용 → 그 잔고로 실제 매수 주문이 체결됨.
- **영향**: 누구나 무한대 자산 발행 → 매도 주문을 다른 계정의 진짜 자산(기존 QTA 1000, 체결된 포지션)과 맞바꿀 수 있음. **실전 투입 시 0원 런지 공격 가능**.
- **필수 조치**:
  1. `/deposit` 은 **관리자 전용(adminMiddleware)** 또는 **완전히 제거**.
  2. 사용자용 입금은 반드시 **외부 체인 스캐너(블록 확인) → 자동 크레딧** 구조로 교체.
  3. 고유 입금 주소(BTC/ETH/USDT(TRC20/ERC20) 등) 발급 API, `deposits.network`, `deposits.memo`, `deposits.from_address` 컬럼은 이미 존재하므로 채울 로직만 추가.

### 1.2 KYC가 "장식" — 거래·출금 어디에도 강제되지 않음
- **파일**: `src/server/routes/order.ts`, `src/server/routes/wallet.ts`
- **문제**: `POST /api/orders`, `POST /api/wallet/withdraw` 는 `kyc_status` 를 전혀 보지 않음.
- **영향**: AML/KYT 의무 미이행 → **국내 특금법(가상자산이용자보호법)·해외 FATF Travel Rule 위반**. 출금 시 신원확인 실패.
- **필수 조치**:
  - KYC 티어 도입 (`none` / `basic` / `verified`)
    - `none`: 로그인·조회만
    - `basic` (전화번호·이메일): 입금·원화 이외 거래 제한
    - `verified` (신분증+실명계좌): 출금·KRW 입출금
  - 각 위험 액션에 `requireKyc('verified')` 미들웨어 추가.

### 1.3 출금 플로우 — 화이트리스트·2FA·한도 전무
- **파일**: `src/server/routes/wallet.ts:96-112`
- **문제**:
  - 주소 검증 없음 (오타 1글자 → 자산 소실).
  - 2FA / 이메일 확인 코드 없음 → **계정 탈취 시 즉시 전액 이탈**.
  - 일일/회당 한도 없음.
  - 금액을 `available - amount` 로 즉시 차감하는데, 잠금(locked)으로 옮기는 **2단계 상태 없음** → 관리자 승인 대기 중 다른 버그로 중복 차감 여지.
  - `amount * 0.001` 수수료를 수수료로 기록하면서 **사용자에게는 `amount - fee` 만 보낸다고 기록** → UI에서 명확히 고지 안 됨 (UX 혼란).
- **필수 조치**:
  1. `withdraw_addresses` (주소 화이트리스트) 테이블 + 24시간 쿨다운.
  2. `/withdraw` 요청 시 **TOTP 6자리 + 이메일 링크** 이중 확인.
  3. `withdraw_limits` 테이블 (일일 USD 상한, KYC 티어별 차등).
  4. 2단계 상태: `requested → email_confirmed → pending_admin → completed`.
  5. `available` 을 곧바로 깎지 말고 `locked` 로 이동, 승인 시 차감·거절 시 환불(현재 admin reject 코드는 이미 refund 하지만, `available` 을 깎은 상태이므로 **"amount+fee"를 더해 복원 = OK**).

### 1.4 2FA(TOTP) 설정·검증 엔드포인트가 없다
- **DB**: `users.two_factor_enabled`, `users.two_factor_secret` 컬럼 존재 (`migrations/0004`)
- **문제**: **활성화·검증 API가 단 하나도 구현되어 있지 않음**. 관리자가 리셋만 가능 (`admin.ts:270`).
- **영향**: 중요한 액션(로그인/출금/API키 생성)을 보호할 수단이 없음.
- **필수 조치**:
  - `POST /api/profile/2fa/enable` (QR secret 발급)
  - `POST /api/profile/2fa/verify` (최초 6자리 확인 → `two_factor_enabled=1`)
  - `POST /api/profile/2fa/disable` (현재 비번 + 현재 코드)
  - 로그인 응답에 `requires_2fa=true` 플래그 → 프론트에서 2단계 폼.

### 1.5 이메일 인증·비밀번호 재설정 부재
- **문제**: 가입 시 아무 이메일이나 입력 가능(@gmail.com 정상성 정규식만 있음), **이메일 소유 증명 안 됨**. 비밀번호 분실 시 복구 불가.
- **영향**: 스팸 가입/다계정 어뷰즈, 유저 이탈.
- **필수 조치**:
  - `email_verifications` 테이블 + 토큰 기반 `/api/auth/verify-email`.
  - 가입 직후 이메일 발송 → 24시간 내 미확인 시 `users.is_active=0`.
  - `/api/auth/forgot-password` + `/reset-password?token=…` 플로우.
  - Cloudflare Workers 에서 메일 발송은 Resend·SES·Postmark API 권장 (Cloudflare 자체에 메일 서비스 없음).

### 1.6 자기거래(Self-Trade) 방지 없음
- **파일**: `src/server/routes/order.ts:181-183`
- **문제**: `matchOrder` 의 WHERE 절에 `AND user_id != ?` 가 없음. 같은 사용자가 **자기 주문끼리 체결 가능** → 거래량·볼륨 허위 부풀리기, 세금·감시 시스템 왜곡.
- **필수 조치**:
  ```sql
  AND user_id != ?          -- taker 의 user_id 를 바인딩
  ```
  거래소에서 흔히 쓰는 STP 옵션은 `cancel_taker` / `cancel_maker` / `cancel_both`. 기본값은 `cancel_taker` 권장.

### 1.7 주문 검증 공백: 최소 수량·소수점·가격 틱사이즈
- **DB**: `markets.min_order_amount`, `min_order_total`, `price_decimals`, `amount_decimals` 이미 존재.
- **문제**: `order.ts` 가 이 컬럼들을 **전혀 읽지 않음** → 0.000000001 BTC 주문, 0.1원짜리 KRW 주문, 소수점 불일치 주문 모두 통과.
- **영향**: DB 저장 시 부동소수점 누적 오차 → 잔고 불일치, 오더북 가격 클러스터링 붕괴.
- **필수 조치**:
  ```ts
  if (amount < market.min_order_amount) return c.json({ error: 'Below min amount' }, 400);
  if ((price ?? 0) * amount < market.min_order_total) return c.json({ error: 'Below min total' }, 400);
  amount = floorToDecimals(amount, market.amount_decimals);
  if (price) price = floorToDecimals(price, market.price_decimals);
  ```

---

## 🟠 2. High — 빠르게 보완 필요 (운영 품질)

### 2.1 login_history 저장 누락 + 컬럼명 오류
- **문제A**: `POST /api/auth/login` 이 **성공/실패 이력을 login_history 에 쓰지 않음**. 보안 감사 불가.
- **문제B**: `src/server/routes/profile.ts:87` 가 `ORDER BY logged_in_at` 로 쿼리하지만 실제 컬럼은 `created_at` → **"내 세션 이력" 항상 빈 배열**. catch 로 감싸서 에러도 안 보임.
- **조치**:
  - 로그인 성공/실패 시 `login_history` 에 `ip_address`, `user_agent`, `status`, `reason` 기록.
  - `profile.ts` 쿼리를 `ORDER BY created_at` 으로 수정.
  - IP 는 `c.req.header('CF-Connecting-IP')`, UA 는 `c.req.header('User-Agent')`.

### 2.2 Rate Limiting 완전 부재
- **문제**: 로그인/가입/비번변경/출금/API 호출 **전부 무제한 호출 가능**.
- **영향**: 무차별 대입 공격(Credential Stuffing), 봇 가입, API 도배.
- **조치**:
  - Cloudflare Rate Limiting Rules (대시보드에서 룰 추가) — 가장 간단.
  - 또는 `users.failed_login_count` + `locked_until` 컬럼으로 애플리케이션 레벨 제한.
  - 권장 기본값: 로그인 `5회/5분/IP`, 가입 `3회/1h/IP`, 출금 `10회/1h/user`.

### 2.3 JWT 로그아웃·세션 무효화 없음
- **문제**: 현재 JWT 7일 고정(`middleware/auth.ts:7`), **강제 로그아웃·세션 폐기 기능 없음**. 비밀번호 변경 후에도 기존 토큰 계속 유효.
- **조치**:
  - `users.token_version INTEGER DEFAULT 0` 추가, JWT 에 `tv` 클레임 포함.
  - 비번 변경·보안 리셋 시 `token_version++` → 불일치 시 401.
  - 또는 `user_sessions` 테이블(이미 존재)에 `revoked_at` 도입 + 서버에서 조회.

### 2.4 입·출금 네트워크/메모 미지원
- **DB**: `deposits.network`, `deposits.memo`, `withdrawals.network`, `withdrawals.memo` 이미 존재.
- **문제**: 프론트·API 모두 네트워크 선택이 없음. USDT 는 TRC20·ERC20·BEP20 등 **네트워크 잘못 선택 시 자산 영구 소실**.
- **조치**:
  - `/withdraw` body 에 `network` 필수화 (코인별 허용 네트워크 화이트리스트).
  - XRP/XLM/EOS/BNB 등 memo 필요 코인 목록 정의, 없으면 거절.

### 2.5 API Key 권한에 WAF·2FA 부재
- **파일**: `profile.ts:103-129`
- **문제**: `permissions: 'read'|'trade'|'withdraw'` 지원하지만
  - withdraw 권한 발급 시 2FA 확인 없음.
  - IP 화이트리스트 컬럼 있지만 **실제 요청 시 검사 로직 없음**.
  - 시크릿을 평문으로 한 번만 돌려주는 건 OK.
- **조치**:
  - withdraw 권한 키 생성 시 TOTP 필수.
  - 인증 미들웨어에 `HMAC-SHA256(secret, timestamp+path+body)` 서명 검증 + IP 화이트리스트 매칭.

### 2.6 수수료·세금·회계 일관성
- **문제**:
  - 수수료율 1개 테이블 (`markets.maker_fee`, `taker_fee`)만 존재, **VIP 티어·사용자별 수수료** 없음.
  - 수수료 징수가 매칭 엔진 내부에서 그냥 계산되고 **별도 fee_ledger 테이블 없음** → 회계 추적 불가.
- **조치**:
  - `fee_tiers` 테이블(30일 거래량 기준 자동 승급) 또는 최소한 `users.fee_tier_id`.
  - `fee_ledger(user_id, trade_id, side, coin, amount, created_at)` 추가, 매칭 엔진에서 매 거래마다 2건 INSERT(taker/maker).

### 2.7 ACID/레이스컨디션
- **문제**: D1 은 트랜잭션 API 가 제한적(`DB.batch()` 만 원자적). `order.ts` 의 `matchOrder` 루프에서 **각 statement 가 개별 커밋** → 매칭 중간 실패 시 일부 상태만 반영.
- **조치**:
  - 가능한 한 한 거래 1건당 모든 업데이트를 `DB.batch([...])` 로 묶기.
  - 또는 saga 패턴: failure table 에 로깅 후 background reconciler 가 정리.

### 2.8 호가/최근체결 "시뮬레이션 폴백"
- **파일**: `src/server/index.ts:407-467`
- **문제**: 실거래량이 적으면 (>3~5건 미만) 서버가 **가짜 호가/체결을 리턴**. 내부 봇이 아니라 **사용자에게 노출**됨 → 시장 조작·허위 표시로 오해 가능.
- **조치**:
  - 시뮬 데이터는 **landing(/home) 마케팅 차트**에만 사용, 실제 거래 페이지(`TradePage`)에서는 빈 오더북을 그대로 표시.
  - 또는 **maker bot 계정**을 만들어 실제 주문을 올려 둠 (법적으로는 disclosure 필요).

---

## 🟡 3. Medium — 거래소 표준 기능 추가 요구

### 3.1 없는 주문 타입
- 🟥 **Stop-Loss / Stop-Limit** (손절·익절 자동 주문)
- 🟥 **OCO (One-Cancels-Other)**
- 🟥 **Post-Only / IOC / FOK** 옵션
- 🟥 **Trailing Stop**
- 🟥 **Iceberg / Hidden**
- 현재는 `limit`, `market` 딱 두 종류. 바이낸스·업비트 수준이 되려면 최소 Stop-Limit + IOC 는 필요.

### 3.2 마진/선물/스왑 거래 없음
- 현 DB 는 순수 현물(spot)만 지원. 마진/선물을 하려면 `positions`, `funding_rates`, `liquidations`, `insurance_fund` 테이블 신설 + 완전히 새로운 엔진 필요(범위 외).
- MVP 권장: **현물만 정식 런칭**, 마진은 Phase 3 로 분리.

### 3.3 원화 입출금(KRW) 실연동 없음
- `KRW` 지갑은 존재하지만 **실시 원화 입금 = 시뮬 deposit / 출금 = 관리자 수동**. 실제로는
  - 제휴 은행 가상계좌 발급 (하나·케이뱅크 등)
  - 실명계좌 1거래소 1은행 원칙 준수
  - Travel Rule (BITGO·Chainalysis) 필요.

### 3.4 알림 — 실시간 Push·이메일·SMS 없음
- `notifications` 테이블 존재하지만 **앱 내부 알림만**. 매우 중요한 이벤트(출금 승인·로그인 알림)도 이메일 미발송.
- 조치: Resend/SES 연동, Firebase Cloud Messaging(Web Push), 이메일 템플릿 i18n(ko/en).

### 3.5 추천인·마케팅 보상
- 가입 때 `ref_code` 만 저장, **실제 커미션 지급 로직 없음**.
- 조치: `referrals(referrer_id, referee_id, status, commission_rate, created_at)` + 매 거래마다 10~20% 수수료 리베이트.

### 3.6 공지·FAQ·지원 티켓
- `NoticePage.tsx`, `SupportPage.tsx` 정적 페이지. **백엔드 공지 관리 API/티켓 DB 없음** → 관리자가 공지 수정하려면 코드 배포 필요.
- 조치: `notices(id, title_ko, title_en, body, pinned, created_at)`, `support_tickets`.

### 3.7 다국어 — 3개 이상 통화권 필요
- 현재 `ko`, `en` 2개. 글로벌 거래소는 보통 `zh-CN`, `ja`, `vi`, `es` 포함 10개 이상. i18n 구조(src/i18n/ko.ts, en.ts) 는 잘 되어 있으니 **번역만 추가**.

### 3.8 회계·감사 로그
- 관리자 액션(유저 비활성화·KYC 승인·출금 승인) **감사 로그 테이블 없음**. 금융감독 대응 시 필수.
- 조치: `admin_audit_logs(admin_id, action, target_type, target_id, payload, created_at)`.

---

## 🟢 4. UX/Mobile — 바이낸스/업비트 체감 맞추기

### 4.1 로그인·회원가입 — PR #12 에서 이미 개편중 ✅
- Email/phone 탭, 소셜 로그인 버튼(UI만), 약관 체크, 비번 강도 게이지 → 이미 반영됨.
- **남은 작업**:
  - 소셜 로그인 **실동작** (Google OAuth, Kakao, Apple).
  - 휴대폰 SMS 인증 코드 연동 (Twilio/국내 SMS).
  - 회원가입 후 **온보딩 튜토리얼** (예치 → 매수 → 차트 보기 3단계).

### 4.2 TradePage 모바일 레이아웃
- 현재 한 화면에 차트·호가·주문·체결 다 노출 → 모바일 세로 스크롤 과부하.
- 개선:
  - 탭 네비 `차트 / 주문 / 호가 / 체결` (업비트식).
  - 하단 고정 **매수/매도 퀵버튼** (바이낸스식 바텀시트).
  - 주문창 숫자 키패드 (iOS `inputmode="decimal"`).

### 4.3 WalletPage
- 코인별 잔고는 잘 보이지만 **입금 주소 QR·네트워크 선택 UI 없음**.
- 추가: `QRCode` 컴포넌트 이미 있으므로 `WalletPage > 코인 클릭 > 입금 탭 > QR + 주소 복사 + 네트워크 드롭다운`.

### 4.4 공통
- **Skeleton/Loading 상태**: API 호출 중 깜빡임 방지.
- **Empty State**: 거래 없음/알림 없음 일러스트.
- **Error Toast**: 현재 `alert()`/단순 텍스트 → 상단 슬라이드 토스트 컴포넌트로 통일.
- **다크·라이트 토글**: 현재 다크 고정. 시장별 선호.

---

## 🔵 5. 인프라·운영

### 5.1 관측성(Observability)
- **현재**: `console.log`, Cloudflare Pages 로그만. 에러 Sentry/Logflare 없음.
- 조치: Cloudflare Workers 는 `tail` 명령으로 실시간 로그, Sentry Edge SDK 연동 권장.

### 5.2 DB 백업·복구
- D1 는 자동 스냅샷 없음 (2026-04 기준). **매일 export 크론** 필요.
- 조치: Workers Cron → `wrangler d1 export` 결과를 R2 버킷에 업로드.

### 5.3 장애 대응 플레이북 없음
- 사고 시 runbook(order 대량 실패·출금 지연·D1 장애) 문서화 필요.

### 5.4 법·컴플라이언스
- 한국 서비스라면 **가상자산사업자(VASP) 신고**, ISMS 인증, 실명계좌, KoFIU 의심거래보고(STR) 시스템 필수. 이건 코드가 아니라 **사업 단계**. 법무·컴플 담당자 채용 필요.

---

## 📋 6. 우선순위 로드맵 (추천 배포 순서)

### Sprint 1 (1~2주) — 런칭 블로커 해결
| # | 작업 | 영역 | 파일 |
|---|------|------|------|
| S1-1 | **자기거래 방지** (`AND user_id != ?`) | 엔진 | order.ts:181 |
| S1-2 | **최소주문 검증 + 소수점 라운딩** | 엔진 | order.ts |
| S1-3 | **/deposit 엔드포인트 무력화** (admin 전용으로) | 보안 | wallet.ts:72 |
| S1-4 | **login_history 기록 + 컬럼명 수정** | 감사 | auth.ts, profile.ts |
| S1-5 | **2FA TOTP 3종 엔드포인트** | 보안 | profile.ts (신규) |
| S1-6 | **이메일 인증 토큰 플로우** | 보안 | auth.ts + 신규 email.ts |

### Sprint 2 (2~3주) — 핵심 신기능
| # | 작업 |
|---|------|
| S2-1 | **비밀번호 재설정** (이메일 토큰) |
| S2-2 | **출금 화이트리스트 + 2FA + 일일한도** |
| S2-3 | **Rate limiting** (Cloudflare Rules 먼저, 이후 앱 레벨) |
| S2-4 | **KYC 티어 게이팅** (trading/withdraw 미들웨어) |
| S2-5 | **실 입금 감시**: 테스트넷(Sepolia, tBTC) 시작 |

### Sprint 3 (3~4주) — 거래소 표준화
| # | 작업 |
|---|------|
| S3-1 | **Stop-Limit 주문** |
| S3-2 | **IOC / FOK / Post-Only** |
| S3-3 | **Fee Tier + fee_ledger** |
| S3-4 | **JWT 세션 무효화 (token_version)** |
| S3-5 | **Maker bot**(시뮬 호가 대체) |

### Sprint 4 (1~2개월) — 운영·컴플라이언스
- 관리자 감사로그
- 공지/지원 티켓 백엔드
- 이메일/푸시 알림
- KRW 원화 연동 (은행 제휴)
- ISMS·VASP 신고 준비

---

## ✅ 7. 이번 감사 중 확인된 "잘 되어 있는" 부분

- ✅ **매칭엔진 자금 이동 정확도**: 매수 → 락·차감·수수료·잔고 이동 수학적 일관성 OK (E2E 에서 6.006 USDT = 5.994 + 0.012 검증).
- ✅ **락 환불 로직**: 지난번 수정한 market-buy refund + `MAX(0, locked - ?)` 방어 OK.
- ✅ **비밀번호 저장**: bcrypt 10 rounds, 상수시간 비교.
- ✅ **JWT 구현**: HMAC-SHA256, 만료 7일, 서명검증.
- ✅ **Self-scheduler**: Phase G 하드닝 (auto-seed, retry reset, status endpoint) 모두 프로덕션 정상 동작.
- ✅ **관리자 대시보드**: 통계·트렌드·유저관리·KYC·출금 승인·2FA 리셋 제공.
- ✅ **i18n**: ko/en 구조 깔끔. 추가만 하면 됨.
- ✅ **가입 보너스 1000 QTA**: 직접 지갑 크레딧 방식 (포인트-대기-출금 방식 아님) → 단순·명확.

---

## 🧾 8. 사용자 질문에 대한 직접 답변

> **"가입시 1000 QTA가 자동으로 지급이 되는 로직인지, 아니면 포인트로 쌓아서 각 개인의 마이페이지에 주었다가 출금신청시 지급하는 로직인지"**

**답변**: **즉시 지급 구조**입니다. 포인트 대기/출금신청 방식이 아닙니다.

- 파일: `src/server/routes/auth.ts:53-65`
- 동작: `/api/auth/register` 성공 시 5개 기본 지갑(`USDT`, `KRW`, `BTC`, `ETH` 각 0, **`QTA` 1000**)을 `DB.batch()` 로 **한 번에 INSERT**.
- `available` 필드에 곧바로 `1000` 이 들어가므로, 사용자는 로그인 직후 **즉시 거래·출금에 사용 가능**.
- "포인트"라는 중간 레이어(예: `reward_points` 테이블) 는 존재하지 않음.
- E2E 테스트에서도 가입 후 `/api/wallet` 호출 시 `QTA.available = 1000.0000` 으로 확인됨.

**시사점**:
- 👍 단순·직관적. 즉시 거래 체험 가능 → 전환율 좋음.
- 👎 어뷰즈 방지 장치가 약함: 이메일 인증 전에 가입만으로 1000 QTA 받음 → **멀티계정 어뷰즈로 QTA 수십만 개 빠져나갈 수 있음**.
- 제안:
  1. **Phase 1**: 가입 시 QTA `locked=1000` 으로 넣고, **이메일 인증 완료 시에 `available` 로 이동**.
  2. **Phase 2**: KYC basic 통과 후에만 unlock.
  3. 또는 **포인트 방식으로 전환**: `reward_points` 에 쌓았다가 사용자가 "클레임" 클릭할 때 실제 지갑으로 이동. 이러면 어뷰즈 계정은 실제 QTA 유통에 영향 없음.

---

## 🔚 마무리

- 🚨 **런칭 전 필수**: §1의 7개 Critical (특히 §1.1 입금 시뮬, §1.2 KYC 게이팅, §1.3 출금 보호, §1.4 2FA)
- 🟠 **런칭 직후 1달 내**: §2의 High 8건
- 🟡 **3개월 내 거래소 표준화**: §3
- 🟢 **점진적 UX 개선**: §4 (PR #12 연장선에서 이어가기)

현재 코드베이스는 **MVP 완성도 ~ 60%**, **실제 거래소(바이낸스/업비트) 수준 ~ 20%** 수준으로 추정합니다. 보안·자산흐름·컴플라이언스를 채우면 **실거래 가능 상태 ~ 80%** 까지 올릴 수 있습니다.

— 감사 담당: Claude (AI Developer) / 2026-04-22
