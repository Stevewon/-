import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { createNotification } from '../services/notifications.js';

const router = Router();

router.use(authMiddleware, adminMiddleware);

// ============================================================================
// Dashboard stats (enhanced)
// ============================================================================
router.get('/stats', (req, res) => {
  const now = Date.now();
  const since24h = new Date(now - 24 * 3600 * 1000).toISOString();
  const since7d  = new Date(now - 7  * 24 * 3600 * 1000).toISOString();

  // Counts
  const users              = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
  const activeUsers        = db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE is_active = 1').get().cnt;
  const newUsers24h        = db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE created_at >= ?').get(since24h).cnt;
  const newUsers7d         = db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE created_at >= ?').get(since7d).cnt;

  const orders             = db.prepare('SELECT COUNT(*) AS cnt FROM orders').get().cnt;
  const openOrders         = db.prepare("SELECT COUNT(*) AS cnt FROM orders WHERE status IN ('open','partial')").get().cnt;

  const trades             = db.prepare('SELECT COUNT(*) AS cnt FROM trades').get().cnt;
  const trades24h          = db.prepare('SELECT COUNT(*) AS cnt FROM trades WHERE created_at >= ?').get(since24h).cnt;

  const pendingKyc         = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE kyc_status = 'pending'").get().cnt;
  const approvedKyc        = db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE kyc_status = 'approved'").get().cnt;

  const pendingWithdrawals = db.prepare("SELECT COUNT(*) AS cnt FROM withdrawals WHERE status = 'pending'").get().cnt;
  const pendingDeposits    = db.prepare("SELECT COUNT(*) AS cnt FROM deposits    WHERE status = 'pending'").get().cnt;

  const totalVolume        = db.prepare('SELECT COALESCE(SUM(total),0) AS total FROM trades').get().total;
  const volume24h          = db.prepare('SELECT COALESCE(SUM(total),0) AS total FROM trades WHERE created_at >= ?').get(since24h).total;

  // Fee revenue (both buyer & seller fees) — priced in quote coin, so approximate by summing
  const feeRevenue         = db.prepare('SELECT COALESCE(SUM(buyer_fee + seller_fee), 0) AS total FROM trades').get().total;
  const feeRevenue24h      = db.prepare('SELECT COALESCE(SUM(buyer_fee + seller_fee), 0) AS total FROM trades WHERE created_at >= ?').get(since24h).total;

  res.json({
    users, activeUsers, newUsers24h, newUsers7d,
    orders, openOrders,
    trades, trades24h,
    pendingKyc, approvedKyc,
    pendingWithdrawals, pendingDeposits,
    totalVolume, volume24h,
    feeRevenue, feeRevenue24h,
  });
});

// ============================================================================
// Daily trend (last 14 days) — new signups, trades, volume
// ============================================================================
router.get('/trends', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 14, 60);

  // Build date buckets
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    buckets.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD
  }

  const userRows = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS cnt
    FROM users
    WHERE created_at >= date('now', ?)
    GROUP BY day
  `).all(`-${days} days`);

  const tradeRows = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS vol
    FROM trades
    WHERE created_at >= date('now', ?)
    GROUP BY day
  `).all(`-${days} days`);

  const userMap  = Object.fromEntries(userRows.map(r => [r.day, r.cnt]));
  const tradeMap = Object.fromEntries(tradeRows.map(r => [r.day, r]));

  res.json(buckets.map(day => ({
    day,
    users:  userMap[day] || 0,
    trades: tradeMap[day]?.cnt || 0,
    volume: tradeMap[day]?.vol || 0,
  })));
});

