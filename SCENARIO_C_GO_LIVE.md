# 시나리오 C — 실제 온체인 입출금 Go-Live 절차

> 대상: QTA / QX / QKEY (Quantarium 네이티브, 브랜치 ①)
> 브랜치 ② (BTC/ETH/USDT) 는 시세 표시 전용 — 여기 해당 없음.
>
> **코드는 전부 완성·배포됨. 아래는 "운영 스위치" 켜는 순서다.**
> 순서를 반드시 지킬 것 — 시크릿·cron 이 준비되기 전에 드라이버를 real 로
> 바꾸면 입금 주소 발급/출금이 `CHAIN_INTEGRATION_PENDING` 또는 실패로 뜬다.

---

## 현재 상태 요약

| # | 항목 | 상태 |
|---|------|------|
| 1 | 핫월렛 펀딩 (10만 QTA @ `0x4B35…938Cb`) | ✅ 완료 (온체인 확인) |
| 2 | 출금 서명·브로드캐스트 (cron `processQtaWithdrawals`) | ✅ 코드 완성 |
| 3 | 입금 감지 스캐너 (cron `scanQtaDeposits`) | ✅ 코드 완성·배포 |
| 4 | `QTA_HD_WALLET_MNEMONIC` 시크릿 | ⏳ **아래 STEP 1** |
| 5 | cron-worker (`quantaex-cron`) 배포 | ⏳ **아래 STEP 2** |
| 6 | `QTA_CHAIN_DRIVER='real'` 플립 | ⏳ **아래 STEP 3** |
| 7 | E2E 테스트 (입금주소 발급 → 소액 입출금) | ⏳ **아래 STEP 4** |

핵심 온체인 값:
- RPC `https://rpc.quantarium.io` / Explorer `https://scan.quantarium.io`
- chainId `60000` (0xea60)
- 핫월렛 `0xdeB6BFE50EeE8D753313988c6d1E77f95322527b` (owner-controlled, index-0 검증됨, mnemonic in QTA_HD_WALLET_MNEMONIC)
  - ⚠️ 이전 `0x496EEaCE…24E97` 는 니모닉 index-0 불일치(index-0 = 0xF4aE…47c87)로 폐기됨 — 재사용 금지
  - ⚠️ 이전 `0x4B35…938Cb` 는 니모닉 유실로 폐기됨 — 재사용 금지
- QX `0xad447d42fB065a5b505772235F0c96d27501e6Fb` (ERC-20, 18dec)
- QKEY `0x216621D3b3dB600F35DBf6c5709486dDC8882a16` (ERC-20, 18dec)

---

## ⚠️ STEP 0 — Cloudflare API 토큰 준비 (한 번만)

https://dash.cloudflare.com/profile/api-tokens 에서 토큰 생성:
- **Account → Workers Scripts → Edit**
- **Account → D1 → Edit**
- **Account → Workers R2 Storage → Edit**  ← (cron 이 R2 백업 버킷을 쓰므로)
- **Account → Account Settings → Read**

Scope: Include → Specific account → 본인 계정.

> 사전 준비: cron `wrangler.jsonc` 에 R2 바인딩(`BACKUPS` → `quantaex-backups`)이
> 있다. 버킷이 없으면 배포 시 실패하니 대시보드에서 미리 만들거나:
> `CLOUDFLARE_API_TOKEN=<t> npx wrangler r2 bucket create quantaex-backups`

---

## STEP 1 — `QTA_HD_WALLET_MNEMONIC` 시크릿 세팅 (2곳)

> 🔴 **니모닉을 채팅/파일/커밋에 절대 넣지 말 것.** 아래 명령은 대화형으로
> 입력값을 받으며 화면·로그에 남지 않는다.
> 🔴 **index-0 가 반드시 핫월렛 `0x4B35…938Cb` 로 유도돼야 한다.**
> (cron 이 시작 시 `verifyMnemonicMatchesHotWallet` 로 검증하고,
> 불일치면 그 출금건을 `failed`(hot_wallet_mnemonic_mismatch)로 처리 후 환불한다.)

### 1-a) cron-worker 에 (출금 서명이 여기서 일어남 — 필수)
```bash
cd cron-worker
CLOUDFLARE_API_TOKEN=<token> npx wrangler secret put QTA_HD_WALLET_MNEMONIC
# 프롬프트에 12단어 니모닉 붙여넣기 → Enter
```

### 1-b) Pages 앱(`quantaex`) 에 (입금주소 발급이 여기서 일어남 — 필수)
Cloudflare 대시보드 → Pages → **quantaex** → Settings → Environment variables
→ **Production** → Add → **Encrypt(Secret)** 로:
- `QTA_HD_WALLET_MNEMONIC` = (12단어 니모닉)

> 두 곳 모두 **같은 니모닉**이어야 한다. Pages 는 유저별 입금주소(index 1..N)를
> 만들고, cron 은 index-0(핫월렛)으로 출금 서명을 한다.

