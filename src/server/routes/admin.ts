import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { createNotification } from './notifications';
import { logAdminAction } from '../utils/audit';
import {
  tmplWithdrawApproved,
  tmplWithdrawRejected,
  tmplDepositCredited,
  tmplKycApproved,
  tmplKycRejected,
  fireAndForgetMail,
} from '../utils/mailer';

// Small helper: look up an email by user id, returning null on any failure.
async function lookupEmail(db: any, userId: string): Promise<string | null> {
  try {
    const row = await db.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
    return row?.email || null;
  } catch { return null; }
}

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

  await logAdminAction(c, {
    action: 'user.toggle_active',
    targetType: 'user',
    targetId: u.id,
    payload: { email: u.email, from: u.is_active ? 1 : 0, to: newVal },
  });

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
  await logAdminAction(c, {
    action: 'user.change_role',
    targetType: 'user',
    targetId: u.id,
    payload: { role },
  });
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
  await logAdminAction(c, {
    action: 'user.reset_2fa',
    targetType: 'user',
    targetId: u.id,
  });
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
  await logAdminAction(c, {
    action: 'user.toggle_active',
    targetType: 'user',
    targetId: userId,
    payload: { from: user.is_active ? 1 : 0, to: newStatus, legacy: true },
  });
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
  await logAdminAction(c, {
    action: 'kyc.approve',
    targetType: 'kyc',
    targetId: u.id,
  });

  // S3-6 user-facing email
  try {
    const to = await lookupEmail(db, u.id);
    if (to) {
      const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
      fireAndForgetMail(c.env as any, to, tmplKycApproved(appUrl), c.executionCtx as any);
    }
  } catch (e) { console.warn('[kyc.approve] mail failed:', e); }

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
  await logAdminAction(c, {
    action: 'kyc.reject',
    targetType: 'kyc',
    targetId: u.id,
    payload: { reason: reason || null },
  });

  // S3-6 user-facing email
  try {
    const to = await lookupEmail(db, u.id);
    if (to) {
      const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
      fireAndForgetMail(c.env as any, to, tmplKycRejected(appUrl, reason || null), c.executionCtx as any);
    }
  } catch (e) { console.warn('[kyc.reject] mail failed:', e); }

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

  // Finalise: the amount was moved to `locked` at submission time.
  // `w.amount` stores NET (after fee); gross lock = w.amount + w.fee.
  const gross = Number(w.amount) + Number(w.fee || 0);
  const tx = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  await db.batch([
    db.prepare(
      `UPDATE wallets SET locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?`
    ).bind(gross, w.user_id, w.coin_symbol),
    db.prepare("UPDATE withdrawals SET status = 'completed', tx_hash = ? WHERE id = ?").bind(tx, w.id),
  ]);

  try {
    await createNotification(db, w.user_id, {
      type: 'withdraw',
      title: 'Withdrawal Approved',
      message: `${w.amount} ${w.coin_symbol} withdrawal was approved.`,
      data: { withdrawal_id: w.id, tx_hash: tx, coin: w.coin_symbol, amount: w.amount },
    });
  } catch { /* ignore */ }

  await logAdminAction(c, {
    action: 'withdrawal.approve',
    targetType: 'withdrawal',
    targetId: w.id,
    payload: {
      user_id: w.user_id,
      coin: w.coin_symbol,
      amount: w.amount,
      fee: w.fee,
      tx_hash: tx,
    },
  });

  // S3-6 user-facing email
  try {
    const to = await lookupEmail(db, w.user_id);
    if (to) {
      const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
      fireAndForgetMail(
        c.env as any,
        to,
        tmplWithdrawApproved(appUrl, { amount: w.amount, coin: w.coin_symbol, txHash: tx }),
        c.executionCtx as any,
      );
    }
  } catch (e) { console.warn('[withdrawal.approve] mail failed:', e); }

  return c.json({ message: 'Withdrawal approved', tx_hash: tx });
});

