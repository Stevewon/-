import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { createNotification } from './notifications';
import { logAdminAction } from '../utils/audit';
import { computeBalanceBreakdown } from '../lib/balance-breakdown';
import {
  tmplWithdrawApproved,
  tmplWithdrawRejected,
  tmplDepositCredited,
  tmplKycApproved,
  tmplKycRejected,
  fireAndForgetMail,
  sendMail,
  templateBasic,
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
    // Search email, nickname AND KYC real name (admins often know the person's
    // real name, not just their handle).
    conds.push('(email LIKE ? OR nickname LIKE ? OR kyc_name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
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
  // NOTE: `conds` reference bare column names that live only on `users`; the QX
  // subquery below exposes just (user_id, qx) so there is no column ambiguity
  // when we alias the base table as `u`.
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const totalRow = await db.prepare(`SELECT COUNT(*) AS cnt FROM users u ${where}`)
    .bind(...params).first<{ cnt: number }>();

  // qx_balance = combined QX + QKEY held on the exchange (available + locked).
  // This drives the fee-tier schedule (owner rule 2026-08-28), so the admin
  // roster shows the amount that decides each member's trading/withdrawal fee.
  const { results } = await db.prepare(`
    SELECT u.id, u.email, u.nickname, u.role, u.kyc_status, u.is_active,
           u.two_factor_enabled, u.created_at, u.kyc_submitted_at,
           COALESCE(qx.qx, 0)                        AS qx_balance
    FROM users u
    LEFT JOIN (
      SELECT user_id, SUM(available + locked) AS qx
        FROM wallets WHERE coin_symbol IN ('QX','QKEY') GROUP BY user_id
    ) qx ON qx.user_id = u.id
    ${where}
    ORDER BY u.created_at DESC
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

  // Live QX + QKEY holding — drives the fee-tier schedule (owner rule 2026-08-28).
  const qxRow = await db.prepare(
    `SELECT COALESCE(SUM(available + locked), 0) AS qx
       FROM wallets WHERE user_id = ? AND coin_symbol IN ('QX','QKEY')`
  ).bind(u.id).first<{ qx: number }>().catch(() => ({ qx: 0 } as any));
  u.qx_balance = Number(qxRow?.qx || 0);

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

// ============================================================================
// GET /admin/users/:id/balance/:coin — per-coin balance breakdown for a user.
// Same reconstruction the user sees, exposed to admins for support/audit:
// shows how a balance decomposes into welcome bonus / referral / deposits /
// admin credits / withdrawals, plus the raw source rows.
// ============================================================================
app.get('/users/:id/balance/:coin', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const coin = (c.req.param('coin') || '').toUpperCase();
  if (!coin) return c.json({ error: 'coin required' }, 400);

  const u = await db
    .prepare('SELECT id, email, nickname FROM users WHERE id = ?')
    .bind(id)
    .first<any>();
  if (!u) return c.json({ error: 'User not found' }, 404);

  try {
    const breakdown = await computeBalanceBreakdown(db, id, coin);
    return c.json({ user: u, breakdown });
  } catch (e) {
    console.error('[admin/users/balance] failed:', e);
    return c.json({ error: 'Failed to compute balance breakdown' }, 500);
  }
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

// NOTE (owner rule 2026-08-28): the old fee-exemption endpoint
// (POST /users/:id/fee-exemption) and the ROYAL/DIAMOND/GOLD/SILVER tier
// system have been REMOVED. Trading & withdrawal fees are now decided solely
// by the member's combined QX+QKEY holding (see src/server/utils/fees.ts).

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
  // ★ Pre-launch hardening (2026-06-22):
  // Load full KYC fields so admin can't accidentally approve an empty
  // record. We refuse to approve if any of the required fields are missing.
  const u = await db.prepare(
    `SELECT id, kyc_status, kyc_name, kyc_phone, kyc_id_number, kyc_address
       FROM users WHERE id = ?`
  ).bind(userId).first<any>();
  if (!u) return c.json({ error: 'User not found' }, 404);

  if (u.kyc_status !== 'pending') {
    return c.json({
      error: `Cannot approve KYC in status '${u.kyc_status}'. Only 'pending' submissions can be approved.`,
      code: 'KYC_NOT_PENDING',
    }, 400);
  }
  const missing: string[] = [];
  if (!u.kyc_name || String(u.kyc_name).trim().length < 2)   missing.push('name');
  if (!u.kyc_phone || String(u.kyc_phone).trim().length < 7) missing.push('phone');
  if (!u.kyc_id_number || String(u.kyc_id_number).trim().length < 4) missing.push('id_number');
  if (!u.kyc_address || String(u.kyc_address).trim().length < 5) missing.push('address');
  if (missing.length > 0) {
    return c.json({
      error: `KYC record is missing required field(s): ${missing.join(', ')}. Reject and ask user to resubmit.`,
      code: 'KYC_INCOMPLETE',
      missing,
    }, 400);
  }

  await db.prepare(`
    UPDATE users SET kyc_status = 'approved', kyc_reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
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
  const body = await c.req.json().catch(() => ({} as any));
  const reason = body.reason ? String(body.reason).slice(0, 500) : null;
  // ★ Pre-launch hardening: optional flag to clear bad data so the user
  // gets a clean re-submission UX. Defaults to true (privacy-friendly —
  // we don't want to keep wrong PII around).
  const clearData = body.clear_data !== false;

  const u = await db.prepare(
    'SELECT id, kyc_status FROM users WHERE id = ?'
  ).bind(userId).first<any>();
  if (!u) return c.json({ error: 'User not found' }, 404);
  if (u.kyc_status !== 'pending') {
    return c.json({
      error: `Cannot reject KYC in status '${u.kyc_status}'. Only 'pending' submissions can be rejected.`,
      code: 'KYC_NOT_PENDING',
    }, 400);
  }

  if (clearData) {
    await db.prepare(`
      UPDATE users
         SET kyc_status = 'rejected',
             kyc_reviewed_at = CURRENT_TIMESTAMP,
             kyc_name = NULL,
             kyc_phone = NULL,
             kyc_id_number = NULL,
             kyc_address = NULL,
             kyc_id_document_url = NULL,
             kyc_address_document_url = NULL,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`).bind(u.id).run();
  } else {
    await db.prepare(`
      UPDATE users
         SET kyc_status = 'rejected',
             kyc_reviewed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`).bind(u.id).run();
  }
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
    payload: { reason: reason || null, clear_data: clearData },
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

  // ★★★★★★★ Boss's permanent rule (2026-06-22) — second-line defense:
  // Even if a withdrawal somehow made it past the user-facing endpoint
  // (legacy row, race window, future code regression), the admin approval
  // MUST also verify the user's available_initial does not exceed the
  // remaining available after this approval. Reject and refund otherwise.
  try {
    const walletRow = await db.prepare(
      `SELECT available, locked, COALESCE(available_initial, 0) AS available_initial
         FROM wallets WHERE user_id = ? AND coin_symbol = ?`
    ).bind(w.user_id, w.coin_symbol).first<any>();
    if (walletRow) {
      // After approval: available stays the same (locked drops by gross).
      // The withdrawable invariant we must always preserve:
      //   available_initial <= available
      // If subtracting `gross` from locked would expose company-issued funds
      // beyond what's already on `available`, block.
      const av = Number(walletRow.available || 0);
      const init = Number(walletRow.available_initial || 0);
      if (init > av) {
        return c.json({
          error: 'Withdrawal blocked — would expose company-issued balance. This withdrawal request appears to draw from initial bonus/reward funds and was rejected by the second-line guard. Please reject this withdrawal and ask the user to retry with a smaller amount.',
          code: 'ADMIN_GUARD_COMPANY_ISSUED',
          available: av,
          available_initial: init,
        }, 400);
      }
    }
  } catch (e) {
    console.warn('[admin/withdrawals/approve] guard check failed:', e);
    // Fail-closed: refuse approval if the guard itself errored.
    return c.json({
      error: 'Admin guard check failed; withdrawal not approved. Please retry or contact engineering.',
      code: 'ADMIN_GUARD_CHECK_FAILED',
    }, 500);
  }

  const tx = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  // ★ A2 fix: claim the state transition FIRST with a conditional UPDATE.
  //   Only if THIS call flipped the row pending→completed (changes === 1) do
  //   we deduct the locked funds. A duplicate/concurrent approve will see
  //   changes === 0 and abort without touching the wallet (no double debit).
  const claim = await db.prepare(
    "UPDATE withdrawals SET status = 'completed', tx_hash = ? WHERE id = ? AND status = 'pending'"
  ).bind(tx, w.id).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ error: 'Withdrawal already processed' }, 409);
  }
  await db.prepare(
    `UPDATE wallets SET locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?`
  ).bind(gross, w.user_id, w.coin_symbol).run();

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
  // ★ A2 fix: claim the state transition FIRST. Only the call that actually
  //   flipped pending→rejected (changes === 1) performs the refund, so a
  //   duplicate/concurrent reject cannot refund the funds twice.
  const claim = await db.prepare(
    "UPDATE withdrawals SET status = 'rejected' WHERE id = ? AND status = 'pending'"
  ).bind(w.id).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ error: 'Withdrawal already processed' }, 409);
  }
  await db.prepare(
    `UPDATE wallets
     SET available = available + ?, locked = MAX(0, locked - ?)
     WHERE user_id = ? AND coin_symbol = ?`
  ).bind(gross, gross, w.user_id, w.coin_symbol).run();

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
  // ★★★★★★★ Boss's permanent rule (2026-06-22):
  // Default: manual deposit is COMPANY-ISSUED (locked from external
  // withdrawal). To credit a verified real deposit (e.g. chain-watcher
  // catch-up) the admin must pass { withdrawable: true } explicitly.
  // This way nobody accidentally lets company funds out.
  const isWithdrawable = body.withdrawable === true;
  const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(user_id).first();
  if (!u) return c.json({ error: 'User not found' }, 404);
  const coin = await db.prepare('SELECT symbol FROM coins WHERE symbol = ?').bind(coin_symbol).first();
  if (!coin) return c.json({ error: 'Unknown coin' }, 400);

  const id = uuid();
  // ★ A3 fix: optional idempotency. If the caller supplies idempotency_key,
  //   it becomes the deposit tx_hash and a duplicate submit (same key) is a
  //   no-op — the credit runs only if THIS insert actually created the row.
  //   Without a key the behavior is unchanged (unique MANUAL-<ts> tx).
  const idemKey = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
    ? `MANUAL-${body.idempotency_key.trim().slice(0, 64)}`
    : '';
  if (idemKey) {
    const dup = await db.prepare('SELECT id FROM deposits WHERE tx_hash = ?').bind(idemKey).first<any>();
    if (dup) {
      return c.json({ ok: true, id: dup.id, duplicate: true, message: 'Already credited (idempotent no-op)' });
    }
  }
  const tx = idemKey || `MANUAL-${Date.now().toString(36)}`;
  const nowIso = new Date().toISOString();

  // D1 batch (atomic). INSERT OR IGNORE + the wallet credit guarded by
  // EXISTS(this deposit) makes the whole batch a no-op on a duplicate key.
  const statements = [
    db.prepare(`
      INSERT OR IGNORE INTO deposits (id, user_id, coin_symbol, amount, tx_hash, status, network, memo, created_at)
      VALUES (?, ?, ?, ?, ?, 'completed', 'MANUAL', ?, ?)
    `).bind(id, user_id, coin_symbol, amt, tx, note || null, nowIso),
  ];

  // The credit UPDATEs are guarded by EXISTS(this deposit id): when an
  // idempotency_key duplicate made the INSERT OR IGNORE a no-op, the deposit
  // row (with this `id`) does not exist, so the credit matches 0 rows and the
  // balance is untouched. Fresh (non-duplicate) inserts always match.
  const existing = await db.prepare('SELECT id FROM wallets WHERE user_id = ? AND coin_symbol = ?')
    .bind(user_id, coin_symbol).first();
  const guard = 'AND EXISTS (SELECT 1 FROM deposits WHERE id = ?)';
  if (existing) {
    if (isWithdrawable) {
      statements.push(
        db.prepare(`UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = ? ${guard}`)
          .bind(amt, user_id, coin_symbol, id)
      );
    } else {
      statements.push(
        db.prepare(`UPDATE wallets SET available = available + ?, available_initial = COALESCE(available_initial, 0) + ? WHERE user_id = ? AND coin_symbol = ? ${guard}`)
          .bind(amt, amt, user_id, coin_symbol, id)
      );
    }
  } else {
    // New wallet row: only create it if the deposit insert actually happened.
    if (isWithdrawable) {
      statements.push(
        db.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available, locked, available_initial) SELECT ?, ?, ?, ?, 0, 0 WHERE EXISTS (SELECT 1 FROM deposits WHERE id = ?)')
          .bind(uuid(), user_id, coin_symbol, amt, id)
      );
    } else {
      statements.push(
        db.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available, locked, available_initial) SELECT ?, ?, ?, ?, 0, ? WHERE EXISTS (SELECT 1 FROM deposits WHERE id = ?)')
          .bind(uuid(), user_id, coin_symbol, amt, amt, id)
      );
    }
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