// ============================================================================
// Top markets / coins by volume (24h)
// ============================================================================
router.get('/top-markets', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT m.base_coin, m.quote_coin,
           COUNT(t.id) AS trade_count,
           COALESCE(SUM(t.total), 0) AS volume
    FROM trades t
    JOIN markets m ON m.id = t.market_id
    WHERE t.created_at >= ?
    GROUP BY t.market_id
    ORDER BY volume DESC
    LIMIT ?
  `).all(since24h, limit);

  res.json(rows);
});

// ============================================================================
// Users — list with filters (search, kyc_status, is_active), paginated
// ============================================================================
router.get('/users', (req, res) => {
  const q          = (req.query.q || '').toString().trim();
  const kyc        = (req.query.kyc || '').toString();
  const active     = (req.query.active || '').toString();
  const role       = (req.query.role || '').toString();
  const limit      = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset     = parseInt(req.query.offset) || 0;

  const conds = [];
  const params = [];

  if (q) {
    conds.push('(email LIKE ? OR nickname LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (kyc && ['none','pending','approved','rejected'].includes(kyc)) {
    conds.push('kyc_status = ?');
    params.push(kyc);
  }
  if (active === '1' || active === '0') {
    conds.push('is_active = ?');
    params.push(parseInt(active));
  }
  if (role && ['user','admin'].includes(role)) {
    conds.push('role = ?');
    params.push(role);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM users ${where}`).get(...params).cnt;

  const rows = db.prepare(`
    SELECT id, email, nickname, role, kyc_status, is_active,
           two_factor_enabled, created_at, kyc_submitted_at
    FROM users
    ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ total, rows });
});

// User detail
router.get('/users/:id', (req, res) => {
  const u = db.prepare(`
    SELECT id, email, nickname, role, kyc_status, is_active,
           two_factor_enabled, kyc_name, kyc_phone, kyc_id_number,
           kyc_address, kyc_submitted_at, kyc_reviewed_at,
           created_at, updated_at
    FROM users WHERE id = ?
  `).get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });

  const wallets = db.prepare(`
    SELECT w.coin_symbol, w.available, w.locked, c.price_usd
    FROM wallets w
    LEFT JOIN coins c ON c.symbol = w.coin_symbol
    WHERE w.user_id = ?
    ORDER BY (w.available + w.locked) * COALESCE(c.price_usd, 0) DESC
  `).all(u.id);

  const recentOrders = db.prepare(`
    SELECT o.id, o.side, o.type, o.price, o.amount, o.filled, o.status, o.created_at,
           m.base_coin, m.quote_coin
    FROM orders o
    JOIN markets m ON m.id = o.market_id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC LIMIT 20
  `).all(u.id);

  const logins = db.prepare(`
    SELECT ip_address, user_agent, device, status, created_at
    FROM login_history WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 10
  `).all(u.id);

  res.json({ user: u, wallets, recentOrders, logins });
});

// Toggle active (ban/unban)
router.post('/users/:id/toggle-active', (req, res) => {
  const u = db.prepare('SELECT id, is_active, email FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate yourself' });

  const newVal = u.is_active ? 0 : 1;
  db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVal, u.id);

  // Notify the affected user
  try {
    createNotification(u.id, {
      type: 'system',
      title: newVal ? 'Account Reactivated' : 'Account Deactivated',
      message: newVal
        ? 'Your account has been reactivated by an administrator.'
        : 'Your account has been deactivated. Contact support if you believe this is an error.',
    });
  } catch (_) { /* ignore */ }

  res.json({ is_active: newVal });
});

// Change role
router.post('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id && role === 'user') {
    return res.status(400).json({ error: 'Cannot demote yourself' });
  }
  db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(role, u.id);
  res.json({ role });
});

// Reset 2FA (emergency)
router.post('/users/:id/reset-2fa', (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?').run(u.id);
  try {
    createNotification(u.id, {
      type: 'system',
      title: '2FA Reset',
      message: 'Your two-factor authentication has been reset by an administrator. Please set it up again.',
    });
  } catch (_) { /* ignore */ }
  res.json({ ok: true });
});

// ============================================================================
// KYC management
// ============================================================================
router.get('/kyc/pending', (req, res) => {
  const users = db.prepare(`
    SELECT id, email, nickname, kyc_status, kyc_name, kyc_phone, kyc_id_number,
           kyc_address, kyc_submitted_at, created_at
    FROM users
    WHERE kyc_status = 'pending'
    ORDER BY kyc_submitted_at DESC, created_at DESC
  `).all();
  res.json(users);
});

router.post('/kyc/:userId/approve', (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!u) return res.status(404).json({ error: 'User not found' });
  db.prepare(`
    UPDATE users SET kyc_status = 'approved', kyc_reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(u.id);
  try {
    createNotification(u.id, {
      type: 'system',
      title: 'KYC Approved',
      message: 'Your identity verification has been approved. You now have full trading access.',
    });
  } catch (_) { /* ignore */ }
  res.json({ message: 'KYC approved' });
});

