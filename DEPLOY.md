# QuantaEX — Cloudflare Pages 배포 가이드

## 스택 개요

- **프론트엔드**: Vite + React SPA → `dist/`
- **API**: Hono on Cloudflare Pages Functions → `dist/_worker.js`
- **DB**: Cloudflare D1 (`quantaex-production`)
- **인증**: 자체 구현 HMAC-SHA256 JWT (Web Crypto API)

## 사전 준비

### 1. Cloudflare 계정 & 프로젝트

- Cloudflare 계정이 필요합니다.
- 프로젝트명: `quantaex`
- D1 database_id: `5eb4f183-1dfc-4310-8872-07b014078dbc` (기존 존재)

### 2. 인증 — 둘 중 하나

**A) 브라우저 기반 로그인 (로컬)**
```bash
npx wrangler login
```

**B) API 토큰 (CI/CD)**
- Cloudflare Dashboard → My Profile → API Tokens
- "Edit Cloudflare Workers" 템플릿 사용 또는 커스텀 토큰 생성:
  - Account → Cloudflare Pages — Edit
  - Account → D1 — Edit
  - Zone → Workers Routes — Edit (커스텀 도메인 사용 시)
- 발급 후:
```bash
export CLOUDFLARE_API_TOKEN="<your_token>"
export CLOUDFLARE_ACCOUNT_ID="<your_account_id>"
```

## 배포 절차

### Step 1 — 빌드

```bash
npm install
npm run build
```

결과물:
- `dist/assets/*.js` : 클라이언트 번들 (~700kB 원본 / ~230kB gzip)
- `dist/_worker.js` : Hono API 워커 (~82kB)
- `dist/index.html`, `_headers`, `_redirects`

### Step 2 — D1 마이그레이션 (프로덕션)

```bash
npm run db:migrate:prod
```

적용되는 마이그레이션 (총 5개):
| # | 파일 | 내용 |
|---|---|---|
| 0001 | `0001_init.sql` | users/coins/markets/wallets/orders/trades/deposits/withdrawals |
| 0002 | `0002_seed.sql` | 13개 코인 + 관리자 계정 + 기본 마켓 |
| 0003 | `0003_wallet_network.sql` | network/memo 컬럼 + notifications + api_keys |
| 0004 | `0004_security_profile.sql` | 2FA/KYC/login_history/user_sessions/avatar |
| 0005 | `0005_price_alerts.sql` | 가격 알림 테이블 |

### Step 3 — 환경변수 / Secrets 설정

**`wrangler.jsonc`에 있는 공개 vars**:
- `JWT_SECRET` — 현재 개발용 기본값. **프로덕션에서는 secret으로 이관 권장**:

```bash
# Pages는 secret을 대시보드 또는 wrangler pages secret 명령으로 설정
npx wrangler pages secret put JWT_SECRET --project-name quantaex
# 프롬프트에 안전한 랜덤 문자열 입력 (예: openssl rand -hex 32)
```

설정 후 `wrangler.jsonc`의 `vars.JWT_SECRET`는 제거하거나 무시됩니다(secret 우선).

### Step 4 — 배포

```bash
npm run deploy
# 내부적으로 실행: npm run build && wrangler pages deploy dist --project-name quantaex
```

출력 예시:
```
✨ Deployment complete!
✨ Uploaded to: https://<hash>.quantaex.pages.dev
✨ View deployment at: https://quantaex.pages.dev
```

### Step 5 — 동작 확인

```bash
curl https://quantaex.pages.dev/api/health
# → {"status":"ok","timestamp":"..."}

curl https://quantaex.pages.dev/api/market/coins | head
# → 13개 코인 JSON 배열
```

브라우저로 `https://quantaex.pages.dev` 접속 → 회원가입/로그인/거래 페이지 확인.

### Step 6 — 초기 관리자 계정

마이그레이션 `0002_seed.sql`에 admin 계정이 포함되어 있습니다:
- **이메일**: `admin@quantaex.io`
- **비밀번호**: `admin1234`
- **⚠️ 배포 직후 반드시 비밀번호를 변경하세요** (MyPage → 비밀번호 변경)

## 로컬 개발

### 옵션 A — Express + Vite (풀 기능, SSE 포함)
```bash
npm run dev            # server:3001 + client:5173
```
- SSE 실시간 알림, Socket.io, 체결 엔진 모두 동작
- SQLite 파일 DB 사용 (`server/db.sqlite`)

### 옵션 B — Wrangler Pages Dev (Cloudflare 시뮬레이션)
```bash
npm run build
npm run db:migrate:local
npm run dev:pages      # 또는: wrangler pages dev dist --local --port 8788
```
- 프로덕션과 동일한 Hono 워커 환경
- 로컬 D1 (sqlite) 사용
- **주의**: SSE (`/api/notifications/stream`)는 현재 구현되지 않음 → 클라이언트는 폴링으로 폴백

## 알려진 제약

1. **SSE (Server-Sent Events)**: Cloudflare Workers에서 스트리밍 응답은 제한적.
   - Express 배포(dev)에서는 `/api/notifications/stream` 완전 동작
   - Pages 배포에서는 `/api/notifications` 폴링 사용 (클라이언트에 폴백 구현 필요)
2. **price-alert 자동 트리거**: Cloudflare Workers는 상주 프로세스가 없어 `priceSimulator`의 2초 주기 체커가 동작하지 않음.
   - 해결책: Cloudflare Cron Trigger로 1분마다 체크하는 스케줄러 추가 (후속 PR)
3. **bcryptjs → Web Crypto**: `profile.ts`의 비밀번호 변경은 SHA-256 해시로 구현. 기존 `auth.ts`와 해시 방식이 동일해야 함(점검 필요).

## 재배포 (변경 후)

코드 수정 → `npm run deploy` 한 번이면 됩니다. Cloudflare가 자동으로:
- 새 버전 업로드
- 프리뷰 URL 생성 (`<hash>.quantaex.pages.dev`)
- 프로덕션 도메인에 원자적 롤아웃

롤백은 대시보드에서 이전 배포를 "Rollback" 버튼으로.

## 커스텀 도메인 연결

Cloudflare Dashboard → Pages → `quantaex` → Custom domains → Setup
- `quantaex.io` 등을 연결하면 자동 SSL, CDN 적용.