// ----------------------------------------------------------------------------
// Coin price POLICY — steer OUR OWN coins (QTA/QX/QKEY) only.
//
// modes:
//   'market'  — free random walk (default; no steering)
//   'peg'     — hold exactly at target
//   'target'  — glide from current price to target over [now .. now+duration_h]
//   'managed' — random walk clamped to center ± band_pct%, biased by bias
//   'jump'    — (action, not a stored mode) set price immediately to target and
//               switch to peg so it stays there
// ----------------------------------------------------------------------------
const QUANTARIUM_STEERABLE = new Set(['QTA', 'QX', 'QKEY']);

app.put('/coins/:symbol/price-policy', async (c) => {
  const db = c.env.DB;
  const symbol = String(c.req.param('symbol')).toUpperCase();
  const body = await c.req.json().catch(() => ({} as any));

  if (!QUANTARIUM_STEERABLE.has(symbol)) {
    return c.json({ error: 'Price policy is only available for our own coins (QTA/QX/QKEY). Standard coins follow the real market.' }, 400);
  }

  const coin = await db.prepare('SELECT * FROM coins WHERE symbol = ?').bind(symbol).first() as any;
  if (!coin) return c.json({ error: 'Coin not found' }, 404);

  const mode = String(body.mode || '').toLowerCase();
  const num = (v: any): number | null =>
    v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
  const now = Date.now();

  const sets: string[] = [];
  const params: any[] = [];
  const push = (col: string, val: any) => { sets.push(`${col} = ?`); params.push(val); };

  switch (mode) {
    case 'market': {
      push('price_mode', 'market');
      break;
    }
    case 'peg': {
      const target = num(body.target);
      if (!target || target <= 0) return c.json({ error: 'peg requires a positive target price' }, 400);
      push('price_mode', 'peg');
      push('price_target', target);
      push('price_usd', target); // keep the stored USD price in sync
      break;
    }
    case 'jump': {
      // Instant jump = set price now + hold via peg.
      const target = num(body.target);
      if (!target || target <= 0) return c.json({ error: 'jump requires a positive target price' }, 400);
      push('price_mode', 'peg');
      push('price_target', target);
      push('price_usd', target);
      break;
    }
    case 'target': {
      const target = num(body.target);
      const durationH = num(body.duration_h) ?? 24; // default 24h glide
      if (!target || target <= 0) return c.json({ error: 'target requires a positive target price' }, 400);
      if (durationH <= 0) return c.json({ error: 'duration_h must be positive' }, 400);
      const from = num(coin.price_usd) ?? target;
      push('price_mode', 'target');
      push('price_target', target);
      push('price_drift_from', from);
      push('price_drift_start', now);
      push('price_drift_end', now + durationH * 3600 * 1000);
      break;
    }
    case 'managed': {
      const center = num(body.center) ?? num(coin.price_usd);
      const bandPct = num(body.band_pct) ?? 3;
      const bias = Math.max(-1, Math.min(1, num(body.bias) ?? 0));
      if (!center || center <= 0) return c.json({ error: 'managed requires a positive center price' }, 400);
      if (bandPct == null || bandPct < 0) return c.json({ error: 'band_pct must be >= 0' }, 400);
      push('price_mode', 'managed');
      push('price_center', center);
      push('price_band_pct', bandPct);
      push('price_bias', bias);
      break;
    }
    default:
      return c.json({ error: `unknown mode "${mode}" (use market|peg|target|managed|jump)` }, 400);
  }

  params.push(symbol);
  await db.prepare(`UPDATE coins SET ${sets.join(', ')} WHERE symbol = ?`).bind(...params).run();

  await logAdminAction(c, {
    action: 'coin.price_policy',
    targetType: 'coin',
    targetId: symbol,
    payload: { mode, body },
  });

  const updated = await db.prepare('SELECT * FROM coins WHERE symbol = ?').bind(symbol).first();
  return c.json({ message: 'Price policy updated', coin: updated });
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

// ============================================================================
// POST /admin/mail-test — soft-launch email deliverability self-test (item ⑪).
// ----------------------------------------------------------------------------
// Sends a real transactional email through the exact same sendMail() path the
// login-OTP / verification flows use, and reports which provider actually
// accepted it (resend | mailchannels | dev). This is the only way to verify
// end-to-end email delivery WITHOUT going through a geo-blocked signup flow.
//
// Body: { to?: string }  — defaults to the calling admin's own email.
// Response: { ok, provider, sent, to, config } — awaited (NOT fire-and-forget)
// so the admin sees the true result. Provider config presence is surfaced so
// the operator can confirm RESEND_API_KEY / MAIL_FROM are wired.
// ============================================================================
app.post('/mail-test', async (c) => {
  const admin = c.get('user') as any;
  let body: any = {};
  try { body = await c.req.json(); } catch { /* empty body ok */ }

  // Resolve recipient: explicit `to`, else the admin's own email on file.
  let to = (body?.to || '').toString().trim().toLowerCase();
  if (!to) {
    const row = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(admin?.id).first<{ email: string }>();
    to = (row?.email || '').toLowerCase();
  }
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return c.json({ ok: false, error: 'A valid recipient email is required' }, 400);
  }

  const env = c.env as any;
  const config = {
    resend_api_key: !!env.RESEND_API_KEY,          // paid provider wired?
    mail_from: env.MAIL_FROM || 'QuantaEX <no-reply@quantaex.io>',
    mail_dev_noop: env.MAIL_DEV_NOOP === '1',      // true → sends are skipped
  };

  const when = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const html = templateBasic(
    'QuantaEX email deliverability test',
    `<p>This is a test email triggered from the admin panel to confirm that
      transactional email delivery is working before soft-launch.</p>
     <p style="margin-top:12px">If you received this, login OTP codes,
      verification links, and security alerts will reach your users.</p>
     <div style="margin-top:16px;padding:12px;background:#0b1017;border:1px solid #1f2a37;border-radius:8px;font-size:12px;color:#8ea0b5">
       <strong>Sent at:</strong> ${when}
     </div>`,
  );
  const text = `QuantaEX email deliverability test.\nSent at: ${when}\nIf you received this, transactional email is working.`;

  // Awaited on purpose — the admin needs the real provider result.
  const result = await sendMail(env, {
    to,
    subject: 'QuantaEX — email deliverability test',
    html,
    text,
  });

  await logAdminAction(c, {
    action: 'mail_test',
    targetType: 'system',
    targetId: to,
    payload: { provider: result.provider, sent: result.sent },
  }).catch(() => {});

  return c.json({
    ok: result.sent,
    provider: result.provider,   // 'resend' | 'mailchannels' | 'dev'
    sent: result.sent,
    to,
    error: result.error || null,
    config,
    hint: result.sent
      ? 'Email accepted by provider. Check the inbox (and spam) to confirm actual delivery.'
      : (config.mail_dev_noop
          ? 'MAIL_DEV_NOOP=1 is set — sends are disabled. Unset it in production.'
          : 'Provider rejected the send. Check RESEND_API_KEY and that the sending domain (quantaex.io) has SPF/DKIM verified.'),
  });
});

// ============================================================================
// GET /admin/db-export — on-demand logical backup of core tables (item ⑫).
// ----------------------------------------------------------------------------
// Streams a JSON snapshot of the operationally-critical tables so an operator
// can take a manual backup from the admin panel at any time (in addition to
// the recommended `wrangler d1 export` CLI job). Kept read-only and bounded:
// only whitelisted tables, capped rows per table, so it can't be abused to
// dump unbounded data or hammer D1.
//
// This is a convenience/safety net for soft-launch (low data volume). For
// production-scale, schedule `wrangler d1 export quantaex-production --remote`
// off-platform — see BACKUP.md.
// ============================================================================
app.get('/db-export', async (c) => {
  const admin = c.get('user') as any;
  // Whitelist of core tables to include, with a hard per-table row cap.
  const TABLES = [
    'users', 'wallets', 'orders', 'trades', 'withdrawals',
    'qta_withdrawals', 'deposits', 'coins', 'notices',
    'admin_audit_logs', 'system_markers', 'user_consents',
  ];
  const PER_TABLE_CAP = 5000;

  const snapshot: Record<string, any> = {
    meta: {
      generated_at: new Date().toISOString(),
      generated_by: admin?.email || admin?.id || 'admin',
      db: 'quantaex-production',
      per_table_cap: PER_TABLE_CAP,
      note: 'Logical JSON snapshot. For full/consistent backups use `wrangler d1 export`.',
    },
    tables: {},
  };

  for (const t of TABLES) {
    try {
      const { results } = await c.env.DB.prepare(
        `SELECT * FROM ${t} LIMIT ${PER_TABLE_CAP}`
      ).all<any>();
      const rows = results || [];
      // Redact password hashes even from admins — a backup file shouldn't
      // carry credential material around.
      if (t === 'users') {
        for (const r of rows) if (r && 'password' in r) r.password = '[REDACTED]';
      }
      snapshot.tables[t] = { rows: rows.length, capped: rows.length >= PER_TABLE_CAP, data: rows };
    } catch (e: any) {
      snapshot.tables[t] = { error: String(e?.message || e).slice(0, 200) };
    }
  }

  await logAdminAction(c, {
    action: 'db_export',
    targetType: 'system',
    targetId: 'snapshot',
    payload: { tables: Object.keys(snapshot.tables).length },
  }).catch(() => {});

  const stamp = new Date().toISOString().slice(0, 10);
  c.header('Content-Disposition', `attachment; filename="quantaex_snapshot_${stamp}.json"`);
  return c.json(snapshot);
});

// GET /admin/consents/:user_id — regulatory / audit view of a single user's
// consent history (Terms, Privacy, marketing opt-in, age_gate) with version,
// timestamp, IP and UA. Returns an empty array when the table is missing
// (pre-0034) so the admin dashboard degrades gracefully.
app.get('/consents/:user_id', async (c) => {
  const userId = c.req.param('user_id');
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT kind, version, effective_date, agreed, ip_address, user_agent, agreed_at, withdrew_at
       FROM user_consents
       WHERE user_id = ?
       ORDER BY agreed_at DESC`
    ).bind(userId).all();
    return c.json({ user_id: userId, consents: results || [] });
  } catch (e) {
    // Table not created yet (migration 0034 not applied). Fail soft.
    console.warn('[admin/consents] user_consents missing:', (e as Error).message);
    return c.json({ user_id: userId, consents: [], table_missing: true });
  }
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

    // Markers (so admin UI can show the integration phase badge + flip required/wasm_ready).
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

// ===========================================================================
// External Trading API (Sprint 5 Phase I1) — admin observability + toggle
// ---------------------------------------------------------------------------
// GET  /api/admin/external-trading-api/stats
//   Surfaces the four system_markers + nonce-table activity counters so the
//   admin UI can render an at-a-glance card without issuing five separate
//   queries.
// POST /api/admin/external-trading-api/toggle
//   Flips system_markers.external_trading_api_enabled between 'on' and 'off'.
//   Optional body { enabled: boolean } pins the value; otherwise the marker
//   toggles. Updates are written through admin_audit_logs so the change is
//   discoverable in the existing audit trail.
// ===========================================================================
app.get('/external-trading-api/stats', async (c) => {
  try {
    const markersRes = await c.env.DB.prepare(
      `SELECT key, value FROM system_markers
        WHERE key IN (
          'external_trading_api_enabled',
          'external_trading_api_integration',
          'external_trading_api_max_skew_sec'
        )`,
    ).all<{ key: string; value: string }>();
    const markers: Record<string, string> = {};
    for (const r of markersRes.results ?? []) markers[r.key] = r.value;

    // Nonce activity — total + last 24h. Wrapped so a missing table on a
    // fresh dev db doesn't 503 the whole card.
    let nonces = { total: 0, last24h: 0, last1h: 0 };
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const dayAgo = nowSec - 24 * 3600;
      const hourAgo = nowSec - 3600;
      const totalRow = await c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM api_key_nonces',
      ).first<{ n: number }>();
      const dayRow = await c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM api_key_nonces WHERE ts >= ?',
      ).bind(dayAgo).first<{ n: number }>();
      const hourRow = await c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM api_key_nonces WHERE ts >= ?',
      ).bind(hourAgo).first<{ n: number }>();
      nonces = {
        total: Number(totalRow?.n ?? 0),
        last24h: Number(dayRow?.n ?? 0),
        last1h: Number(hourRow?.n ?? 0),
      };
    } catch { /* table not migrated yet — leave zeros */ }

    return c.json({
      ok: true,
      enabled: (markers['external_trading_api_enabled'] ?? 'off') === 'on',
      integration_phase: markers['external_trading_api_integration'] ?? 'phase-i1-stub',
      max_skew_sec: parseInt(markers['external_trading_api_max_skew_sec'] ?? '60', 10) || 60,
      nonces,
      fetched_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return c.json(
      { error: 'external_trading_api_stats unavailable', detail: String(e?.message || e) },
      503,
    );
  }
});

app.post('/external-trading-api/toggle', async (c) => {
  const me = c.get('user') as { id: string; email: string; role: string };
  if (me.role !== 'admin') {
    return c.json({ error: 'admin role required' }, 403);
  }

  let desired: 'on' | 'off' | null = null;
  try {
    const body = await c.req.json<{ enabled?: boolean }>();
    if (typeof body?.enabled === 'boolean') {
      desired = body.enabled ? 'on' : 'off';
    }
  } catch { /* no body — treat as toggle */ }

  // If no explicit value, flip whatever is currently set.
  if (!desired) {
    const cur = await c.env.DB.prepare(
      "SELECT value FROM system_markers WHERE key = 'external_trading_api_enabled'",
    ).first<{ value: string }>();
    desired = (cur?.value ?? 'off') === 'on' ? 'off' : 'on';
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO system_markers (key, value)
       VALUES ('external_trading_api_enabled', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
      .bind(desired)
      .run();
  } catch (e: any) {
    return c.json(
      { error: 'failed to update marker', detail: String(e?.message || e) },
      503,
    );
  }

  // Best-effort audit log entry (mirrors other admin mutators).
  try {
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_logs (id, admin_user_id, admin_email, action, target, details, created_at)
       VALUES (?, ?, ?, 'external_trading_api_toggle', ?, ?, datetime('now'))`,
    )
      .bind(
        crypto.randomUUID(),
        me.id,
        me.email || '',
        'system_markers/external_trading_api_enabled',
        JSON.stringify({ value: desired }),
      )
      .run();
  } catch { /* swallow — audit best-effort */ }

  return c.json({ ok: true, enabled: desired === 'on' });
});