app.post('/withdrawals/:id/reject', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const { reason } = await c.req.json().catch(() => ({}));
  const w = await db.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(id).first<any>();
  if (!w) return c.json({ error: 'Not found' }, 404);
  if (w.status !== 'pending') return c.json({ error: 'Not pending' }, 400);

  // Refund: gross = net (w.amount) + fee. Move from `locked` back to `available`.
  const gross = Number(w.amount) + Number(w.fee || 0);
  await db.batch([
    db.prepare(
      `UPDATE wallets
       SET available = available + ?, locked = MAX(0, locked - ?)
       WHERE user_id = ? AND coin_symbol = ?`
    ).bind(gross, gross, w.user_id, w.coin_symbol),
    db.prepare("UPDATE withdrawals SET status = 'rejected' WHERE id = ?").bind(w.id),
  ]);

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

  await logAdminAction(c, {
    action: 'withdrawal.reject',
    targetType: 'withdrawal',
    targetId: w.id,
    payload: {
      user_id: w.user_id,
      coin: w.coin_symbol,
      amount: w.amount,
      fee: w.fee,
      reason: reason || null,
    },
  });

  // S3-6 user-facing email
  try {
    const to = await lookupEmail(db, w.user_id);
    if (to) {
      const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
      fireAndForgetMail(
        c.env as any,
        to,
        tmplWithdrawRejected(appUrl, { amount: w.amount, coin: w.coin_symbol, reason: reason || null }),
        c.executionCtx as any,
      );
    }
  } catch (e) { console.warn('[withdrawal.reject] mail failed:', e); }

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

  await logAdminAction(c, {
    action: 'deposit.manual',
    targetType: 'deposit',
    targetId: id,
    payload: { user_id, coin: coin_symbol, amount: amt, tx_hash: tx, note: note || null },
  });

  // S3-6 user-facing email
  try {
    const to = await lookupEmail(db, user_id);
    if (to) {
      const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
      fireAndForgetMail(
        c.env as any,
        to,
        tmplDepositCredited(appUrl, { amount: amt, coin: coin_symbol, txHash: tx, note: note || null }),
        c.executionCtx as any,
      );
    }
  } catch (e) { console.warn('[deposit.manual] mail failed:', e); }

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
  await logAdminAction(c, {
    action: 'coin.update',
    targetType: 'coin',
    targetId: symbol,
    payload: {
      price_usd: price_usd ?? null,
      is_active: is_active ?? null,
      sort_order: sort_order ?? null,
    },
  });
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

  await logAdminAction(c, {
    action: 'broadcast.send',
    targetType: 'broadcast',
    payload: {
      title,
      target: Array.isArray(target) ? `array(${target.length})` : (target || 'all'),
      sent,
      total: userIds.length,
    },
  });

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

// ============================================================================
// Admin audit log viewer (Sprint 3 — S3-2)
// Read-only. Supports filtering by admin_id, action, target_type, target_id.
// ============================================================================
app.get('/audit-logs', async (c) => {
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);
  const adminId = c.req.query('admin_id') || '';
  const action = c.req.query('action') || '';
  const targetType = c.req.query('target_type') || '';
  const targetId = c.req.query('target_id') || '';

  let sql = 'SELECT * FROM admin_audit_logs WHERE 1=1';
  const params: any[] = [];
  if (adminId) { sql += ' AND admin_id = ?'; params.push(adminId); }
  if (action) { sql += ' AND action = ?'; params.push(action); }
  if (targetType) { sql += ' AND target_type = ?'; params.push(targetType); }
  if (targetId) { sql += ' AND target_id = ?'; params.push(targetId); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  try {
    const { results } = await db.prepare(sql).bind(...params).all<any>();
    // Parse payload JSON for UI convenience
    const parsed = (results || []).map((r: any) => ({
      ...r,
      payload: r.payload
        ? (() => { try { return JSON.parse(r.payload); } catch { return r.payload; } })()
        : null,
    }));
    return c.json(parsed);
  } catch (e: any) {
    // Table may not exist yet if migration has not been applied
    return c.json({ error: 'audit log unavailable', detail: String(e?.message || e) }, 503);
  }
});

// ============================================================================
// Admin fee ledger viewer (Sprint 3+ — S3-5 admin surface)
// Read-only. Supports filtering by user_id, market_id, role (buyer/seller),
// coin, and a date range. Also returns aggregate totals so the UI can render
// a "fee revenue by coin" summary.
// ============================================================================
app.get('/fee-ledger', async (c) => {
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query('limit') || '200'), 1000);
  const userId = c.req.query('user_id') || '';
  const marketId = c.req.query('market_id') || '';
  const role = c.req.query('role') || '';
  const coin = c.req.query('coin') || '';
  const since = c.req.query('since') || ''; // ISO date string

  let sql = `SELECT l.*, m.base_coin, m.quote_coin, u.email AS user_email
               FROM fee_ledger l
          LEFT JOIN markets m ON m.id = l.market_id
          LEFT JOIN users   u ON u.id = l.user_id
              WHERE 1=1`;
  const params: any[] = [];
  if (userId)   { sql += ' AND l.user_id = ?';   params.push(userId); }
  if (marketId) { sql += ' AND l.market_id = ?'; params.push(marketId); }
  if (role)     { sql += ' AND l.role = ?';      params.push(role); }
  if (coin)     { sql += ' AND l.coin = ?';      params.push(coin); }
  if (since)    { sql += ' AND l.created_at >= ?'; params.push(since); }
  sql += ' ORDER BY l.created_at DESC LIMIT ?';
  params.push(limit);

  try {
    const { results } = await db.prepare(sql).bind(...params).all<any>();
    return c.json(results || []);
  } catch (e: any) {
    return c.json({ error: 'fee_ledger unavailable', detail: String(e?.message || e) }, 503);
  }
});

