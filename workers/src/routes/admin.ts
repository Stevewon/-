import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const app = new Hono<AppEnv>();

// All admin routes require auth + admin role
app.use('*', authMiddleware, adminMiddleware);

// Dashboard stats
app.get('/stats', async (c) => {
  const users = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first() as any;
  const orders = await c.env.DB.prepare('SELECT COUNT(*) as count FROM orders').first() as any;
  const trades = await c.env.DB.prepare('SELECT COUNT(*) as count FROM trades').first() as any;
  const pendingKyc = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE kyc_status = 'pending'").first() as any;
  const pendingWithdrawals = await c.env.DB.prepare("SELECT COUNT(*) as count FROM withdrawals WHERE status = 'pending'").first() as any;
  const totalVolume = await c.env.DB.prepare('SELECT SUM(total) as total FROM trades').first() as any;

  return c.json({
    users: users.count,
    orders: orders.count,
    trades: trades.count,
    pendingKyc: pendingKyc.count,
    pendingWithdrawals: pendingWithdrawals.count,
    totalVolume: totalVolume.total || 0,
  });
});

// User list
app.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, email, nickname, role, kyc_status, is_active, created_at FROM users ORDER BY created_at DESC'
  ).all();
  return c.json(results);
});

// Toggle user active status
app.post('/users/:userId/toggle', async (c) => {
  const userId = c.req.param('userId');
  const user = await c.env.DB.prepare('SELECT is_active FROM users WHERE id = ?').bind(userId).first() as any;
  if (!user) return c.json({ error: 'User not found' }, 404);
  const newStatus = user.is_active ? 0 : 1;
  await c.env.DB.prepare('UPDATE users SET is_active = ? WHERE id = ?').bind(newStatus, userId).run();
  return c.json({ message: `User ${newStatus ? 'activated' : 'deactivated'}` });
});

// KYC pending list
app.get('/kyc/pending', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, nickname, kyc_status, kyc_name, kyc_phone, kyc_id_number, created_at FROM users WHERE kyc_status = 'pending'"
  ).all();
  return c.json(results);
});

// KYC approve
app.post('/kyc/:userId/approve', async (c) => {
  await c.env.DB.prepare("UPDATE users SET kyc_status = 'approved' WHERE id = ?").bind(c.req.param('userId')).run();
  return c.json({ message: 'KYC approved' });
});

// KYC reject
app.post('/kyc/:userId/reject', async (c) => {
  await c.env.DB.prepare("UPDATE users SET kyc_status = 'rejected' WHERE id = ?").bind(c.req.param('userId')).run();
  return c.json({ message: 'KYC rejected' });
});

// Withdrawal list
app.get('/withdrawals', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT w.*, u.email, u.nickname FROM withdrawals w
    JOIN users u ON u.id = w.user_id
    ORDER BY w.created_at DESC
  `).all();
  return c.json(results);
});

// Approve withdrawal
app.post('/withdrawals/:id/approve', async (c) => {
  const wId = c.req.param('id');
  const w = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(wId).first() as any;
  if (!w) return c.json({ error: 'Not found' }, 404);

  const txHash = `0x${Date.now().toString(16)}${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`;
  await c.env.DB.prepare("UPDATE withdrawals SET status = 'completed', tx_hash = ? WHERE id = ?").bind(txHash, wId).run();
  return c.json({ message: 'Withdrawal approved' });
});

// Reject withdrawal (refund)
app.post('/withdrawals/:id/reject', async (c) => {
  const wId = c.req.param('id');
  const w = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(wId).first() as any;
  if (!w) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare('UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = ?')
    .bind(w.amount + w.fee, w.user_id, w.coin_symbol).run();
  await c.env.DB.prepare("UPDATE withdrawals SET status = 'rejected' WHERE id = ?").bind(wId).run();
  return c.json({ message: 'Withdrawal rejected and refunded' });
});

// Coin management
app.get('/coins', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM coins ORDER BY sort_order').all();
  return c.json(results);
});

app.put('/coins/:symbol', async (c) => {
  const { price_usd, is_active } = await c.req.json();
  if (price_usd !== undefined) {
    await c.env.DB.prepare('UPDATE coins SET price_usd = ? WHERE symbol = ?').bind(price_usd, c.req.param('symbol')).run();
  }
  if (is_active !== undefined) {
    await c.env.DB.prepare('UPDATE coins SET is_active = ? WHERE symbol = ?').bind(is_active ? 1 : 0, c.req.param('symbol')).run();
  }
  return c.json({ message: 'Coin updated' });
});

// All orders (admin view)
app.get('/orders', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT o.*, m.base_coin, m.quote_coin, u.email, u.nickname
    FROM orders o
    JOIN markets m ON m.id = o.market_id
    JOIN users u ON u.id = o.user_id
    ORDER BY o.created_at DESC LIMIT 200
  `).all();
  return c.json(results);
});

// All trades (admin view)
app.get('/trades', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT t.*, m.base_coin, m.quote_coin
    FROM trades t JOIN markets m ON m.id = t.market_id
    ORDER BY t.created_at DESC LIMIT 200
  `).all();
  return c.json(results);
});

export default app;
