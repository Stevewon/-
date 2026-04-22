import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware } from '../middleware/auth';
import { requireKyc } from '../middleware/kyc';
import { rateLimit } from '../middleware/rateLimit';

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

// Place order — requires approved KYC (gates all trading)
app.post('/', authMiddleware, rlPlaceOrder, requireKyc('approved'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  let { market_symbol, side, type, price, amount } = body;
  if (!market_symbol || typeof market_symbol !== 'string') {
    return c.json({ error: 'Invalid market_symbol' }, 400);
  }
  const [base, quote] = market_symbol.split('-');
  if (!base || !quote) return c.json({ error: 'Invalid market_symbol' }, 400);

  const market = await c.env.DB.prepare('SELECT * FROM markets WHERE base_coin = ? AND quote_coin = ? AND is_active = 1').bind(base, quote).first() as any;
  if (!market) return c.json({ error: 'Market not found' }, 404);

  if (!['buy', 'sell'].includes(side)) return c.json({ error: 'Invalid side' }, 400);
  if (!['limit', 'market'].includes(type)) return c.json({ error: 'Invalid type' }, 400);

  // Numeric coercion (frontend may send strings)
  amount = Number(amount);
  if (price != null) price = Number(price);
  if (!isFinite(amount) || amount <= 0) return c.json({ error: 'Invalid amount' }, 400);
  if (type === 'limit' && (!isFinite(price) || price <= 0)) return c.json({ error: 'Price required for limit order' }, 400);

  // -------- Decimals & minimum-order validation --------
  amount = floorToDecimals(amount, market.amount_decimals);
  if (type === 'limit') price = floorToDecimals(price, market.price_decimals);
  if (amount <= 0) return c.json({ error: 'Amount too small for market precision' }, 400);

  if (amount < market.min_order_amount) {
    return c.json({ error: `Minimum order amount is ${market.min_order_amount} ${base}` }, 400);
  }
  if (type === 'limit') {
    const notional = price * amount;
    if (notional < market.min_order_total) {
      return c.json({ error: `Minimum order total is ${market.min_order_total} ${quote}` }, 400);
    }
  }

  // ============================================================================
  // Balance check & lock
  // ----------------------------------------------------------------------------
  // For LIMIT orders we know the exact cost up-front and lock accordingly.
  // For MARKET orders we use an estimated worst-case cost derived from the
  // current best ask (buy) / best bid (sell) so the user can't over-commit.
  // Any un-used locked funds are refunded by matchOrder() after execution.
  // ============================================================================
  let lockAmount = 0;
  let lockSymbol = '';

  if (side === 'buy') {
    lockSymbol = quote;
    if (type === 'limit') {
      lockAmount = price * amount * (1 + market.taker_fee);
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
      lockAmount = estPrice * amount * 1.2 * (1 + market.taker_fee);
    }

    const wallet = await c.env.DB.prepare('SELECT available FROM wallets WHERE user_id = ? AND coin_symbol = ?').bind(user.id, quote).first() as any;
    if (!wallet || wallet.available < lockAmount) return c.json({ error: 'Insufficient balance' }, 400);

    await c.env.DB.prepare('UPDATE wallets SET available = available - ?, locked = locked + ? WHERE user_id = ? AND coin_symbol = ?')
      .bind(lockAmount, lockAmount, user.id, quote).run();
  } else {
    lockSymbol = base;
    lockAmount = amount;
    const wallet = await c.env.DB.prepare('SELECT available FROM wallets WHERE user_id = ? AND coin_symbol = ?').bind(user.id, base).first() as any;
    if (!wallet || wallet.available < amount) return c.json({ error: 'Insufficient balance' }, 400);

    await c.env.DB.prepare('UPDATE wallets SET available = available - ?, locked = locked + ? WHERE user_id = ? AND coin_symbol = ?')
      .bind(amount, amount, user.id, base).run();
  }

  const orderId = uuid();
  const orderPrice = type === 'market' ? null : price;

  await c.env.DB.prepare(
    'INSERT INTO orders (id, user_id, market_id, side, type, price, amount, remaining, total) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(orderId, user.id, market.id, side, type, orderPrice, amount, amount, (orderPrice || 0) * amount).run();

  // Match order (passes lockAmount so unused funds are refunded)
  const result = await matchOrder(c.env.DB, orderId, market, { lockAmount, lockSymbol });

  return c.json({
    order: result.order,
    trades: result.trades.map((t: any) => ({ id: t.id, price: t.price, amount: t.amount, total: t.total })),
  });
});

// Cancel order
app.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(c.req.param('id'), user.id).first() as any;
  if (!order) return c.json({ error: 'Order not found' }, 404);
  if (!['open', 'partial'].includes(order.status)) return c.json({ error: 'Order cannot be cancelled' }, 400);

  const market = await c.env.DB.prepare('SELECT * FROM markets WHERE id = ?').bind(order.market_id).first() as any;

  // Unlock remaining funds. Only limit orders can reach this point with
  // status in ('open','partial'); market orders always finalise inside
  // matchOrder, so order.price is guaranteed to be a valid number here.
  if (order.side === 'buy') {
    if (!order.price || order.price <= 0) {
      return c.json({ error: 'Cannot cancel: invalid order price' }, 400);
    }
    const unlockAmount = order.remaining * order.price * (1 + market.taker_fee);
    await c.env.DB.prepare('UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?')
      .bind(unlockAmount, unlockAmount, user.id, market.quote_coin).run();
  } else {
    await c.env.DB.prepare('UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?')
      .bind(order.remaining, order.remaining, user.id, market.base_coin).run();
  }

  await c.env.DB.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").bind(order.id).run();
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
    sql += ` AND o.status IN ('open','partial')`;
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
  lockInfo?: { lockAmount: number; lockSymbol: string }
) {
  const order = await DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first() as any;
  const trades: any[] = [];

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

  let remaining = order.remaining;

  // Track how much of the taker's locked quote was actually consumed
  // (only relevant for buy orders, where the lock is in quote currency).
  let quoteConsumed = 0;

  for (const match of matchingOrders as any[]) {
    if (remaining <= 0) break;

    const tradeAmount = Math.min(remaining, match.remaining);
    const tradePrice = match.price;
    const tradeTotal = tradePrice * tradeAmount;
    const buyerFee = tradeTotal * market.taker_fee;
    const sellerFee = tradeTotal * market.maker_fee;

    const tradeId = uuid();
    const buyOrderId = order.side === 'buy' ? order.id : match.id;
    const sellOrderId = order.side === 'sell' ? order.id : match.id;
    const buyerId = order.side === 'buy' ? order.user_id : match.user_id;
    const sellerId = order.side === 'sell' ? order.user_id : match.user_id;

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
  }

  // Update taker order
  const filled = order.amount - remaining;
  const status = remaining <= 0 ? 'filled' : filled > 0 ? 'partial' : (order.type === 'market' ? 'cancelled' : 'open');
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
      await DB.prepare('UPDATE coins SET price_usd = ? WHERE symbol = ?').bind(lastPrice, market.base_coin).run();
    }
  }

  const updatedOrder = await DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  return { order: updatedOrder, trades };
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
      const prevCandle = await DB.prepare('SELECT close FROM candles WHERE market_id = ? AND interval = ? AND open_time < ? ORDER BY open_time DESC LIMIT 1')
        .bind(marketId, interval, openTime).first() as any;
      const openPrice = prevCandle ? prevCandle.close : trades[0].price;
      await DB.prepare('INSERT INTO candles (market_id, interval, open_time, open, high, low, close, volume) VALUES (?,?,?,?,?,?,?,?)')
        .bind(marketId, interval, openTime, openPrice, highPrice, lowPrice, lastPrice, totalVolume).run();
    }
  }
}

export default app;
