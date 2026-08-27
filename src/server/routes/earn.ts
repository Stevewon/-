import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware } from '../middleware/auth';

// ---------------------------------------------------------------------------
// QTA Staking API (official tier plan)
//
// FLOW
//   Stake:     user stakes USDT in $100 increments; tier (daily rate) chosen
//              by USDT band + term. Principal (USDT) is locked out of wallet.
//   Dividend:  denominated in USD = principal_usd * daily_rate * elapsed_days
//              (simple interest, no compounding), accrued daily, paid AS QTA.
//   Lock:      each position matures on its OWN start date + the product term
//              (180/360d). Redeeming before that position's maturity is an
//              early exit: 30% penalty on (principal + accrued dividend), then
//              net off already-taken QTA at today's price, remainder as USDT.
//              At/after maturity: keep dividend + full principal, no penalty.
//              Positions never merge — each stake is settled independently.
//   Payout:    dividend QTA credited on redeem/claim; company-issued
//              (available_initial bumped so it stays internal).
//   Withdraw:  a dedicated staking-dividend withdrawal (QTA), 100-QTA
//              increments, flat 5% fee (95 QTA net on 100 requested).
//   Referral:  when dividend is credited, L1 referrer gets 10% and L2 gets
//              5% of that dividend value, paid as QTA (company-issued).
//
// FUND SAFETY: subscribe uses an atomic conditional balance lock; redeem uses
// a claim-first status flip so a position can't be redeemed twice.
// ---------------------------------------------------------------------------

const app = new Hono<AppEnv>();

const uuid = () => crypto.randomUUID();
const MS_PER_DAY = 86_400_000;
const EARLY_PENALTY = 0.30;          // 30% penalty on (principal + dividend) for early exit
const WITHDRAW_FEE = 0.05;           // 5% flat fee on dividend withdrawal
const WITHDRAW_UNIT_QTA = 100;       // 100-QTA increments
const MATCH_L1 = 0.10;               // 1st-level referral match
const MATCH_L2 = 0.05;               // 2nd-level referral match
const STAKE_UNIT_USD = 100;          // $100 increments

async function qtaPrice(c: any): Promise<number> {
  const row = await c.env.DB.prepare(
    `SELECT price_usd FROM coins WHERE symbol = 'QTA'`
  ).first<any>();
  const p = row?.price_usd || 0;
  return p > 0 ? p : 0.01; // fallback so we never divide by zero
}

// Live USDT price (USD). Normally 1.00, but read from coins so a peg change
// is respected. Fallback 1.00.
async function usdtPrice(c: any): Promise<number> {
  const row = await c.env.DB.prepare(
    `SELECT price_usd FROM coins WHERE symbol = 'USDT'`
  ).first<any>();
  const p = row?.price_usd || 0;
  return p > 0 ? p : 1.0;
}

// Accrued dividend in USD for a position, capped at the full term.
function accruedUsd(p: {
  principal_usd: number;
  daily_rate: number;
  term_days: number;
  created_at: string | null;
}, nowMs: number): number {
  const start = p.created_at ? Date.parse(p.created_at) : nowMs;
  const elapsedDays = Math.max(0, (nowMs - (isNaN(start) ? nowMs : start)) / MS_PER_DAY);
  const cappedDays = Math.min(elapsedDays, p.term_days || 0);
  const usd = (p.principal_usd || 0) * (p.daily_rate || 0) * cappedDays;
  return isFinite(usd) ? usd : 0;
}

// Credit a QTA amount to a user as company-issued (internal, non-withdrawable
// beyond the staking-dividend withdrawal path). Creates wallet row if missing.
async function creditQta(c: any, userId: string, qta: number) {
  if (qta <= 0) return;
  const upd = await c.env.DB.prepare(
    `UPDATE wallets SET available = available + ?,
            available_initial = COALESCE(available_initial,0) + ?
      WHERE user_id = ? AND coin_symbol = 'QTA'`
  ).bind(qta, qta, userId).run();
  if (!upd.meta || upd.meta.changes === 0) {
    await c.env.DB.prepare(
      `INSERT INTO wallets (id, user_id, coin_symbol, available, available_initial)
       VALUES (?,?, 'QTA', ?, ?)`
    ).bind(uuid(), userId, qta, qta).run();
  }
}

