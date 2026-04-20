# QuantaEX Production Deployment Guide

## Architecture (Unified Cloudflare Pages)

```
                    ┌──────────────────────────────┐
                    │      www.quantaex.io          │
                    │    (Cloudflare Pages)          │
  User Browser ────>│                                │
                    │  /api/*  → _worker.js (Hono)   │
                    │  /*      → React SPA (dist/)   │
                    │  DB      → Cloudflare D1       │
                    └──────────────────────────────┘
```

프론트엔드(React)와 API(Hono)가 **같은 도메인**에서 서비스됩니다.  
별도 API 서버가 필요 없고, CORS 설정도 불필요합니다.

---

## Step 1: GitHub Repository Secrets 설정

GitHub repo **Settings > Secrets and variables > Actions**에서 추가:

| Secret Name | Value | 설명 |
|-------------|-------|------|
| `CLOUDFLARE_API_TOKEN` | (Cloudflare API 토큰) | Cloudflare Dashboard > My Profile > API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | `37814a078a2d8ab3c20f85ec0640950b` | Cloudflare Dashboard 오른쪽 사이드바 |

### API Token 생성 방법:
1. https://dash.cloudflare.com/profile/api-tokens
2. **Create Token** 클릭
3. **"Edit Cloudflare Workers"** 템플릿 사용
4. 권한 추가: **Account > Cloudflare Pages > Edit**
5. 권한 추가: **Account > D1 > Edit**
6. 생성 후 토큰 복사

---

## Step 2: D1 Database 생성

GitHub Actions에서 **"Setup D1 Database"** 워크플로우를 수동 실행:
1. repo > Actions > "Setup D1 Database" > Run workflow

또는 로컬에서:
```bash
export CLOUDFLARE_API_TOKEN=your_token
npx wrangler d1 create quantaex-production
```

생성 후 출력된 `database_id`를 `wrangler.jsonc`에 입력합니다.

---

## Step 3: wrangler.jsonc 업데이트

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "quantaex-production",
      "database_id": "여기에_실제_ID_입력"  // <-- 변경
    }
  ]
}
```

이 변경사항을 커밋하고 push합니다.

---

## Step 4: 마이그레이션 실행

```bash
npx wrangler d1 migrations apply quantaex-production --remote
```

또는 GitHub Actions "Setup D1 Database" 워크플로우를 재실행합니다.

---

## Step 5: 배포 (자동)

`main` 브랜치에 push하면 **GitHub Actions**가 자동으로:
1. React SPA 빌드 (`dist/assets/`, `dist/index.html`)
2. Hono API 빌드 (`dist/_worker.js`)
3. Cloudflare Pages에 배포

수동 배포:
```bash
npm run build
npx wrangler pages deploy dist --project-name quantaex
```

---

## Step 6: 가비아 DNS → Cloudflare

### Option A: 네임서버 이전 (추천)

1. Cloudflare Dashboard > "Add a site" > `quantaex.io`
2. Free plan 선택
3. 가비아 로그인 > 도메인 관리 > DNS 설정
4. 네임서버를 Cloudflare 제공 값으로 변경:
   ```
   ada.ns.cloudflare.com  (예시)
   bob.ns.cloudflare.com  (예시)
   ```
5. 24-48시간 대기

### Option B: CNAME만 설정

가비아 DNS에서:
```
CNAME  www  →  quantaex.pages.dev
```

---

## Step 7: Custom Domain 연결

1. Cloudflare Pages > quantaex 프로젝트 > Custom domains
2. `www.quantaex.io` 추가
3. SSL/TLS 인증서 자동 발급 대기 (최대 24시간)

---

## Step 8: 캔들 데이터 시드

배포 후 차트 데이터 생성:

```bash
# 관리자 로그인
TOKEN=$(curl -s -X POST https://www.quantaex.io/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@quantaex.io","password":"admin1234"}' | jq -r '.token')

# 캔들 시드
curl "https://www.quantaex.io/api/admin/seed-candles" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 검증 체크리스트

- [ ] https://www.quantaex.io 로딩 확인
- [ ] https://www.quantaex.io/api/health → `{"status":"ok"}`
- [ ] 회원가입/로그인 동작
- [ ] 마켓 데이터 로딩
- [ ] 차트 캔들 표시
- [ ] 주문 기능 동작
- [ ] 관리자 대시보드

---

## 유지보수

### 배포
`main`에 push하면 자동 배포됩니다.

### DB 백업
```bash
npx wrangler d1 backup create quantaex-production
```

### 로그 확인
```bash
npx wrangler pages deployment tail --project-name quantaex
```

### JWT Secret 변경
```bash
npx wrangler pages secret put JWT_SECRET --project-name quantaex
```
