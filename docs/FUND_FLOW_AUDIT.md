# QuantaEX 자금 경로 코드 감사 리포트 (Fund-Flow Security Audit)

> 작성: 운영 개시 전 감사 · 대상 커밋 `b144c60` · 범위: 입금/출금/주문 잔액 회계
> ⚠️ 이 문서는 "돈이 새는 구멍"만 다룹니다. UI/UX·성능은 별도.

---

## 요약 (심각도순)

| # | 심각도 | 위치 | 문제 | 상태 |
|---|--------|------|------|------|
| A1 | 🔴 CRITICAL | order.ts, wallet.ts | 잔액 차감이 원자적이지 않음 → 동시 요청 시 **초과 인출/초과 주문** 가능 (race condition) | ✅ 수정완료 (조건부 UPDATE + changes 판정) |
| A2 | 🔴 CRITICAL | admin.ts, chain.ts 출금 승인/거부/완료 | check-then-act → 관리자 **이중 승인/이중 환불** 가능 | ✅ 수정완료 (상태전이 먼저 claim, 성공 시에만 잔액이동). QTA 거부 시 환불 누락 버그도 함께 수정 |
| A3 | 🟠 HIGH | cron 입금 크레딧, admin 수동크레딧 | 입금/크레딧 **멱등성(idempotency) 부재** → 재시도 시 이중 크레딧 가능 | ✅ 수정완료 (크론 credit을 EXISTS 가드로 종속, 수동크레딧 idempotency_key + tx_hash UNIQUE 인덱스 0042) |
| A4 | 🟠 HIGH | 전반 | 잔액 이동에 **DB 트랜잭션(원자성)** 미보장 — D1 batch는 트랜잭션이지만 SELECT→UPDATE 구간은 밖 | ✅ 해소 (A1 조건부 UPDATE로 SELECT 의존 제거) |
| B1 | 🟢 OK | wallet.ts 출금 회계 | gross/net/fee 계산 일관 (lock=amount, 저장=net+fee) | 정상 |
| B2 | 🟢 OK | 회사지급분 출금차단 | available_initial 2중 방어 (유저단 + admin approve단) | 정상 |
| B3 | 🟢 OK | QTA/QX/QKEY 주소검증 | 서버 `0x+40hex` 강제 + UI 경고/체크박스 | 정상 |

---

## A1. 🔴 잔액 차감 Race Condition (최우선)

**증상:** 잔액을 `SELECT available` 로 읽어 확인한 뒤, 별도의 `UPDATE ... WHERE id = ?` 로 차감.
두 요청이 거의 동시에 오면 **둘 다 검증을 통과**한 뒤 **둘 다 차감** → 가진 잔액보다 많이 인출/주문됨.

**해당 위치:**
- `order.ts:165-169` (매수 잔액 잠금)
- `order.ts:173-177` (매도 잔액 잠금)
- `wallet.ts:336-339 → 377/387` (출금 잔액 잠금)

**현재 코드(취약):**
```ts
const wallet = await DB.prepare('SELECT available FROM wallets WHERE ...').first();
if (!wallet || wallet.available < lockAmount) return error;      // ← 확인
await DB.prepare('UPDATE wallets SET available = available - ?, locked = locked + ? WHERE user_id=? AND coin_symbol=?')
  .bind(lockAmount, lockAmount, ...).run();                       // ← 차감 (조건 없음)
```

**권장 수정(조건부 UPDATE로 원자화):** UPDATE 자체에 `AND available >= ?` 를 넣고, `meta.changes` 로 성공 여부 판정.
```ts
const res = await DB.prepare(
  'UPDATE wallets SET available = available - ?, locked = locked + ? ' +
  'WHERE user_id = ? AND coin_symbol = ? AND available >= ?'
).bind(lockAmount, lockAmount, userId, coin, lockAmount).run();
if (res.meta.changes === 0) return c.json({ error: 'Insufficient balance' }, 400);
```
이렇게 하면 동시 요청 중 하나만 성공하고, 잔액이 부족하면 `changes=0` 이 되어 안전하게 거부됨.

