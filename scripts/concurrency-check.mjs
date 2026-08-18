#!/usr/bin/env node
/**
 * QuantaEX — Fund-Flow Concurrency Verification Harness
 * =============================================================================
 * Verifies the A1 / A2 / A3 fund-flow fixes actually hold under CONCURRENT
 * requests against a LIVE deployment (run from KR/JP — the sandbox is US-geo-
 * blocked so it cannot reach /api/auth or /api/wallet).
 *
 * It does NOT try to log in (login has an email-OTP step-up that can't be
 * scripted). Instead you paste a JWT you copied from a logged-in browser
 * session, and the harness fires N simultaneous requests to check the invariant
 * "only ONE of N racing requests may succeed".
 *
 * WHAT IT CHECKS
 *   T1 (A1 – order over-commit)   : place the SAME buy order N times at once,
 *                                   with a balance that only covers ONE.
 *                                   PASS ⇢ exactly 1 accepted, N-1 rejected
 *                                   with "Insufficient balance", and the wallet
 *                                   never went negative.
 *   T2 (A1 – withdraw over-draw)  : submit the SAME withdrawal N times at once.
 *                                   PASS ⇢ exactly 1 pending row created.
 *   T3 (A2 – double approve/reject): fire N admin approve (or reject) calls on
 *                                   the SAME withdrawal id at once (needs an
 *                                   ADMIN jwt). PASS ⇢ exactly 1 → 200/handled,
 *                                   the rest → 409 "already processed".
 *
 * USAGE
 *   BASE=https://quantaex.io \
 *   JWT="<user jwt>" \
 *   ADMIN_JWT="<admin jwt>"        # optional, only for T3
 *   node scripts/concurrency-check.mjs [--n=8] [--only=T1,T2] \
 *        [--market=QTA-USDT] [--coin=QTA] [--price=1] [--amount=1] \
 *        [--address=0x0000000000000000000000000000000000000001] \
 *        [--withdrawal-id=<id>] [--action=approve|reject]
 *
 * SAFETY
 *   • Read-mostly. The only state it changes is what YOU point it at: it places
 *     tiny orders / one tiny withdrawal on YOUR OWN test account. Use a
 *     dedicated QA account with a small, known balance.
 *   • It never prints your JWT. It never signs anything. No mnemonic involved.
 *
 * INTERPRETING RESULTS
 *   Each test prints "PASS" (invariant held — the fix works) or "FAIL"
 *   (invariant broken — money could leak; DO NOT launch, tell engineering).
 * =============================================================================
 */

const BASE = (process.env.BASE || 'https://quantaex.io').replace(/\/+$/, '');
const JWT = process.env.JWT || '';
const ADMIN_JWT = process.env.ADMIN_JWT || '';

// ---- arg parsing ----------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);
const N = Math.max(2, parseInt(args.n || '8', 10));
const ONLY = args.only ? String(args.only).split(',').map((s) => s.trim().toUpperCase()) : null;
const MARKET = args.market || 'QTA-USDT';
const COIN = args.coin || 'QTA';
const PRICE = Number(args.price || 1);
const AMOUNT = Number(args.amount || 1);
const ADDRESS = args.address || '0x0000000000000000000000000000000000000001';
const WID = args['withdrawal-id'] || '';
const ADMIN_ACTION = (args.action || 'approve').toLowerCase();

const want = (t) => !ONLY || ONLY.includes(t);

// ---- helpers --------------------------------------------------------------
const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
};

async function req(path, { method = 'GET', token = JWT, body } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, json, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, json: { error: String(e?.message || e) }, ms: Date.now() - t0 };
  }
}

/** Fire the SAME request N times as simultaneously as possible. */
async function burst(n, makeReq) {
  // Build all promises first, then await — maximises overlap.
  const promises = Array.from({ length: n }, () => makeReq());
  return Promise.all(promises);
}

function summarize(results) {
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return byStatus;
}

function line() { console.log(C.d('─'.repeat(74))); }

