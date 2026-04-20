import { Router } from 'express';
import db from '../database.js';

const router = Router();

// Get all coins
router.get('/coins', (req, res) => {
  const coins = db.prepare('SELECT * FROM coins WHERE is_active = 1 ORDER BY sort_order').all();
  res.json(coins);
});

// Get all markets
router.get('/markets', (req, res) => {
  const markets = db.prepare(`
    SELECT m.*, bc.name as base_name, bc.price_usd as base_price, bc.change_24h, bc.volume_24h, bc.high_24h, bc.low_24h, bc.icon as base_icon
    FROM markets m
    JOIN coins bc ON bc.symbol = m.base_coin
    WHERE m.is_active = 1
    ORDER BY bc.sort_order
  `).all();
  res.json(markets);
});

// Get single market
router.get('/markets/:symbol', (req, res) => {
  const [base, quote] = req.params.symbol.split('-');
  const market = db.prepare(`
    SELECT m.*, bc.name as base_name, bc.price_usd as base_price, bc.change_24h, bc.volume_24h, bc.icon as base_icon
    FROM markets m JOIN coins bc ON bc.symbol = m.base_coin
    WHERE m.base_coin = ? AND m.quote_coin = ?
  `).get(base, quote);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  res.json(market);
});

// Get orderbook
router.get('/orderbook/:symbol', (req, res) => {
  const [base, quote] = req.params.symbol.split('-');
  const market = db.prepare('SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?').get(base, quote);
  if (!market) return res.status(404).json({ error: 'Market not found' });

  const depth = parseInt(req.query.depth) || 25;
  const bids = db.prepare(
    `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'buy' AND status IN ('open','partial') GROUP BY price ORDER BY price DESC LIMIT ?`
  ).all(market.id, depth);
  const asks = db.prepare(
    `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'sell' AND status IN ('open','partial') GROUP BY price ORDER BY price ASC LIMIT ?`
  ).all(market.id, depth);

  res.json({ bids, asks });
});

// Get recent trades
router.get('/trades/:symbol', (req, res) => {
  const [base, quote] = req.params.symbol.split('-');
  const market = db.prepare('SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?').get(base, quote);
  if (!market) return res.status(404).json({ error: 'Market not found' });

  const limit = parseInt(req.query.limit) || 50;
  const trades = db.prepare(`
    SELECT t.id, t.price, t.amount, t.total, t.created_at,
      CASE WHEN o.side = 'buy' THEN 'buy' ELSE 'sell' END as side
    FROM trades t
    JOIN orders o ON o.id = t.buy_order_id
    WHERE t.market_id = ?
    ORDER BY t.created_at DESC LIMIT ?
  `).all(market.id, limit);

  res.json(trades);
});

// Get candles
router.get('/candles/:symbol', (req, res) => {
  const [base, quote] = req.params.symbol.split('-');
  const market = db.prepare('SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?').get(base, quote);
  if (!market) return res.status(404).json({ error: 'Market not found' });

  const interval = req.query.interval || '1h';
  const limit = parseInt(req.query.limit) || 200;

  const candles = db.prepare(
    'SELECT open_time as time, open, high, low, close, volume FROM candles WHERE market_id = ? AND interval = ? ORDER BY open_time DESC LIMIT ?'
  ).all(market.id, interval, limit);

  res.json(candles.reverse());
});

// Get ticker for all markets
router.get('/tickers', (req, res) => {
  const markets = db.prepare('SELECT * FROM markets WHERE is_active = 1').all();
  const tickers = {};

  markets.forEach(m => {
    const symbol = `${m.base_coin}-${m.quote_coin}`;
    const lastTrade = db.prepare('SELECT price FROM trades WHERE market_id = ? ORDER BY created_at DESC LIMIT 1').get(m.id);
    const lastCandle = db.prepare('SELECT close FROM candles WHERE market_id = ? AND interval = ? ORDER BY open_time DESC LIMIT 1').get(m.id, '1m');
    const coin = db.prepare('SELECT * FROM coins WHERE symbol = ?').get(m.base_coin);

    tickers[symbol] = {
      last: lastTrade?.price || lastCandle?.close || coin?.price_usd || 0,
      change: coin?.change_24h || (Math.random() - 0.5) * 10,
      volume: coin?.volume_24h || Math.random() * 1000000,
      high: coin?.high_24h || 0,
      low: coin?.low_24h || 0,
    };
  });

  res.json(tickers);
});

export default router;
