import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { createNotification } from './notifications';

const app = new Hono<AppEnv>();

// All admin routes require auth + admin role
app.use('*', authMiddleware, adminMiddleware);

function uuid() {
  return crypto.randomUUID();
}

// ============================================================================
// Dashboard stats (enhanced)
// ============================================================================
app.get('/stats', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const since24h = new Date(now - 24 * 3600 * 1000).toISOString();
  const since7d = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

  const [
    users, activeUsers, newUsers24h, newUsers7d,
    orders, openOrders,
    trades, trades24h,
    pendingKyc, approvedKyc,
    pendingWithdrawals, pendingDeposits,
    totalVolume, volume24h,
    feeRevenue, feeRevenue24h,
  ] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS cnt FROM users').first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE is_active = 1').first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE created_at >= ?').bind(since24h).first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE created_at >= ?').bind(since7d).first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) AS cnt FROM orders').first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) AS cnt FROM orders WHERE status IN ('open','partial')").first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) AS cnt FROM trades').first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) AS cnt FROM trades WHERE created_at >= ?').bind(since24h).first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE kyc_status = 'pending'").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE kyc_status = 'approved'").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) AS cnt FROM withdrawals WHERE status = 'pending'").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) AS cnt FROM deposits WHERE status = 'pending'").first<{ cnt: number }>(),
    db.prepare('SELECT COALESCE(SUM(total), 0) AS total FROM trades').first<{ total: number }>(),
    db.prepare('SELECT COALESCE(SUM(total), 0) AS total FROM trades WHERE created_at >= ?').bind(since24h).first<{ total: number }>(),
    db.prepare('SELECT COALESCE(SUM(buyer_fee + seller_fee), 0) AS total FROM trades').first<{ total: number }>(),
    db.prepare('SELECT COALESCE(SUM(buyer_fee + seller_fee), 0) AS total FROM trades WHERE created_at >= ?').bind(since24h).first<{ total: number }>(),
  ]);

  return c.json({
    users: users?.cnt || 0,
    activeUsers: activeUsers?.cnt || 0,
    newUsers24h: newUsers24h?.cnt || 0,
    newUsers7d: newUsers7d?.cnt || 0,
    orders: orders?.cnt || 0,
    openOrders: openOrders?.cnt || 0,
    trades: trades?.cnt || 0,
    trades24h: trades24h?.cnt || 0,
    pendingKyc: pendingKyc?.cnt || 0,
    approvedKyc: approvedKyc?.cnt || 0,
    pendingWithdrawals: pendingWithdrawals?.cnt || 0,
    pendingDeposits: pendingDeposits?.cnt || 0,
    totalVolume: totalVolume?.total || 0,
    volume24h: volume24h?.total || 0,
    feeRevenue: feeRevenue?.total || 0,
    feeRevenue24h: feeRevenue24h?.total || 0,
  });
});

// ============================================================================
// Daily trend (last 14 days)
// ============================================================================
app.get('/trends', async (c) => {
  const db = c.env.DB;
  const days = Math.min(parseInt(c.req.query('days') || '14'), 60);

  // Build date buckets (YYYY-MM-DD)
  const buckets: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    buckets.push(d.toISOString().slice(0, 10));
  }
  const sinceDate = buckets[0];

  const [userRows, tradeRows] = await Promise.all([
    db.prepare(`
      SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS cnt
      FROM users WHERE substr(created_at, 1, 10) >= ?
      GROUP BY day
    `).bind(sinceDate).all<{ day: string; cnt: number }>(),
    db.prepare(`
      SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS vol
      FROM trades WHERE substr(created_at, 1, 10) >= ?
      GROUP BY day
    `).bind(sinceDate).all<{ day: string; cnt: number; vol: number }>(),
  ]);

  const userMap = Object.fromEntries((userRows.results || []).map((r) => [r.day, r.cnt]));
  const tradeMap = Object.fromEntries((tradeRows.results || []).map((r) => [r.day, r]));

  return c.json(buckets.map((day) => ({
    day,
    users: userMap[day] || 0,
    trades: tradeMap[day]?.cnt || 0,
    volume: tradeMap[day]?.vol || 0,
  })));
});

// ============================================================================
// Top markets by 24h volume
// ============================================================================
app.get('/top-markets', async (c) => {
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query('limit') || '5'), 20);
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const { results } = await db.prepare(`
    SELECT m.base_coin, m.quote_coin,
           COUNT(t.id) AS trade_count,
           COALESCE(SUM(t.total), 0) AS volume
    FROM trades t
    JOIN markets m ON m.id = t.market_id
    WHERE t.created_at >= ?
    GROUP BY t.market_id
    ORDER BY volume DESC
    LIMIT ?
  `).bind(since24h, limit).all();

  return c.json(results);
});

