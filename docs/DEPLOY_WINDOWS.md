# Windows CMD 에서 Quantaex 배포하기

이 가이드는 **Windows 명령 프롬프트(cmd.exe)** 환경에서 PR #12 의 변경사항을
Cloudflare D1(DB) + Cloudflare Pages(코드) 로 배포하는 방법을 정리합니다.

## 0) 사전 준비 (한 번만)

### 0-1. 리포지토리 클론
```cmd
cd /d C:\Users\sayto
git clone https://github.com/Stevewon/-.git quantaex
cd quantaex
git checkout genspark_ai_developer
git pull
```

### 0-2. 의존성 설치 — **네이티브 빌드 스킵**
`better-sqlite3` 는 Python/VS Build Tools 가 필요한 네이티브 모듈이지만,
프로덕션(Cloudflare D1)에서는 사용되지 않습니다.

```cmd
npm install --ignore-scripts
```

### 0-3. Cloudflare API 토큰 발급
1. https://dash.cloudflare.com/profile/api-tokens
2. **Create Token** → **Edit Cloudflare Workers** 템플릿 or Custom:
   - Workers Scripts: Edit
   - D1: Edit
   - Cloudflare Pages: Edit

### 0-4. 토큰을 세션에 설정 (매번 새 창 열 때)
```cmd
set CLOUDFLARE_API_TOKEN=여기에_토큰을_붙여넣기
```

영구 설정 (새 창이 필요):
```cmd
setx CLOUDFLARE_API_TOKEN "여기에_토큰"
```

## 1) 현재 DB 상태 확인 (중복 실행 방지)

```cmd
npx --yes wrangler d1 execute quantaex-production --remote ^
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('email_verifications','password_resets','withdraw_whitelist','rate_limits','admin_audit_logs','user_meta');"
```

결과 해석:
- **0개** → 둘 다 실행
- `email_verifications`, `password_resets`, `admin_audit_logs`, `user_meta` 중
  하나라도 있으면 → 0007 은 이미 일부/전부 적용됨
- 4개 + `withdraw_whitelist`, `rate_limits` 모두 있으면 → 완전 적용됨

## 2) 마이그레이션 실행

### 첫 배포
```cmd
npx --yes wrangler d1 execute quantaex-production --remote --file=./migrations/0007_sprint1_hardening.sql
npx --yes wrangler d1 execute quantaex-production --remote --file=./migrations/0008_sprint2_hardening.sql
```

### `duplicate column name` 에러가 뜬다면
해당 컬럼이 이미 존재한다는 뜻입니다. Sprint 1 / Sprint 2 에는 다음 ALTER 가 있습니다:

| 마이그레이션 | ALTER TABLE 컬럼 |
|---|---|
| 0007 | `two_factor_pending_secret`, `email_verified_at` |
| 0008 | `token_version` |

이미 존재하는 ALTER 문만 제거한 **사용자 편집본**을 준비해 실행하세요.
(또는 컬럼이 이미 있으면 무시하고 다음 줄로 계속 진행)

임시 해결법 — 마이그레이션을 **명령 단위로 쪼개 실행**:

```cmd
rem email_verifications 만 생성 (ALTER 스킵)
npx --yes wrangler d1 execute quantaex-production --remote --command="CREATE TABLE IF NOT EXISTS email_verifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at DATETIME NOT NULL, used_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);"

rem token_version 이 이미 있을 때 추가를 시도하지 않으려면 조회 후 결정
npx --yes wrangler d1 execute quantaex-production --remote --command="PRAGMA table_info(users);"
```

## 3) 코드 빌드 및 배포

```cmd
npm run build
npx --yes wrangler pages deploy dist --project-name=quantaex --branch=main
```

## 4) 배포 확인

```cmd
curl https://quantaex.io/api/health
```

응답 예:
```json
{"status":"ok","timestamp":"2026-04-22T..."}
```

## 5) 프론트엔드 스모크 테스트

| 페이지 | URL | 기대 동작 |
|---|---|---|
| 회원가입 | https://quantaex.io/register | 바이낸스 스타일 폼, 인증 메일 자동 발송 |
| 로그인 | https://quantaex.io/login | 이메일/비번 → (2FA 켠 계정이면) 6자리 코드 |
| 비번 찾기 | https://quantaex.io/forgot-password | 이메일 입력, 항상 성공 토스트 |
| 2FA 설정 | https://quantaex.io/profile/security | QR + secret 표시, 6자리 Verify |
| 이메일 배너 | 모든 페이지 상단 | 미인증 사용자에게만 노란 배너 |

## 6) 자주 나는 에러

### `Authentication error [code: 10000]`
→ `CLOUDFLARE_API_TOKEN` 이 안 설정됐거나 만료됨. `set` 재실행.

### `duplicate column name: xxx`
→ 이미 적용된 마이그레이션의 ALTER. 컬럼만 있으면 정상이므로 다음 파일로 진행.

### `Need to install the following packages: wrangler@4.x.x` 무한 반복
→ `--yes` 플래그 추가해 자동 승인하거나 `npm install --ignore-scripts` 로 로컬 설치.

### `no such table: users`
→ `wrangler.jsonc` 의 `database_name` 오타 또는 production DB 가 아닌
preview DB 에 연결 중. `--remote` 가 붙었는지 확인.

### `EACCES` / 권한 오류
→ `C:\Users\sayto\quantaex` 안에서 실행 중인지 확인.
