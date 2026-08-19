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
//   Lock:      hard 90-day minimum lock. Early exit (< 90d) forfeits all
//              accrued dividend AND pays a 30% principal penalty (70% USDT
//              returned). After 90 days: keep dividend + full principal.
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
const MIN_LOCK_DAYS = 90;
const EARLY_PENALTY = 0.30;          // 30% principal penalty on early exit
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
async function payReferralMatch(c: any, stakerId: string, usdValue: number, price: number, positionId: string) {
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
    const lockEnd = p.lock_end_at ? Date.parse(p.lock_end_at) : now;
    const termEnd = p.term_end_at ? Date.parse(p.term_end_at) : now;
    return {
      ...p,
      accrued_dividend_usd: divUsd,
      accrued_dividend_qta: divUsd / price,
      can_redeem: now >= lockEnd,            // 90-day min lock passed
      matured: now >= termEnd,               // full term done
      lock_end_at: p.lock_end_at,
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
// POST /subscribe { product_id, amount_usd }
// Stakes USDT in $100 increments matching the chosen tier band.
// --------------------------------------------------------------------------
app.post('/subscribe', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const productId = String(body.product_id || '');
  const amountUsd = Number(body.amount_usd);

  if (!productId) return c.json({ error: 'product_id required' }, 400);
  if (!isFinite(amountUsd) || amountUsd <= 0) return c.json({ error: 'Invalid amount' }, 400);
  if (amountUsd % STAKE_UNIT_USD !== 0) {
    return c.json({ error: `Amount must be in $${STAKE_UNIT_USD} increments` }, 400);
  }

  const product = await c.env.DB.prepare(
    `SELECT * FROM staking_products WHERE id = ? AND is_active = 1`
  ).bind(productId).first<any>();
  if (!product) return c.json({ error: 'Product not found' }, 404);

  if (amountUsd < product.min_usd) {
    return c.json({ error: `Minimum for this tier is $${product.min_usd}` }, 400);
  }
  if (product.max_usd != null && amountUsd > product.max_usd) {
    return c.json({ error: `Maximum for this tier is $${product.max_usd}` }, 400);
  }

  // Lock the USDT principal atomically (USDT is 1:1 USD).
  const lockRes = await c.env.DB.prepare(
    `UPDATE wallets SET available = available - ?
      WHERE user_id = ? AND coin_symbol = 'USDT' AND available >= ?`
  ).bind(amountUsd, user.id, amountUsd).run();
  if (!lockRes.meta || lockRes.meta.changes === 0) {
    return c.json({ error: 'Insufficient USDT balance' }, 400);
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const lockEndIso = new Date(now + MIN_LOCK_DAYS * MS_PER_DAY).toISOString();
  const termEndIso = new Date(now + product.term_days * MS_PER_DAY).toISOString();
  const posId = uuid();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO staking_positions
        (id, user_id, product_id, coin_symbol, kind, apr, principal,
         accrued_interest, status, lock_days,
         principal_usd, daily_rate, term_days, accrued_dividend_usd,
         paid_dividend_qta, payout_coin, lock_end_at, term_end_at,
         last_accrued_at, created_at)
       VALUES (?,?,?, 'USDT','fixed', ?, ?, 0, 'active', ?,
               ?,?,?,0, 0, 'QTA', ?,?, ?, ?)`
    ).bind(posId, user.id, product.id, product.total_return || (product.daily_rate * product.term_days),
           amountUsd, product.term_days,
           amountUsd, product.daily_rate, product.term_days,
           lockEndIso, termEndIso, nowIso, nowIso),
    c.env.DB.prepare(
      `UPDATE staking_products SET total_staked = COALESCE(total_staked,0) + ?, updated_at = ?
        WHERE id = ?`
    ).bind(amountUsd, nowIso, product.id),
  ]);

  return c.json({ ok: true, position_id: posId, lock_end_at: lockEndIso, term_end_at: termEndIso });
});

// --------------------------------------------------------------------------
// POST /claim { position_id }
// Credits accrued QTA dividend WITHOUT closing the position (allowed anytime
// after the 90-day lock). Pays referral match on the credited amount.
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
  if (pos.lock_end_at && Date.parse(pos.lock_end_at) > now) {
    return c.json({ error: 'Dividend is locked for the first 90 days', lock_end_at: pos.lock_end_at }, 400);
  }

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
// Closes a position. Before 90 days: forfeit dividend + 30% principal penalty
// (70% USDT returned). After 90 days: pay remaining dividend as QTA + return
// full USDT principal.
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
  const isEarly = pos.lock_end_at ? Date.parse(pos.lock_end_at) > now : false;

  // Claim-first status flip.
  const claim = await c.env.DB.prepare(
    `UPDATE staking_positions SET status = 'redeemed', redeemed_at = ?, last_accrued_at = ?
      WHERE id = ? AND status = 'active'`
  ).bind(nowIso, nowIso, positionId).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ error: 'Already redeemed' }, 409);
  }

  let returnedUsd: number;
  let dividendQta = 0;
  let penaltyUsd = 0;

  if (isEarly) {
    // Forfeit all dividend, 30% principal penalty.
    penaltyUsd = principalUsd * EARLY_PENALTY;
    returnedUsd = principalUsd - penaltyUsd;
  } else {
    // Pay remaining unpaid dividend as QTA + full principal back.
    const totalUsd = accruedUsd(pos, now);
    const paidUsd = pos.accrued_dividend_usd || 0;
    const payableUsd = Math.max(0, totalUsd - paidUsd);
    dividendQta = payableUsd / price;
    returnedUsd = principalUsd;

    if (dividendQta > 0) {
      await creditQta(c, user.id, dividendQta);
      await c.env.DB.prepare(
        `INSERT INTO staking_dividends (id, position_id, user_id, kind, usd_amount, qta_amount, qta_price)
         VALUES (?,?,?, 'dividend', ?,?,?)`
      ).bind(uuid(), positionId, user.id, payableUsd, dividendQta, price).run();
      await payReferralMatch(c, user.id, payableUsd, price, positionId);
    }
  }

  // Return USDT principal (net of any early penalty) to available.
  const upd = await c.env.DB.prepare(
    `UPDATE wallets SET available = available + ?
      WHERE user_id = ? AND coin_symbol = 'USDT'`
  ).bind(returnedUsd, user.id).run();
  if (!upd.meta || upd.meta.changes === 0) {
    await c.env.DB.prepare(
      `INSERT INTO wallets (id, user_id, coin_symbol, available, available_initial)
       VALUES (?,?, 'USDT', ?, 0)`
    ).bind(uuid(), user.id, returnedUsd).run();
  }

  await c.env.DB.prepare(
    `UPDATE staking_products SET total_staked = MAX(0, COALESCE(total_staked,0) - ?), updated_at = ?
      WHERE id = ?`
  ).bind(principalUsd, nowIso, pos.product_id).run();

  return c.json({
    ok: true, early: isEarly,
    returned_usdt: returnedUsd, penalty_usdt: penaltyUsd,
    dividend_qta: dividendQta, qta_price: price,
  });
});

// --------------------------------------------------------------------------
// POST /withdraw-dividend { amount_qta }
// Withdraws staking-dividend QTA. 100-QTA increments, flat 5% fee.
// Creates a normal QTA withdrawal request (operator pays out manually).
// --------------------------------------------------------------------------
app.post('/withdraw-dividend', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const amountQta = Number(body.amount_qta);
  const address = String(body.address || '').trim();

  if (!isFinite(amountQta) || amountQta <= 0) return c.json({ error: 'Invalid amount' }, 400);
  if (amountQta % WITHDRAW_UNIT_QTA !== 0) {
    return c.json({ error: `Amount must be in ${WITHDRAW_UNIT_QTA}-QTA increments` }, 400);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return c.json({ error: 'Valid Quantarium (0x...) address required' }, 400);
  }

  const fee = amountQta * WITHDRAW_FEE;    // 5%
  const net = amountQta - fee;             // e.g. 95 on 100

  // Atomically lock the requested QTA from available.
  const lock = await c.env.DB.prepare(
    `UPDATE wallets SET available = available - ?, locked = COALESCE(locked,0) + ?
      WHERE user_id = ? AND coin_symbol = 'QTA' AND available >= ?`
  ).bind(amountQta, amountQta, user.id, amountQta).run();
  if (!lock.meta || lock.meta.changes === 0) {
    return c.json({ error: 'Insufficient QTA balance' }, 400);
  }

  const id = uuid();
  const nowIso = new Date().toISOString();
  // Record as a QTA withdrawal (manual-withdrawal mode; operator settles).
  // amount/fee are TEXT columns in qta_withdrawals — store as strings.
  await c.env.DB.prepare(
    `INSERT INTO qta_withdrawals
       (id, user_id, asset, amount, fee, to_address, status, network, created_at)
     VALUES (?,?, 'QTA', ?, ?, ?, 'pending', 'qta-mainnet', ?)`
  ).bind(id, user.id, String(net), String(fee), address, nowIso).run();

  return c.json({ ok: true, withdrawal_id: id, requested_qta: amountQta, fee_qta: fee, net_qta: net });
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
