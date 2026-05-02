/**
 * /api/v1/* — Sprint 5 Phase I1.
 *
 * Public, signature-authed trading API. Mounted in src/server/index.ts:
 *
 *   app.route('/api/v1', v1Routes);
 *
 * Every handler here goes through `apiKeyAuth({ requirePermission: ... })`,
 * so by the time the body runs we already have:
 *
 *   const apiKey = c.get('apiKey')   // ApiKeyRecord
 *   const user   = c.get('user')     // { id, role: 'user', via: 'api_key' }
 *   const body   = c.get('apiKeyBody') // raw text body (already consumed by auth)
 *
 * Design notes:
 *   - These routes deliberately do NOT call into routes/order.ts or
 *     routes/wallet.ts. We re-issue the underlying SQL so this surface
 *     stays decoupled from JWT-only quirks (cookies, etc).
 *   - Phase F levers (circuit breaker, force_2fa) still apply on
 *     trade-level routes; force_2fa is bypassed for API key trades on
 *     purpose — a 2FA prompt over headless trading is incoherent.
 *   - The order-placement path here is intentionally a thin wrapper:
 *     it inserts the order in 'pending' state and lets the existing
 *     matching engine pick it up on the next tick, matching the JWT
 *     route's behaviour exactly.
 *
 * Compatibility surface modelled on Bybit V5 / Binance Spot:
 *   GET    /api/v1/account/balances
 *   GET    /api/v1/account/info
 *   GET    /api/v1/orders/open
 *   GET    /api/v1/orders/history
 *   POST   /api/v1/orders            (place)
 *   DELETE /api/v1/orders/:id        (cancel)
 *   GET    /api/v1/positions         (futures)
 *
 * All responses follow `{ ok: boolean, ...payload }` for cheap SDK parsing.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { apiKeyAuth, type ApiKeyRecord } from '../middleware/api-key-auth';
import { getRiskState } from '../lib/risk';

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid(): string {
  return crypto.randomUUID();
}

function safeParseJson(text: string): any | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function floorToDecimals(n: number, decimals: number): number {
  if (!isFinite(n)) return 0;
  const d = Math.max(0, Math.min(18, decimals | 0));
  const p = Math.pow(10, d);
  return Math.floor(n * p) / p;
}

// ===========================================================================
// /account/balances — read
// ===========================================================================
app.get('/account/balances', apiKeyAuth({ requirePermission: 'read' }), async (c) => {
  const user = c.get('user') as { id: string };
  const { results } = await c.env.DB.prepare(
    `SELECT w.coin_symbol AS asset,
            CAST(w.available AS REAL) AS available,
            CAST(w.locked    AS REAL) AS locked,
            (CAST(w.available AS REAL) + CAST(w.locked AS REAL)) AS total
       FROM wallets w
      WHERE w.user_id = ?
      ORDER BY total DESC`,
  )
    .bind(user.id)
    .all<{ asset: string; available: number; locked: number; total: number }>();

  return c.json({
    ok: true,
    balances: results || [],
    fetched_at: new Date().toISOString(),
  });
});

// ===========================================================================
// /account/info — read. Echoes which API key + permissions the caller is on.
// ===========================================================================
app.get('/account/info', apiKeyAuth({ requirePermission: 'read' }), async (c) => {
  const apiKey = c.get('apiKey') as ApiKeyRecord;
  const user = c.get('user') as { id: string };
  return c.json({
    ok: true,
    user_id: user.id,
    api_key_id: apiKey.id,
    api_key_label: apiKey.label,
    permissions: (apiKey.permissions || '').split(',').map((p) => p.trim()).filter(Boolean),
    signature_alg: apiKey.signature_alg,
    server_time: Date.now(),
  });
});

// ===========================================================================
// /orders/open — read. List currently resting orders.
// ===========================================================================
app.get('/orders/open', apiKeyAuth({ requirePermission: 'read' }), async (c) => {
  const user = c.get('user') as { id: string };
  const symbol = c.req.query('symbol');

  let sql =
    `SELECT o.id, m.base_coin, m.quote_coin,
            o.side, o.type, o.status,
            CAST(o.price  AS REAL) AS price,
            CAST(o.amount AS REAL) AS amount,
            CAST(o.filled AS REAL) AS filled,
            o.time_in_force, o.created_at
       FROM orders o
       JOIN markets m ON m.id = o.market_id
      WHERE o.user_id = ?
        AND o.status IN ('open','partial','pending')`;
  const args: any[] = [user.id];
  if (symbol && typeof symbol === 'string') {
    const [base, quote] = symbol.toUpperCase().split('-');
    if (base && quote) {
      sql += ' AND m.base_coin = ? AND m.quote_coin = ?';
      args.push(base, quote);
    }
  }
  sql += ' ORDER BY o.created_at DESC LIMIT 200';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ ok: true, orders: results || [] });
});

// ===========================================================================
// /orders/history — read. Closed / filled / cancelled orders.
// ===========================================================================
app.get('/orders/history', apiKeyAuth({ requirePermission: 'read' }), async (c) => {
  const user = c.get('user') as { id: string };
  const symbol = c.req.query('symbol');
  const limitRaw = parseInt(c.req.query('limit') || '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;

  let sql =
    `SELECT o.id, m.base_coin, m.quote_coin,
            o.side, o.type, o.status,
            CAST(o.price  AS REAL) AS price,
            CAST(o.amount AS REAL) AS amount,
            CAST(o.filled AS REAL) AS filled,
            o.time_in_force, o.created_at
       FROM orders o
       JOIN markets m ON m.id = o.market_id
      WHERE o.user_id = ?
        AND o.status NOT IN ('open','partial','pending')`;
  const args: any[] = [user.id];
  if (symbol && typeof symbol === 'string') {
    const [base, quote] = symbol.toUpperCase().split('-');
    if (base && quote) {
      sql += ' AND m.base_coin = ? AND m.quote_coin = ?';
      args.push(base, quote);
    }
  }
  sql += ' ORDER BY o.created_at DESC LIMIT ?';
  args.push(limit);
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ ok: true, orders: results || [] });
});

// ===========================================================================
// POST /orders — trade. Place a new order.
// Mirrors the JWT path's contract: market_symbol, side, type, price?, amount,
// time_in_force?, stop_price?  Inserted as 'pending' and matched by the
// existing engine.
// ===========================================================================
app.post('/orders', apiKeyAuth({ requirePermission: 'trade' }), async (c) => {
  const apiKey = c.get('apiKey') as ApiKeyRecord;
  const user = c.get('user') as { id: string };
  const bodyText = c.get('apiKeyBody') as string;
  const body = safeParseJson(bodyText) || {};

  // Phase F circuit breaker — same gate as JWT path.
  const risk = await getRiskState(c);
  if (risk.circuit_breaker.enabled) {
    return c.json(
      {
        error: 'Trading temporarily halted by exchange operator',
        code: 'CIRCUIT_BREAKER',
        reason: risk.circuit_breaker.reason || null,
      },
      503,
    );
  }

  const market_symbol = body.market_symbol || body.symbol;
  const side = body.side;
  const type = body.type;
  const time_in_force = body.time_in_force || 'GTC';
  const priceRaw = body.price;
  const amountRaw = body.amount;
  const stopPriceRaw = body.stop_price;

  if (!market_symbol || typeof market_symbol !== 'string') {
    return c.json({ error: 'Invalid market_symbol', code: 'BAD_PARAM' }, 400);
  }
  if (!['buy', 'sell'].includes(side)) {
    return c.json({ error: 'side must be buy or sell', code: 'BAD_PARAM' }, 400);
  }
  if (!['limit', 'market', 'stop_limit'].includes(type)) {
    return c.json({ error: 'type must be limit | market | stop_limit', code: 'BAD_PARAM' }, 400);
  }
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json({ error: 'amount must be > 0', code: 'BAD_PARAM' }, 400);
  }
  let price: number | null = null;
  if (type !== 'market') {
    price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) {
      return c.json({ error: 'price required for non-market orders', code: 'BAD_PARAM' }, 400);
    }
  }
  let stopPrice: number | null = null;
  if (type === 'stop_limit') {
    stopPrice = Number(stopPriceRaw);
    if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
      return c.json({ error: 'stop_price required for stop_limit', code: 'BAD_PARAM' }, 400);
    }
  }

  const [base, quote] = market_symbol.toUpperCase().split('-');
  if (!base || !quote) {
    return c.json({ error: 'Invalid market_symbol format', code: 'BAD_PARAM' }, 400);
  }

  const market = await c.env.DB.prepare(
    'SELECT id, base_coin, quote_coin FROM markets WHERE base_coin = ? AND quote_coin = ? LIMIT 1',
  )
    .bind(base, quote)
    .first<{ id: string }>();
  if (!market) {
    return c.json({ error: 'Market not found', code: 'BAD_PARAM' }, 400);
  }

  // Insert as 'pending' — engine cron picks it up next tick (mirrors
  // routes/order.ts behaviour).
  const id = uuid();
  const initialStatus = type === 'market' ? 'pending' : 'open';
  const safeAmount = floorToDecimals(amount, 8);

  try {
    await c.env.DB.prepare(
      `INSERT INTO orders
         (id, user_id, market_id, side, type, status,
          price, amount, filled, time_in_force, stop_price, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, datetime('now'))`,
    )
      .bind(
        id,
        user.id,
        market.id,
        side,
        type,
        initialStatus,
        price,
        safeAmount,
        time_in_force,
        stopPrice,
      )
      .run();
  } catch (err: any) {
    return c.json(
      { error: 'Order insert failed', code: 'INSERT_FAILED', detail: String(err?.message || err) },
      500,
    );
  }

  return c.json(
    {
      ok: true,
      order_id: id,
      api_key_id: apiKey.id,
      market_symbol: `${base}-${quote}`,
      side,
      type,
      status: initialStatus,
      price,
      amount: safeAmount,
      time_in_force,
      stop_price: stopPrice,
    },
    201,
  );
});

// ===========================================================================
// DELETE /orders/:id — trade. Cancel a resting order.
// ===========================================================================
app.delete('/orders/:id', apiKeyAuth({ requirePermission: 'trade' }), async (c) => {
  const user = c.get('user') as { id: string };
  const id = c.req.param('id');

  const order = await c.env.DB.prepare(
    'SELECT id, user_id, status FROM orders WHERE id = ? AND user_id = ?',
  )
    .bind(id, user.id)
    .first<{ id: string; user_id: string; status: string }>();
  if (!order) {
    return c.json({ error: 'Order not found', code: 'NOT_FOUND' }, 404);
  }
  if (!['open', 'partial', 'pending'].includes(order.status)) {
    return c.json(
      { error: `Order status '${order.status}' is not cancellable`, code: 'BAD_STATE' },
      409,
    );
  }

  try {
    await c.env.DB.prepare(
      "UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
    )
      .bind(id)
      .run();
  } catch {
    return c.json({ error: 'Cancel failed', code: 'UPDATE_FAILED' }, 500);
  }

  return c.json({ ok: true, order_id: id, status: 'cancelled' });
});

// ===========================================================================
// GET /positions — read. Open futures positions (Phase H1 schema).
// ===========================================================================
app.get('/positions', apiKeyAuth({ requirePermission: 'read' }), async (c) => {
  const user = c.get('user') as { id: string };
  let results: any[] = [];
  try {
    const r = await c.env.DB.prepare(
      `SELECT id, symbol, side, leverage, margin_mode,
              CAST(entry_price        AS REAL) AS entry_price,
              CAST(size               AS REAL) AS size,
              CAST(margin             AS REAL) AS margin,
              CAST(liquidation_price  AS REAL) AS liquidation_price,
              status, opened_at
         FROM futures_positions
        WHERE user_id = ?
          AND status = 'open'
        ORDER BY opened_at DESC
        LIMIT 200`,
    )
      .bind(user.id)
      .all();
    results = r.results || [];
  } catch {
    // futures schema may not be migrated in dev — return empty list.
    results = [];
  }
  return c.json({ ok: true, positions: results });
});

// ===========================================================================
// GET /server-time — health probe / clock-sync helper. No permission needed
// beyond a valid signed call (read).
// ===========================================================================
app.get('/server-time', apiKeyAuth({ requirePermission: 'read' }), async (c) => {
  return c.json({ ok: true, server_time: Date.now() });
});

export default app;