// Pay referral match bonuses for a dividend of `usdValue` earned by `stakerId`.
//
// ★ RETIRED (owner rule 2026-08-26): the old L1 10% / L2 5% dividend-match
//   program has been replaced by the binary left/right MATCHING BONUS. The old
//   "Referral Match — Level 1/Level 2" panel was removed from the Earn page and
//   this payout is now DISABLED. Kept as a no-op (guarded below) for audit
//   history; flip DIVIDEND_REFERRAL_MATCH_ENABLED to re-enable if ever needed.
const DIVIDEND_REFERRAL_MATCH_ENABLED = false;
async function payReferralMatch(c: any, stakerId: string, usdValue: number, price: number, positionId: string) {
  if (!DIVIDEND_REFERRAL_MATCH_ENABLED) return; // retired — see note above
  if (usdValue <= 0) return;
  // L1: who referred the staker?
  const l1 = await c.env.DB.prepare(
    `SELECT referrer_id FROM referrals WHERE referred_id = ?`
  ).bind(stakerId).first<any>();
  if (!l1?.referrer_id) return;

  const l1Usd = usdValue * MATCH_L1;
  const l1Qta = l1Usd / price;
  await creditQta(c, l1.referrer_id, l1Qta);
  await c.env.DB.prepare(
    `INSERT INTO staking_dividends (id, position_id, user_id, kind, usd_amount, qta_amount, qta_price, source_user_id)
     VALUES (?,?,?, 'match_l1', ?,?,?,?)`
  ).bind(uuid(), positionId, l1.referrer_id, l1Usd, l1Qta, price, stakerId).run();

  // L2: who referred the L1 referrer?
  const l2 = await c.env.DB.prepare(
    `SELECT referrer_id FROM referrals WHERE referred_id = ?`
  ).bind(l1.referrer_id).first<any>();
  if (!l2?.referrer_id) return;

  const l2Usd = usdValue * MATCH_L2;
  const l2Qta = l2Usd / price;
  await creditQta(c, l2.referrer_id, l2Qta);
  await c.env.DB.prepare(
    `INSERT INTO staking_dividends (id, position_id, user_id, kind, usd_amount, qta_amount, qta_price, source_user_id)
     VALUES (?,?,?, 'match_l2', ?,?,?,?)`
  ).bind(uuid(), positionId, l2.referrer_id, l2Usd, l2Qta, price, stakerId).run();
}

// --------------------------------------------------------------------------
// GET /products — active tier catalog (public).
// --------------------------------------------------------------------------
app.get('/products', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, coin_symbol, kind, min_usd, max_usd, term_days, daily_rate,
            payout_coin, sort_order
       FROM staking_products
      WHERE is_active = 1
      ORDER BY sort_order ASC`
  ).all();
  const price = await qtaPrice(c);
  const products = (results || []).map((p: any) => ({
    ...p,
    total_return: (p.daily_rate * p.term_days), // e.g. 0.36 = 36%
    unit_usd: STAKE_UNIT_USD,
  }));
  return c.json({ products, qta_price: price, stake_unit_usd: STAKE_UNIT_USD });
});

// --------------------------------------------------------------------------
// GET /positions — user's active positions with live accrual (in USD + QTA).
// --------------------------------------------------------------------------
app.get('/positions', authMiddleware, async (c) => {
  const user = c.get('user');
  const now = Date.now();
  const price = await qtaPrice(c);

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM staking_positions
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at DESC`
  ).bind(user.id).all();

  const positions = ((results || []) as any[]).map((p) => {
    const divUsd = accruedUsd(p, now);
    const termEnd = p.term_end_at ? Date.parse(p.term_end_at) : now;
    const matured = now >= termEnd;          // this position's own term reached
    const principalQta = p.principal_qta
      || p.principal
      || (p.qta_price_at_stake > 0 ? (p.principal_usd || 0) / p.qta_price_at_stake : 0);
    return {
      ...p,
      principal_qta: principalQta,
      accrued_dividend_usd: divUsd,
      accrued_dividend_qta: divUsd / price,
      // Normal (penalty-free) redeem is allowed only once THIS position's own
      // term (180/360d from its own start date) has been reached. Before that
      // it is an early exit. Each position has its own term_end_at.
      can_redeem: matured,
      matured,
      term_end_at: p.term_end_at,
    };
  });

  const summary = {
    totalPrincipalUsd: positions.reduce((s, p) => s + (p.principal_usd || 0), 0),
    totalDividendUsd: positions.reduce((s, p) => s + (p.accrued_dividend_usd || 0), 0),
    totalDividendQta: positions.reduce((s, p) => s + (p.accrued_dividend_qta || 0), 0),
  };
  return c.json({ positions, summary, qta_price: price });
});

