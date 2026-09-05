import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { isQuantariumAsset } from '../lib/asset-routing';
import {
  fetchExternalCandles,
  fetchExternalTicker,
  fetchExternalTickersBatch,
} from '../lib/market-data';
const app = new Hono<AppEnv>();

// Get coins
app.get('/coins', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM coins WHERE is_active = 1 ORDER BY sort_order').all();
  return c.json(results);
});

// Get markets
//
// 5 s edge cache so a market list refresh on the home/markets page is
// served from Cloudflare's edge for everyone after the first hit, instead
// of going through Workers + D1 every time.
app.get('/markets', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT m.*, c.name as base_name, c.price_usd as base_price, c.change_24h, c.volume_24h, c.high_24h, c.low_24h, c.icon as base_icon
    FROM markets m JOIN coins c ON c.symbol = m.base_coin WHERE m.is_active = 1 ORDER BY c.sort_order
  `).all();
  c.header('Cache-Control', 'public, max-age=5, s-maxage=10');
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
//
// Coin-family split (same rule as the wallet router — isQuantariumAsset):
//   • Standard global coins (BTC, ETH, BNB, ...) → REAL candles proxied from a
//     public spot exchange (OKX, Coinbase fallback) so the chart moves exactly
//     like every other global exchange.
//   • Quantarium-native assets (QTA, QX, QKEY) → OUR OWN candles from D1, built
//     by our matching engine. We handle these ourselves.
app.get('/candles/:symbol', async (c) => {
  const [base, quote] = c.req.param('symbol').split('-');
  const interval = c.req.query('interval') || '1h';
  const limit = parseInt(c.req.query('limit') || '200');

  // ---- Standard coins: real market data ----
  if (!isQuantariumAsset(base)) {
    const external = await fetchExternalCandles(base, interval, limit);
    if (external.length) {
      // Short edge cache — real data changes every few seconds; the client
      // also polls the latest candle so staleness stays sub-10s.
      c.header('Cache-Control', 'public, max-age=5, s-maxage=10');
      return c.json(external);
    }
    // If the external provider is unreachable, fall through to whatever we have
    // cached in D1 rather than returning an empty chart.
  }

  const market = await c.env.DB.prepare('SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?').bind(base, quote).first() as any;
  if (!market) return c.json({ error: 'Market not found' }, 404);

  const { results } = await c.env.DB.prepare(
    'SELECT open_time as time, open, high, low, close, volume FROM candles WHERE market_id = ? AND interval = ? ORDER BY open_time DESC LIMIT ?'
  ).bind(market.id, interval, limit).all();

  return c.json(results.reverse());
});

// Tickers
//
// Performance: previously this endpoint ran an N+1 query pattern
// (1 markets query + 1 coin query per market + 1 candle query per market =
// 45+ DB roundtrips for 22 markets, ~700-900 ms total on D1). We now do it
// with exactly **3** queries regardless of market count and join in memory,
// dropping the response time to ~50-100 ms.
app.get('/tickers', async (c) => {
  const [marketsRes, coinsRes, candlesRes] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM markets WHERE is_active = 1').all(),
    c.env.DB.prepare('SELECT * FROM coins WHERE is_active = 1').all(),
    // Latest 1m candle per market via a correlated subquery — single roundtrip.
    c.env.DB.prepare(`
      SELECT c.market_id, c.close
        FROM candles c
       WHERE c.interval = '1m'
         AND c.open_time = (
           SELECT MAX(open_time) FROM candles
            WHERE market_id = c.market_id AND interval = '1m'
         )
    `).all().catch(() => ({ results: [] as any[] })),
  ]);

  const markets = marketsRes.results as any[];
  const coinsBySymbol = new Map<string, any>();
  for (const c of coinsRes.results as any[]) coinsBySymbol.set(c.symbol, c);
  const closeByMarket = new Map<string, number>();
  for (const r of (candlesRes.results || []) as any[]) closeByMarket.set(r.market_id, r.close);

  // Coin-family split: standard coins get REAL 24h tickers from the public
  // spot exchange (one batched request for all of them); Quantarium-native
  // assets (QTA/QX/QKEY) keep using our own D1 data.
  const standardBases = Array.from(
    new Set(markets.map((m) => m.base_coin).filter((b: string) => !isQuantariumAsset(b))),
  ) as string[];
  const externalTickers = await fetchExternalTickersBatch(standardBases);

  const tickers: Record<string, any> = {};
  for (const m of markets) {
    const sym = `${m.base_coin}-${m.quote_coin}`;
    const coin = coinsBySymbol.get(m.base_coin);

    // Standard coin with a live external ticker → use the real market.
    const ext = !isQuantariumAsset(m.base_coin) ? externalTickers.get(m.base_coin) : undefined;
    if (ext) {
      tickers[sym] = {
        last: ext.last,
        change: ext.change,
        volume: ext.volume,
        high: ext.high,
        low: ext.low,
      };
      continue;
    }

    // Quantarium asset, stablecoin, or external provider miss → our own data.
    // QuantaEX is USD-denominated; USDT and USDC both peg to ~$1 so the
    // base coin's USD price applies directly without conversion.
    //
    // ★ FIX (2026-09-05): for OUR coins (QTA/QX/QKEY) the header ticker MUST
    //   match the actual last traded price (order-book centre / recent trades),
    //   which is exactly what `coins.price_usd` is kept at by matchOrder. The
    //   old code re-ran nextPolicyPrice() here on every /tickers call, which
    //   pulled the value back toward price_center each request and produced a
    //   header price (e.g. 0.004373) that disagreed with the order book's last
    //   price (e.g. 0.004862). We now use the stored price_usd directly so the
    //   header and the order book always show the SAME number. (The managed
    //   random-walk lives in the mm-bot tick, which already updates price_usd.)
    const price = (coin && isQuantariumAsset(m.base_coin))
      ? (coin.price_usd ?? closeByMarket.get(m.id) ?? 0)
      : (closeByMarket.get(m.id) ?? coin?.price_usd ?? 0);

    tickers[sym] = {
      last: price,
      change: coin?.change_24h ?? 0,
      volume: coin?.volume_24h ?? 0,
      high: coin?.high_24h || price,
      low: coin?.low_24h || price,
    };
  }

  c.header('Cache-Control', 'public, max-age=5, s-maxage=10');
  return c.json(tickers);
});

export default app;
