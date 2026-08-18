# Fund-Flow Concurrency Verification — How to Run

`scripts/concurrency-check.mjs` proves the **A1 / A2 / A3** fixes (see
`docs/FUND_FLOW_AUDIT.md`) actually hold under **simultaneous** requests on the
live site. Run it **from KR or JP** — the US is geo-blocked (451) so `/api/auth`
and `/api/wallet` won't respond from a US network.

No install needed (uses Node 20 built-in `fetch`).

---

## 1. Get a JWT (no scripting of login — it has an email-OTP step)

1. Log in to **https://quantaex.io** in your browser as a **dedicated QA account**.
2. Open DevTools → Console and run:
   ```js
   copy(localStorage.getItem('token'))
   ```
   The token is now on your clipboard.

For **T3** (admin double-approve) you also need an **admin** account's token the
same way (`ADMIN_JWT`).

## 2. Prepare the QA account

- **T1 (orders):** give the account a QUOTE balance (e.g. USDT) that covers
  **exactly one** of the test order (`price × amount × (1+fee)`), not two.
- **T2 (withdraw):** the account should have a **withdrawable** balance covering
  **only one** withdrawal, the destination address **whitelisted**, and **KYC
  approved**. (If not, T2 will show 0 accepted — still a valid check: it proves
  no more than one can ever reach "pending".)
- **T3 (admin):** create ONE pending withdrawal and note its `id`.

## 3. Run

```bash
# T1 + T2 (user-level race checks)
BASE=https://quantaex.io \
JWT="<paste user token>" \
node scripts/concurrency-check.mjs --n=8 --market=QTA-USDT --coin=QTA --price=1 --amount=1

# T3 (admin double-approve / double-reject) — needs a pending withdrawal id
BASE=https://quantaex.io \
JWT="<user token>" ADMIN_JWT="<admin token>" \
node scripts/concurrency-check.mjs --only=T3 --withdrawal-id=<pending-id> --action=approve
```

### Options
| flag | default | meaning |
|------|---------|---------|
| `--n` | `8` | how many simultaneous requests to fire |
| `--only` | (all) | comma list, e.g. `--only=T1,T2` |
| `--market` | `QTA-USDT` | market for T1 |
| `--coin` | `QTA` | coin for T2 wallet read / withdraw |
| `--price` `--amount` | `1` `1` | T1 order price/size (and T2 amount) |
| `--address` | test 0x…01 | T2 destination (must be whitelisted to reach "pending") |
| `--withdrawal-id` | — | T3 target pending withdrawal id |
| `--action` | `approve` | T3: `approve` or `reject` |

## 4. Read the result

- **T1 PASS** ⇢ of N simultaneous orders, **≤1 accepted**, the rest rejected
  "Insufficient balance", wallet never negative. (A1 order fix works.)
- **T2 PASS** ⇢ **≤1 withdrawal** reached "pending". (A1 withdraw fix works.)
- **T3 PASS** ⇢ exactly **1** admin call handled (200), the rest **409
  already-processed** — no double approve / double refund. (A2 fix works.)

Exit code `0` = all ran tests passed, `1` = at least one FAIL (⇒ do **not**
launch, report to engineering), `2` = auth/precondition problem.

> Safe to re-run. It only touches the QA account you point it at, never signs
> anything, and never prints your token.