// ============================================================================
// Sprint 6 Phase A — Notice board CRUD (admin only)
// ----------------------------------------------------------------------------
// The public read API lives in /api/notices. Admin operations (create, edit,
// delete, pin) live here so they inherit the admin gate set up at the top of
// this file.
// ============================================================================

const NOTICE_TYPES = ['notice', 'event', 'maintenance', 'listing'] as const;

function validateNoticeBody(body: any): { ok: true; data: any } | { ok: false; error: string } {
  const type = String(body.type || '').trim();
  if (!NOTICE_TYPES.includes(type as any)) {
    return { ok: false, error: `type must be one of: ${NOTICE_TYPES.join(', ')}` };
  }
  const title_ko = String(body.title_ko || '').trim();
  const title_en = String(body.title_en || '').trim();
  const content_ko = String(body.content_ko || '').trim();
  const content_en = String(body.content_en || '').trim();
  if (!title_ko || title_ko.length > 200) return { ok: false, error: 'title_ko required, max 200 chars' };
  if (!title_en || title_en.length > 200) return { ok: false, error: 'title_en required, max 200 chars' };
  if (!content_ko || content_ko.length > 20000) return { ok: false, error: 'content_ko required, max 20000 chars' };
  if (!content_en || content_en.length > 20000) return { ok: false, error: 'content_en required, max 20000 chars' };
  const pinned = body.pinned === true || body.pinned === 1 ? 1 : 0;
  const published = body.published === false || body.published === 0 ? 0 : 1;
  return { ok: true, data: { type, title_ko, title_en, content_ko, content_en, pinned, published } };
}