// --------------------------------------------------------------------------
// POST /subscribe { product_id, amount_usd? , amount_qta? }
// Stakes QTA (bought on the exchange) into a tier. The tier band is USD, but
// the staked asset is QTA: the required QTA quantity is derived from the LIVE
// QTA price at stake time. Caller may send either a USD target (amount_usd) or
// the QTA quantity directly (amount_qta) — they're two views of the same stake.
//   required_qta   = amount_usd / price      (when USD target given)
//   principal_usd  = qta_qty * price         (locked-in USD value at stake)
// Dividend math stays USD-denominated off principal_usd; principal returns in
// QTA (the same quantity that was staked).
// --------------------------------------------------------------------------
app.post('/subscribe', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const productId = String(body.product_id || '');
  const price = await qtaPrice(c);              // live QTA price (USD)

  if (!productId) return c.json({ error: 'product_id required' }, 400);

  const product = await c.env.DB.prepare(
    `SELECT * FROM staking_products WHERE id = ? AND is_active = 1`
  ).bind(productId).first<any>();
  if (!product) return c.json({ error: 'Product not found' }, 404);

  // Resolve the stake into a QTA quantity + its USD value at the live price.
  // Prefer an explicit QTA quantity; otherwise convert the USD target.
  let qtaQty = Number(body.amount_qta);
  let amountUsd = Number(body.amount_usd);
  if (isFinite(qtaQty) && qtaQty > 0) {
    amountUsd = qtaQty * price;
  } else if (isFinite(amountUsd) && amountUsd > 0) {
    qtaQty = amountUsd / price;
  } else {
    return c.json({ error: 'Invalid amount' }, 400);
  }
  if (!isFinite(qtaQty) || qtaQty <= 0 || !isFinite(amountUsd) || amountUsd <= 0) {
    return c.json({ error: 'Invalid amount' }, 400);
  }

  // Validate the USD value against the tier band.
  if (amountUsd < product.min_usd) {
    return c.json({ error: `Minimum for this tier is $${product.min_usd}` }, 400);
  }
  if (product.max_usd != null && amountUsd > product.max_usd) {
    return c.json({ error: `Maximum for this tier is $${product.max_usd}` }, 400);
  }

  // Lock the QTA principal atomically from the user's available balance.
  const lockRes = await c.env.DB.prepare(
    `UPDATE wallets SET available = available - ?, locked = COALESCE(locked,0) + ?
      WHERE user_id = ? AND coin_symbol = 'QTA' AND available >= ?`
  ).bind(qtaQty, qtaQty, user.id, qtaQty).run();
  if (!lockRes.meta || lockRes.meta.changes === 0) {
    return c.json({ error: 'Insufficient QTA balance' }, 400);
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  // Each position matures on its OWN start date + the product term (180/360d).
  const termEndIso = new Date(now + product.term_days * MS_PER_DAY).toISOString();
  const lockEndIso = termEndIso; // legacy column kept in sync with term end
  const posId = uuid();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO staking_positions
        (id, user_id, product_id, coin_symbol, kind, apr, principal,
         accrued_interest, status, lock_days,
         principal_usd, principal_qta, qta_price_at_stake,
         daily_rate, term_days, accrued_dividend_usd,
         paid_dividend_qta, payout_coin, lock_end_at, term_end_at,
         last_accrued_at, created_at)
       VALUES (?,?,?, 'QTA','fixed', ?, ?, 0, 'active', ?,
               ?,?,?, ?,?,0, 0, 'QTA', ?,?, ?, ?)`
    ).bind(posId, user.id, product.id, product.total_return || (product.daily_rate * product.term_days),
           qtaQty, product.term_days,
           amountUsd, qtaQty, price,
           product.daily_rate, product.term_days,
           lockEndIso, termEndIso, nowIso, nowIso),
    c.env.DB.prepare(
      `UPDATE staking_products SET total_staked = COALESCE(total_staked,0) + ?, updated_at = ?
        WHERE id = ?`
    ).bind(amountUsd, nowIso, product.id),
  ]);

  return c.json({
    ok: true, position_id: posId,
    staked_qta: qtaQty, principal_usd: amountUsd, qta_price: price,
    lock_end_at: lockEndIso, term_end_at: termEndIso,
  });
});

// --------------------------------------------------------------------------
// POST /claim { position_id }
// Credits accrued QTA dividend WITHOUT closing the position. Dividends accrue
// daily in real time, so a claim is allowed anytime there is unclaimed
// dividend (the principal stays staked until maturity or early exit). Pays
// referral match on the credited amount.
// --------------------------------------------------------------------------
app.post('/claim', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const positionId = String(body.position_id || '');
  if (!positionId) return c.json({ error: 'position_id required' }, 400);

  const pos = await c.env.DB.prepare(
    `SELECT * FROM staking_positions WHERE id = ? AND user_id = ?`
  ).bind(positionId, user.id).first<any>();
  if (!pos) return c.json({ error: 'Position not found' }, 404);
  if (pos.status !== 'active') return c.json({ error: 'Position not active' }, 409);

  const now = Date.now();
  const price = await qtaPrice(c);
  const totalUsd = accruedUsd(pos, now);
  // accrued_dividend_usd holds the USD value already credited so far.
  const alreadyPaidUsd = pos.accrued_dividend_usd || 0;
  const payableUsd = Math.max(0, totalUsd - alreadyPaidUsd);
  if (payableUsd <= 0) return c.json({ ok: true, credited_qta: 0, note: 'nothing to claim' });

  const qta = payableUsd / price;

  // Claim-first: bump the paid snapshot atomically so concurrent claims can't
  // double-pay.
  const claim = await c.env.DB.prepare(
    `UPDATE staking_positions
        SET accrued_dividend_usd = ?, paid_dividend_qta = COALESCE(paid_dividend_qta,0) + ?,
            last_accrued_at = ?
      WHERE id = ? AND status = 'active' AND accrued_dividend_usd = ?`
  ).bind(totalUsd, qta, new Date(now).toISOString(), positionId, alreadyPaidUsd).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ error: 'Claim already in progress, retry' }, 409);
  }

  await creditQta(c, user.id, qta);
  await c.env.DB.prepare(
    `INSERT INTO staking_dividends (id, position_id, user_id, kind, usd_amount, qta_amount, qta_price)
     VALUES (?,?,?, 'dividend', ?,?,?)`
  ).bind(uuid(), positionId, user.id, payableUsd, qta, price).run();

  await payReferralMatch(c, user.id, payableUsd, price, positionId);

  return c.json({ ok: true, credited_qta: qta, qta_price: price });
});

// --------------------------------------------------------------------------
// POST /redeem { position_id }
// Closes a position. "Early" is measured against THIS position's own maturity
// date (term_end_at = its own start + the product term, 180/360d) — there is
// no global fixed lock, and each position is settled independently.
//   Before maturity (early): base = principal_usd + TOTAL accrued dividend
//     (USD, whether or not any QTA was already claimed); deduct 30% of that
//     base, then net off any QTA already taken valued at today's price; pay the
//     remainder ALL AS USDT.
//   At/after maturity: pay remaining (unpaid) dividend as QTA + return full
//     USDT principal (no penalty).
// --------------------------------------------------------------------------
app.post('/redeem', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const positionId = String(body.position_id || '');
  if (!positionId) return c.json({ error: 'position_id required' }, 400);

  const pos = await c.env.DB.prepare(
    `SELECT * FROM staking_positions WHERE id = ? AND user_id = ?`
  ).bind(positionId, user.id).first<any>();
  if (!pos) return c.json({ error: 'Position not found' }, 404);
  if (pos.status !== 'active') return c.json({ error: 'Already redeemed' }, 409);

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const price = await qtaPrice(c);
  const principalUsd = pos.principal_usd || 0;
  // QTA principal that was locked at stake time. Fall back to `principal`
  // (the QTA quantity is now stored there) or derive from the staked-price.
  const principalQta = pos.principal_qta
    || pos.principal
    || (pos.qta_price_at_stake > 0 ? principalUsd / pos.qta_price_at_stake : 0);
  // Early == before this position's own maturity date (per-position).
  const isEarly = pos.term_end_at ? Date.parse(pos.term_end_at) > now : false;

  // Claim-first status flip.
  const claim = await c.env.DB.prepare(
    `UPDATE staking_positions SET status = 'redeemed', redeemed_at = ?, last_accrued_at = ?
      WHERE id = ? AND status = 'active'`
  ).bind(nowIso, nowIso, positionId).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ error: 'Already redeemed' }, 409);
  }

  let returnedQta: number;      // QTA principal returned to the wallet
  let dividendQta = 0;          // remaining unpaid dividend (matured only)
  let penaltyQta = 0;           // QTA principal forfeited (early only)

  if (isEarly) {
    // ★★★ Boss's early-exit rule: the 30% penalty is charged on the FULL
    // base = (principal + accrued dividend), NOT the principal alone.
    //   e.g. principal 100 + accrued interest 10 = base 110
    //        penalty  = 110 * 30% = 33
    //        returned = 110 - 33 = 77   (paid as QTA)
    // Everything is denominated in QTA for wallet consistency: the accrued
    // dividend (USD) is converted to QTA at today's price, and any dividend
    // the user ALREADY claimed is netted out of the base so it isn't paid
    // twice.
    const totalDivUsd = accruedUsd(pos, now);                 // total interest so far (USD)
    const alreadyPaidUsd = pos.accrued_dividend_usd || 0;      // dividend already taken (USD)
    const remainingDivUsd = Math.max(0, totalDivUsd - alreadyPaidUsd);
    const remainingDivQta = price > 0 ? remainingDivUsd / price : 0;

    const baseQta = principalQta + remainingDivQta;           // 원금 + 적립이자 (QTA)
    penaltyQta = baseQta * EARLY_PENALTY;                      // 30% of (principal + dividend)
    returnedQta = Math.max(0, baseQta - penaltyQta);          // remaining 70%, paid as QTA
  } else {
    // Matured: return the full QTA principal + pay remaining unpaid dividend
    // (valued in USD, paid as QTA at today's price).
    const totalUsd = accruedUsd(pos, now);
    const paidUsd = pos.accrued_dividend_usd || 0;
    const payableUsd = Math.max(0, totalUsd - paidUsd);
    dividendQta = payableUsd / price;
    returnedQta = principalQta;

    if (dividendQta > 0) {
      await creditQta(c, user.id, dividendQta);
      await c.env.DB.prepare(
        `INSERT INTO staking_dividends (id, position_id, user_id, kind, usd_amount, qta_amount, qta_price)
         VALUES (?,?,?, 'dividend', ?,?,?)`
      ).bind(uuid(), positionId, user.id, payableUsd, dividendQta, price).run();
      await payReferralMatch(c, user.id, payableUsd, price, positionId);
    }
  }

  // Return the QTA principal (net of any early penalty): move it out of locked
  // and back into available. Non-negative guard keeps locked from underflowing.
  if (returnedQta > 0) {
    const upd = await c.env.DB.prepare(
      `UPDATE wallets
          SET available = available + ?,
              locked = MAX(0, COALESCE(locked,0) - ?)
        WHERE user_id = ? AND coin_symbol = 'QTA'`
    ).bind(returnedQta, principalQta, user.id).run();
    if (!upd.meta || upd.meta.changes === 0) {
      await c.env.DB.prepare(
        `INSERT INTO wallets (id, user_id, coin_symbol, available, available_initial)
         VALUES (?,?, 'QTA', ?, 0)`
      ).bind(uuid(), user.id, returnedQta).run();
    }
  } else {
    // Nothing returned (100% forfeit edge case): just release the lock.
    await c.env.DB.prepare(
      `UPDATE wallets SET locked = MAX(0, COALESCE(locked,0) - ?)
        WHERE user_id = ? AND coin_symbol = 'QTA'`
    ).bind(principalQta, user.id).run();
  }

  await c.env.DB.prepare(
    `UPDATE staking_products SET total_staked = MAX(0, COALESCE(total_staked,0) - ?), updated_at = ?
      WHERE id = ?`
  ).bind(principalUsd, nowIso, pos.product_id).run();

  return c.json({
    ok: true, early: isEarly,
    returned_qta: returnedQta, penalty_qta: penaltyQta,
    principal_qta: principalQta,
    dividend_qta: dividendQta, qta_price: price,
  });
});

// --------------------------------------------------------------------------
// POST /withdraw-dividend { amount_qta, address, payout_coin? }
// Withdraws staking-dividend QTA. 100-QTA increments, flat 5% fee.
// The dividend is always denominated in QTA, but the user CHOOSES the payout
// coin: 'QTA' (default) or 'USDT'. When USDT is chosen, the net QTA is
// converted at that moment's LIVE QTA and USDT prices:
//     usdt_amount = net_qta * qta_price / usdt_price
// Creates a normal withdrawal request in the chosen asset (operator settles).
// --------------------------------------------------------------------------
app.post('/withdraw-dividend', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const amountQta = Number(body.amount_qta);
  const address = String(body.address || '').trim();
  const payoutCoin = String(body.payout_coin || 'QTA').toUpperCase();

  if (!isFinite(amountQta) || amountQta <= 0) return c.json({ error: 'Invalid amount' }, 400);
  if (amountQta % WITHDRAW_UNIT_QTA !== 0) {
    return c.json({ error: `Amount must be in ${WITHDRAW_UNIT_QTA}-QTA increments` }, 400);
  }
  if (payoutCoin !== 'QTA' && payoutCoin !== 'USDT') {
    return c.json({ error: 'payout_coin must be QTA or USDT' }, 400);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return c.json({ error: 'Valid destination (0x...) address required' }, 400);
  }

  // Live prices at THIS moment.
  const qPrice = await qtaPrice(c);          // QTA price in USD
  const uPrice = await usdtPrice(c);         // USDT price in USD (≈1)

  // ★★★★★★★ Boss's minimum-withdrawal rule (2026-08-26): $50 USD equivalent,
  //   valued at the QTA live price. Below $50 is hard-blocked server-side.
  const MIN_WITHDRAW_USD = 50;
  const requestUsd = amountQta * qPrice;
  if (qPrice > 0 && requestUsd < MIN_WITHDRAW_USD) {
    return c.json({
      error: `Minimum withdrawal is $${MIN_WITHDRAW_USD} (valued at the current live price).`,
      code: 'BELOW_MIN_WITHDRAWAL',
      min_usd: MIN_WITHDRAW_USD,
      requested_usd: Math.round(requestUsd * 100) / 100,
    }, 400);
  }

  const feeQta = amountQta * WITHDRAW_FEE;   // 5% fee on the QTA amount
  const netQta = amountQta - feeQta;         // e.g. 95 on 100

  // Atomically lock the requested QTA from the user's QTA available balance.
  const lock = await c.env.DB.prepare(
    `UPDATE wallets SET available = available - ?, locked = COALESCE(locked,0) + ?
      WHERE user_id = ? AND coin_symbol = 'QTA' AND available >= ?`
  ).bind(amountQta, amountQta, user.id, amountQta).run();
  if (!lock.meta || lock.meta.changes === 0) {
    return c.json({ error: 'Insufficient QTA balance' }, 400);
  }

  const id = uuid();
  const nowIso = new Date().toISOString();

  // Determine the settled payout in the chosen asset.
  let payoutAmount: number;
  let payoutFee: number;
  let network: string;
  if (payoutCoin === 'USDT') {
    // Convert net QTA -> USDT at live prices.
    payoutAmount = (netQta * qPrice) / uPrice;
    payoutFee = (feeQta * qPrice) / uPrice;
    network = 'bep20';               // USDT settles on BEP-20 (BSC)
  } else {
    payoutAmount = netQta;
    payoutFee = feeQta;
    network = 'qta-mainnet';
  }

  // Record as a withdrawal request (manual-withdrawal mode; operator settles).
  // amount/fee are TEXT columns in qta_withdrawals — store as strings.
  await c.env.DB.prepare(
    `INSERT INTO qta_withdrawals
       (id, user_id, asset, amount, fee, to_address, status, network, created_at)
     VALUES (?,?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(id, user.id, payoutCoin, String(payoutAmount), String(payoutFee), address, network, nowIso).run();

  return c.json({
    ok: true,
    withdrawal_id: id,
    payout_coin: payoutCoin,
    requested_qta: amountQta,
    fee_qta: feeQta,
    net_qta: netQta,
    qta_price: qPrice,
    usdt_price: uPrice,
    payout_amount: payoutAmount,
    payout_fee: payoutFee,
  });
});

// --------------------------------------------------------------------------
// GET /dividends — recent dividend + match ledger for the user.
// --------------------------------------------------------------------------
app.get('/dividends', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT kind, usd_amount, qta_amount, qta_price, created_at
       FROM staking_dividends WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 100`
  ).bind(user.id).all();
  return c.json({ dividends: results || [] });
});

export default app;