router.post('/kyc/:userId/reject', (req, res) => {
  const { reason } = req.body || {};
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!u) return res.status(404).json({ error: 'User not found' });
  db.prepare(`
    UPDATE users SET kyc_status = 'rejected', kyc_reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(u.id);
  try {
    createNotification(u.id, {
      type: 'system',
      title: 'KYC Rejected',
      message: reason
        ? `Your KYC was rejected: ${reason}. Please resubmit with correct information.`
        : 'Your KYC was rejected. Please resubmit with correct information.',
    });
  } catch (_) { /* ignore */ }
  res.json({ message: 'KYC rejected' });
});

// ============================================================================
// Withdrawals
// ============================================================================
router.get('/withdrawals', (req, res) => {
  const status = (req.query.status || '').toString();
  const limit  = Math.min(parseInt(req.query.limit) || 100, 500);

  let sql = `
    SELECT w.*, u.email, u.nickname
    FROM withdrawals w
    JOIN users u ON u.id = w.user_id
  `;
  const params = [];
  if (['pending','completed','rejected'].includes(status)) {
    sql += ' WHERE w.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY w.created_at DESC LIMIT ?';
  params.push(limit);

  res.json(db.prepare(sql).all(...params));
});

router.post('/withdrawals/:id/approve', (req, res) => {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Not pending' });

  const tx = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  db.prepare("UPDATE withdrawals SET status = 'completed', tx_hash = ? WHERE id = ?").run(tx, w.id);

  try {
    createNotification(w.user_id, {
      type: 'withdraw',
      title: 'Withdrawal Approved',
      message: `${w.amount} ${w.coin_symbol} withdrawal was approved.`,
      data: { withdrawal_id: w.id, tx_hash: tx, coin: w.coin_symbol, amount: w.amount },
    });
  } catch (_) { /* ignore */ }

  res.json({ message: 'Withdrawal approved', tx_hash: tx });
});

router.post('/withdrawals/:id/reject', (req, res) => {
  const { reason } = req.body || {};
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Not pending' });

  // Refund available balance (original amount + fee)
  db.prepare('UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = ?')
    .run(w.amount + (w.fee || 0), w.user_id, w.coin_symbol);
  db.prepare("UPDATE withdrawals SET status = 'rejected' WHERE id = ?").run(w.id);

  try {
    createNotification(w.user_id, {
      type: 'withdraw',
      title: 'Withdrawal Rejected',
      message: reason
        ? `${w.amount} ${w.coin_symbol} withdrawal was rejected: ${reason}. Funds returned to your wallet.`
        : `${w.amount} ${w.coin_symbol} withdrawal was rejected. Funds returned to your wallet.`,
      data: { withdrawal_id: w.id },
    });
  } catch (_) { /* ignore */ }

  res.json({ message: 'Withdrawal rejected and refunded' });
});

// ============================================================================
// Deposits
// ============================================================================
router.get('/deposits', (req, res) => {
  const status = (req.query.status || '').toString();
  const limit  = Math.min(parseInt(req.query.limit) || 100, 500);

  let sql = `
    SELECT d.*, u.email, u.nickname
    FROM deposits d
    JOIN users u ON u.id = d.user_id
  `;
  const params = [];
  if (['pending','completed','rejected'].includes(status)) {
    sql += ' WHERE d.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY d.created_at DESC LIMIT ?';
  params.push(limit);

  res.json(db.prepare(sql).all(...params));
});

// Manual credit (admin deposit)
router.post('/deposits/manual', (req, res) => {
  const { user_id, coin_symbol, amount, note } = req.body || {};
  const amt = Number(amount);
  if (!user_id || !coin_symbol || !(amt > 0)) {
    return res.status(400).json({ error: 'user_id, coin_symbol, amount > 0 required' });
  }
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const c = db.prepare('SELECT symbol FROM coins WHERE symbol = ?').get(coin_symbol);
  if (!c) return res.status(400).json({ error: 'Unknown coin' });

  const id  = uuidv4();
  const tx  = `MANUAL-${Date.now().toString(36)}`;
  const nowIso = new Date().toISOString();

  // Insert deposit and credit wallet atomically
  const tx_run = db.transaction(() => {
    db.prepare(`
      INSERT INTO deposits (id, user_id, coin_symbol, amount, tx_hash, status, network, memo, created_at)
      VALUES (?, ?, ?, ?, ?, 'completed', 'MANUAL', ?, ?)
    `).run(id, user_id, coin_symbol, amt, tx, note || null, nowIso);

    // Ensure wallet exists
    const existing = db.prepare('SELECT id FROM wallets WHERE user_id = ? AND coin_symbol = ?').get(user_id, coin_symbol);
    if (existing) {
      db.prepare('UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = ?')
        .run(amt, user_id, coin_symbol);
    } else {
      db.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available, locked) VALUES (?, ?, ?, ?, 0)')
        .run(uuidv4(), user_id, coin_symbol, amt);
    }
  });
  tx_run();

  try {
    createNotification(user_id, {
      type: 'deposit',
      title: 'Manual Deposit Credited',
      message: `+${amt} ${coin_symbol} credited to your wallet${note ? ` (${note})` : ''}.`,
      data: { coin: coin_symbol, amount: amt, tx_hash: tx, manual: true },
    });
  } catch (_) { /* ignore */ }

  res.json({ id, tx_hash: tx, amount: amt });
});

// ============================================================================
// Trade history (global)
// ============================================================================
router.get('/trades', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 500);
  const userId = (req.query.user_id || '').toString();

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
  const params = [];
  if (userId) {
    sql += ' WHERE t.buyer_id = ? OR t.seller_id = ?';
    params.push(userId, userId);
  }
  sql += ' ORDER BY t.created_at DESC LIMIT ?';
  params.push(limit);

  res.json(db.prepare(sql).all(...params));
});

// ============================================================================
// Coin management
// ============================================================================
router.get('/coins', (req, res) => {
  const coins = db.prepare('SELECT * FROM coins ORDER BY sort_order, symbol').all();
  res.json(coins);
});

router.put('/coins/:symbol', (req, res) => {
  const { price_usd, is_active, sort_order } = req.body || {};
  const c = db.prepare('SELECT symbol FROM coins WHERE symbol = ?').get(req.params.symbol);
  if (!c) return res.status(404).json({ error: 'Coin not found' });

  const sets = [];
  const params = [];
  if (price_usd !== undefined && price_usd !== null && !Number.isNaN(Number(price_usd))) {
    sets.push('price_usd = ?'); params.push(Number(price_usd));
  }
  if (is_active !== undefined) {
    sets.push('is_active = ?'); params.push(is_active ? 1 : 0);
  }
  if (sort_order !== undefined && !Number.isNaN(Number(sort_order))) {
    sets.push('sort_order = ?'); params.push(Number(sort_order));
  }
  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.symbol);
  db.prepare(`UPDATE coins SET ${sets.join(', ')} WHERE symbol = ?`).run(...params);
  res.json({ message: 'Coin updated' });
});

// ============================================================================
// System notification broadcaster
// ============================================================================
router.post('/broadcast', (req, res) => {
  const { title, message, target } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required' });
  }

  let userIds = [];
  if (target === 'all' || !target) {
    userIds = db.prepare('SELECT id FROM users WHERE is_active = 1').all().map(r => r.id);
  } else if (target === 'kyc_approved') {
    userIds = db.prepare("SELECT id FROM users WHERE is_active = 1 AND kyc_status = 'approved'").all().map(r => r.id);
  } else if (target === 'admins') {
    userIds = db.prepare("SELECT id FROM users WHERE is_active = 1 AND role = 'admin'").all().map(r => r.id);
  } else if (Array.isArray(target)) {
    userIds = target;
  } else {
    return res.status(400).json({ error: "target must be 'all' | 'kyc_approved' | 'admins' | string[]" });
  }

  let sent = 0;
  for (const uid of userIds) {
    try {
      createNotification(uid, {
        type: 'system',
        title,
        message: message || null,
      });
      sent++;
    } catch (_) { /* continue */ }
  }

  res.json({ sent, total: userIds.length });
});

// ============================================================================
// Recent activity feed (last 30 events: signups, KYC, withdrawals, deposits)
// ============================================================================
router.get('/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);

  const signups = db.prepare(`
    SELECT 'signup' AS type, u.id AS entity_id, u.nickname AS actor,
           NULL AS detail, u.created_at AS ts
    FROM users u ORDER BY u.created_at DESC LIMIT ?
  `).all(limit);

  const kyc = db.prepare(`
    SELECT 'kyc_' || kyc_status AS type, id AS entity_id, nickname AS actor,
           kyc_name AS detail, COALESCE(kyc_reviewed_at, kyc_submitted_at) AS ts
    FROM users
    WHERE kyc_status IN ('pending','approved','rejected')
      AND COALESCE(kyc_reviewed_at, kyc_submitted_at) IS NOT NULL
    ORDER BY ts DESC LIMIT ?
  `).all(limit);

  const wds = db.prepare(`
    SELECT 'withdraw_' || w.status AS type, w.id AS entity_id,
           u.nickname AS actor,
           (w.amount || ' ' || w.coin_symbol) AS detail,
           w.created_at AS ts
    FROM withdrawals w JOIN users u ON u.id = w.user_id
    ORDER BY w.created_at DESC LIMIT ?
  `).all(limit);

  const deps = db.prepare(`
    SELECT 'deposit_' || d.status AS type, d.id AS entity_id,
           u.nickname AS actor,
           (d.amount || ' ' || d.coin_symbol) AS detail,
           d.created_at AS ts
    FROM deposits d JOIN users u ON u.id = d.user_id
    ORDER BY d.created_at DESC LIMIT ?
  `).all(limit);

  const merged = [...signups, ...kyc, ...wds, ...deps]
    .filter(x => x.ts)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, limit);

  res.json(merged);
});

export default router;