// GET /api/admin/notices — admin list (includes unpublished)
app.get('/notices', async (c) => {
  const includeDeleted = c.req.query('include_deleted') === 'true';
  let query =
    `SELECT id, type, title_ko, title_en, content_ko, content_en,
            pinned, published, created_at, updated_at, created_by
       FROM notices`;
  if (!includeDeleted) query += ' WHERE published = 1';
  query += ' ORDER BY pinned DESC, created_at DESC LIMIT 500';
  const res = await c.env.DB.prepare(query).all<any>();
  return c.json({ notices: res.results || [] });
});

// POST /api/admin/notices — create
app.post('/notices', async (c) => {
  const me = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const v = validateNoticeBody(body);
  if (!v.ok) return c.json({ error: v.error }, 400);
  const d = v.data;
  const res = await c.env.DB.prepare(
    `INSERT INTO notices (type, title_ko, title_en, content_ko, content_en, pinned, published, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`
  ).bind(d.type, d.title_ko, d.title_en, d.content_ko, d.content_en, d.pinned, d.published, me.id).run();
  const newId = (res as any)?.meta?.last_row_id ?? null;
  // Audit
  try {
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_logs (id, admin_user_id, admin_email, action, target, details, created_at)
       VALUES (?, ?, ?, 'notice_create', ?, ?, datetime('now'))`
    ).bind(
      crypto.randomUUID(), me.id, me.email || '',
      `notices/${newId}`,
      JSON.stringify({ type: d.type, title_ko: d.title_ko.slice(0, 80) }),
    ).run();
  } catch { /* audit best-effort */ }
  return c.json({ ok: true, id: newId });
});

// PUT /api/admin/notices/:id — update
app.put('/notices/:id', async (c) => {
  const me = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);

  const exist = await c.env.DB.prepare('SELECT id FROM notices WHERE id = ?').bind(id).first();
  if (!exist) return c.json({ error: 'Notice not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const v = validateNoticeBody(body);
  if (!v.ok) return c.json({ error: v.error }, 400);
  const d = v.data;

  await c.env.DB.prepare(
    `UPDATE notices
        SET type = ?, title_ko = ?, title_en = ?, content_ko = ?, content_en = ?,
            pinned = ?, published = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`
  ).bind(d.type, d.title_ko, d.title_en, d.content_ko, d.content_en, d.pinned, d.published, id).run();

  try {
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_logs (id, admin_user_id, admin_email, action, target, details, created_at)
       VALUES (?, ?, ?, 'notice_update', ?, ?, datetime('now'))`
    ).bind(
      crypto.randomUUID(), me.id, me.email || '',
      `notices/${id}`,
      JSON.stringify({ type: d.type, pinned: d.pinned, published: d.published }),
    ).run();
  } catch { /* audit best-effort */ }

  return c.json({ ok: true });
});

