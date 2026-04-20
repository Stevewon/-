import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Place order
router.post('/', authMiddleware, (req, res) => {
  try {
    const { market_symbol, side, type, price, amount } = req.body;
    const [base, quote] = market_symbol.split('-');

    const market = db.prepare('SELECT * FROM markets WHERE base_coin = ? AND quote_coin = ?').get(base, quote);
    if (!market) return res.status(404).json({ error: 'Market not found' });

    if (!['buy', 'sell'].includes(side)) return res.status(400).json({ error: 'Invalid side' });
    if (!['limit', 'market'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (type === 'limit' && (!price || price <= 0)) return res.status(400).json({ error: 'Price required for limit order' });

    // Check balance
    if (side === 'buy') {
      const total = type === 'limit' ? price * amount : amount * 999999; // market order estimate
      const wallet = db.prepare('SELECT available FROM wallets WHERE user_id = ? AND coin_symbol = ?').get(req.user.id, quote);
      if (!wallet || wallet.available < total) return res.status(400).json({ error: 'Insufficient balance' });

      // Lock funds
      const lockAmount = type === 'limit' ? price * amount * (1 + market.taker_fee) : wallet.available;
      db.prepare('UPDATE wallets SET available = available - ?, locked = locked + ? WHERE user_id = ? AND coin_symbol = ?')
        .run(lockAmount, lockAmount, req.user.id, quote);
    } else {
      const wallet = db.prepare('SELECT available FROM wallets WHERE user_id = ? AND coin_symbol = ?').get(req.user.id, base);
      if (!wallet || wallet.available < amount) return res.status(400).json({ error: 'Insufficient balance' });

      db.prepare('UPDATE wallets SET available = available - ?, locked = locked + ? WHERE user_id = ? AND coin_symbol = ?')
        .run(amount, amount, req.user.id, base);
    }

    const orderId = uuidv4();
    const orderPrice = type === 'market' ? null : price;

    db.prepare(`INSERT INTO orders (id, user_id, market_id, side, type, price, amount, remaining, total) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(orderId, req.user.id, market.id, side, type, orderPrice, amount, amount, (orderPrice || 0) * amount);

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

    // Process through matching engine
    const engine = req.app.get('matchingEngine');
    const result = engine.processOrder(order);

    res.json({
      order: result.order,
      trades: result.trades.map(t => ({ id: t.id, price: t.price, amount: t.amount, total: t.total })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cancel order
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!['open', 'partial'].includes(order.status)) return res.status(400).json({ error: 'Order cannot be cancelled' });

    const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(order.market_id);

    // Unlock remaining funds
    if (order.side === 'buy') {
      const unlockAmount = order.remaining * order.price * (1 + market.taker_fee);
      db.prepare('UPDATE wallets SET available = available + ?, locked = locked - ? WHERE user_id = ? AND coin_symbol = ?')
        .run(unlockAmount, unlockAmount, req.user.id, market.quote_coin);
    } else {
      db.prepare('UPDATE wallets SET available = available + ?, locked = locked - ? WHERE user_id = ? AND coin_symbol = ?')
        .run(order.remaining, order.remaining, req.user.id, market.base_coin);
    }

    db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('cancelled', order.id);

    // Broadcast updated orderbook
    const engine = req.app.get('matchingEngine');
    const orderbook = engine.getOrderbook(market.id);
    const symbol = `${market.base_coin}${market.quote_coin}`;
    req.app.get('io')?.to(symbol)?.emit('orderbook', orderbook);

    res.json({ message: 'Order cancelled' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get user orders
router.get('/my', authMiddleware, (req, res) => {
  const { status, market } = req.query;
  let sql = `SELECT o.*, m.base_coin, m.quote_coin FROM orders o JOIN markets m ON m.id = o.market_id WHERE o.user_id = ?`;
  const params = [req.user.id];

  if (status === 'open') {
    sql += ` AND o.status IN ('open','partial')`;
  } else if (status === 'closed') {
    sql += ` AND o.status IN ('filled','cancelled')`;
  }
  if (market) {
    const [base, quote] = market.split('-');
    sql += ` AND m.base_coin = ? AND m.quote_coin = ?`;
    params.push(base, quote);
  }

  sql += ' ORDER BY o.created_at DESC LIMIT 100';
  const orders = db.prepare(sql).all(...params);
  res.json(orders);
});

// Get user trades
router.get('/my/trades', authMiddleware, (req, res) => {
  const trades = db.prepare(`
    SELECT t.*, m.base_coin, m.quote_coin,
      CASE WHEN t.buyer_id = ? THEN 'buy' ELSE 'sell' END as side
    FROM trades t JOIN markets m ON m.id = t.market_id
    WHERE t.buyer_id = ? OR t.seller_id = ?
    ORDER BY t.created_at DESC LIMIT 100
  `).all(req.user.id, req.user.id, req.user.id);
  res.json(trades);
});

export default router;
