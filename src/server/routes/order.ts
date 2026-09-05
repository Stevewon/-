import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { getUserFeeTier, recordFeeLedger, type FeeTier } from '../utils/fees';
import { getRiskState } from '../lib/risk';

const app = new Hono<AppEnv>();

// 100 orders / minute / IP — tight enough to stop order-book spam,
// loose enough for real usage.
const rlPlaceOrder = rateLimit({ key: 'order:place', max: 100, windowSec: 60 });

function uuid() {
  return crypto.randomUUID();
}

// Floor a number to N decimal places (avoids FP drift like 0.1 + 0.2).
function floorToDecimals(n: number, decimals: number): number {
  if (!isFinite(n)) return 0;
  const d = Math.max(0, Math.min(18, decimals | 0));
  const p = Math.pow(10, d);
  return Math.floor(n * p) / p;
}

// Place order — KYC is NOT required for trading (buy/sell).
// KYC is enforced ONLY on withdrawals (see routes/wallet.ts).
// SELL policy is unchanged: QTA daily sell cap for regular members,
// company account exempt (see check below).
app.post('/', authMiddleware, rlPlaceOrder, async (c) => {
  // Phase F: global circuit breaker. When admin flips this on (Risk tab),
  // all *new* order placement halts immediately; existing resting orders
  // remain on the book and can still be cancelled by the user.
  const risk = await getRiskState(c);
  if (risk.circuit_breaker.enabled) {
    return c.json(
      {
        error: 'Trading temporarily halted by exchange operator',
        reason: risk.circuit_breaker.reason || null,
        circuit_breaker: true,
      },
      503,
    );
  }

  const user = c.get('user');
  const body = await c.req.json();
  let { market_symbol, side, type, price, amount, time_in_force, stop_price } = body;
  if (!market_symbol || typeof market_symbol !== 'string') {
    return c.json({ error: 'Invalid market_symbol' }, 400);
  }
  const [base, quote] = market_symbol.split('-');
  if (!base || !quote) return c.json({ error: 'Invalid market_symbol' }, 400);

  const market = await c.env.DB.prepare('SELECT * FROM markets WHERE base_coin = ? AND quote_coin = ? AND is_active = 1').bind(base, quote).first() as any;
  if (!market) return c.json({ error: 'Market not found' }, 404);

  if (!['buy', 'sell'].includes(side)) return c.json({ error: 'Invalid side' }, 400);
  if (!['limit', 'market', 'stop_limit'].includes(type)) return c.json({ error: 'Invalid type' }, 400);

  // S3-3: Stop-Limit validation. `price` is the limit price once triggered,
  // `stop_price` is the trigger level. Both required, both positive.
  let stopPriceVal: number | null = null;
  if (type === 'stop_limit') {
    stopPriceVal = Number(stop_price);
    if (!isFinite(stopPriceVal) || stopPriceVal <= 0) {
      return c.json({ error: 'stop_price required for stop_limit order' }, 400);
    }
  }

  // S3-4 Time-In-Force. Default GTC for backward-compat. Market orders are
  // always IOC semantics by nature, so normalise any explicit value here.
  const tifRaw = (time_in_force == null ? 'GTC' : String(time_in_force)).toUpperCase();
  if (!['GTC', 'IOC', 'FOK', 'POST_ONLY'].includes(tifRaw)) {
    return c.json({ error: 'Invalid time_in_force (GTC|IOC|FOK|POST_ONLY)' }, 400);
  }
  if (type === 'market' && (tifRaw === 'POST_ONLY' || tifRaw === 'GTC' || tifRaw === 'FOK')) {
    // Market orders inherently cannot rest in the book or require atomic
    // fill against an unknown price. Only IOC is meaningful.
    if (tifRaw !== 'GTC') {
      return c.json({ error: 'Market orders only support IOC time_in_force' }, 400);
    }
    // Upgrade implicit GTC for market → IOC (existing behaviour already
    // cancels any unfilled market remainder, this just names it).
  }
  const tif: 'GTC' | 'IOC' | 'FOK' | 'POST_ONLY' =
    type === 'market' ? 'IOC' : (tifRaw as any);

  // Numeric coercion (frontend may send strings)
  amount = Number(amount);
  if (price != null) price = Number(price);
  if (!isFinite(amount) || amount <= 0) return c.json({ error: 'Invalid amount' }, 400);
  const isPricedOrder = type === 'limit' || type === 'stop_limit';
  if (isPricedOrder && (!isFinite(price) || price <= 0)) {
    return c.json({ error: 'Price required for limit/stop_limit order' }, 400);
  }

  // -------- Decimals & minimum-order validation --------
  amount = floorToDecimals(amount, market.amount_decimals);
  if (isPricedOrder) price = floorToDecimals(price, market.price_decimals);
  if (type === 'stop_limit' && stopPriceVal != null) {
    stopPriceVal = floorToDecimals(stopPriceVal, market.price_decimals);
    if (stopPriceVal <= 0) return c.json({ error: 'Invalid stop_price precision' }, 400);
  }
  if (amount <= 0) return c.json({ error: 'Amount too small for market precision' }, 400);

  if (amount < market.min_order_amount) {
    return c.json({ error: `Minimum order amount is ${market.min_order_amount} ${base}` }, 400);
  }
  if (isPricedOrder) {
    const notional = price * amount;
    if (notional < market.min_order_total) {
      return c.json({ error: `Minimum order total is ${market.min_order_total} ${quote}` }, 400);
    }
  }

  // ============================================================================
  // QTA SELL POLICY (owner rule 2026-09-05, "가" 방식) — NO up-front rejection.
  // ----------------------------------------------------------------------------
  // Previous behaviour REJECTED any QTA sell that would exceed the daily 50,000
  // KRW cap. The owner changed this: a member may PLACE a QTA sell of any size;
  // it is simply accepted and rests on the book. The COMPANY (mm-bot) only BUYS
  // FROM a member up to KRW 50,000/day PER MEMBER (valued at the fixed 1,450
  // KRW/USDT rate → 50000/1450 ≈ 34.48 USDT). Anything above that stays UNFILLED
  // on the book until the member cancels it themselves (leftover 방치). That
  // per-member company-buy cap is enforced in the mm-bot tick (qta-mm-tick),
  // NOT here, so placing the order never fails. Company account stays exempt as
  // a seller. (See USDT_KRW_RATE / MM_MEMBER_BUY_BUDGET_USDT below.)
  // ============================================================================
  const isCompanyAccount = user.role === 'admin' || user.email === 'admin@quantaex.io';
  void isCompanyAccount; // reserved (company seller exemption handled elsewhere)

  // ============================================================================
  // Balance check & lock
  // ----------------------------------------------------------------------------
  // For LIMIT orders we know the exact cost up-front and lock accordingly.
  // For MARKET orders we use an estimated worst-case cost derived from the
  // current best ask (buy) / best bid (sell) so the user can't over-commit.
  // Any un-used locked funds are refunded by matchOrder() after execution.
  // ============================================================================
  // S3-5: resolve the taker's current fee tier once, so the lock calculation
  // uses the actual discounted rate instead of the market default.
  const takerTier = await getUserFeeTier(c.env.DB, user.id, {
    maker_fee: market.maker_fee,
    taker_fee: market.taker_fee,
  });

  let lockAmount = 0;
  let lockSymbol = '';

  if (side === 'buy') {
    lockSymbol = quote;
    if (isPricedOrder) {
      // For stop_limit we lock on the limit price (what we'll actually pay
      // once triggered), not on the stop trigger price.
      lockAmount = price * amount * (1 + takerTier.taker_fee);
    } else {
      // Market buy: estimate using best-ask (+20% safety cushion) and coin
      // reference price as fallback. This prevents locking the entire wallet
      // balance, which previously froze user funds when no sell orders
      // were available.
      const bestAsk = await c.env.DB.prepare(
        `SELECT MIN(price) AS p FROM orders
         WHERE market_id = ? AND side = 'sell' AND status IN ('open','partial')`
      ).bind(market.id).first() as any;
      const refPrice = await c.env.DB.prepare(
        'SELECT price_usd FROM coins WHERE symbol = ?'
      ).bind(base).first() as any;
      const estPrice = (bestAsk?.p && bestAsk.p > 0)
        ? bestAsk.p
        : (refPrice?.price_usd && refPrice.price_usd > 0 ? refPrice.price_usd : 0);
      if (!estPrice || estPrice <= 0) {
        return c.json({ error: 'Market price unavailable; use a limit order' }, 400);
      }
      // Enforce min_order_total for market buys too (estimated notional)
      if (estPrice * amount < market.min_order_total) {
        return c.json({ error: `Minimum order total is ${market.min_order_total} ${quote}` }, 400);
      }
      // 20% safety buffer so slippage doesn't short-lock
      lockAmount = estPrice * amount * 1.2 * (1 + takerTier.taker_fee);
    }

    // ★ A1 fix: atomic conditional debit. The `AND available >= ?` guard makes
    //   the balance check + debit a single indivisible operation, so two
    //   concurrent orders can never both pass and over-commit the wallet.
    const res = await c.env.DB.prepare(
      'UPDATE wallets SET available = available - ?, locked = locked + ? ' +
      'WHERE user_id = ? AND coin_symbol = ? AND available >= ?'
    ).bind(lockAmount, lockAmount, user.id, quote, lockAmount).run();
    if (!res.meta || res.meta.changes === 0) return c.json({ error: 'Insufficient balance' }, 400);
  } else {
    lockSymbol = base;
    lockAmount = amount;
    // ★ A1 fix: atomic conditional debit (see buy-side note above).
    const res = await c.env.DB.prepare(
      'UPDATE wallets SET available = available - ?, locked = locked + ? ' +
      'WHERE user_id = ? AND coin_symbol = ? AND available >= ?'
    ).bind(amount, amount, user.id, base, amount).run();
    if (!res.meta || res.meta.changes === 0) return c.json({ error: 'Insufficient balance' }, 400);
  }

  const orderId = uuid();
  const orderPrice = type === 'market' ? null : price;

  // S3-3: Stop-limit orders start in 'pending' status until their trigger
  // level is crossed by a subsequent trade. Funds are still locked so the
  // user can't double-spend the balance.
  const initialStatus = type === 'stop_limit' ? 'pending' : 'open';

  await c.env.DB.prepare(
    `INSERT INTO orders
       (id, user_id, market_id, side, type, price, amount, remaining, total,
        time_in_force, taker_fee_locked, maker_fee_locked,
        stop_price, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    orderId, user.id, market.id, side, type, orderPrice,
    amount, amount, (orderPrice || 0) * amount, tif,
    takerTier.taker_fee, takerTier.maker_fee,
    stopPriceVal, initialStatus,
  ).run();

  if (type === 'stop_limit') {
    // No immediate match. Return the pending order. Check for immediate
    // trigger against the last trade price in case the stop is already
    // crossed at submission time.
    const lastTrade = await c.env.DB.prepare(
      'SELECT price FROM trades WHERE market_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(market.id).first<{ price: number }>().catch(() => null);
    if (lastTrade?.price && stopPriceVal != null) {
      const shouldTrigger =
        (side === 'buy'  && Number(lastTrade.price) >= stopPriceVal) ||
        (side === 'sell' && Number(lastTrade.price) <= stopPriceVal);
      if (shouldTrigger) {
        const triggered = await triggerAndMatch(c.env.DB, orderId, market, { lockAmount, lockSymbol, tif });
        return c.json({
          order: triggered.order,
          trades: triggered.trades.map((t: any) => ({ id: t.id, price: t.price, amount: t.amount, total: t.total })),
          tif_rejected: triggered.tifRejected || undefined,
          triggered: true,
        });
      }
    }
    const pending = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    return c.json({ order: pending, trades: [], pending: true });
  }

  // Match order (passes lockAmount so unused funds are refunded).
  // `tif` drives FOK preflight / POST_ONLY guard / IOC cancel-on-remain.
  const result = await matchOrder(c.env.DB, orderId, market, { lockAmount, lockSymbol, tif });

  // S3-3: after any real trade we may have crossed pending stop-limits on
  // this market. Trigger them (lock info unknown here → use stored snapshot).
  if (result.trades.length > 0) {
    const lastPrice = result.trades[result.trades.length - 1].price;
    try {
      await checkAndTriggerStops(c.env.DB, market, lastPrice);
    } catch (e) { console.warn('[stop-trigger] failed:', e); }
  }

  return c.json({
    order: result.order,
    trades: result.trades.map((t: any) => ({ id: t.id, price: t.price, amount: t.amount, total: t.total })),
    tif_rejected: result.tifRejected || undefined,
  });
});

// Cancel order
app.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(c.req.param('id'), user.id).first() as any;
  if (!order) return c.json({ error: 'Order not found' }, 404);
  if (!['open', 'partial', 'pending'].includes(order.status)) return c.json({ error: 'Order cannot be cancelled' }, 400);

  const market = await c.env.DB.prepare('SELECT * FROM markets WHERE id = ?').bind(order.market_id).first() as any;

  // Validate buy-side price BEFORE we flip the status (so a bad row doesn't get
  // stuck in 'cancelled' with no refund). Only limit orders reach here with a
  // cancellable status; market orders always finalise inside matchOrder.
  if (order.side === 'buy' && (!order.price || order.price <= 0)) {
    return c.json({ error: 'Cannot cancel: invalid order price' }, 400);
  }

  // ★ RACE FIX (2026-08-30): flip the status to 'cancelled' ATOMICALLY FIRST,
  //   guarded by the current status. Only the request whose UPDATE actually
  //   changed a row (changes === 1) is the "winner" and proceeds to refund the
  //   locked funds. A second concurrent cancel sees changes === 0 and returns
  //   409 WITHOUT refunding — so the lock can never be released (double-
  //   refunded) twice. Previously the refund ran before the status flip with
  //   no atomic guard, so two overlapping cancels could both refund.
  const flip = await c.env.DB.prepare(
    "UPDATE orders SET status = 'cancelled', updated_at = datetime('now') " +
    "WHERE id = ? AND status IN ('open','partial','pending')"
  ).bind(order.id).run();
  if (!flip.meta || flip.meta.changes === 0) {
    return c.json({ error: 'Order already processed' }, 409);
  }

  // Unlock remaining funds. We are the sole winner of the atomic flip above,
  // so this refund runs exactly once for this order.
  if (order.side === 'buy') {
    // S3-5: use the fee rate snapshotted at placement so we refund exactly
    // what was locked, even if the user's tier has since changed.
    const lockedRate = order.taker_fee_locked != null ? order.taker_fee_locked : market.taker_fee;
    const unlockAmount = order.remaining * order.price * (1 + lockedRate);
    await c.env.DB.prepare('UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?')
      .bind(unlockAmount, unlockAmount, user.id, market.quote_coin).run();
  } else {
    await c.env.DB.prepare('UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?')
      .bind(order.remaining, order.remaining, user.id, market.base_coin).run();
  }

  return c.json({ message: 'Order cancelled' });
});

// Get user's orders
app.get('/my', authMiddleware, async (c) => {
  const user = c.get('user');
  const status = c.req.query('status');
  const market = c.req.query('market');

  let sql = `SELECT o.*, m.base_coin, m.quote_coin FROM orders o JOIN markets m ON m.id = o.market_id WHERE o.user_id = ?`;
  const params: any[] = [user.id];

  if (status === 'open') {
    // S3-3: pending = stop order waiting for its trigger. Show alongside open/partial.
    sql += ` AND o.status IN ('open','partial','pending')`;
  } else if (status === 'closed') {
    sql += ` AND o.status IN ('filled','cancelled')`;
  }
  if (market) {
    const [b, q] = market.split('-');
    sql += ` AND m.base_coin = ? AND m.quote_coin = ?`;
    params.push(b, q);
  }

  sql += ' ORDER BY o.created_at DESC LIMIT 100';
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(results);
});

// Get user's trades
app.get('/my/trades', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(`
    SELECT t.*, m.base_coin, m.quote_coin,
      CASE WHEN t.buyer_id = ? THEN 'buy' ELSE 'sell' END as side
    FROM trades t JOIN markets m ON m.id = t.market_id
    WHERE t.buyer_id = ? OR t.seller_id = ?
    ORDER BY t.created_at DESC LIMIT 100
  `).bind(user.id, user.id, user.id).all();
  return c.json(results);
});

// ============================================================================
// 🛡️ QTA 24h PRICE FLOOR (owner rule 2026-09-05)
// ----------------------------------------------------------------------------
// "24h 평균 이하 가격에서는 어떤 매도도 체결 안 된다." Prevents a wash-trader from
// crashing the QTA price by selling at 1 KRW and buying it all back at 1 KRW.
//   • floor = the PRIOR KST calendar day's volume-weighted avg trade price
//             (SUM(total) / SUM(amount) over trades in that day).
//   • If the prior day had NO trades (fresh market), fall back to the coin's
//     managed price_center.
// Applied ONLY to the QTA base market. Any prospective trade whose price is
// BELOW this floor is SKIPPED in matchOrder (so both member↔member and
// member↔mm-bot fills at sub-floor prices are refused; the order just rests).
// Cached per matchOrder pass via the caller.
// ============================================================================
async function qtaPriceFloor(DB: D1Database, market: any): Promise<number> {
  if (market.base_coin !== 'QTA') return 0; // no floor on other markets
  // Prior KST calendar day window [yesterday 00:00 KST, today 00:00 KST) in UTC.
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const todayKstMidnightUtcMs =
    Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()) - 9 * 3600 * 1000;
  const yestKstMidnightUtcMs = todayKstMidnightUtcMs - 24 * 3600 * 1000;
  const dayStart = new Date(yestKstMidnightUtcMs).toISOString().slice(0, 19).replace('T', ' ');
  const dayEnd = new Date(todayKstMidnightUtcMs).toISOString().slice(0, 19).replace('T', ' ');

  const row = await DB.prepare(
    `SELECT COALESCE(SUM(total),0) AS t, COALESCE(SUM(amount),0) AS a
       FROM trades
      WHERE market_id = ? AND created_at >= ? AND created_at < ?`
  ).bind(market.id, dayStart, dayEnd).first<{ t: number; a: number }>().catch(() => null);

  const t = Number(row?.t || 0);
  const a = Number(row?.a || 0);
  if (a > 0 && t > 0) return t / a; // prior-day volume-weighted average price

  // Fallback: managed center price (or 0 = no floor if not managed).
  const coin = await DB.prepare(
    "SELECT price_mode, price_center FROM coins WHERE symbol = 'QTA'"
  ).first<{ price_mode: string; price_center: number }>().catch(() => null);
  if (coin?.price_mode === 'managed' && Number(coin.price_center) > 0) {
    return Number(coin.price_center);
  }
  return 0;
}

// Matching engine for D1.
//
// `lockInfo` carries the amount/symbol that the caller pre-locked when the
// order was created. Any portion of that lock that doesn't get consumed by
// actual trades (e.g. a market order with no liquidity, or a limit buy with
// safety-buffered lock) is refunded to `available` at the end so user funds
// never stay frozen.
async function matchOrder(
  DB: D1Database,
  orderId: string,
  market: any,
  lockInfo?: { lockAmount: number; lockSymbol: string; tif?: 'GTC' | 'IOC' | 'FOK' | 'POST_ONLY' }
) {
  const order = await DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first() as any;
  const trades: any[] = [];
  const tif: 'GTC' | 'IOC' | 'FOK' | 'POST_ONLY' =
    (lockInfo?.tif as any) || order.time_in_force || 'GTC';
  let tifRejected: string | null = null;

  const oppositeSide = order.side === 'buy' ? 'sell' : 'buy';
  const priceOrder = order.side === 'buy' ? 'ASC' : 'DESC';
  const priceCondition = order.type === 'limit'
    ? (order.side === 'buy' ? `AND price <= ${order.price}` : `AND price >= ${order.price}`)
    : '';

  // 🛡️ Self-Trade Prevention (STP): never match against the taker's own
  // open orders. Without this filter a single user could fake volume and
  // move price by placing buys and sells from the same account.
  const { results: matchingOrders } = await DB.prepare(
    `SELECT * FROM orders
     WHERE market_id = ? AND side = ? AND status IN ('open','partial')
       AND user_id != ?
       ${priceCondition}
     ORDER BY price ${priceOrder}, created_at ASC LIMIT 50`
  ).bind(market.id, oppositeSide, order.user_id).all();

  // S3-4 POST_ONLY: maker-only. If any order on the opposite side would cross
  // (ie. the book has liquidity at our limit price or better), cancel without
  // trading so the order never becomes a taker. POST_ONLY is limit-only.
  if (tif === 'POST_ONLY' && order.type === 'limit' && (matchingOrders as any[]).length > 0) {
    tifRejected = 'POST_ONLY: order would cross the book';
    await DB.prepare(
      "UPDATE orders SET status = 'cancelled', remaining = 0, updated_at = datetime('now') WHERE id = ?"
    ).bind(order.id).run();
    // Refund the whole lock (no trade happened).
    if (lockInfo && lockInfo.lockAmount > 0) {
      await DB.prepare(
        'UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?'
      ).bind(lockInfo.lockAmount, lockInfo.lockAmount, order.user_id, lockInfo.lockSymbol).run();
    }
    const updated = await DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    return { order: updated, trades, tifRejected };
  }

  // S3-4 FOK: Fill-Or-Kill. Walk the book without mutating to see whether we
  // could fully fill right now; if not, cancel the whole order atomically.
  if (tif === 'FOK') {
    let available = 0;
    for (const m of matchingOrders as any[]) {
      available += Number(m.remaining);
      if (available >= order.amount) break;
    }
    if (available < order.amount) {
      tifRejected = 'FOK: insufficient liquidity to fully fill';
      await DB.prepare(
        "UPDATE orders SET status = 'cancelled', remaining = 0, updated_at = datetime('now') WHERE id = ?"
      ).bind(order.id).run();
      if (lockInfo && lockInfo.lockAmount > 0) {
        await DB.prepare(
          'UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?'
        ).bind(lockInfo.lockAmount, lockInfo.lockAmount, order.user_id, lockInfo.lockSymbol).run();
      }
      const updated = await DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
      return { order: updated, trades, tifRejected };
    }
  }

  let remaining = order.remaining;

  // Track how much of the taker's locked quote was actually consumed
  // (only relevant for buy orders, where the lock is in quote currency).
  let quoteConsumed = 0;

  // S3-5: Cache fee-tier lookups per user for this single match pass so
  // we don't hit the DB once per opposite order.
  const tierCache = new Map<string, FeeTier>();
  async function tierFor(userId: string): Promise<FeeTier> {
    const cached = tierCache.get(userId);
    if (cached) return cached;
    const t = await getUserFeeTier(DB, userId, {
      maker_fee: market.maker_fee,
      taker_fee: market.taker_fee,
    });
    tierCache.set(userId, t);
    return t;
  }

  // Snapshot of coin USD prices for ledger's fee_usd column (best-effort).
  const baseUsd = await DB.prepare('SELECT price_usd FROM coins WHERE symbol = ?')
    .bind(market.base_coin).first<{ price_usd: number }>().catch(() => null);
  const quoteUsd = await DB.prepare('SELECT price_usd FROM coins WHERE symbol = ?')
    .bind(market.quote_coin).first<{ price_usd: number }>().catch(() => null);

  // 🛡️ QTA 24h floor: no trade may execute BELOW this price (owner 2026-09-05).
  // 0 = no floor (non-QTA markets or managed center unavailable).
  const priceFloor = await qtaPriceFloor(DB, market);

  for (const match of matchingOrders as any[]) {
    if (remaining <= 0) break;

    const tradeAmount = Math.min(remaining, match.remaining);
    const tradePrice = match.price;

    // 🛡️ Refuse any fill BELOW the 24h floor (owner 2026-09-05). The maker
    // order stays on the book; the taker keeps its remaining (rests, or is
    // refunded if market/IOC). Blocks sub-floor wash-trade price crashes.
    //   • BUY taker: asks scanned cheapest-first, so a sub-floor ask is CHEAPER
    //     than valid ones — SKIP it (continue) and keep looking at pricier asks
    //     that may be ≥ floor.  (Do NOT break, that would drop valid asks.)
    //   • SELL taker: bids scanned highest-first, so once a bid is sub-floor
    //     every remaining bid is too → STOP (break).
    if (priceFloor > 0 && tradePrice < priceFloor - 1e-12) {
      if (order.side === 'buy') continue;
      break;
    }

    const tradeTotal = tradePrice * tradeAmount;

    // Taker = the newly placed `order`; maker = the resting `match`.
    // Use the fee rates snapshotted when each order was placed (falling
    // back to the market default for pre-S3-5 orders that predate the
    // *_fee_locked columns). This keeps refund/charge symmetric.
    const takerTaker = order.taker_fee_locked != null
      ? Number(order.taker_fee_locked)
      : (await tierFor(order.user_id)).taker_fee;
    const makerMaker = match.maker_fee_locked != null
      ? Number(match.maker_fee_locked)
      : (await tierFor(match.user_id)).maker_fee;

    const buyerFeeRate  = order.side === 'buy' ? takerTaker : makerMaker;
    const sellerFeeRate = order.side === 'sell' ? takerTaker : makerMaker;
    const buyerFee  = tradeTotal * buyerFeeRate;
    const sellerFee = tradeTotal * sellerFeeRate;

    const tradeId = uuid();
    const buyOrderId  = order.side === 'buy'  ? order.id : match.id;
    const sellOrderId = order.side === 'sell' ? order.id : match.id;
    const buyerId     = order.side === 'buy'  ? order.user_id : match.user_id;
    const sellerId    = order.side === 'sell' ? order.user_id : match.user_id;

    // Insert trade
    await DB.prepare(
      'INSERT INTO trades (id, market_id, buy_order_id, sell_order_id, buyer_id, seller_id, price, amount, total, buyer_fee, seller_fee) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(tradeId, market.id, buyOrderId, sellOrderId, buyerId, sellerId, tradePrice, tradeAmount, tradeTotal, buyerFee, sellerFee).run();

    // Update maker order
    const makerRemaining = match.remaining - tradeAmount;
    const makerFilled = (match.filled || 0) + tradeAmount;
    const makerStatus = makerRemaining <= 0 ? 'filled' : 'partial';
    await DB.prepare("UPDATE orders SET filled = ?, remaining = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(makerFilled, makerRemaining, makerStatus, match.id).run();

    // Transfer funds - buyer gets base coin
    await addBalance(DB, buyerId, market.base_coin, tradeAmount);
    await subtractLocked(DB, buyerId, market.quote_coin, tradeTotal + buyerFee);

    // Seller gets quote coin
    await addBalance(DB, sellerId, market.quote_coin, tradeTotal - sellerFee);
    await subtractLocked(DB, sellerId, market.base_coin, tradeAmount);

    if (order.side === 'buy') quoteConsumed += tradeTotal + buyerFee;

    trades.push({ id: tradeId, price: tradePrice, amount: tradeAmount, total: tradeTotal });
    remaining -= tradeAmount;

    // S3-5: append fee-ledger rows for BOTH sides. Best-effort — never
    // rolls back the trade on failure (helper swallows its own errors).
    const buyerTier  = order.side === 'buy'  ? await tierFor(buyerId)  : await tierFor(buyerId);
    const sellerTier = order.side === 'sell' ? await tierFor(sellerId) : await tierFor(sellerId);
    await recordFeeLedger(DB, [
      {
        trade_id: tradeId,
        user_id: buyerId,
        role: order.side === 'buy' ? 'taker' : 'maker',
        side: 'buy',
        market_id: market.id,
        fee_coin: market.quote_coin,        // buyer pays fee in quote
        fee_amount: buyerFee,
        fee_rate: buyerFeeRate,
        fee_usd: (quoteUsd?.price_usd || 0) > 0 ? buyerFee * Number(quoteUsd!.price_usd) : null,
        tier: buyerTier.tier,
      },
      {
        trade_id: tradeId,
        user_id: sellerId,
        role: order.side === 'sell' ? 'taker' : 'maker',
        side: 'sell',
        market_id: market.id,
        fee_coin: market.quote_coin,        // seller's fee is deducted from quote payout
        fee_amount: sellerFee,
        fee_rate: sellerFeeRate,
        fee_usd: (quoteUsd?.price_usd || 0) > 0 ? sellerFee * Number(quoteUsd!.price_usd) : null,
        tier: sellerTier.tier,
      },
    ]);
  }
  // Touch-up: keep linter happy — baseUsd is captured above purely for
  // future extension (e.g. sellers paying fee in base). Reference it.
  void baseUsd;

  // Update taker order.
  // S3-4: IOC cancels any leftover after matching (never rests in book).
  // Market orders have always behaved this way; IOC extends the semantics
  // to limit orders too. GTC keeps the previous "open / partial" behaviour.
  const filled = order.amount - remaining;
  const iocUnfilled = tif === 'IOC' && remaining > 0;
  let status: string;
  if (remaining <= 0) {
    status = 'filled';
  } else if (order.type === 'market' || iocUnfilled) {
    status = 'cancelled';
  } else if (filled > 0) {
    status = 'partial';
  } else {
    status = 'open';
  }
  if (iocUnfilled && filled === 0) tifRejected = 'IOC: no liquidity at limit price';
  await DB.prepare("UPDATE orders SET filled = ?, remaining = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(filled, remaining, status, order.id).run();

  // ============================================================================
  // 🔒 Refund unused locks (critical: prevents stuck balances)
  // ----------------------------------------------------------------------------
  // - For LIMIT orders that stay `open` we keep the lock for the remaining qty
  //   (the cancel handler will refund it if the user cancels later).
  // - For MARKET orders (status 'filled' or 'cancelled' here) and any LIMIT
  //   order that is fully filled, we compute the leftover and move it back
  //   from `locked` to `available` in the same wallet.
  // ============================================================================
  if (lockInfo && lockInfo.lockAmount > 0) {
    if (order.side === 'buy') {
      // LIMIT open: the matching engine has already reduced `locked` by the
      // consumed portion (tradeTotal + buyerFee per trade). No refund needed
      // while the order remains open — the rest corresponds to `remaining`.
      if (order.type === 'market' || status === 'filled' || status === 'cancelled') {
        const refund = Math.max(0, lockInfo.lockAmount - quoteConsumed);
        if (refund > 0) {
          await DB.prepare(
            'UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?'
          ).bind(refund, refund, order.user_id, lockInfo.lockSymbol).run();
        }
      }
    } else {
      // Sell side: lock is in base coin, equals `amount`. The matching engine
      // reduces locked per trade. For market sells that end in 'cancelled'
      // with no fills (or partial fills), refund the untraded remainder.
      if ((order.type === 'market' || status === 'filled' || status === 'cancelled') && remaining > 0) {
        await DB.prepare(
          'UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?'
        ).bind(remaining, remaining, order.user_id, lockInfo.lockSymbol).run();
      }
    }
  }

  // Update candles if trades happened
  if (trades.length > 0) {
    const lastPrice = trades[trades.length - 1].price;
    await updateCandles(DB, market.id, trades);
    if (market.quote_coin === 'USDT') {
      // 🛡️ REF-PRICE GUARD (취약점#1): never let a single (possibly colluding)
      // trade push the coin's reference price outside its managed band. For a
      // `managed` coin we clamp the new reference price to [center*(1-band),
      // center*(1+band)]; for a normal (market-driven) coin we leave lastPrice
      // untouched. STP only blocks same-account wash trades — two cooperating
      // accounts could still cross at a band-edge price and drag the oracle,
      // so we clamp here at the write boundary.
      let refPrice = lastPrice;
      const coinRow = await DB.prepare(
        'SELECT price_mode, price_center, price_band_pct FROM coins WHERE symbol = ?'
      ).bind(market.base_coin).first<any>().catch(() => null);
      if (coinRow?.price_mode === 'managed' && Number(coinRow.price_center) > 0) {
        const band = Math.max(0, Number(coinRow.price_band_pct) || 0) / 100;
        const center = Number(coinRow.price_center);
        const lo = center * (1 - band);
        const hi = center * (1 + band);
        if (refPrice < lo) refPrice = lo;
        if (refPrice > hi) refPrice = hi;
      }
      await DB.prepare('UPDATE coins SET price_usd = ? WHERE symbol = ?').bind(refPrice, market.base_coin).run();
    }
  }

  const updatedOrder = await DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  return { order: updatedOrder, trades, tifRejected };
}

async function addBalance(DB: D1Database, userId: string, coinSymbol: string, amount: number) {
  const wallet = await DB.prepare('SELECT id FROM wallets WHERE user_id = ? AND coin_symbol = ?').bind(userId, coinSymbol).first() as any;
  if (wallet) {
    await DB.prepare('UPDATE wallets SET available = available + ? WHERE id = ?').bind(amount, wallet.id).run();
  } else {
    await DB.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available) VALUES (?,?,?,?)').bind(uuid(), userId, coinSymbol, amount).run();
  }
}

async function subtractLocked(DB: D1Database, userId: string, coinSymbol: string, amount: number) {
  await DB.prepare('UPDATE wallets SET locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?').bind(amount, userId, coinSymbol).run();
}

async function updateCandles(DB: D1Database, marketId: string, trades: any[]) {
  const intervals: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
  const now = Math.floor(Date.now() / 1000);
  const lastPrice = trades[trades.length - 1].price;
  const highPrice = Math.max(...trades.map((t: any) => t.price));
  const lowPrice = Math.min(...trades.map((t: any) => t.price));
  const totalVolume = trades.reduce((s: number, t: any) => s + t.amount, 0);

  for (const [interval, seconds] of Object.entries(intervals)) {
    const openTime = Math.floor(now / seconds) * seconds;
    const existing = await DB.prepare('SELECT id, high, low FROM candles WHERE market_id = ? AND interval = ? AND open_time = ?')
      .bind(marketId, interval, openTime).first() as any;

    if (existing) {
      await DB.prepare('UPDATE candles SET high = MAX(high, ?), low = MIN(low, ?), close = ?, volume = volume + ? WHERE id = ?')
        .bind(highPrice, lowPrice, lastPrice, totalVolume, existing.id).run();
    } else {
      const prevCandle = await DB.prepare('SELECT open_time, close FROM candles WHERE market_id = ? AND interval = ? AND open_time < ? ORDER BY open_time DESC LIMIT 1')
        .bind(marketId, interval, openTime).first() as any;
      const openPrice = prevCandle ? prevCandle.close : trades[0].price;

      // GAP-FILL (like Binance/Bybit): if some buckets had no trades, real
      // exchanges still emit flat "doji" candles at the prior close so the
      // series has NO missing bars. Backfill every empty bucket between the
      // previous candle and this one with O=H=L=C=prevClose, volume 0.
      if (prevCandle && Number(prevCandle.open_time) > 0) {
        const flat = Number(prevCandle.close);
        const fillStmts: D1PreparedStatement[] = [];
        for (let t = Number(prevCandle.open_time) + seconds; t < openTime; t += seconds) {
          fillStmts.push(
            DB.prepare('INSERT OR IGNORE INTO candles (market_id, interval, open_time, open, high, low, close, volume) VALUES (?,?,?,?,?,?,?,0)')
              .bind(marketId, interval, t, flat, flat, flat, flat)
          );
          if (fillStmts.length >= 50) break; // safety cap per tick
        }
        if (fillStmts.length) await DB.batch(fillStmts);
      }

      await DB.prepare('INSERT INTO candles (market_id, interval, open_time, open, high, low, close, volume) VALUES (?,?,?,?,?,?,?,?)')
        .bind(marketId, interval, openTime, openPrice, highPrice, lowPrice, lastPrice, totalVolume).run();
    }
  }
}

// ============================================================================
// S3-3: Stop-limit trigger helpers
// ----------------------------------------------------------------------------
// After every successful trade the matching engine calls checkAndTriggerStops
// to see whether the new market price (last trade price) has crossed any
// pending stop-limit orders in the same market. Triggered orders are flipped
// to 'open' and immediately run through matchOrder.
//
// IMPORTANT: triggered orders reuse their already-locked balance (locked at
// placement time). We reconstruct the lock info from the order row so refund
// accounting stays symmetric.
// ============================================================================
async function checkAndTriggerStops(DB: D1Database, market: any, lastPrice: number): Promise<void> {
  // Pull candidate pending stops in this market that just became actionable.
  // Buy stop:   trigger when lastPrice >= stop_price
  // Sell stop:  trigger when lastPrice <= stop_price
  let candidates: any[] = [];
  try {
    const { results } = await DB.prepare(
      `SELECT * FROM orders
        WHERE market_id = ?
          AND status = 'pending'
          AND type = 'stop_limit'
          AND (
            (side = 'buy'  AND stop_price <= ?) OR
            (side = 'sell' AND stop_price >= ?)
          )
        ORDER BY created_at ASC
        LIMIT 100`
    ).bind(market.id, lastPrice, lastPrice).all<any>();
    candidates = (results || []) as any[];
  } catch (e) {
    // stop_price column missing → migration not applied yet. Silently no-op.
    console.warn('[stop-trigger] query failed (migration pending?):', e);
    return;
  }

  for (const stop of candidates) {
    try {
      // Reconstruct lock info from the stored row: for buys the lock was in
      // quote with the (1+taker_fee_locked) cushion; for sells the lock is
      // simply `amount` of base. This mirrors the placement-time math so
      // refunds after fills stay balanced.
      const lockSymbol = stop.side === 'buy' ? market.quote_coin : market.base_coin;
      const takerFee = stop.taker_fee_locked != null ? Number(stop.taker_fee_locked) : Number(market.taker_fee);
      const lockAmount = stop.side === 'buy'
        ? Number(stop.price) * Number(stop.remaining) * (1 + takerFee)
        : Number(stop.remaining);
      await triggerAndMatch(DB, stop.id, market, {
        lockAmount,
        lockSymbol,
        tif: (stop.time_in_force as any) || 'GTC',
      });
    } catch (e) {
      console.warn('[stop-trigger] order', stop.id, 'failed to match:', e);
    }
  }
}

async function triggerAndMatch(
  DB: D1Database,
  orderId: string,
  market: any,
  lockInfo: { lockAmount: number; lockSymbol: string; tif: 'GTC' | 'IOC' | 'FOK' | 'POST_ONLY' },
) {
  // Flip pending → open, stamp triggered_at, then run the matcher.
  await DB.prepare(
    `UPDATE orders
        SET status = 'open',
            type = 'limit',
            triggered_at = datetime('now'),
            updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'`
  ).bind(orderId).run();
  return matchOrder(DB, orderId, market, lockInfo);
}

// ============================================================================
// Company-only TWAP split-sell — internal slice executor.
// ----------------------------------------------------------------------------
// The cron worker (quantaex-cron) calls this endpoint every 5 minutes with the
// shared TWAP_CRON_SECRET. For every ACTIVE twap_orders row whose next_run_at
// has passed, we fire ONE slice using the exact same lock + insert + matchOrder
// path as a normal order — so slippage refunds, fee tiers, candle updates and
// price bookkeeping all behave identically. The company account is already
// exempt from the QTA daily sell cap, so slices never hit that gate.
//
// Design notes:
//   • ONE slice per parent per tick → the sell pressure is spread thin (the
//     whole point of TWAP: 급락 방지 / avoid crashing the displayed price).
//   • Limit slices rest on the book at limit_price if they don't fully fill;
//     market slices are IOC and any unfilled base is refunded to available.
//   • remaining_amount is decremented by the slice size we *attempted*; the
//     matcher refunds any unconsumed lock, so the wallet stays correct even if
//     a slice only partially fills. When remaining hits ~0 (or all slices are
//     done) the parent flips to 'completed'.
// ============================================================================
app.post('/twap-tick', async (c) => {
  const secret = c.req.header('x-twap-secret') || '';
  const expected = (c.env as any).TWAP_CRON_SECRET || '';
  if (!expected || secret !== expected) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const DB = c.env.DB;
  const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Ensure the table exists (defensive — normally created by migration 0055).
  try {
    await DB.prepare(
      `CREATE TABLE IF NOT EXISTS twap_orders (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, market_symbol TEXT NOT NULL,
        side TEXT NOT NULL DEFAULT 'sell', order_type TEXT NOT NULL DEFAULT 'limit',
        limit_price REAL, total_amount REAL NOT NULL, remaining_amount REAL NOT NULL,
        slice_count INTEGER NOT NULL, slice_amount REAL NOT NULL,
        slices_done INTEGER NOT NULL DEFAULT 0, interval_sec INTEGER NOT NULL,
        next_run_at TEXT NOT NULL, end_at TEXT, status TEXT NOT NULL DEFAULT 'active',
        note TEXT, last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    ).run();
  } catch { /* ignore */ }

  const { results: due } = await DB.prepare(
    `SELECT * FROM twap_orders
      WHERE status = 'active' AND next_run_at <= ?
      ORDER BY next_run_at ASC LIMIT 20`
  ).bind(nowIso).all<any>();

  const executed: any[] = [];

  for (const twap of (due || [])) {
    try {
      const [base, quote] = String(twap.market_symbol).split('-');
      const market = await DB.prepare(
        'SELECT * FROM markets WHERE base_coin = ? AND quote_coin = ? AND is_active = 1'
      ).bind(base, quote).first<any>();
      if (!market) {
        await DB.prepare(
          `UPDATE twap_orders SET status='cancelled', last_error='market not found', updated_at=datetime('now') WHERE id=?`
        ).bind(twap.id).run();
        continue;
      }

      // Slice size = the smaller of the configured slice and what's left.
      let sliceAmt = Math.min(Number(twap.slice_amount), Number(twap.remaining_amount));
      sliceAmt = floorToDecimals(sliceAmt, market.amount_decimals);
      if (sliceAmt <= 0) {
        await DB.prepare(
          `UPDATE twap_orders SET status='completed', remaining_amount=0, updated_at=datetime('now') WHERE id=?`
        ).bind(twap.id).run();
        continue;
      }

      const isLimit = twap.order_type === 'limit';
      const price = isLimit ? Number(twap.limit_price) : null;

      // Fee tier for the company account.
      const takerTier = await getUserFeeTier(DB, twap.user_id, {
        maker_fee: market.maker_fee, taker_fee: market.taker_fee,
      });

      // SELL side: lock `sliceAmt` of the base coin (atomic conditional debit).
      const lockRes = await DB.prepare(
        'UPDATE wallets SET available = available - ?, locked = locked + ? ' +
        'WHERE user_id = ? AND coin_symbol = ? AND available >= ?'
      ).bind(sliceAmt, sliceAmt, twap.user_id, base, sliceAmt).run();
      if (!lockRes.meta || lockRes.meta.changes === 0) {
        // Not enough treasury balance right now — pause this parent so the
        // operator can top up / cancel, and skip.
        await DB.prepare(
          `UPDATE twap_orders SET status='paused', last_error='insufficient balance', updated_at=datetime('now') WHERE id=?`
        ).bind(twap.id).run();
        continue;
      }

      const orderId = uuid();
      const orderType = isLimit ? 'limit' : 'market';
      const tif: 'GTC' | 'IOC' = isLimit ? 'GTC' : 'IOC';
      const orderPrice = isLimit ? price : null;

      await DB.prepare(
        `INSERT INTO orders
           (id, user_id, market_id, side, type, price, amount, remaining, total,
            time_in_force, taker_fee_locked, maker_fee_locked, stop_price, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        orderId, twap.user_id, market.id, 'sell', orderType, orderPrice,
        sliceAmt, sliceAmt, (orderPrice || 0) * sliceAmt, tif,
        takerTier.taker_fee, takerTier.maker_fee, null, 'open',
      ).run();

      const matched = await matchOrder(DB, orderId, market, {
        lockAmount: sliceAmt, lockSymbol: base, tif,
      });

      // Advance the parent: bump slices_done, decrement remaining by slice size
      // (any unfilled remainder either rests on the book as a limit or was
      // refunded — either way the sell intent for this slice is spent).
      const slicesDone = Number(twap.slices_done) + 1;
      const remaining = floorToDecimals(
        Math.max(0, Number(twap.remaining_amount) - sliceAmt),
        market.amount_decimals,
      );
      const done = remaining <= 0 || slicesDone >= Number(twap.slice_count);
      const nextRun = new Date(Date.now() + Number(twap.interval_sec) * 1000)
        .toISOString().slice(0, 19).replace('T', ' ');

      await DB.prepare(
        `UPDATE twap_orders
            SET slices_done = ?, remaining_amount = ?,
                status = ?, next_run_at = ?, last_error = NULL,
                updated_at = datetime('now')
          WHERE id = ?`
      ).bind(
        slicesDone, remaining,
        done ? 'completed' : 'active', nextRun, twap.id,
      ).run();

      executed.push({
        twap_id: twap.id, slice_order_id: orderId, slice_amount: sliceAmt,
        trades: (matched.trades || []).length, slices_done: slicesDone,
        remaining, status: done ? 'completed' : 'active',
      });
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      await DB.prepare(
        `UPDATE twap_orders SET last_error=?, updated_at=datetime('now') WHERE id=?`
      ).bind(msg, twap.id).run().catch(() => {});
      executed.push({ twap_id: twap.id, error: msg });
    }
  }

  return c.json({ ok: true, checked: (due || []).length, executed });
});

// ============================================================================
// POST /qta-autobuy-tick  — COMPANY AUTO-BUY WALL for QTA (Method A)
// ----------------------------------------------------------------------------
// Owner policy (2026-09): the company automatically BUYS members' QTA sells so
// there is always a bid. Implemented as a STANDING BUY WALL: the admin/treasury
// account (admin-001) keeps a single resting limit-BUY order on QTA/USDT priced
// at the TOP of the managed band, so it absorbs every member sell — including
// sells priced BELOW 5 KRW — at a generous price.
//
// Daily budget (KST calendar day): 51,000 KRW ÷ 1,400 KRW/USD = $36.4286 USDT.
//   • We SUM how much USDT the company already SPENT buying QTA today (from
//     `trades` where buyer_id = admin AND base = QTA, for the current KST day).
//   • remaining = budget − spentToday.
//   • If remaining <= market.min_order_total → cancel the wall and STOP for the
//     day (no more buying). The wall re-arms automatically at KST midnight, when
//     spentToday resets to 0.
//   • Otherwise → (re)post a resting BUY sized so its notional == remaining, at
//     the band-top price, and immediately run matchOrder so any resting member
//     sells are filled right away. Both this-order fills and future passive
//     fills are counted against the same daily budget on the next tick.
//
// The wall order is tagged in `orders.stop_price = -1` as a private marker so we
// can find/cancel exactly our own auto-buy order without touching real orders.
// Guarded by the same x-twap-secret header as /twap-tick.
// ============================================================================
const QTA_AUTOBUY_MARKER = -1; // stored in stop_price to identify the wall order

app.post('/qta-autobuy-tick', async (c) => {
  const secret = c.req.header('x-twap-secret') || '';
  const expected = (c.env as any).TWAP_CRON_SECRET || '';
  if (!expected || secret !== expected) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const DB = c.env.DB;

  // Resolve the company/treasury account.
  const admin = await DB.prepare(
    "SELECT id FROM users WHERE role = 'admin' OR email = 'admin@quantaex.io' ORDER BY (email='admin@quantaex.io') DESC LIMIT 1"
  ).first<{ id: string }>();
  if (!admin?.id) return c.json({ error: 'admin account not found' }, 500);
  const adminId = admin.id;

  // QTA/USDT market.
  const market = await DB.prepare(
    "SELECT * FROM markets WHERE base_coin = 'QTA' AND quote_coin = 'USDT' AND is_active = 1"
  ).first<any>();
  if (!market) return c.json({ error: 'QTA/USDT market not found' }, 500);

  // ---- Daily budget (KST) ----------------------------------------------
  //   51,000 KRW ÷ 1,400 KRW/USD = 36.42857… USDT.
  const DAILY_BUDGET_USDT = 51000 / 1400;

  // KST (UTC+9) day start expressed in UTC for `created_at` comparisons.
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const kstMidnightUtcMs = Date.UTC(
    nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate(),
  ) - 9 * 3600 * 1000;
  const dayStartUtc = new Date(kstMidnightUtcMs).toISOString().slice(0, 19).replace('T', ' ');

  // How much USDT the company already SPENT buying QTA today (settled fills).
  const spentRow = await DB.prepare(
    `SELECT COALESCE(SUM(t.total), 0) AS spent
       FROM trades t
       JOIN markets m ON m.id = t.market_id
      WHERE t.buyer_id = ?
        AND m.base_coin = 'QTA'
        AND t.created_at >= ?`
  ).bind(adminId, dayStartUtc).first<{ spent: number }>().catch(() => null);
  const spentTodayUsdt = Number(spentRow?.spent || 0);
  const remainingUsdt = Math.max(0, DAILY_BUDGET_USDT - spentTodayUsdt);

  // Helper: cancel any existing auto-buy wall order (refund its locked USDT).
  async function cancelWall(): Promise<number> {
    const walls = await DB.prepare(
      `SELECT * FROM orders
         WHERE user_id = ? AND market_id = ? AND side = 'buy'
           AND stop_price = ? AND status IN ('open','partial')`
    ).bind(adminId, market.id, QTA_AUTOBUY_MARKER).all<any>();
    let cancelled = 0;
    for (const w of (walls.results || [])) {
      // Refund the still-locked USDT (remaining × price).
      const refund = Number(w.remaining) * Number(w.price);
      await DB.prepare(
        "UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?"
      ).bind(w.id).run();
      if (refund > 0) {
        await DB.prepare(
          "UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = 'USDT'"
        ).bind(refund, refund, adminId).run();
      }
      cancelled += 1;
    }
    return cancelled;
  }

  // If today's budget is exhausted, tear down the wall and stop.
  if (remainingUsdt < Number(market.min_order_total)) {
    const cancelled = await cancelWall();
    return c.json({
      ok: true, action: 'budget_exhausted',
      spent_today_usdt: spentTodayUsdt, remaining_usdt: remainingUsdt,
      budget_usdt: DAILY_BUDGET_USDT, walls_cancelled: cancelled,
    });
  }

  // ---- Determine the wall BID price = TOP of the managed band -----------
  // Read QTA's managed policy so the wall pays at the band ceiling (generous,
  // absorbs sub-5원 sells too). Fall back to the reference price if unmanaged.
  const qtaCoin = await DB.prepare(
    'SELECT price_usd, price_mode, price_center, price_band_pct FROM coins WHERE symbol = ?'
  ).bind('QTA').first<any>();
  const refUsd = Number(qtaCoin?.price_usd) || 0.00357142857;
  let bidPrice = refUsd;
  if (qtaCoin?.price_mode === 'managed' && Number(qtaCoin.price_center) > 0) {
    const band = Math.max(0, Number(qtaCoin.price_band_pct) || 0) / 100;
    bidPrice = Number(qtaCoin.price_center) * (1 + band); // band ceiling
  }
  bidPrice = floorToDecimals(bidPrice, market.price_decimals);
  if (!(bidPrice > 0)) return c.json({ error: 'invalid bid price' }, 500);

  // Refresh the wall: cancel the old one (so its size tracks the shrinking
  // daily budget), then post a fresh resting BUY sized to the remaining budget.
  await cancelWall();

  // Amount so that amount × price == remainingUsdt (floored to precision).
  let amount = floorToDecimals(remainingUsdt / bidPrice, market.amount_decimals);
  if (amount < Number(market.min_order_amount)) {
    return c.json({
      ok: true, action: 'below_min_amount',
      spent_today_usdt: spentTodayUsdt, remaining_usdt: remainingUsdt,
      bid_price: bidPrice,
    });
  }
  let notional = floorToDecimals(amount * bidPrice, 8);

  // Atomically lock the quote (USDT) budget from the treasury.
  const lockRes = await DB.prepare(
    "UPDATE wallets SET available = available - ?, locked = locked + ? " +
    "WHERE user_id = ? AND coin_symbol = 'USDT' AND available >= ?"
  ).bind(notional, notional, adminId, notional).run();
  if (!lockRes.meta || lockRes.meta.changes === 0) {
    return c.json({
      ok: true, action: 'treasury_insufficient_usdt',
      needed_usdt: notional, spent_today_usdt: spentTodayUsdt,
    });
  }

  // Fee tier for the company account.
  const takerTier = await getUserFeeTier(DB, adminId, {
    maker_fee: market.maker_fee, taker_fee: market.taker_fee,
  });

  const orderId = uuid();
  await DB.prepare(
    `INSERT INTO orders
       (id, user_id, market_id, side, type, price, amount, remaining, total,
        time_in_force, taker_fee_locked, maker_fee_locked, stop_price, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    orderId, adminId, market.id, 'buy', 'limit', bidPrice,
    amount, amount, notional, 'GTC',
    takerTier.taker_fee, takerTier.maker_fee, QTA_AUTOBUY_MARKER, 'open',
  ).run();

  // Immediately absorb any resting member sells at/below our bid.
  const matched = await matchOrder(DB, orderId, market, {
    lockAmount: notional, lockSymbol: 'USDT', tif: 'GTC',
  });

  return c.json({
    ok: true, action: 'wall_posted',
    order_id: orderId, bid_price: bidPrice, amount, notional_usdt: notional,
    trades: (matched.trades || []).length,
    spent_today_usdt: spentTodayUsdt, remaining_usdt: remainingUsdt,
    budget_usdt: DAILY_BUDGET_USDT,
  });
});

// ============================================================================
// POST /qta-mm-tick  — QTA MARKET-MAKING + member-sell absorption (one tick)
// ----------------------------------------------------------------------------
// Owner request: "손님 올 때까지 자체 거래를 돌려라" — the QTA/USDT market must
// look ALIVE (a two-sided order book + a fresh candle every tick) AND a member
// who sells must always get bought. Two internal maker bots do BOTH:
//
//   • mm-bot-a  → maintains a resting ASK (sell) just ABOVE the managed price
//   • mm-bot-b  → maintains a resting BID (buy) just BELOW the managed price
//
// So the order book always shows BOTH sides (no more "No sell orders"), and the
// spread straddles the managed mid. Each tick:
//   1. FIRST buy any member sells: bot-b sends a small taker BUY at the mid. It
//      sweeps the cheapest resting asks — i.e. members selling at/under the mid
//      get filled. (A member selling ABOVE the mid just rests as a normal ask.)
//      This is capped by the daily KST budget (51,000 KRW ≈ $36.43) measured as
//      how much the bots BOUGHT FROM MEMBERS today; once hit, no more member
//      buying, but cosmetic self-trading continues.
//   2. Print ONE small candle: bot-b crosses a tiny amount against bot-a's own
//      resting ask at the mid (STP allows it — different accounts). The trade
//      price == the managed mid, so the candle sits ON the price line and never
//      spikes.
//   3. Re-arm the book: cancel the bots' stale quotes and repost a fresh
//      ASK (bot-a) and BID (bot-b) around the new mid.
//
// All bot quotes are tagged with stop_price = MM_MARKER so they are found and
// refreshed without touching real member/company orders. Guarded by the shared
// x-twap-secret.
// ============================================================================
const MM_BOT_A = 'mm-bot-a';
const MM_BOT_B = 'mm-bot-b';
const MM_MARKER = -2;                 // stop_price tag for MM bot quotes
// ★ OWNER RULE (2026-09-05): fixed USDT↔KRW rate while the market is seeded.
const USDT_KRW_RATE = 1450;
// ★ OWNER RULE (2026-09-05): the company (mm-bot) buys FROM each member at most
//   KRW 50,000 / day → 50000/1450 ≈ 34.48 USDT. This is now a PER-MEMBER cap
//   (previously one global budget). Anything a member sells beyond this in a
//   day is NOT bought by the company and just rests until they cancel it.
const MM_MEMBER_BUY_BUDGET_USDT = 50000 / USDT_KRW_RATE;  // ≈ 34.4828 USDT / member / day

app.post('/qta-mm-tick', async (c) => {
  const secret = c.req.header('x-twap-secret') || '';
  const expected = (c.env as any).TWAP_CRON_SECRET || '';
  if (!expected || secret !== expected) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const DB = c.env.DB;

  const market = await DB.prepare(
    "SELECT * FROM markets WHERE base_coin = 'QTA' AND quote_coin = 'USDT' AND is_active = 1"
  ).first<any>();
  if (!market) return c.json({ error: 'QTA/USDT market not found' }, 500);

  const bots = await DB.prepare(
    "SELECT id FROM users WHERE id IN (?, ?)"
  ).bind(MM_BOT_A, MM_BOT_B).all<any>();
  if ((bots.results || []).length < 2) {
    return c.json({ ok: true, action: 'bots_missing' });
  }

  const pdec = market.price_decimals;
  const adec = market.amount_decimals;
  const minTotal = Math.max(1, Number(market.min_order_total) || 1);
  const minAmt = Number(market.min_order_amount) || 0.0001;

  // ---- Managed mid price: a smooth random walk, NOT a saw-tooth ----------
  // The previous version clamped the mid to bandHi*(1-3%) every tick while the
  // coin's stored price sat ON the band ceiling, so each tick bounced the price
  // 0.004998 <-> 0.004848 and painted an endless red down-candle. Instead we:
  //   • take the LAST traded price as the anchor (real continuity),
  //   • nudge it by a tiny random step (±~0.15%) with a gentle upward bias so
  //     the chart drifts up like a healthy market instead of flat-lining,
  //   • keep it comfortably INSIDE the band (leave room for both walls) using a
  //     soft mean-reversion toward the band centre rather than a hard clamp.
  const qtaCoin = await DB.prepare(
    'SELECT price_usd, price_mode, price_center, price_band_pct FROM coins WHERE symbol = ?'
  ).bind('QTA').first<any>();

  // Anchor on the most recent real trade price (falls back to the coin price).
  const lastTradeRow = await DB.prepare(
    "SELECT price FROM trades WHERE market_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(market.id).first<{ price: number }>().catch(() => null);
  let mid = Number(lastTradeRow?.price) || Number(qtaCoin?.price_usd) || 0.00410714;

  // Band bounds (reused by the wall builder in Step 3).
  let bandLo = 0, bandHi = Number.MAX_VALUE, center = mid;
  if (qtaCoin?.price_mode === 'managed' && Number(qtaCoin.price_center) > 0) {
    const band = Math.max(0, Number(qtaCoin.price_band_pct) || 0) / 100;
    center = Number(qtaCoin.price_center);
    bandHi = center * (1 + band);
    bandLo = center * (1 - band);
  }

  // Tiny per-tick step with a gentle upward bias.
  const rnd = Math.random();                 // 0..1, fresh each tick
  const step = (rnd - 0.42) * 0.003;         // ~ -0.126% .. +0.174%  (slight up bias)
  mid = mid * (1 + step);
  // Soft mean-reversion: if we drift into the outer ~15% of the band, pull back
  // toward the centre a little so we never pin to an edge (which killed one wall
  // side and produced the saw-tooth). This keeps ~15% headroom for both walls.
  if (bandHi < Number.MAX_VALUE) {
    const innerHi = center + (bandHi - center) * 0.85;
    const innerLo = center - (center - bandLo) * 0.85;
    if (mid > innerHi) mid = mid + (innerHi - mid) * 0.5;
    if (mid < innerLo) mid = mid + (innerLo - mid) * 0.5;
    // Hard safety clamp strictly inside the band.
    if (mid > bandHi) mid = bandHi;
    if (mid < bandLo) mid = bandLo;
  }
  mid = floorToDecimals(mid, pdec);
  if (!(mid > 0)) return c.json({ error: 'invalid mm mid' }, 500);

  // A tight spread around the mid (±0.4%), clamped to the price grid so both
  // quotes are distinct from the mid.
  const tick = 1 / Math.pow(10, pdec);
  let ask = floorToDecimals(mid * 1.004, pdec);
  let bid = floorToDecimals(mid * 0.996, pdec);
  if (ask <= mid) ask = floorToDecimals(mid + tick, pdec);
  if (bid >= mid) bid = floorToDecimals(mid - tick, pdec);
  if (bid <= 0) bid = mid;

  // ---- Helper: cancel + refund all resting MM bot quotes ----------------
  async function clearBotQuotes(): Promise<number> {
    const q = await DB.prepare(
      `SELECT id, user_id, side, remaining, price FROM orders
         WHERE market_id = ? AND user_id IN (?, ?) AND status IN ('open','partial')`
    ).bind(market.id, MM_BOT_A, MM_BOT_B).all<any>();
    let n = 0;
    for (const o of (q.results || [])) {
      await DB.prepare(
        "UPDATE orders SET status='cancelled', updated_at=datetime('now') WHERE id=?"
      ).bind(o.id).run();
      if (o.side === 'sell') {
        await DB.prepare(
          "UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?) WHERE user_id=? AND coin_symbol='QTA'"
        ).bind(Number(o.remaining), Number(o.remaining), o.user_id).run();
      } else {
        const refund = Number(o.remaining) * Number(o.price);
        await DB.prepare(
          "UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?) WHERE user_id=? AND coin_symbol='USDT'"
        ).bind(refund, refund, o.user_id).run();
      }
      n += 1;
    }
    return n;
  }

  // Clear last tick's stale quotes first (so sizes/prices track the new mid).
  const cleared = await clearBotQuotes();

  const tierA = await getUserFeeTier(DB, MM_BOT_A, { maker_fee: market.maker_fee, taker_fee: market.taker_fee });
  const tierB = await getUserFeeTier(DB, MM_BOT_B, { maker_fee: market.maker_fee, taker_fee: market.taker_fee });

  async function placeOrder(
    userId: string, side: 'buy' | 'sell', price: number, amount: number,
    tier: { maker_fee: number; taker_fee: number },
  ): Promise<string | null> {
    const total = floorToDecimals(amount * price, 8);
    if (amount < minAmt || total < minTotal) return null;
    // Lock funds atomically.
    if (side === 'sell') {
      const lk = await DB.prepare(
        "UPDATE wallets SET available=available-?, locked=locked+? WHERE user_id=? AND coin_symbol='QTA' AND available>=?"
      ).bind(amount, amount, userId, amount).run();
      if (!lk.meta || lk.meta.changes === 0) return null;
    } else {
      const lk = await DB.prepare(
        "UPDATE wallets SET available=available-?, locked=locked+? WHERE user_id=? AND coin_symbol='USDT' AND available>=?"
      ).bind(total, total, userId, total).run();
      if (!lk.meta || lk.meta.changes === 0) return null;
    }
    const id = uuid();
    await DB.prepare(
      `INSERT INTO orders
         (id, user_id, market_id, side, type, price, amount, remaining, total,
          time_in_force, taker_fee_locked, maker_fee_locked, stop_price, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, userId, market.id, side, 'limit', price,
      amount, amount, total, 'GTC', tier.taker_fee, tier.maker_fee, MM_MARKER, 'open',
    ).run();
    return id;
  }

  // KST day start for the per-member daily company-buy cap.
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const kstMidnightUtcMs = Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()) - 9 * 3600 * 1000;
  const dayStartUtc = new Date(kstMidnightUtcMs).toISOString().slice(0, 19).replace('T', ' ');

  // ★ 24h floor: the company must NOT buy (nor let anyone buy) below this price.
  const floor = await qtaPriceFloor(DB, market);

  let memberTrades = 0;
  // ============================================================================
  // ---- Step 1: the COMPANY (mm-bot-b) buys member sells in REAL TIME --------
  // ----------------------------------------------------------------------------
  // Owner rule (2026-09-05, REVISED): whenever a member is selling QTA at/below
  // the live price, the company buys it — AT THE MEMBER'S OWN ASK PRICE (so they
  // get exactly what they asked) — but only up to KRW 50,000/day PER MEMBER
  // (≈34.48 USDT @1,450). Never buy below the 24h floor.
  //   ★ POLICY CHANGE (2026-09-05): once a member's daily company-buy hits the
  //     50,000-KRW cap, their LEFTOVER QTA sell orders are AUTO-CANCELLED —
  //     removed from the ask book and the locked QTA refunded to `available`.
  //     (Previously the leftover just rested until the member cancelled it.)
  // We walk each seller's resting asks cheapest-first, per seller, tracking how
  // much the company has already bought FROM THAT seller today, then sweep-cancel
  // any remaining asks of members who reached the cap.
  // ============================================================================
  {
    // All resting member asks at/under the live mid (exclude the bots), with
    // the seller id and each ask's price so we can buy at the member's price.
    const askRows = await DB.prepare(
      `SELECT id, user_id, remaining, price FROM orders
         WHERE market_id=? AND side='sell' AND status IN ('open','partial')
           AND user_id NOT IN (?, ?) AND price <= ?
         ORDER BY user_id ASC, price ASC, created_at ASC`
    ).bind(market.id, MM_BOT_A, MM_BOT_B, mid).all<any>().catch(() => ({ results: [] as any[] }));

    // Per-seller USDT the company already bought from them TODAY.
    const spentBySeller = new Map<string, number>();
    async function companyBoughtFrom(sellerId: string): Promise<number> {
      const cached = spentBySeller.get(sellerId);
      if (cached != null) return cached;
      const r = await DB.prepare(
        `SELECT COALESCE(SUM(t.total),0) spent FROM trades t
           WHERE t.market_id=? AND t.buyer_id IN (?, ?) AND t.seller_id=?
             AND t.created_at >= ?`
      ).bind(market.id, MM_BOT_A, MM_BOT_B, sellerId, dayStartUtc)
        .first<{ spent: number }>().catch(() => null);
      const v = Number(r?.spent || 0);
      spentBySeller.set(sellerId, v);
      return v;
    }

    for (const ask of (askRows.results || [])) {
      const askPrice = Number(ask.price);
      const askQty = Number(ask.remaining);
      if (!(askQty > 0) || !(askPrice > 0)) continue;

      // Load this seller's running company-buy total FIRST (even for sub-floor
      // asks) so they are tracked in spentBySeller and considered by the
      // auto-cancel sweep below.
      const sellerId = String(ask.user_id);
      const already = await companyBoughtFrom(sellerId);

      // 🛡️ Never buy below the 24h floor (but the seller is now tracked).
      if (floor > 0 && askPrice < floor - 1e-12) continue;

      const roomUsdt = MM_MEMBER_BUY_BUDGET_USDT - already;
      if (roomUsdt < minTotal) continue; // this member is out of daily room

      // Buy up to the smaller of (this ask qty) and (member's remaining room).
      const roomQty = roomUsdt / askPrice;
      const buyQty = floorToDecimals(Math.min(askQty, roomQty), adec);
      if (!(buyQty > 0) || buyQty * askPrice < minTotal) continue;

      // mm-bot-b crosses at the MEMBER'S ask price → the member sells at their
      // own price. IOC so no bot bid rests behind.
      const buyId = await placeOrder(MM_BOT_B, 'buy', askPrice, buyQty, tierB);
      if (buyId) {
        const m = await matchOrder(DB, buyId, market, {
          lockAmount: floorToDecimals(buyQty * askPrice, 8), lockSymbol: 'USDT', tif: 'IOC',
        });
        const n = (m.trades || []).length;
        memberTrades += n;
        // Update the running per-seller spend so we respect the cap within
        // this same tick if they have multiple asks.
        const spentNow = (m.trades || []).reduce((s: number, t: any) => s + Number(t.total || 0), 0);
        spentBySeller.set(sellerId, already + spentNow);
      }
    }

    // ★ AUTO-CANCEL leftover (owner 2026-09-05): for every member who has now
    //   reached the daily 50,000-KRW company-buy cap, cancel ALL their remaining
    //   open/partial QTA sell orders and refund the locked QTA to `available`.
    //   "reached cap" = remaining daily room is below the market minimum, i.e.
    //   the company can no longer buy a valid lot from them today.
    for (const [sellerId, spent] of spentBySeller.entries()) {
      const room = MM_MEMBER_BUY_BUDGET_USDT - spent;
      if (room >= minTotal) continue; // still has room; leave their asks resting
      const leftovers = await DB.prepare(
        `SELECT id, remaining FROM orders
           WHERE market_id=? AND user_id=? AND side='sell'
             AND status IN ('open','partial')`
      ).bind(market.id, sellerId).all<any>().catch(() => ({ results: [] as any[] }));
      for (const o of (leftovers.results || [])) {
        const rem = Number(o.remaining || 0);
        const cancelled = await DB.prepare(
          `UPDATE orders SET status='cancelled', updated_at=datetime('now')
             WHERE id=? AND status IN ('open','partial')`
        ).bind(o.id).run();
        // Only refund if THIS call actually flipped it to cancelled (guards
        // against double-refund if the order changed concurrently).
        if (cancelled?.meta && cancelled.meta.changes > 0 && rem > 0) {
          await DB.prepare(
            "UPDATE wallets SET available=available+?, locked=MAX(0,locked-?) WHERE user_id=? AND coin_symbol='QTA'"
          ).bind(rem, rem, sellerId).run();
        }
      }
    }
  }

  // ============================================================================
  // ---- Step 1.5: the COMPANY (mm-bot-a) SUPPLIES member BUYS in real time ---
  // ----------------------------------------------------------------------------
  // Owner rule (2026-09-05): a member BUY is UNLIMITED. After it sweeps any pure
  // member asks, the company fills the REMAINDER — at the BUYER'S OWN limit
  // price — so the buy is 100% filled. Refusals:
  //   • only for resting member BUY orders (limit) that still have room;
  //   • the buyer's limit price must be ≥ the 24h floor (a sub-floor bid is
  //     NEVER supplied and just rests — blocks "1원에 1억" crash-buys);
  //   • the buy price must be ≥ the live mid (a lowball bid under the market
  //     isn't crossed by the company — "호가 시세 이하면 사주지 말라").
  // Market buys are already filled synchronously at order time, so here we only
  // top up resting LIMIT buys from members.
  // ============================================================================
  let buySupplyTrades = 0;
  {
    const bidRows = await DB.prepare(
      `SELECT id, user_id, remaining, price FROM orders
         WHERE market_id=? AND side='buy' AND type='limit' AND status IN ('open','partial')
           AND user_id NOT IN (?, ?) AND price >= ?
         ORDER BY price DESC, created_at ASC`
    ).bind(market.id, MM_BOT_A, MM_BOT_B, mid).all<any>().catch(() => ({ results: [] as any[] }));

    for (const bid of (bidRows.results || [])) {
      const bidPrice = Number(bid.price);
      const bidQty = Number(bid.remaining);
      if (!(bidQty > 0) || !(bidPrice > 0)) continue;
      // 🛡️ Never supply below the 24h floor.
      if (floor > 0 && bidPrice < floor - 1e-12) continue;

      // mm-bot-a rests an ask at the BUYER'S price; the member's resting bid
      // crosses it. We place the bot ask then re-run the member's buy so the
      // member is the taker and gets filled at their own price.
      const sellId = await placeOrder(MM_BOT_A, 'sell', bidPrice, floorToDecimals(bidQty, adec), tierA);
      if (sellId) {
        // Cross the member's resting bid against the fresh bot ask.
        const m = await matchOrder(DB, String(bid.id), market);
        buySupplyTrades += (m.trades || []).length;
        // Cancel any unmatched remainder of the bot ask so it doesn't linger.
        await DB.prepare(
          `UPDATE orders SET status='cancelled', updated_at=datetime('now')
             WHERE id=? AND status IN ('open','partial')`
        ).bind(sellId).run();
        // Refund the bot ask's unfilled base lock.
        const leftover = await DB.prepare(
          "SELECT remaining FROM orders WHERE id=?"
        ).bind(sellId).first<{ remaining: number }>().catch(() => null);
        const rem = Number(leftover?.remaining || 0);
        if (rem > 0) {
          await DB.prepare(
            "UPDATE wallets SET available=available+?, locked=MAX(0,locked-?) WHERE user_id=? AND coin_symbol='QTA'"
          ).bind(rem, rem, MM_BOT_A).run();
        }
      }
    }
  }

  // ---- Step 2: print one cosmetic candle at the mid ---------------------
  // bot-a rests a small ask at the mid; bot-b crosses it with a tiny taker buy.
  const candleQty = floorToDecimals(Math.max(minAmt, (minTotal * 1.2) / mid), adec);
  let candleTrades = 0;
  const aSell = await placeOrder(MM_BOT_A, 'sell', mid, candleQty, tierA);
  if (aSell) {
    await matchOrder(DB, aSell, market, { lockAmount: candleQty, lockSymbol: 'QTA', tif: 'GTC' });
    const bBuy = await placeOrder(MM_BOT_B, 'buy', mid, candleQty, tierB);
    if (bBuy) {
      const m = await matchOrder(DB, bBuy, market, {
        lockAmount: floorToDecimals(candleQty * mid, 8), lockSymbol: 'USDT', tif: 'IOC',
      });
      candleTrades = (m.trades || []).length;
    }
  }

  // ---- Step 3: re-arm a DEEP multi-level two-sided book ----------------
  // Cancel whatever leftover from steps 1-2, then stack a full wall on BOTH
  // sides so the order book looks packed (owner: "칸을 다 채워라"):
  //   • mm-bot-a stacks LEVELS ask rungs stepping UP from `ask`
  //   • mm-bot-b stacks LEVELS bid rungs stepping DOWN from `bid`
  // Each rung is clamped to the managed band so no rung ever prints outside
  // 0.003216..0.004998 (no more crash-looking outliers), and the price grid
  // guarantees every rung is a distinct row. Rung size grows a little with
  // depth so the far side of the book looks like real liquidity.
  await clearBotQuotes();

  const LEVELS = 14;                // rungs per side -> book shows ~14 asks + 14 bids
  // Step between rungs: small enough that all LEVELS ask rungs fit in the
  // headroom between the mid and the band ceiling (so the sell wall doesn't
  // collapse into one row), but at least one price tick.
  const askRoom = Math.max(tick, bandHi === Number.MAX_VALUE ? mid * 0.03 : (bandHi - ask));
  const STEP = Math.max(tick, floorToDecimals(askRoom / (LEVELS + 1), pdec));
  // bandLo / bandHi were computed with the mid above (Number.MAX_VALUE / 0 when
  // the coin is not in managed mode, so the clamps below are no-ops then).

  let asksPlaced = 0, bidsPlaced = 0;
  const seenAsk = new Set<number>();
  const seenBid = new Set<number>();
  for (let i = 0; i < LEVELS; i++) {
    // ASK rung i: ask, ask+STEP, ask+2*STEP, ...  (clamped to band hi)
    let ap = floorToDecimals(ask + i * STEP, pdec);
    if (ap > bandHi) ap = floorToDecimals(bandHi, pdec);
    if (ap <= mid) ap = floorToDecimals(mid + tick, pdec);
    if (ap > 0 && !seenAsk.has(ap)) {
      seenAsk.add(ap);
      // Depth per rung: ~$4 near touch, growing gently with distance so 14
      // rungs stay affordable while the far book still looks deep. A per-rung
      // random jitter (±35%) makes each re-arm look alive instead of frozen.
      const aJit = 0.65 + Math.random() * 0.7;                 // 0.65 .. 1.35
      const aQty = floorToDecimals((minTotal * (4 + i * 1.5) * aJit) / ap, adec);
      if (await placeOrder(MM_BOT_A, 'sell', ap, aQty, tierA)) asksPlaced++;
    }
    // BID rung i: bid, bid-STEP, bid-2*STEP, ...  (clamped to band lo & >0)
    let bp = floorToDecimals(bid - i * STEP, pdec);
    if (bp < bandLo) bp = floorToDecimals(bandLo, pdec);
    if (bp >= mid) bp = floorToDecimals(mid - tick, pdec);
    if (bp > 0 && !seenBid.has(bp)) {
      seenBid.add(bp);
      const bJit = 0.65 + Math.random() * 0.7;                 // 0.65 .. 1.35
      const bQty = floorToDecimals((minTotal * (4 + i * 1.5) * bJit) / bp, adec);
      if (await placeOrder(MM_BOT_B, 'buy', bp, bQty, tierB)) bidsPlaced++;
    }
  }

  return c.json({
    ok: true, action: 'mm_ok',
    mid, ask, bid, floor,
    member_sell_trades: memberTrades, buy_supply_trades: buySupplyTrades,
    candle_trades: candleTrades,
    per_member_buy_cap_usdt: MM_MEMBER_BUY_BUDGET_USDT,
    cleared, asks_placed: asksPlaced, bids_placed: bidsPlaced,
  });
});

export default app;