// GET /fee-stats — aggregate totals (24h / 7d / all-time) grouped by coin.
app.get('/fee-stats', async (c) => {
  const db = c.env.DB;
  try {
    const totals = await db.prepare(
      `SELECT coin,
              SUM(amount) AS total_amount,
              SUM(usd_equivalent) AS total_usd,
              COUNT(*) AS entries
         FROM fee_ledger
        GROUP BY coin
        ORDER BY total_usd DESC`
    ).all<any>();

    const day = await db.prepare(
      `SELECT COALESCE(SUM(usd_equivalent), 0) AS usd, COUNT(*) AS entries
         FROM fee_ledger
        WHERE created_at >= datetime('now', '-1 day')`
    ).first<any>();

    const week = await db.prepare(
      `SELECT COALESCE(SUM(usd_equivalent), 0) AS usd, COUNT(*) AS entries
         FROM fee_ledger
        WHERE created_at >= datetime('now', '-7 days')`
    ).first<any>();

    const byTier = await db.prepare(
      `SELECT tier, COUNT(*) AS entries, SUM(usd_equivalent) AS usd
         FROM fee_ledger
        GROUP BY tier
        ORDER BY tier ASC`
    ).all<any>();

    return c.json({
      byCoin: totals.results || [],
      last24h: day || { usd: 0, entries: 0 },
      last7d: week || { usd: 0, entries: 0 },
      byTier: byTier.results || [],
    });
  } catch (e: any) {
    return c.json({ error: 'fee_stats unavailable', detail: String(e?.message || e) }, 503);
  }
});

// ============================================================================
// System health & operational status (Sprint 3+ admin dashboard)
// ============================================================================