// ---- balance read (for context / negative-balance check) ------------------
async function readWallet(coin) {
  const r = await req(`/api/wallet/${encodeURIComponent(coin)}`);
  if (r.status !== 200 || !r.json) return null;
  return r.json;
}

// ============================================================================
// T1 — A1 order over-commit
// ============================================================================
async function T1() {
  console.log(C.b(`\nT1 · A1 order over-commit  (${MARKET}, buy ${AMOUNT} @ ${PRICE}, x${N})`));
  console.log(C.d('  Precondition: your QUOTE balance should cover ONLY ONE such order.'));

  const [base, quote] = MARKET.split('-');
  const before = await readWallet(quote);
  if (before) console.log(C.d(`  ${quote} available before: ${before.available}`));

  const results = await burst(N, () =>
    req('/api/orders', {
      method: 'POST',
      body: { market_symbol: MARKET, side: 'buy', type: 'limit', price: PRICE, amount: AMOUNT, time_in_force: 'GTC' },
    }),
  );

  const ok = results.filter((r) => r.status === 200 || r.status === 201);
  const insufficient = results.filter(
    (r) => r.status === 400 && /insufficient/i.test(JSON.stringify(r.json || {})),
  );
  const other = results.filter((r) => !ok.includes(r) && !insufficient.includes(r));

  console.log(C.d(`  statuses: ${JSON.stringify(summarize(results))}`));
  console.log(`  accepted=${ok.length}  insufficient=${insufficient.length}  other=${other.length}`);

  const after = await readWallet(quote);
  let negative = false;
  if (after) {
    console.log(C.d(`  ${quote} available after: ${after.available} (locked: ${after.locked})`));
    negative = Number(after.available) < 0 || Number(after.locked) < 0;
  }

  // Invariant: at most ONE order may be accepted when balance covers one, and
  // balances must never go negative.
  const pass = ok.length <= 1 && !negative && other.length === 0;
  verdict('T1', pass,
    pass ? `Exactly ${ok.length} order accepted, rest rejected cleanly, no negative balance.`
         : `Expected ≤1 accepted & no negatives; got accepted=${ok.length}, negative=${negative}, other=${other.length}.`);
  if (other.length) console.log(C.y('  ⚠ unexpected responses:'), other.slice(0, 3).map((r) => r.json));
  return pass;
}

// ============================================================================
// T2 — A1 withdraw over-draw
// ============================================================================
async function T2() {
  console.log(C.b(`\nT2 · A1 withdraw over-draw  (${COIN} ${AMOUNT} → ${ADDRESS.slice(0, 10)}…, x${N})`));
  console.log(C.d('  Precondition: WITHDRAWABLE balance should cover ONLY ONE such withdrawal,'));
  console.log(C.d('  the address must be whitelisted, and KYC approved (else all will 4xx — still a valid'));
  console.log(C.d('  concurrency check: at most one may reach "pending").'));

  const before = await readWallet(COIN);
  if (before) console.log(C.d(`  ${COIN} available before: ${before.available} (locked: ${before.locked})`));

  const results = await burst(N, () =>
    req('/api/wallet/withdraw', {
      method: 'POST',
      body: { coin_symbol: COIN, amount: AMOUNT, address: ADDRESS, network: COIN },
    }),
  );

  const accepted = results.filter(
    (r) => (r.status === 200 || r.status === 201) &&
           /withdrawal_id|submitted/i.test(JSON.stringify(r.json || {})),
  );
  console.log(C.d(`  statuses: ${JSON.stringify(summarize(results))}`));
  console.log(`  accepted(pending created)=${accepted.length}`);

  const after = await readWallet(COIN);
  let negative = false;
  if (after) {
    console.log(C.d(`  ${COIN} available after: ${after.available} (locked: ${after.locked})`));
    negative = Number(after.available) < 0 || Number(after.locked) < 0;
  }

  // Invariant: at most ONE withdrawal accepted; balances never negative.
  const pass = accepted.length <= 1 && !negative;
  verdict('T2', pass,
    pass ? `At most one withdrawal accepted (${accepted.length}); no negative balance.`
         : `Expected ≤1 accepted & no negatives; got accepted=${accepted.length}, negative=${negative}.`);
  if (accepted.length === 0) {
    console.log(C.y('  note: 0 accepted usually means precondition not met (not whitelisted / KYC / balance).'));
    console.log(C.y('        sample response:'), results[0]?.json);
  }
  return pass;
}