### (선택) 니모닉 없이 미리 검증하고 싶으면
로컬에서 파생 결과 index-0 주소만 확인 (니모닉은 로컬에만):
```bash
cd cron-worker
node -e "const{deriveAccountFromMnemonic}=require('./dist/lib/qta-sphincs.js');/* or ts */"
```
> 실무적으로는 STEP 4 의 헬스체크(`/qta/admin/health`)에서 자동 검증되므로
> 이 단계는 건너뛰어도 된다.

---

## STEP 2 — cron-worker (`quantaex-cron`) 배포

```bash
cd cron-worker
CLOUDFLARE_API_TOKEN=<token> ./deploy.sh
```
`deploy.sh` 가 토큰 검증 → 의존성 설치 → `wrangler deploy` → `/run` 핑까지 한다.

배포되면 확인:
```bash
# 입금 스캐너 수동 실행 (driver 가 아직 mock 이면 driver_not_real 반환)
curl https://quantaex-cron.<account>.workers.dev/qta/scan
# 출금 큐 처리 수동 실행
curl https://quantaex-cron.<account>.workers.dev/qta/withdrawals
```
> cron `wrangler.jsonc` 에는 `QTA_CHAIN_DRIVER: "real"` 이 이미 박혀 있다.
> 즉 **cron 쪽은 배포 즉시 real 로 동작**하려 하지만, 니모닉(STEP1-a)이 없으면
> `processQtaWithdrawals` 는 `missing_env` 로 안전하게 no-op 한다.

스케줄: `*/5 * * * *` (5분마다 입금스캔 + 컨펌 + 출금 1건) / `0 3 * * *` (일일 백업)

---

## STEP 3 — Pages 앱 `QTA_CHAIN_DRIVER='real'` 플립

Cloudflare 대시보드 → Pages → **quantaex** → Settings → Environment variables
→ **Production**:
- `QTA_CHAIN_DRIVER` = `real`  (기존 `mock` → `real`)

저장 후 **재배포 트리거**(빈 커밋 push 또는 대시보드 Retry deployment).
환경변수만 바꾸면 다음 배포부터 적용된다.

> 이 플립 전까지 `/api/chain/qta/deposit-address`, `/api/chain/qta/withdraw`,
> `/api/wallet/withdraw`(Quantarium 자산)은 `CHAIN_INTEGRATION_PENDING`(503)
> 으로 막혀 있다 — 의도된 안전장치.

---

## STEP 4 — E2E 테스트 (소액으로)

> ⚠️ US IP(샌드박스)는 geo-block(451)이라 API 기능 테스트 불가.
> KR/JP 등 허용 지역에서, 또는 실제 UI 에서 테스트할 것.

1. **입금주소 발급**: 로그인 → 지갑 → QTA 입금 → 주소 생성
   (`POST /api/chain/qta/deposit-address`). `qta_addresses` 에 index N 주소가 박힘.
2. **소액 입금**: 외부 지갑에서 그 주소로 **소량 QTA**(예 1 QTA) 전송.
3. **감지 확인**(최대 5분): cron `scanQtaDeposits` 가 `qta_deposits` 에 `detected`
   로 넣음 → 컨펌 12개 쌓이면 `credited` + 잔고 반영.
   - 수동 즉시 확인: `curl .../qta/scan` 후 `curl .../qta/tick`
4. **소액 출금**: 지갑에서 QTA 출금 요청 → 관리자 승인(→ `broadcasting`)
   → 다음 cron tick 에서 SPHINCS+ 서명·브로드캐스트 → `confirmed` + tx_hash.
   - 회사지급 락 규칙 유효: 출금가능 = available − available_initial.
5. **헬스체크**: 관리자 `GET /api/chain/qta/admin/health` 로
   핫월렛 잔고/니모닉 매칭/head 상태 확인.

문제 시: cron 로그 `npx wrangler tail quantaex-cron` 로 `[cron] qta …` 라인 관찰.

---

## 롤백 (문제 생기면)

- **즉시 정지**: Pages `QTA_CHAIN_DRIVER` = `mock` 으로 되돌리고 재배포
  → 입금주소 발급/출금이 다시 503 으로 막힘 (신규 온체인 동작 정지).
- **cron 만 정지**: cron `wrangler.jsonc` 의 `QTA_CHAIN_DRIVER` 를 `mock` 으로
  바꿔 재배포 → 스캔/브로드캐스트 no-op.
- 이미 `broadcasting` 인 출금건은 니모닉만 있으면 real 에서 처리된다.

---

## 안전장치 요약 (이미 코드에 있음)

- 입금 중복크레딧 차단: `qta_deposits` UNIQUE(tx_hash,address) + status-guarded credit.
- 출금 오서명 차단: 매 tick 니모닉 index-0 == 핫월렛 검증, 불일치 시 fail+환불.
- CPU 보호: SPHINCS+ 서명(6~10초)은 HTTP 핸들러가 아닌 cron 에서 tick당 1건.
- 컨펌: 메인넷 12 confirmations 후에만 크레딧.
- 회사지급 QTA 외부출금 불가 규칙 유지 (available_initial 차감).