// GET /admin/system-health — DB ping, table presence, row counts for the
// Sprint 3 tables, and optional cron-worker / R2 backup probes. Designed to
// be cheap (uses SELECT COUNT(*) with LIMIT 1 trick where possible) so it
// can be polled every 30s by the dashboard without measurable load.
app.get('/system-health', async (c) => {
  const db = c.env.DB;
  const probes: Record<string, any> = {};
  const now = Date.now();

  // 1) DB ping
  try {
    const r = await db.prepare('SELECT 1 AS one').first<any>();
    probes.db = { ok: r?.one === 1, latency_ms: Date.now() - now };
  } catch (e: any) {
    probes.db = { ok: false, error: String(e?.message || e) };
  }

  // 2) Sprint 3 table presence + row counts
  const tables = [
    'admin_audit_logs',  // 0009 — S3-2
    'fee_tiers',         // 0011 — S3-5
    'fee_ledger',        // 0011 — S3-5
  ];
  probes.tables = {};
  for (const t of tables) {
    try {
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<any>();
      probes.tables[t] = { ok: true, rows: Number(r?.n || 0) };
    } catch (e: any) {
      // SQLITE_ERROR for missing table
      probes.tables[t] = { ok: false, error: String(e?.message || e).slice(0, 200) };
    }
  }

  // 3) Sprint 3 column presence on orders (TIF + stop-limit)
  try {
    const colRows = await db.prepare(`PRAGMA table_info(orders)`).all<any>();
    const cols = new Set((colRows.results || []).map((r: any) => r.name));
    probes.orders_columns = {
      time_in_force: cols.has('time_in_force'),  // 0010 — S3-4
      stop_price:    cols.has('stop_price'),     // 0012 — S3-3
      triggered_at:  cols.has('triggered_at'),   // 0012 — S3-3
    };
  } catch (e: any) {
    probes.orders_columns = { error: String(e?.message || e).slice(0, 200) };
  }

  // 4) Activity counters (last 24h) — quick DB pulse
  try {
    const day = await db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM orders WHERE created_at >= datetime('now', '-1 day')) AS orders,
         (SELECT COUNT(*) FROM trades WHERE created_at >= datetime('now', '-1 day')) AS trades,
         (SELECT COUNT(*) FROM users  WHERE created_at >= datetime('now', '-1 day')) AS new_users`
    ).first<any>();
    probes.last24h = day || { orders: 0, trades: 0, new_users: 0 };
  } catch (e: any) {
    probes.last24h = { error: String(e?.message || e).slice(0, 200) };
  }

  // 5) Most recent backup marker (if cron-worker writes a row to a marker
  // table, surface it; otherwise return null and the UI shows "—").
  try {
    const r = await db.prepare(
      `SELECT value FROM system_markers WHERE key = 'last_backup_at'`
    ).first<any>();
    probes.last_backup_at = r?.value || null;
  } catch {
    // Table is optional — cron-worker may write directly to R2 without a marker.
    probes.last_backup_at = null;
  }

  // Aggregate status
  const allOk =
    probes.db?.ok === true &&
    Object.values(probes.tables || {}).every((v: any) => v?.ok) &&
    Object.values(probes.orders_columns || {}).every((v: any) => v === true);
  probes.status = allOk ? 'ok' : 'degraded';
  probes.checked_at = new Date().toISOString();

  return c.json(probes);
});

// GET /admin/audit-stats — counts for the dashboard summary cards.
app.get('/audit-stats', async (c) => {
  const db = c.env.DB;
  try {
    const totals = await db.prepare(
      `SELECT
         COUNT(*) AS total,
         (SELECT COUNT(*) FROM admin_audit_logs WHERE created_at >= datetime('now', '-1 day'))  AS last24h,
         (SELECT COUNT(*) FROM admin_audit_logs WHERE created_at >= datetime('now', '-7 days')) AS last7d
       FROM admin_audit_logs`
    ).first<any>();
    const byAction = await db.prepare(
      `SELECT action, COUNT(*) AS n
         FROM admin_audit_logs
        WHERE created_at >= datetime('now', '-7 days')
        GROUP BY action
        ORDER BY n DESC
        LIMIT 10`
    ).all<any>();
    const topAdmins = await db.prepare(
      `SELECT admin_email, COUNT(*) AS n
         FROM admin_audit_logs
        WHERE created_at >= datetime('now', '-7 days')
        GROUP BY admin_email
        ORDER BY n DESC
        LIMIT 5`
    ).all<any>();
    return c.json({
      total: Number(totals?.total || 0),
      last24h: Number(totals?.last24h || 0),
      last7d: Number(totals?.last7d || 0),
      byAction: byAction.results || [],
      topAdmins: topAdmins.results || [],
    });
  } catch (e: any) {
    return c.json({ error: 'audit_stats unavailable', detail: String(e?.message || e) }, 503);
  }
});

// ============================================================================
// Sprint 4 Phase H2 — Admin: PQ API key observability
// GET /api/admin/api-keys/stats
// Returns global algorithm distribution + recent PQ verify failures.
// Used by AdminPage "API Keys" stats card.
// ============================================================================
app.get('/api-keys/stats', async (c) => {
  try {
    const db = c.env.DB;

    // Algorithm distribution across all users.
    const distRows = await db.prepare(
      `SELECT signature_alg, COUNT(*) AS n
         FROM api_keys GROUP BY signature_alg`
    ).all<{ signature_alg: string; n: number }>();
    const distribution: Record<string, number> = {
      'hmac-sha256': 0,
      'dilithium2': 0,
      'hybrid': 0,
    };
    for (const r of distRows.results ?? []) {
      if (r.signature_alg) distribution[r.signature_alg] = Number(r.n) || 0;
    }

    // Total active keys (is_active = 1) for context.
    const totals = await db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active
       FROM api_keys`
    ).first<{ total: number; active: number }>();

    // Recent PQ audit summary (last 24h).
    let recentFailures: Array<{ outcome: string; n: number }> = [];
    let total24h = 0;
    try {
      const failRows = await db.prepare(
        `SELECT outcome, COUNT(*) AS n
           FROM api_key_pq_audit
          WHERE created_at >= strftime('%s', 'now') - 86400
          GROUP BY outcome
          ORDER BY n DESC`
      ).all<{ outcome: string; n: number }>();
      recentFailures = (failRows.results ?? []).map((r) => ({
        outcome: r.outcome,
        n: Number(r.n) || 0,
      }));
      total24h = recentFailures.reduce((acc, r) => acc + r.n, 0);
    } catch { /* audit table not migrated yet */ }

    // Markers (so admin UI can show 'phase-h2-stub' badge + flip required/wasm_ready).
    let markers: Record<string, string> = {};
    try {
      const mr = await db.prepare(
        `SELECT key, value FROM system_markers
           WHERE key IN (
             'pq_api_keys_enabled',
             'pq_api_keys_required',
             'pq_api_keys_wasm_ready',
             'pq_api_keys_integration'
           )`
      ).all<{ key: string; value: string }>();
      for (const r of mr.results ?? []) markers[r.key] = r.value;
    } catch { /* markers table missing */ }

    return c.json({
      ok: true,
      distribution,
      totals: {
        total: Number(totals?.total || 0),
        active: Number(totals?.active || 0),
      },
      pq_audit_24h: {
        total: total24h,
        by_outcome: recentFailures,
      },
      markers: {
        enabled: (markers['pq_api_keys_enabled'] ?? 'off') === 'on',
        required: (markers['pq_api_keys_required'] ?? 'off') === 'on',
        wasm_ready: (markers['pq_api_keys_wasm_ready'] ?? 'off') === 'on',
        integration_phase: markers['pq_api_keys_integration'] ?? 'phase-h2-stub',
      },
    });
  } catch (e: any) {
    return c.json({ error: 'api_keys_stats unavailable', detail: String(e?.message || e) }, 503);
  }
});

export default app;