// ============================================================================
// Users — filters (q, kyc, active, role), paginated
// ============================================================================
app.get('/users', async (c) => {
  const db = c.env.DB;
  const q = (c.req.query('q') || '').trim();
  const kyc = c.req.query('kyc') || '';
  const active = c.req.query('active') || '';
  const role = c.req.query('role') || '';
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const offset = parseInt(c.req.query('offset') || '0');

  const conds: string[] = [];
  const params: any[] = [];

  if (q) {
    conds.push('(email LIKE ? OR nickname LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (['none', 'pending', 'approved', 'rejected'].includes(kyc)) {
    conds.push('kyc_status = ?');
    params.push(kyc);
  }
  if (active === '1' || active === '0') {
    conds.push('is_active = ?');
    params.push(parseInt(active));
  }
  if (['user', 'admin'].includes(role)) {
    conds.push('role = ?');
    params.push(role);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const totalRow = await db.prepare(`SELECT COUNT(*) AS cnt FROM users ${where}`)
    .bind(...params).first<{ cnt: number }>();

  const { results } = await db.prepare(`
    SELECT id, email, nickname, role, kyc_status, is_active,
           two_factor_enabled, created_at, kyc_submitted_at
    FROM users
    ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ total: totalRow?.cnt || 0, rows: results });
});

// User detail
app.get('/users/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const u = await db.prepare(`
    SELECT id, email, nickname, role, kyc_status, is_active,
           two_factor_enabled, kyc_name, kyc_phone, kyc_id_number,
           kyc_address, kyc_submitted_at, kyc_reviewed_at,
           created_at, updated_at
    FROM users WHERE id = ?
  `).bind(id).first<any>();
  if (!u) return c.json({ error: 'User not found' }, 404);

  const [wallets, recentOrders, logins] = await Promise.all([
    db.prepare(`
      SELECT w.coin_symbol, w.available, w.locked, c.price_usd
      FROM wallets w
      LEFT JOIN coins c ON c.symbol = w.coin_symbol
      WHERE w.user_id = ?
      ORDER BY (w.available + w.locked) * COALESCE(c.price_usd, 0) DESC
    `).bind(u.id).all(),
    db.prepare(`
      SELECT o.id, o.side, o.type, o.price, o.amount, o.filled, o.status, o.created_at,
             m.base_coin, m.quote_coin
      FROM orders o
      JOIN markets m ON m.id = o.market_id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC LIMIT 20
    `).bind(u.id).all(),
    db.prepare(`
      SELECT ip_address, user_agent, device, status, created_at
      FROM login_history WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 10
    `).bind(u.id).all().catch(() => ({ results: [] })),
  ]);

  return c.json({
    user: u,
    wallets: wallets.results,
    recentOrders: recentOrders.results,
    logins: logins.results,
  });
});

// Toggle active (ban / unban)
app.post('/users/:id/toggle-active', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const me = c.get('user');

  const u = await db.prepare('SELECT id, is_active, email FROM users WHERE id = ?').bind(id).first<any>();
  if (!u) return c.json({ error: 'User not found' }, 404);
  if (u.id === me.id) return c.json({ error: 'Cannot deactivate yourself' }, 400);

  const newVal = u.is_active ? 0 : 1;
  await db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(newVal, u.id).run();

  try {
    await createNotification(db, u.id, {
      type: 'system',
      title: newVal ? 'Account Reactivated' : 'Account Deactivated',
      message: newVal
        ? 'Your account has been reactivated by an administrator.'
        : 'Your account has been deactivated. Contact support if you believe this is an error.',
    });
  } catch { /* ignore */ }

  return c.json({ is_active: newVal });
});

// Change role
app.post('/users/:id/role', async (c) => {
  const db = c.env.DB;
  const me = c.get('user');
  const { role } = await c.req.json().catch(() => ({}));
  if (!['user', 'admin'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400);
  }
  const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!u) return c.json({ error: 'User not found' }, 404);
  if (u.id === me.id && role === 'user') {
    return c.json({ error: 'Cannot demote yourself' }, 400);
  }
  await db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(role, u.id).run();
  return c.json({ role });
});

// Reset 2FA (emergency)
app.post('/users/:id/reset-2fa', async (c) => {
  const db = c.env.DB;
  const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!u) return c.json({ error: 'User not found' }, 404);
  await db.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?').bind(u.id).run();
  try {
    await createNotification(db, u.id, {
      type: 'system',
      title: '2FA Reset',
      message: 'Your two-factor authentication has been reset by an administrator. Please set it up again.',
    });
  } catch { /* ignore */ }
  return c.json({ ok: true });
});

// Legacy alias (kept for existing Hono clients)
app.post('/users/:userId/toggle', async (c) => {
  const db = c.env.DB;
  const userId = c.req.param('userId');
  const user = await db.prepare('SELECT is_active FROM users WHERE id = ?').bind(userId).first<any>();
  if (!user) return c.json({ error: 'User not found' }, 404);
  const newStatus = user.is_active ? 0 : 1;
  await db.prepare('UPDATE users SET is_active = ? WHERE id = ?').bind(newStatus, userId).run();
  return c.json({ message: `User ${newStatus ? 'activated' : 'deactivated'}`, is_active: newStatus });
});

// ============================================================================
// KYC management
// ============================================================================
app.get('/kyc/pending', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT id, email, nickname, kyc_status, kyc_name, kyc_phone, kyc_id_number,
           kyc_address, kyc_submitted_at, created_at
    FROM users
    WHERE kyc_status = 'pending'
    ORDER BY kyc_submitted_at DESC, created_at DESC
  `).all();
  return c.json(results);
});

app.post('/kyc/:userId/approve', async (c) => {
  const db = c.env.DB;
  const userId = c.req.param('userId');
  const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first<any>();
  if (!u) return c.json({ error: 'User not found' }, 404);
  await db.prepare(`
    UPDATE users SET kyc_status = 'approved', kyc_reviewed_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(u.id).run();
  try {
    await createNotification(db, u.id, {
      type: 'system',
      title: 'KYC Approved',
      message: 'Your identity verification has been approved. You now have full trading access.',
    });
  } catch { /* ignore */ }
  return c.json({ message: 'KYC approved' });
});

app.post('/kyc/:userId/reject', async (c) => {
  const db = c.env.DB;
  const userId = c.req.param('userId');
  const { reason } = await c.req.json().catch(() => ({}));
  const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first<any>();
  if (!u) return c.json({ error: 'User not found' }, 404);
  await db.prepare(`
    UPDATE users SET kyc_status = 'rejected', kyc_reviewed_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(u.id).run();
  try {
    await createNotification(db, u.id, {
      type: 'system',
      title: 'KYC Rejected',
      message: reason
        ? `Your KYC was rejected: ${reason}. Please resubmit with correct information.`
        : 'Your KYC was rejected. Please resubmit with correct information.',
    });
  } catch { /* ignore */ }
  return c.json({ message: 'KYC rejected' });
});

// ============================================================================
// Withdrawals
// ============================================================================
app.get('/withdrawals', async (c) => {
  const db = c.env.DB;
  const status = c.req.query('status') || '';
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);

  let sql = `
    SELECT w.*, u.email, u.nickname
    FROM withdrawals w
    JOIN users u ON u.id = w.user_id
  `;
  const params: any[] = [];
  if (['pending', 'completed', 'rejected'].includes(status)) {
    sql += ' WHERE w.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY w.created_at DESC LIMIT ?';
  params.push(limit);

  const { results } = await db.prepare(sql).bind(...params).all();
  return c.json(results);
});

app.post('/withdrawals/:id/approve', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const w = await db.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(id).first<any>();
  if (!w) return c.json({ error: 'Not found' }, 404);
  if (w.status !== 'pending') return c.json({ error: 'Not pending' }, 400);

  const tx = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  await db.prepare("UPDATE withdrawals SET status = 'completed', tx_hash = ? WHERE id = ?").bind(tx, w.id).run();

  try {
    await createNotification(db, w.user_id, {
      type: 'withdraw',
      title: 'Withdrawal Approved',
      message: `${w.amount} ${w.coin_symbol} withdrawal was approved.`,
      data: { withdrawal_id: w.id, tx_hash: tx, coin: w.coin_symbol, amount: w.amount },
    });
  } catch { /* ignore */ }

  return c.json({ message: 'Withdrawal approved', tx_hash: tx });
});

app.post('/withdrawals/:id/reject', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const { reason } = await c.req.json().catch(() => ({}));
  const w = await db.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(id).first<any>();
  if (!w) return c.json({ error: 'Not found' }, 404);
  if (w.status !== 'pending') return c.json({ error: 'Not pending' }, 400);

  // Refund available balance (amount + fee)
  await db.prepare('UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = ?')
    .bind(w.amount + (w.fee || 0), w.user_id, w.coin_symbol).run();
  await db.prepare("UPDATE withdrawals SET status = 'rejected' WHERE id = ?").bind(w.id).run();

  try {
    await createNotification(db, w.user_id, {
      type: 'withdraw',
      title: 'Withdrawal Rejected',
      message: reason
        ? `${w.amount} ${w.coin_symbol} withdrawal was rejected: ${reason}. Funds returned to your wallet.`
        : `${w.amount} ${w.coin_symbol} withdrawal was rejected. Funds returned to your wallet.`,
      data: { withdrawal_id: w.id },
    });
  } catch { /* ignore */ }

  return c.json({ message: 'Withdrawal rejected and refunded' });
});

// ============================================================================
// Deposits
// ============================================================================
app.get('/deposits', async (c) => {
  const db = c.env.DB;
  const status = c.req.query('status') || '';
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);

  let sql = `
    SELECT d.*, u.email, u.nickname
    FROM deposits d
    JOIN users u ON u.id = d.user_id
  `;
  const params: any[] = [];
  if (['pending', 'completed', 'rejected'].includes(status)) {
    sql += ' WHERE d.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY d.created_at DESC LIMIT ?';
  params.push(limit);

  const { results } = await db.prepare(sql).bind(...params).all();
  return c.json(results);
});

// Manual credit
app.post('/deposits/manual', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { user_id, coin_symbol, amount, note } = body;
  const amt = Number(amount);
  if (!user_id || !coin_symbol || !(amt > 0)) {
    return c.json({ error: 'user_id, coin_symbol, amount > 0 required' }, 400);
  }
  const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(user_id).first();
  if (!u) return c.json({ error: 'User not found' }, 404);
  const coin = await db.prepare('SELECT symbol FROM coins WHERE symbol = ?').bind(coin_symbol).first();
  if (!coin) return c.json({ error: 'Unknown coin' }, 400);

  const id = uuid();
  const tx = `MANUAL-${Date.now().toString(36)}`;
  const nowIso = new Date().toISOString();

  // D1 batch (atomic)
  const statements = [
    db.prepare(`
      INSERT INTO deposits (id, user_id, coin_symbol, amount, tx_hash, status, network, memo, created_at)
      VALUES (?, ?, ?, ?, ?, 'completed', 'MANUAL', ?, ?)
    `).bind(id, user_id, coin_symbol, amt, tx, note || null, nowIso),
  ];

  const existing = await db.prepare('SELECT id FROM wallets WHERE user_id = ? AND coin_symbol = ?')
    .bind(user_id, coin_symbol).first();
  if (existing) {
    statements.push(
      db.prepare('UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = ?')
        .bind(amt, user_id, coin_symbol)
    );
  } else {
    statements.push(
      db.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available, locked) VALUES (?, ?, ?, ?, 0)')
        .bind(uuid(), user_id, coin_symbol, amt)
    );
  }

  await db.batch(statements);

  try {
    await createNotification(db, user_id, {
      type: 'deposit',
      title: 'Manual Deposit Credited',
      message: `+${amt} ${coin_symbol} credited to your wallet${note ? ` (${note})` : ''}.`,
      data: { coin: coin_symbol, amount: amt, tx_hash: tx, manual: true },
    });
  } catch { /* ignore */ }

  return c.json({ id, tx_hash: tx, amount: amt });
});