// DELETE /api/admin/notices/:id — soft delete (set published = 0)
app.delete('/notices/:id', async (c) => {
  const me = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);

  const res = await c.env.DB.prepare(
    'UPDATE notices SET published = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(id).run();
  const changed = (res as any)?.meta?.changes ?? 0;
  if (changed === 0) return c.json({ error: 'Notice not found' }, 404);

  try {
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_logs (id, admin_user_id, admin_email, action, target, details, created_at)
       VALUES (?, ?, ?, 'notice_delete', ?, ?, datetime('now'))`
    ).bind(crypto.randomUUID(), me.id, me.email || '', `notices/${id}`, '{}').run();
  } catch { /* audit best-effort */ }

  return c.json({ ok: true });
});

// ============================================================================
// Downline force-purge (one-off operator maintenance)
// ----------------------------------------------------------------------------
// Given a ROOT nickname, walk the referral tree (referrer_id -> referred_id)
// across ALL levels (L1/L2/L3/…) and collect every descendant user. The root
// itself is NEVER included. Two endpoints:
//
//   GET  /admin/downline/:nickname/preview
//        Dry-run. Returns the root + the full descendant list (id, nickname,
//        email, level, is_active) and a `count`. Nothing is mutated.
//
//   POST /admin/downline/:nickname/purge   body: { confirm_count: number }
//        HARD-DELETE every descendant user row + all associated rows in every
//        table that has a user_id column, plus their referrals rows (as
//        referrer_id or referred_id). This FREES each deleted user's unique
//        nickname/email so they can re-register. `confirm_count` must exactly
//        match the live descendant count (guards against a tree that changed
//        between preview and purge). The root user is untouched.
//
// Implementation notes:
//   * Tree walk is an iterative BFS with a visited-set so a malformed cyclic
//     referral graph cannot loop forever.
//   * Associated-table cleanup uses an EXPLICIT hardcoded table list
//     (USER_ID_TABLES). Cloudflare D1 forbids schema introspection
//     (sqlite_master / PRAGMA table_info both raise SQLITE_AUTH), so dynamic
//     enumeration is impossible on prod and crashed the handler. `referrals`
//     (referrer_id/referred_id) and the users row itself are handled explicitly.
//     Keep USER_ID_TABLES in sync when a new user-scoped table is migrated in.
// ============================================================================

async function collectDownline(db: any, rootId: string): Promise<Array<{ id: string; level: number }>> {
  const out: Array<{ id: string; level: number }> = [];
  const visited = new Set<string>([rootId]);
  let frontier: string[] = [rootId];
  let level = 0;
  // Cap depth defensively; a real referral tree is only 3 deep but we walk all.
  while (frontier.length > 0 && level < 64) {
    level += 1;
    const placeholders = frontier.map(() => '?').join(',');
    const rows = await db
      .prepare(`SELECT DISTINCT referred_id FROM referrals WHERE referrer_id IN (${placeholders})`)
      .bind(...frontier)
      .all<{ referred_id: string }>();
    const next: string[] = [];
    for (const r of rows.results || []) {
      const childId = r.referred_id;
      if (!childId || visited.has(childId)) continue; // skip cycles / re-entry
      visited.add(childId);
      out.push({ id: childId, level });
      next.push(childId);
    }
    frontier = next;
  }
  return out;
}

// Cloudflare D1 REJECTS schema introspection — `SELECT ... FROM sqlite_master`
// and `PRAGMA table_info(...)` both throw `D1_ERROR: not authorized: SQLITE_AUTH`
// on the production D1 authorizer. The previous dynamic-enumeration version of
// this helper therefore ALWAYS crashed the purge handler on prod (the exception
// propagated out of the /purge route → "member deletion doesn't work"). We use
// an explicit, hardcoded list of every table that carries a `user_id` column
// instead. This is the same validated pattern used by the index.ts self-bootstrap
// purge. Update this list whenever a new user-scoped table is added by migration.
const USER_ID_TABLES: readonly string[] = [
  'api_keys', 'bridge_transfers', 'deposits', 'email_verifications', 'fee_ledger',
  'futures_positions', 'kyc_documents', 'liquidations', 'login_history', 'login_otps',
  'margin_accounts', 'margin_loans', 'notifications', 'orders', 'password_resets',
  'price_alerts', 'qta_addresses', 'qta_deposits', 'qta_hd_indexes', 'qta_withdrawals',
  'staking_dividends', 'staking_positions', 'user_consents', 'user_meta', 'user_sessions',
  'wallets', 'withdraw_whitelist', 'withdrawals',
];

function tablesWithUserId(): string[] {
  // Return a copy so callers cannot mutate the canonical list.
  return [...USER_ID_TABLES];
}

// GET /api/admin/downline/:nickname/preview — dry-run target list
app.get('/downline/:nickname/preview', async (c) => {
  const db = c.env.DB;
  const nickname = c.req.param('nickname');

  const root = await db
    .prepare('SELECT id, nickname, email, is_active FROM users WHERE nickname = ?')
    .bind(nickname)
    .first<any>();
  if (!root) return c.json({ error: `No user with nickname '${nickname}'` }, 404);

  const desc = await collectDownline(db, root.id);
  if (desc.length === 0) {
    return c.json({ root, count: 0, targets: [] });
  }
  const idPlaceholders = desc.map(() => '?').join(',');
  const detail = await db
    .prepare(`SELECT id, nickname, email, is_active, created_at FROM users WHERE id IN (${idPlaceholders})`)
    .bind(...desc.map((d) => d.id))
    .all<any>();
  const levelById = new Map(desc.map((d) => [d.id, d.level]));
  const targets = (detail.results || [])
    .map((u: any) => ({ ...u, level: levelById.get(u.id) ?? null }))
    .sort((a: any, b: any) => (a.level - b.level) || String(a.nickname).localeCompare(String(b.nickname)));

  return c.json({ root, count: targets.length, targets });
});

// DELETE /api/admin/users/:id — HARD delete a SINGLE member.
// Removes the user's rows from every user_id table + their referrals rows
// (as referrer or referred), then the users row itself — which frees the
// unique nickname/email for immediate re-registration. The user's DIRECT
// downline is NOT deleted; those referral links are simply severed (their
// referred_by is cleared) so the sub-members survive as top-level users.
// Uses the explicit USER_ID_TABLES list — D1 forbids sqlite_master / PRAGMA
// introspection (SQLITE_AUTH).
app.delete('/users/:id', async (c) => {
  const db = c.env.DB;
  const me = c.get('user');
  const id = c.req.param('id');

  const u = await db
    .prepare('SELECT id, nickname, email, role FROM users WHERE id = ?')
    .bind(id)
    .first<any>();
  if (!u) return c.json({ error: 'User not found' }, 404);
  if (u.id === me.id) return c.json({ error: 'Cannot delete yourself' }, 400);
  if (u.role === 'admin') return c.json({ error: 'Cannot delete an admin account' }, 400);

  const perTable: Record<string, number> = {};

  // 1) associated rows in every user_id table (explicit list — D1 forbids
  //    sqlite_master / PRAGMA introspection with SQLITE_AUTH)
  for (const tbl of tablesWithUserId()) {
    try {
      const res = await db.prepare(`DELETE FROM ${tbl} WHERE user_id = ?`).bind(u.id).run();
      perTable[tbl] = (res as any)?.meta?.changes ?? 0;
    } catch {
      perTable[tbl] = -1; // signal failure but keep going
    }
  }

  // 2) referral links — as referred (their own row) and as referrer (sever the
  //    link to their direct downline, who survive as top-level users).
  try {
    const r1 = await db.prepare('DELETE FROM referrals WHERE referred_id = ?').bind(u.id).run();
    const r2 = await db.prepare('DELETE FROM referrals WHERE referrer_id = ?').bind(u.id).run();
    perTable['referrals'] = ((r1 as any)?.meta?.changes ?? 0) + ((r2 as any)?.meta?.changes ?? 0);
  } catch { perTable['referrals'] = -1; }

  // 2b) best-effort clear of any denormalized referred_by pointer on children
  try {
    await db.prepare("UPDATE users SET referred_by = NULL WHERE referred_by = ?").bind(u.id).run();
  } catch { /* column may not exist — ignore */ }

  // 3) the user row itself — frees nickname + email UNIQUE for re-signup
  let deleted = 0;
  try {
    const ru = await db.prepare('DELETE FROM users WHERE id = ?').bind(u.id).run();
    deleted = (ru as any)?.meta?.changes ?? 0;
  } catch (e) {
    return c.json({ error: 'user delete failed', detail: String(e), per_table: perTable }, 500);
  }

  try {
    await logAdminAction(c, {
      action: 'user.delete',
      targetType: 'user',
      targetId: u.id,
      payload: { nickname: u.nickname, email: u.email, per_table: perTable },
    });
  } catch { /* audit best-effort */ }

  return c.json({
    ok: true,
    deleted_user: { id: u.id, nickname: u.nickname, email: u.email },
    deleted,
    per_table: perTable,
    freed_for_resignup: true,
  });
});

// POST /api/admin/downline/:nickname/purge — HARD delete the whole downline
app.post('/downline/:nickname/purge', async (c) => {
  const db = c.env.DB;
  const me = c.get('user');
  const nickname = c.req.param('nickname');

  let body: any = {};
  try { body = await c.req.json(); } catch { /* empty body */ }
  const confirmCount = Number(body?.confirm_count);
  if (!Number.isInteger(confirmCount) || confirmCount < 0) {
    return c.json({ error: 'confirm_count (integer) is required' }, 400);
  }

  const root = await db
    .prepare('SELECT id, nickname, email FROM users WHERE nickname = ?')
    .bind(nickname)
    .first<any>();
  if (!root) return c.json({ error: `No user with nickname '${nickname}'` }, 404);

  const desc = await collectDownline(db, root.id);
  const targetIds = desc.map((d) => d.id);

  if (targetIds.length !== confirmCount) {
    return c.json({
      error: 'confirm_count mismatch — the downline changed since preview',
      live_count: targetIds.length,
      confirm_count: confirmCount,
    }, 409);
  }
  if (targetIds.length === 0) {
    return c.json({ ok: true, deleted_users: 0, note: 'downline already empty' });
  }

  // Snapshot who we are about to delete (for the audit trail).
  const snap = await db
    .prepare(`SELECT id, nickname, email FROM users WHERE id IN (${targetIds.map(() => '?').join(',')})`)
    .bind(...targetIds)
    .all<any>();
  const deletedList = (snap.results || []).map((u: any) => ({ id: u.id, nickname: u.nickname, email: u.email }));

  const ph = targetIds.map(() => '?').join(',');
  const perTable: Record<string, number> = {};

  // 1) associated rows in every user_id table (explicit list — D1 forbids
  //    sqlite_master / PRAGMA introspection with SQLITE_AUTH)
  const userTables = tablesWithUserId();
  for (const tbl of userTables) {
    try {
      const res = await db.prepare(`DELETE FROM ${tbl} WHERE user_id IN (${ph})`).bind(...targetIds).run();
      perTable[tbl] = (res as any)?.meta?.changes ?? 0;
    } catch (e) {
      perTable[tbl] = -1; // signal failure but keep going
    }
  }

  // 2) referrals rows where a target is either the referrer or the referred
  try {
    const r1 = await db.prepare(`DELETE FROM referrals WHERE referred_id IN (${ph})`).bind(...targetIds).run();
    const r2 = await db.prepare(`DELETE FROM referrals WHERE referrer_id IN (${ph})`).bind(...targetIds).run();
    perTable['referrals'] = ((r1 as any)?.meta?.changes ?? 0) + ((r2 as any)?.meta?.changes ?? 0);
  } catch { perTable['referrals'] = -1; }

  // 3) the user rows themselves — frees nickname + email UNIQUE for re-signup
  let deletedUsers = 0;
  try {
    const ru = await db.prepare(`DELETE FROM users WHERE id IN (${ph})`).bind(...targetIds).run();
    deletedUsers = (ru as any)?.meta?.changes ?? 0;
  } catch (e) {
    return c.json({ error: 'user delete failed', detail: String(e), per_table: perTable }, 500);
  }

  // Best-effort audit
  try {
    await logAdminAction(c, {
      action: 'user.downline_purge',
      targetType: 'user',
      targetId: root.id,
      payload: {
        root_nickname: root.nickname,
        deleted_users: deletedUsers,
        per_table: perTable,
        deleted: deletedList,
      },
    });
  } catch { /* audit best-effort */ }

  return c.json({
    ok: true,
    root: { id: root.id, nickname: root.nickname },
    deleted_users: deletedUsers,
    per_table: perTable,
    freed_for_resignup: true,
    deleted: deletedList,
  });
});

export default app;