---

## A2. 🔴 관리자 출금 승인/거부 이중 처리

**증상:** `SELECT status` 로 pending 확인 후, `UPDATE ... WHERE id = ?` (status 조건 없음).
승인 버튼을 빠르게 두 번 누르거나 요청이 중복되면 **locked 를 두 번 차감**(승인) / **available 로 두 번 환불**(거부)될 수 있음.

**해당 위치:** `admin.ts:540 & 587` (approve), `admin.ts:635 & 645` (reject)

**권장 수정:** 상태 전이 UPDATE에 `AND status = 'pending'` 를 넣고 `changes` 확인.
```ts
const res = await db.prepare(
  "UPDATE withdrawals SET status='completed', tx_hash=? WHERE id=? AND status='pending'"
).bind(tx, w.id).run();
if (res.meta.changes === 0) return c.json({ error: 'Already processed' }, 409);
// ↑ 이 UPDATE가 성공(changes=1)했을 때만 wallet locked 차감을 진행
```
**핵심:** "상태 전이가 성공한 경우에만 잔액을 움직인다" 순서로 바꿔야 이중 처리가 원천 차단됨.
(QTA 크론 경로 `chain.ts` 의 승인/완료/거부도 동일 점검 필요.)

---

## A3. 🟠 입금/크레딧 멱등성

**점검 대상:**
- `wallet.ts:140/142` (입금 크레딧 `available += amount`)
- `admin.ts:714~` 수동 크레딧

**위험:** 같은 입금 트랜잭션(체인 tx_hash)이 두 번 처리되면 잔액이 이중 반영됨.
**권장:** 입금 처리 시 `tx_hash`(또는 external deposit id)에 **UNIQUE 제약** + "이미 처리됨"이면 skip.
크레딧 승인도 `deposit.status='pending' → 'completed'` 조건부 UPDATE 후 `changes=1` 일 때만 잔액 반영.

---

## A4. 🟠 SELECT→UPDATE 원자성

Cloudflare D1 의 `DB.batch([...])` 는 **하나의 트랜잭션**으로 원자적이지만,
현재 코드는 `SELECT`(검증)와 `batch`(차감)가 **분리**되어 있어 그 사이에 다른 요청이 끼어들 수 있음.
→ A1/A2 를 조건부 UPDATE로 고치면 SELECT 의존이 사라져 이 문제도 함께 해소됨.

---

## 정상 확인된 항목 (B-그룹)

- **출금 gross/net/fee 회계**: lock=amount(gross), 저장=net(amount-fee)+fee, 승인 시 locked-=gross, 거부 시 available+=gross/locked-=gross → **정합** ✓
- **회사 지급분(available_initial) 외부 출금 차단**: 유저 엔드포인트 + admin approve 2중 방어 ✓
- **QTA/QX/QKEY 퀀타리움 전용 주소 강제**: 서버 정규식 + UI 경고/동의 체크박스 ✓
- **KYC 미승인 출금 차단 / 2FA 강제 / 화이트리스트 / 일일한도**: 엔드포인트에 존재 ✓
- **locked 음수 방지**: 모든 차감에 `MAX(0, locked - ?)` 적용 ✓

---

## 운영 개시 전 권장 조치 순서

1. **A1 수정** (주문·출금 잔액 잠금을 조건부 UPDATE + changes 판정) — 가장 시급
2. **A2 수정** (관리자/크론 상태 전이를 조건부 UPDATE, 전이 성공 시에만 잔액 이동)
3. **A3 점검·수정** (입금 tx_hash UNIQUE + 멱등 처리)
4. 수정 후 **동시성 부하 테스트**: 같은 계정으로 동일 출금/주문을 동시에 N번 발사 → 딱 1번만 성공하는지 확인
5. 소액 실전 리허설: 입금→거래→출금→관리자 승인 1사이클을 실제 KR/JP 환경에서

> A1·A2는 실제 금전 손실로 직결되는 항목입니다. 운영 개시 전 반드시 수정 권장.