// ============================================================================
// Trade history
// ============================================================================
app.get('/trades', async (c) => {
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 500);
  const userId = c.req.query('user_id') || '';

  let sql = `
    SELECT t.id, t.price, t.amount, t.total, t.buyer_fee, t.seller_fee, t.created_at,
           m.base_coin, m.quote_coin,
           bu.email AS buyer_email, bu.nickname AS buyer_nickname,
           su.email AS seller_email, su.nickname AS seller_nickname
    FROM trades t
    JOIN markets m ON m.id = t.market_id
    JOIN users bu ON bu.id = t.buyer_id
    JOIN users su ON su.id = t.seller_id
  `;
  const params: any[] = [];
  if (userId) {
    sql += ' WHERE t.buyer_id = ? OR t.seller_id = ?';
    params.push(userId, userId);
  }
  sql += ' ORDER BY t.created_at DESC LIMIT ?';
  params.push(limit);

  const { results } = await db.prepare(sql).bind(...params).all();
  return c.json(results);
});

// ============================================================================
// All orders (admin view)
// ============================================================================
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

// ============================================================================
// Coin management
// ============================================================================
app.get('/coins', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM coins ORDER BY sort_order, symbol').all();
  return c.json(results);
});

app.put('/coins/:symbol', async (c) => {
  const db = c.env.DB;
  const symbol = c.req.param('symbol');
  const body = await c.req.json().catch(() => ({}));
  const { price_usd, is_active, sort_order } = body;

  const coin = await db.prepare('SELECT symbol FROM coins WHERE symbol = ?').bind(symbol).first();
  if (!coin) return c.json({ error: 'Coin not found' }, 404);

  const sets: string[] = [];
  const params: any[] = [];
  if (price_usd !== undefined && price_usd !== null && !Number.isNaN(Number(price_usd))) {
    sets.push('price_usd = ?'); params.push(Number(price_usd));
  }
  if (is_active !== undefined) {
    sets.push('is_active = ?'); params.push(is_active ? 1 : 0);
  }
  if (sort_order !== undefined && !Number.isNaN(Number(sort_order))) {
    sets.push('sort_order = ?'); params.push(Number(sort_order));
  }
  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);

  params.push(symbol);
  await db.prepare(`UPDATE coins SET ${sets.join(', ')} WHERE symbol = ?`).bind(...params).run();
  return c.json({ message: 'Coin updated' });
});