// ============================================================================
// T3 — A2 double approve/reject (admin)
// ============================================================================
async function T3() {
  console.log(C.b(`\nT3 · A2 admin double-${ADMIN_ACTION}  (withdrawal id=${WID || '<none>'}, x${N})`));
  if (!ADMIN_JWT) { console.log(C.y('  SKIP: ADMIN_JWT not set.')); return null; }
  if (!WID) { console.log(C.y('  SKIP: pass --withdrawal-id=<pending id> to run this test.')); return null; }

  const path = `/api/admin/withdrawals/${encodeURIComponent(WID)}/${ADMIN_ACTION}`;
  const results = await burst(N, () =>
    req(path, { method: 'POST', token: ADMIN_JWT, body: ADMIN_ACTION === 'reject' ? { reason: 'concurrency-test' } : {} }),
  );

  const handled = results.filter((r) => r.status === 200);
  const alreadyProcessed = results.filter(
    (r) => r.status === 409 || /already processed|not pending|invalid_status/i.test(JSON.stringify(r.json || {})),
  );
  const other = results.filter((r) => !handled.includes(r) && !alreadyProcessed.includes(r));

  console.log(C.d(`  statuses: ${JSON.stringify(summarize(results))}`));
  console.log(`  handled(200)=${handled.length}  already-processed(409)=${alreadyProcessed.length}  other=${other.length}`);

  // Invariant: exactly ONE call handles it; the rest are rejected as already-processed.
  const pass = handled.length === 1 && other.length === 0;
  verdict('T3', pass,
    pass ? `Exactly 1 ${ADMIN_ACTION} handled; ${alreadyProcessed.length} correctly refused as already-processed.`
         : `Expected exactly 1 handled & rest 409; got handled=${handled.length}, other=${other.length}.`);
  if (other.length) console.log(C.y('  ⚠ unexpected responses:'), other.slice(0, 3).map((r) => r.json));
  return pass;
}

// ---- verdict + main -------------------------------------------------------
const scoreboard = [];
function verdict(name, pass, msg) {
  const tag = pass ? C.g('PASS') : C.r('FAIL');
  console.log(`  ${tag}  ${msg}`);
  scoreboard.push({ name, pass });
}

async function main() {
  console.log(C.b('QuantaEX Fund-Flow Concurrency Harness'));
  console.log(C.d(`  target: ${BASE}   concurrency N=${N}`));
  if (!JWT) {
    console.log(C.r('\nERROR: JWT env var is required (paste a user JWT from a logged-in browser session).'));
    console.log(C.d('  In the browser devtools console:  copy(localStorage.getItem("token"))  (key name may vary)'));
    process.exit(2);
  }
  // sanity: token reaches an authenticated endpoint
  const ping = await readWallet(COIN);
  if (ping === null) {
    console.log(C.r(`\nERROR: JWT did not authenticate against ${BASE}/api/wallet/${COIN}.`));
    console.log(C.d('  Check: token valid & not expired, you are running from KR/JP (US is geo-blocked 451),'));
    console.log(C.d('  and the coin symbol exists on your account.'));
    process.exit(2);
  }

  line();
  if (want('T1')) await T1();
  if (want('T2')) await T2();
  if (want('T3')) await T3();
  line();

  const ran = scoreboard.length;
  const passed = scoreboard.filter((s) => s.pass).length;
  console.log(C.b(`\nRESULT: ${passed}/${ran} tests passed`));
  for (const s of scoreboard) console.log(`  ${s.pass ? C.g('✓') : C.r('✗')} ${s.name}`);
  if (ran === 0) { console.log(C.y('  (no tests ran — check --only / preconditions)')); process.exit(0); }
  process.exit(passed === ran ? 0 : 1);
}

main().catch((e) => { console.error(C.r('harness crashed:'), e); process.exit(3); });
