# 🚀 GitHub Actions 자동 배포 가이드

CMD/터미널 명령어 없이 **GitHub 웹 화면에서 버튼 몇 번**으로 Cloudflare 에
배포하는 방법입니다.

## 📋 한 번만 세팅 (시크릿 등록)

GitHub 리포에 **Cloudflare API 토큰과 Account ID 를 시크릿으로 저장**합니다.
토큰 값은 GitHub 이 안전하게 암호화해서 저장하므로 채팅이나 코드에 노출되지
않습니다.

### 1. Cloudflare API Token 준비
- https://dash.cloudflare.com/profile/api-tokens
- 스크린샷에서 확인된 **`deploy-token`** (D1 + Cloudflare Pages 권한)을 **Roll**
  해서 새 토큰 값 발급
- 또는 템플릿 `Edit Cloudflare Workers` 로 새로 발급 후 `Account > D1 > Edit`,
  `Account > Cloudflare Pages > Edit`, `User > User Details > Read`,
  `User > Memberships > Read` 권한 추가

### 2. Account ID 확인
- 화면에 이미 보이는 값: `37814a078a2d8ab3c20f85ec0640950b`
- 또는 Cloudflare 대시보드 우측 사이드바 `Account ID` 에서 복사

### 3. GitHub Repo Secrets 에 등록
1. https://github.com/Stevewon/-/settings/secrets/actions 접속
2. **New repository secret** 클릭 → 아래 두 개 추가

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | (Cloudflare 에서 발급한 토큰) |
| `CLOUDFLARE_ACCOUNT_ID` | `37814a078a2d8ab3c20f85ec0640950b` |

## 🎯 시나리오별 사용법

### ▶️ 시나리오 A — PR #12 머지로 자동 배포

1. https://github.com/Stevewon/-/pull/12 접속
2. 초록색 **Merge pull request** 버튼 클릭 → **Confirm merge**
3. 자동으로 `.github/workflows/deploy.yml` 실행됨:
   - `npm ci --ignore-scripts`
   - **D1 migration 0007 + 0008 자동 적용**
   - `vite build` (client + worker)
   - Cloudflare Pages 배포
   - `quantaex.io/api/health` 헬스체크
4. 진행 상황: https://github.com/Stevewon/-/actions 에서 로그 확인

### ▶️ 시나리오 B — 수동 트리거 (Actions 탭 사용)

main 에 머지할 준비가 안 된 상태에서 미리 배포하고 싶을 때.

1. https://github.com/Stevewon/-/actions 접속
2. 좌측에서 **Build, Migrate & Deploy to Cloudflare Pages** 클릭
3. 우측 **Run workflow** 드롭다운 클릭
4. Branch: `genspark_ai_developer` 선택
5. `run_migrations`: `true` (마이그레이션까지 같이) 또는 `false` (배포만)
6. **Run workflow** 버튼 클릭

### ▶️ 시나리오 C — 마이그레이션만 수동 실행

DB 스키마 변경만 따로 적용하고 싶을 때.

1. https://github.com/Stevewon/-/actions
2. 좌측에서 **D1 Migration (manual)** 클릭
3. **Run workflow** 드롭다운
4. `migration_file` 기본값 `migrations/0008_sprint2_hardening.sql` → 필요시 변경
5. `database`: `quantaex-production` 그대로
6. **Run workflow**

## 📌 각 워크플로우 파일 설명

| 파일 | 용도 |
|---|---|
| `.github/workflows/deploy.yml` | main push / 수동 트리거로 빌드 + 마이그레이션 + 배포 |
| `.github/workflows/migrate.yml` | 마이그레이션만 수동 실행 (파일명 지정 가능) |

## ⚠️ 자주 나는 에러

### "Error: Input required and not supplied: apiToken"
→ Secrets `CLOUDFLARE_API_TOKEN` 미등록. 위 2단계 다시 확인.

### "Error: Authentication error [code: 10000]"
→ 토큰 권한 부족. `User Details + Memberships` 추가 필요.

### "duplicate column name: xxx" (빨간 에러지만 워크플로우는 초록색 ✅)
→ 정상. `continue-on-error: true` 설정 덕분에 무시됨. 이미 적용된 ALTER 문.

### "Project 'quantaex' not found"
→ Cloudflare Pages 프로젝트 이름 오타. `wrangler.jsonc` 의
`name: "quantaex"` 확인.

## ✅ 배포 확인

- https://quantaex.io/api/health → `{"status":"ok",...}` 확인
- https://quantaex.io/register → 바이낸스 스타일 UI 로드
- https://quantaex.io/forgot-password → 새 페이지 로드

## 🔐 보안

- GitHub Secrets 는 암호화되어 저장되며, 워크플로우 로그에서도 `***` 로 마스킹됩니다
- 토큰이 한 번 노출된 경우 Cloudflare 에서 **Roll** 하거나 **Delete** 후 재발급
- 채팅/이메일/Slack 에 토큰을 직접 붙여넣지 마세요