// ============================================================================
// System notification broadcaster
// ============================================================================
app.post('/broadcast', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { title, message, target } = body;

  if (!title || typeof title !== 'string') {
    return c.json({ error: 'title is required' }, 400);
  }

  let userIds: string[] = [];
  if (target === 'all' || !target) {
    const { results } = await db.prepare('SELECT id FROM users WHERE is_active = 1').all<{ id: string }>();
    userIds = (results || []).map((r) => r.id);
  } else if (target === 'kyc_approved') {
    const { results } = await db.prepare("SELECT id FROM users WHERE is_active = 1 AND kyc_status = 'approved'").all<{ id: string }>();
    userIds = (results || []).map((r) => r.id);
  } else if (target === 'admins') {
    const { results } = await db.prepare("SELECT id FROM users WHERE is_active = 1 AND role = 'admin'").all<{ id: string }>();
    userIds = (results || []).map((r) => r.id);
  } else if (Array.isArray(target)) {
    userIds = target;
  } else {
    return c.json({ error: "target must be 'all' | 'kyc_approved' | 'admins' | string[]" }, 400);
  }

  let sent = 0;
  // Batch insert in groups for D1 performance
  const BATCH_SIZE = 25;
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const slice = userIds.slice(i, i + BATCH_SIZE);
    const stmts = slice.map((uid) =>
      db.prepare(`
        INSERT INTO notifications (id, user_id, type, title, message, data)
        VALUES (?, ?, 'system', ?, ?, NULL)
      `).bind(uuid(), uid, title, message || null)
    );
    try {
      await db.batch(stmts);
      sent += slice.length;
    } catch { /* continue */ }
  }

  return c.json({ sent, total: userIds.length });
});

