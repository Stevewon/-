import { Hono } from 'hono';
import type { AppEnv } from '../index';

const app = new Hono<AppEnv>();

// Get coins
app.get('/coins', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM coins WHERE is_active = 1 ORDER BY sort_order').all();
  return c.json(results);
});

// Get markets
app.get('/markets', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT m.*, c.name as base_name, c.price_usd as base_price, c.change_24h, c.volume_24h, c.high_24h, c.low_24h, c.icon as base_icon
    FROM markets m JOIN coins c ON c.symbol = m.base_coin WHERE m.is_active = 1 ORDER BY c.sort_order
  `).all();
  return c.json(results);
});

// Get single market
app.get('/markets/:symbol', async (c) => {
  const [base, quote] = c.req.param('symbol').split('-');
  const market = await c.env.DB.prepare(`
    SELECT m.*, c.name as base_name, c.price_usd as base_price, c.change_24h, c.volume_24h, c.icon as base_icon
    FROM markets m JOIN coins c ON c.symbol = m.base_coin WHERE m.base_coin = ? AND m.quote_coin = ?
  `).bind(base, quote).first();
  if (!market) return c.json({ error: 'Market not found' }, 404);
  return c.json(market);
});

// Orderbook
app.get('/orderbook/:symbol', async (c) => {
  const [base, quote] = c.req.param('symbol').split('-');
  const market = await c.env.DB.prepare('SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?').bind(base, quote).first() as any;
  if (!market) return c.json({ error: 'Market not found' }, 404);

  const depth = parseInt(c.req.query('depth') || '25');
  const { results: bids } = await c.env.DB.prepare(
    `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'buy' AND status IN ('open','partial') GROUP BY price ORDER BY price DESC LIMIT ?`
  ).bind(market.id, depth).all();
  const { results: asks } = await c.env.DB.prepare(
    `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'sell' AND status IN ('open','partial') GROUP BY price ORDER BY price ASC LIMIT ?`
  ).bind(market.id, depth).all();

  return c.json({ bids, asks });
});

// Recent trades
app.get('/trades/:symbol', async (c) => {
  const [base, quote] = c.req.param('symbol').split('-');
  const market = await c.env.DB.prepare('SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?').bind(base, quote).first() as any;
  if (!market) return c.json({ error: 'Market not found' }, 404);

  const limit = parseInt(c.req.query('limit') || '50');
  const { results } = await c.env.DB.prepare(`
    SELECT t.id, t.price, t.amount, t.total, t.created_at,
      CASE WHEN o.side = 'buy' THEN 'buy' ELSE 'sell' END as side
    FROM trades t JOIN orders o ON o.id = t.buy_order_id
    WHERE t.market_id = ? ORDER BY t.created_at DESC LIMIT ?
  `).bind(market.id, limit).all();
  return c.json(results);
});

// Candles
app.get('/candles/:symbol', async (c) => {
  const [base, quote] = c.req.param('symbol').split('-');
  const market = await c.env.DB.prepare('SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?').bind(base, quote).first() as any;
  if (!market) return c.json({ error: 'Market not found' }, 404);

  const interval = c.req.query('interval') || '1h';
  const limit = parseInt(c.req.query('limit') || '200');

  const { results } = await c.env.DB.prepare(
    'SELECT open_time as time, open, high, low, close, volume FROM candles WHERE market_id = ? AND interval = ? ORDER BY open_time DESC LIMIT ?'
  ).bind(market.id, interval, limit).all();

  return c.json(results.reverse());
});

// Tickers
app.get('/tickers', async (c) => {
  const { results: markets } = await c.env.DB.prepare('SELECT * FROM markets WHERE is_active = 1').all();
  const tickers: Record<string, any> = {};

  for (const m of markets as any[]) {
    const sym = `${m.base_coin}-${m.quote_coin}`;
    const coin = await c.env.DB.prepare('SELECT * FROM coins WHERE symbol = ?').bind(m.base_coin).first() as any;
    const lastCandle = await c.env.DB.prepare(
      'SELECT close FROM candles WHERE market_id = ? AND interval = ? ORDER BY open_time DESC LIMIT 1'
    ).bind(m.id, '1m').first() as any;

    // QuantaEX is USD-denominated; USDT and USDC both peg to ~$1 so the
    // base coin's USD price applies directly without conversion. Any legacy
    // KRW market still in the DB falls through harmlessly until migration
    // 0014 is applied.
    const price = lastCandle?.close || (coin?.price_usd || 0);
    tickers[sym] = {
      last: price,
      change: coin?.change_24h || (Math.random() - 0.5) * 10,
      volume: coin?.volume_24h || Math.random() * 1000000,
      high: coin?.high_24h || price * 1.02,
      low: coin?.low_24h || price * 0.98,
    };
  }

  return c.json(tickers);
});

export default app;