// ============================================================================
// Recent activity feed
// ============================================================================
app.get('/activity', async (c) => {
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query('limit') || '30'), 100);

  const [signups, kyc, wds, deps] = await Promise.all([
    db.prepare(`
      SELECT 'signup' AS type, u.id AS entity_id, u.nickname AS actor,
             NULL AS detail, u.created_at AS ts
      FROM users u ORDER BY u.created_at DESC LIMIT ?
    `).bind(limit).all<any>(),
    db.prepare(`
      SELECT 'kyc_' || kyc_status AS type, id AS entity_id, nickname AS actor,
             kyc_name AS detail, COALESCE(kyc_reviewed_at, kyc_submitted_at) AS ts
      FROM users
      WHERE kyc_status IN ('pending','approved','rejected')
        AND COALESCE(kyc_reviewed_at, kyc_submitted_at) IS NOT NULL
      ORDER BY ts DESC LIMIT ?
    `).bind(limit).all<any>(),
    db.prepare(`
      SELECT 'withdraw_' || w.status AS type, w.id AS entity_id,
             u.nickname AS actor,
             (w.amount || ' ' || w.coin_symbol) AS detail,
             w.created_at AS ts
      FROM withdrawals w JOIN users u ON u.id = w.user_id
      ORDER BY w.created_at DESC LIMIT ?
    `).bind(limit).all<any>(),
    db.prepare(`
      SELECT 'deposit_' || d.status AS type, d.id AS entity_id,
             u.nickname AS actor,
             (d.amount || ' ' || d.coin_symbol) AS detail,
             d.created_at AS ts
      FROM deposits d JOIN users u ON u.id = d.user_id
      ORDER BY d.created_at DESC LIMIT ?
    `).bind(limit).all<any>(),
  ]);

  const merged = [
    ...(signups.results || []),
    ...(kyc.results || []),
    ...(wds.results || []),
    ...(deps.results || []),
  ]
    .filter((x: any) => x.ts)
    .sort((a: any, b: any) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, limit);

  return c.json(merged);
});

export default app;
