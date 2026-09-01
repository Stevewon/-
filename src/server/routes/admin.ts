import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { createNotification } from './notifications';
import { logAdminAction } from '../utils/audit';
import { computeBalanceBreakdown } from '../lib/balance-breakdown';
import { recomputeBinaryFromStaking, rollStakeUpBinary, placeInBinaryTree, assignBinaryLeg } from '../lib/binary-matching';
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

// ★ 2026-09-01 ~ 09-10 (KST) fixed peg: 1 QTA = 6원, 1 USDT = 1,450원.
//   Binary MATCH BONUS QTA payouts (via recomputeBinaryFromStaking /
//   rollStakeUpBinary) must convert bonus USD → QTA at this fixed price, exactly
//   like staking dividends. Outside the window, fall back to the live price.
const ADMIN_FIXED_QTA_USD = 6 / 1450; // $0.00413793
const ADMIN_FIXED_WIN_START_MS = Date.parse('2026-09-01T00:00:00+09:00');
const ADMIN_FIXED_WIN_END_MS = Date.parse('2026-09-11T00:00:00+09:00'); // exclusive
function adminInFixedWindow(nowMs: number): boolean {
  return nowMs >= ADMIN_FIXED_WIN_START_MS && nowMs < ADMIN_FIXED_WIN_END_MS;
}

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

  // Defensive: never let a DB hiccup 500 the whole 입금 탭 — return [] so the
  // page renders and the operator can still switch tabs / do manual deposits.
  try {
    const { results } = await db.prepare(sql).bind(...params).all();
    return c.json(results);
  } catch (err: any) {
    console.warn('[admin/deposits] query failed:', err?.message || err);
    return c.json([]);
  }
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

  // Optional referral link (윗 직대 연결). Manual deposit ONLY connects the
  // member under the referrer — it does NOT choose a binary leg (L/R). The
  // referrer later picks L/R themselves from their own account, after seeing
  // "누가 나를 추천으로 얼마 했다" in their team view. So we attach the member
  // (binary_parent_id = referrer, binary_leg stays NULL) and write the L1
  // referrals row (idempotent). If the member is already placed, we leave it.
  const referrerCode = String(body.referrer_code || '').trim().toUpperCase();
  let referrer: { id: string; nickname: string | null; email: string | null } | null = null;
  if (referrerCode) {
    const rf = await db.prepare(
      `SELECT id, nickname, email FROM users WHERE referral_code = ?`
    ).bind(referrerCode).first<any>();
    if (!rf) return c.json({ error: `추천코드 "${referrerCode}"에 해당하는 회원을 찾을 수 없습니다` }, 404);
    if (rf.id === user_id) return c.json({ error: '본인을 추천인으로 지정할 수 없습니다' }, 400);
    referrer = { id: rf.id, nickname: rf.nickname ?? null, email: rf.email ?? null };
  }

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

  // ── REFERRAL LINK (윗 직대 연결, 좌/우는 추천인이 나중에 본인이 선택) ──────────
  const placement: any = { referrer: referrer ? { id: referrer.id, nickname: referrer.nickname, email: referrer.email } : null, linked: false, already_placed: false };
  if (referrer) {
    try {
      // 1) L1 referral relationship — this is what the referrer's team/직대
      //    view reads to show "이 회원이 나를 추천으로 가입/입금".
      await db.prepare(
        `INSERT OR IGNORE INTO referrals
           (id, referrer_id, referred_id, referral_code, reward_qta, rewarded_in_qx, level)
         VALUES (?, ?, ?, ?, 0, 1, 1)`
      ).bind(uuid(), referrer.id, user_id, referrerCode).run();

      // 2) Binary attach (parent only, leg stays NULL). Referrer later assigns
      //    L/R themselves from their own account.
      const existing = await db.prepare(
        `SELECT binary_parent_id, binary_leg FROM users WHERE id = ?`
      ).bind(user_id).first<any>();
      if (existing?.binary_parent_id) {
        placement.already_placed = true;
        placement.leg = existing.binary_leg || null;
      } else {
        await placeInBinaryTree(db, user_id, referrer.id);
        placement.linked = true;
      }
    } catch (e) {
      console.warn('[deposit.manual] referral link failed:', e);
      placement.error = String((e as any)?.message || e).slice(0, 200);
    }
  }

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

  return c.json({ id, tx_hash: tx, amount: amt, placement });
});

// ---------------------------------------------------------------------------
// GET /deposits/manual — LIVE list of ALL admin-created MANUAL deposits.
//   Two creation paths both count as "수동입금":
//     • POST /admin/deposits/manual → network='MANUAL', tx_hash='MANUAL-...'
//     • POST /wallet/admin-credit   → tx_hash='admin-...' (network may be NULL)
//   This endpoint returns BOTH (newest first) with the member's email/nickname,
//   plus per-coin totals so the admin can see the running tally in real time.
//   Optional filters: ?coin=QTA  &q=<email/nickname substring>  &limit=<n up to 1000>.
// ---------------------------------------------------------------------------
app.get('/deposits/manual', async (c) => {
  const db = c.env.DB;
  const coin = (c.req.query('coin') || '').trim().toUpperCase();
  const q = (c.req.query('q') || '').trim();
  const limit = Math.min(parseInt(c.req.query('limit') || '200'), 1000);

  // Include BOTH manual paths: network='MANUAL' OR admin-credit tx_hash prefix.
  const conds: string[] = [`(d.network = 'MANUAL' OR d.tx_hash LIKE 'admin-%')`];
  const params: any[] = [];
  if (coin) { conds.push('d.coin_symbol = ?'); params.push(coin); }
  if (q) {
    conds.push('(u.email LIKE ? OR u.nickname LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like);
  }
  const where = `WHERE ${conds.join(' AND ')}`;

  const listSql = `
    SELECT d.id, d.user_id, d.coin_symbol, d.amount, d.tx_hash, d.memo,
           d.status, d.network, d.created_at, u.email, u.nickname
      FROM deposits d
      JOIN users u ON u.id = d.user_id
      ${where}
     ORDER BY d.created_at DESC
     LIMIT ?`;
  const totalsSql = `
    SELECT d.coin_symbol AS coin, COUNT(*) AS count, COALESCE(SUM(d.amount),0) AS total
      FROM deposits d
      JOIN users u ON u.id = d.user_id
      ${where}
     GROUP BY d.coin_symbol
     ORDER BY total DESC`;

  // Defensive: keep the 입금 탭 alive even if a DB error occurs.
  try {
    const { results: rows } = await db.prepare(listSql).bind(...params, limit).all<any>();
    const { results: totals } = await db.prepare(totalsSql).bind(...params).all<any>();
    const grandCount = (rows || []).length;
    return c.json({
      rows: rows || [],
      totals: totals || [],       // [{ coin, count, total }]
      returned: grandCount,
      limit,
      filter: { coin: coin || null, q: q || null },
    });
  } catch (err: any) {
    console.warn('[admin/deposits/manual] query failed:', err?.message || err);
    return c.json({ rows: [], totals: [], returned: 0, limit, filter: { coin: coin || null, q: q || null }, degraded: true });
  }
});

// ---------------------------------------------------------------------------
// DELETE /deposits/manual/:id — 수동입금 삭제(취소).
//   관리자가 잘못 넣은 수동입금(두 경로 모두)을 되돌린다:
//     • POST /admin/deposits/manual → network='MANUAL', tx_hash='MANUAL-...'
//     • POST /wallet/admin-credit   → tx_hash='admin-...'
//   되돌림 규칙:
//     1) 대상은 '수동입금 + completed' 건만 (실입금/온체인 건은 거부).
//     2) 지갑 available 를 원자적으로 차감 (available >= amount 가드).
//        → 이미 사용(스테이킹/출금/거래)된 잔액이면 changes=0 → 409 거부.
//     3) available_initial(회사지급분 추적)은 차감 후 available 를 넘지 못하도록
//        MIN(available_initial, available) 로 정합성 유지 → 회사지급/출금가능
//        어느 쪽이든 인베리언트가 깨지지 않음.
//     4) claim-first: deposits 행을 상태 가드와 함께 삭제 → 이중삭제 방지.
//     5) 감사로그 기록.
// ---------------------------------------------------------------------------
app.delete('/deposits/manual/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  // 1) 대상 조회 — 수동입금(두 경로) + completed 만 삭제 허용.
  const dep = await db.prepare(
    `SELECT id, user_id, coin_symbol, amount, tx_hash, status, network
       FROM deposits WHERE id = ?`
  ).bind(id).first<any>();
  if (!dep) return c.json({ error: '입금 내역을 찾을 수 없습니다' }, 404);

  const isManual = dep.network === 'MANUAL' || String(dep.tx_hash || '').startsWith('admin-');
  if (!isManual) {
    return c.json({ error: '수동입금 건만 삭제할 수 있습니다 (온체인/실입금은 삭제 불가)' }, 400);
  }
  if (dep.status !== 'completed') {
    return c.json({ error: `삭제할 수 없는 상태입니다 (status=${dep.status})` }, 409);
  }

  // 1.5) 하부(추천 하위 조직) 존재 검사 — 이 회원 아래에 누군가 있으면 삭제 불가.
  //   "하부"는 두 관점 모두를 뜻한다:
  //     • referrals.referrer_id = 이 회원  → 추천 조직상 직대/하위가 존재
  //     • users.binary_parent_id = 이 회원  → 바이너리 트리상 하위가 존재
  //   둘 중 하나라도 있으면(=조직이 이미 형성됨) 진입금액 회수가 다른 회원에게
  //   영향을 줄 수 있으므로 삭제를 거부한다. (당일 여부와 무관)
  try {
    const downline = await db.prepare(
      `SELECT (
         (SELECT COUNT(*) FROM referrals WHERE referrer_id = ?1) +
         (SELECT COUNT(*) FROM users     WHERE binary_parent_id = ?1)
       ) AS cnt`
    ).bind(dep.user_id).first<any>();
    const downlineCount = Number(downline?.cnt || 0);
    if (downlineCount > 0) {
      return c.json({
        error: `하부(추천 하위)가 ${downlineCount}명 있어 삭제할 수 없습니다. 하부가 아무도 없을 때만 수동입금 삭제가 가능합니다.`,
        downline_count: downlineCount,
      }, 409);
    }
  } catch (err: any) {
    // 검사 자체가 실패하면 안전하게 삭제를 막는다(=fail-closed).
    console.warn('[admin/deposits/manual DELETE] downline check failed:', err?.message || err);
    return c.json({ error: '하부 존재 여부를 확인하지 못해 삭제를 중단했습니다. 잠시 후 다시 시도하세요.' }, 500);
  }

  const amt = Number(dep.amount) || 0;
  if (!(amt > 0)) {
    // 금액이 0 이하면 지갑을 건드리지 않고 행만 정리.
    await db.prepare(`DELETE FROM deposits WHERE id = ? AND status = 'completed'`).bind(id).run();
    await logAdminAction(c, {
      action: 'deposit.manual_delete', targetType: 'deposit', targetId: id,
      payload: { user_id: dep.user_id, coin_symbol: dep.coin_symbol, amount: amt, tx_hash: dep.tx_hash, zero_amount: true },
    });
    return c.json({ ok: true, message: '수동입금이 삭제되었습니다', reversed_amount: 0 });
  }

  // 2) 지갑 available 원자적 차감 (available >= amount 가드).
  //    이미 사용된 잔액이면 changes=0 → 되돌릴 수 없음.
  //    available_initial(회사지급분 추적): 회사지급 수동입금은 생성 시 +amount
  //    되었으므로 되돌릴 때 -amount. 단, 음수가 되지 않도록 MAX(0,...),
  //    그리고 차감 후 available 를 넘지 않도록 MIN(..., available-amount)
  //    로 인베리언트(available_initial ≤ available)를 항상 유지한다.
  const rev = await db.prepare(
    `UPDATE wallets
        SET available_initial = MIN(
              MAX(0, COALESCE(available_initial, 0) - ?),
              available - ?
            ),
            available = available - ?
      WHERE user_id = ? AND coin_symbol = ? AND available >= ?`
  ).bind(amt, amt, amt, dep.user_id, dep.coin_symbol, amt).run();

  if (!rev.meta || rev.meta.changes === 0) {
    return c.json({
      error: '잔액이 부족하여 삭제할 수 없습니다 (해당 자금이 이미 사용/출금/스테이킹됨)',
    }, 409);
  }

  // 3) claim-first: deposits 행 삭제 (completed 상태일 때만) → 이중삭제 방지.
  const del = await db.prepare(
    `DELETE FROM deposits WHERE id = ? AND status = 'completed'`
  ).bind(id).run();

  if (!del.meta || del.meta.changes === 0) {
    // 극히 드문 동시성 케이스: 지갑은 이미 되돌렸는데 행이 사라짐 → 롤백(재크레딧).
    await db.prepare(
      `UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = ?`
    ).bind(amt, dep.user_id, dep.coin_symbol).run();
    return c.json({ error: '동시 처리로 삭제가 취소되었습니다. 다시 시도하세요' }, 409);
  }

  // 4) 감사로그.
  await logAdminAction(c, {
    action: 'deposit.manual_delete', targetType: 'deposit', targetId: id,
    payload: {
      user_id: dep.user_id, coin_symbol: dep.coin_symbol,
      amount: amt, tx_hash: dep.tx_hash, network: dep.network,
    },
  });

  return c.json({ ok: true, message: '수동입금이 삭제되었습니다', reversed_amount: amt });
});

// ============================================================================
// On-chain (external) deposit APPROVAL queue — owner rule 2026-08-29.
// ----------------------------------------------------------------------------
// A confirmed on-chain USDT deposit for a REGULAR user is parked by the cron
// watcher in ext_deposits.status = 'awaiting_approval' (NO wallet credit). The
// admin verifies the main wallet actually received the funds, then Approves
// here — only then is the user's `available` balance credited and the deposit
// becomes usable for buying QTA. Company/admin accounts auto-credit (never
// enter this queue). Approve/Reject are atomic + idempotent.
// ============================================================================

// GET /admin/ext-deposits?status=awaiting_approval|credited|rejected|confirming|detected|all
app.get('/ext-deposits', async (c) => {
  const db = c.env.DB;
  const status = (c.req.query('status') || 'awaiting_approval').trim();
  const limit = Math.min(parseInt(c.req.query('limit') || '200'), 500);

  let sql = `
    SELECT d.id, d.user_id, d.chain, d.network, d.coin_symbol, d.address,
           d.tx_hash, d.block_height, d.amount, d.confirmations, d.required_confs,
           d.status, d.credited_at, d.approved_by, d.approved_at, d.rejected_reason,
           d.created_at, u.email, u.nickname
      FROM ext_deposits d
      LEFT JOIN users u ON u.id = d.user_id
  `;
  const params: any[] = [];
  if (status && status !== 'all') {
    sql += ' WHERE d.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY d.created_at DESC LIMIT ?';
  params.push(limit);

  // Defensive: if the ext_deposits table/columns are missing on an environment
  // where migration 0046 has not been applied yet, the query throws SQLITE_ERROR
  // and the whole 입금 탭 fails to load. Return an empty queue instead of 500 so
  // the admin page still renders (the other tabs keep working).
  try {
    const { results } = await db.prepare(sql).bind(...params).all<any>();
    const pend = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM ext_deposits WHERE status = 'awaiting_approval'`
    ).first<{ cnt: number }>();
    return c.json({ rows: results || [], awaiting_count: pend?.cnt || 0 });
  } catch (err: any) {
    console.warn('[admin/ext-deposits] query failed:', err?.message || err);
    return c.json({ rows: [], awaiting_count: 0, degraded: true });
  }
});

// POST /admin/ext-deposits/:id/approve — credit the user's wallet, mark credited.
app.post('/ext-deposits/:id/approve', async (c) => {
  const db = c.env.DB;
  const admin = c.get('user') as { id: string; email: string };
  const id = c.req.param('id');

  const row = await db.prepare(
    `SELECT id, user_id, coin_symbol, amount, status FROM ext_deposits WHERE id = ?`
  ).bind(id).first<any>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'awaiting_approval') {
    return c.json({ error: 'invalid_status', status: row.status }, 409);
  }

  const asset = String(row.coin_symbol || 'USDT').toUpperCase();
  const amt = Number(row.amount || '0');
  const nowIso = new Date().toISOString();

  // Atomic claim: flip status ONLY while still awaiting_approval. If a
  // concurrent approve already claimed it, changes === 0 and we bail — so the
  // wallet is never credited twice.
  const claim = await db.prepare(
    `UPDATE ext_deposits
        SET status = 'credited', credited_at = ?, approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND status = 'awaiting_approval'`
  ).bind(nowIso, admin.id, nowIso, nowIso, id).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ error: 'invalid_status' }, 409);
  }

  // Credit the user's balance now that an admin verified the main-wallet receipt.
  if (amt > 0) {
    await db.prepare(
      `INSERT INTO wallets (id, user_id, coin_symbol, available, locked)
       VALUES (?, ?, ?, 0, 0)
       ON CONFLICT(user_id, coin_symbol) DO NOTHING`
    ).bind(uuid(), row.user_id, asset).run();
    await db.prepare(
      `UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = ?`
    ).bind(amt, row.user_id, asset).run();
  }

  try {
    await createNotification(db, row.user_id, {
      type: 'deposit',
      title: 'Deposit Approved',
      message: `+${amt} ${asset} deposit approved and credited to your wallet.`,
      data: { coin: asset, amount: amt, tx_hash: row.tx_hash, onchain: true },
    });
  } catch { /* ignore */ }

  await logAdminAction(c, {
    action: 'ext_deposit.approve',
    targetType: 'ext_deposit',
    targetId: id,
    payload: { user_id: row.user_id, coin: asset, amount: amt, tx_hash: row.tx_hash },
  });

  try {
    const to = await lookupEmail(db, row.user_id);
    if (to) {
      const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
      fireAndForgetMail(
        c.env as any,
        to,
        tmplDepositCredited(appUrl, { amount: amt, coin: asset, txHash: row.tx_hash, note: null }),
        c.executionCtx as any,
      );
    }
  } catch (e) { console.warn('[ext_deposit.approve] mail failed:', e); }

  return c.json({ ok: true, id, status: 'credited', credited: amt, coin: asset });
});

// POST /admin/ext-deposits/:id/reject — mark rejected (no credit). Body: { reason }
app.post('/ext-deposits/:id/reject', async (c) => {
  const db = c.env.DB;
  const admin = c.get('user') as { id: string; email: string };
  const id = c.req.param('id');
  let body: any = {};
  try { body = await c.req.json(); } catch { /* empty ok */ }
  const reason = String(body.reason || 'rejected by admin').slice(0, 200);

  const row = await db.prepare(
    `SELECT id, user_id, coin_symbol, amount, status FROM ext_deposits WHERE id = ?`
  ).bind(id).first<any>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'awaiting_approval') {
    return c.json({ error: 'invalid_status', status: row.status }, 409);
  }

  const nowIso = new Date().toISOString();
  const claim = await db.prepare(
    `UPDATE ext_deposits
        SET status = 'rejected', rejected_reason = ?, approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND status = 'awaiting_approval'`
  ).bind(reason, admin.id, nowIso, nowIso, id).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ error: 'invalid_status' }, 409);
  }

  await logAdminAction(c, {
    action: 'ext_deposit.reject',
    targetType: 'ext_deposit',
    targetId: id,
    payload: { user_id: row.user_id, coin: row.coin_symbol, amount: row.amount, reason },
  });

  return c.json({ ok: true, id, status: 'rejected' });
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

// ============================================================================
// POST /admin/binary/recompute — RESET & REBUILD 몸값 from STAKING only.
// ----------------------------------------------------------------------------
// OWNER RULE (2026-08-28): 몸값(self_usd) & binary volume come EXCLUSIVELY from
// STAKING SUBSCRIPTIONS. This endpoint wipes ALL existing binary_volume (which
// was WRONGLY grown from deposits under the old rule) and rebuilds it purely
// from staking_positions. Admin-only. Idempotent — safe to re-run.
// ============================================================================
app.post('/binary/recompute', async (c) => {
  try {
    // Live QTA price (USD). Fallback to the known peg used elsewhere.
    let qtaPrice = 0;
    try {
      const row = await c.env.DB.prepare(
        `SELECT price_usd FROM coins WHERE symbol = 'QTA'`
      ).first<any>();
      qtaPrice = Number(row?.price_usd || 0);
    } catch { /* ignore */ }
    if (!(qtaPrice > 0)) qtaPrice = 0.00357142857;
    // ★ During the fixed window, match-bonus QTA converts at the 6원 peg.
    if (adminInFixedWindow(Date.now())) qtaPrice = ADMIN_FIXED_QTA_USD;

    const report = await recomputeBinaryFromStaking(c.env.DB, qtaPrice);

    try {
      await logAdminAction(c, {
        action: 'binary.recompute',
        targetType: 'binary_volume',
        targetId: 'all',
        payload: { ...report, qta_price: qtaPrice },
      });
    } catch { /* audit best-effort */ }

    return c.json({ ...report, qta_price: qtaPrice });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

// ============================================================================
// POST /admin/staking-positions/delete — delete ONE staking position by id,
// then RECOMPUTE binary volume so the tree exactly reflects the remaining
// positions. Used to remove a DUPLICATE position (e.g. a member's own stake
// that got duplicated by a later admin-granted position). Admin-only.
//
// Body: { position_id: string, confirm?: true }
// Returns the deleted position snapshot + the fresh recompute report.
// ============================================================================
app.post('/staking-positions/delete', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({} as any));
  const positionId = String(body.position_id || '').trim();
  if (!positionId) return c.json({ ok: false, error: 'position_id가 필요합니다' }, 400);

  // Snapshot the position BEFORE deletion (for audit + response).
  const pos = await db.prepare(
    `SELECT id, user_id, product_id, principal_usd, real_principal_usd,
            bonus_principal_usd, principal_qta, granted_by, status, created_at
       FROM staking_positions WHERE id = ?`
  ).bind(positionId).first<any>();
  if (!pos) return c.json({ ok: false, error: '해당 포지션을 찾을 수 없습니다', position_id: positionId }, 404);

  // Delete the position.
  const del = await db.prepare(`DELETE FROM staking_positions WHERE id = ?`).bind(positionId).run();
  const deletedCount = Number((del as any)?.meta?.changes ?? 0);
  if (deletedCount < 1) {
    return c.json({ ok: false, error: '삭제에 실패했습니다 (변경된 행 없음)', position_id: positionId }, 500);
  }

  // Best-effort: roll back the product's total_staked by the deleted principal.
  try {
    await db.prepare(
      `UPDATE staking_products
          SET total_staked = MAX(0, COALESCE(total_staked,0) - ?), updated_at = ?
        WHERE id = ?`
    ).bind(Number(pos.principal_usd) || 0, new Date().toISOString(), pos.product_id).run();
  } catch { /* ignore */ }

  // Recompute the FULL binary tree from the remaining staking positions so the
  // deleted position's volume is removed cleanly (no drift / no double count).
  let recompute: any = null;
  try {
    let qtaPrice = 0;
    try {
      const row = await db.prepare(`SELECT price_usd FROM coins WHERE symbol = 'QTA'`).first<any>();
      qtaPrice = Number(row?.price_usd || 0);
    } catch { /* ignore */ }
    if (!(qtaPrice > 0)) qtaPrice = 0.00357142857;
    // ★ During the fixed window, match-bonus QTA converts at the 6원 peg.
    if (adminInFixedWindow(Date.now())) qtaPrice = ADMIN_FIXED_QTA_USD;
    recompute = await recomputeBinaryFromStaking(db, qtaPrice);
    recompute.qta_price = qtaPrice;
  } catch (e: any) {
    recompute = { ok: false, error: String(e?.message || e).slice(0, 200) };
  }

  try {
    await logAdminAction(c, {
      action: 'staking.position.delete',
      targetType: 'staking_position',
      targetId: positionId,
      payload: { deleted: pos, recompute },
    });
  } catch { /* audit best-effort */ }

  return c.json({ ok: true, deleted: pos, recompute });
});

// ============================================================================
// Company-only TWAP (분할 매도) management.
// ----------------------------------------------------------------------------
// Only the COMPANY account (role='admin' / admin@quantaex.io) may create TWAP
// treasury sells. The operator enters a total amount + a duration (and how many
// slices), and the cron worker sells it off in equal slices over time so a big
// treasury liquidation never crashes the displayed price (급락 방지).
// ============================================================================
async function ensureTwapTable(db: any) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS twap_orders (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, market_symbol TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'sell', order_type TEXT NOT NULL DEFAULT 'limit',
      limit_price REAL, total_amount REAL NOT NULL, remaining_amount REAL NOT NULL,
      slice_count INTEGER NOT NULL, slice_amount REAL NOT NULL,
      slices_done INTEGER NOT NULL DEFAULT 0, interval_sec INTEGER NOT NULL,
      next_run_at TEXT NOT NULL, end_at TEXT, status TEXT NOT NULL DEFAULT 'active',
      note TEXT, last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run().catch(() => {});
}

// GET /admin/twap — list this operator's TWAP orders with live progress.
app.get('/twap', async (c) => {
  const admin = c.get('user') as any;
  await ensureTwapTable(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM twap_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
  ).bind(admin.id).all<any>();
  const rows = (results || []).map((r: any) => {
    const total = Number(r.total_amount) || 0;
    const remaining = Number(r.remaining_amount) || 0;
    const sold = Math.max(0, total - remaining);
    return {
      ...r,
      sold_amount: sold,
      progress_pct: total > 0 ? Math.min(100, (sold / total) * 100) : 0,
    };
  });
  return c.json({ ok: true, orders: rows });
});

// POST /admin/twap — create a new TWAP split-sell.
// Body: { market_symbol, order_type('limit'|'market'), limit_price?,
//         total_amount, slice_count, interval_sec, note? }
app.post('/twap', async (c) => {
  const admin = c.get('user') as any;
  await ensureTwapTable(c.env.DB);

  let body: any = {};
  try { body = await c.req.json(); } catch { /* empty */ }

  const market_symbol = String(body.market_symbol || '').trim().toUpperCase();
  const order_type = body.order_type === 'market' ? 'market' : 'limit';
  const total_amount = Number(body.total_amount);
  const slice_count = Math.floor(Number(body.slice_count));
  const interval_sec = Math.floor(Number(body.interval_sec));
  const limit_price = order_type === 'limit' ? Number(body.limit_price) : null;
  const note = body.note ? String(body.note).slice(0, 200) : null;

  // Validation
  const [base, quote] = market_symbol.split('-');
  if (!base || !quote) return c.json({ ok: false, error: 'market_symbol 형식이 올바르지 않습니다 (예: QTA-USDT)' }, 400);
  if (!isFinite(total_amount) || total_amount <= 0) return c.json({ ok: false, error: '총 매도 수량이 올바르지 않습니다' }, 400);
  if (!Number.isInteger(slice_count) || slice_count < 1 || slice_count > 2000) return c.json({ ok: false, error: '분할 횟수는 1~2000 사이여야 합니다' }, 400);
  if (!Number.isInteger(interval_sec) || interval_sec < 60 || interval_sec > 86400) return c.json({ ok: false, error: '분할 간격은 60초~86400초(24시간) 사이여야 합니다' }, 400);
  if (order_type === 'limit' && (!isFinite(limit_price as number) || (limit_price as number) <= 0)) {
    return c.json({ ok: false, error: '지정가 주문은 최저가(limit_price)가 필요합니다' }, 400);
  }

  // Market must exist and be active.
  const market = await c.env.DB.prepare(
    'SELECT * FROM markets WHERE base_coin = ? AND quote_coin = ? AND is_active = 1'
  ).bind(base, quote).first<any>();
  if (!market) return c.json({ ok: false, error: '해당 마켓을 찾을 수 없습니다' }, 404);

  // Company must actually hold enough of the base coin (available balance).
  const wallet = await c.env.DB.prepare(
    'SELECT available FROM wallets WHERE user_id = ? AND coin_symbol = ?'
  ).bind(admin.id, base).first<{ available: number }>();
  const available = Number(wallet?.available || 0);
  if (available < total_amount) {
    return c.json({ ok: false, error: `보유 ${base} 수량이 부족합니다 (보유: ${available}, 필요: ${total_amount})` }, 400);
  }

  const slice_amount = total_amount / slice_count;
  const nowMs = Date.now();
  // First slice fires on the next cron tick (immediately eligible).
  const next_run_at = new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ');
  const end_at = new Date(nowMs + (slice_count - 1) * interval_sec * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO twap_orders
       (id, user_id, market_symbol, side, order_type, limit_price,
        total_amount, remaining_amount, slice_count, slice_amount,
        slices_done, interval_sec, next_run_at, end_at, status, note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, admin.id, market_symbol, 'sell', order_type, limit_price,
    total_amount, total_amount, slice_count, slice_amount,
    0, interval_sec, next_run_at, end_at, 'active', note,
  ).run();

  await logAdminAction(c, {
    action: 'twap.create',
    targetType: 'twap_order',
    targetId: id,
    payload: { market_symbol, order_type, limit_price, total_amount, slice_count, interval_sec },
  }).catch(() => {});

  const created = await c.env.DB.prepare('SELECT * FROM twap_orders WHERE id = ?').bind(id).first<any>();
  return c.json({ ok: true, order: created });
});

// POST /admin/twap/:id/cancel — stop an active/paused TWAP.
app.post('/twap/:id/cancel', async (c) => {
  const admin = c.get('user') as any;
  const id = c.req.param('id');
  await ensureTwapTable(c.env.DB);
  const row = await c.env.DB.prepare(
    'SELECT * FROM twap_orders WHERE id = ? AND user_id = ?'
  ).bind(id, admin.id).first<any>();
  if (!row) return c.json({ ok: false, error: 'TWAP 주문을 찾을 수 없습니다' }, 404);
  if (row.status === 'completed' || row.status === 'cancelled') {
    return c.json({ ok: false, error: `이미 ${row.status} 상태입니다` }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE twap_orders SET status='cancelled', updated_at=datetime('now') WHERE id=?`
  ).bind(id).run();
  await logAdminAction(c, {
    action: 'twap.cancel', targetType: 'twap_order', targetId: id,
  }).catch(() => {});
  return c.json({ ok: true });
});

// ============================================================================
// Admin-granted staking with a BONUS (인정) principal.
// ----------------------------------------------------------------------------
// The admin opens a staking position ON BEHALF OF a member with an inflated
// principal:  principal_usd = real + bonus.
//   • Daily dividend + binary matching run on the FULL principal_usd (2,000).
//   • At MATURITY only real_principal_usd (1,000) worth of QTA is returned;
//     the bonus evaporates.
//   • EARLY exit charges the 30% penalty on the WHOLE inflated base.
// No wallet balance is deducted from the user — this is a company grant.
// Because principal_qta / qta_price_at_stake are left 0, the binary tick falls
// back to principal_usd, so 몸값/matching count the full 2,000. (migration 0056)
// ============================================================================
async function qtaPriceUsd(db: any): Promise<number> {
  // ★ During the fixed window, match-bonus QTA converts at the 6원 peg.
  if (adminInFixedWindow(Date.now())) return ADMIN_FIXED_QTA_USD;
  try {
    const row = await db.prepare(`SELECT price_usd FROM coins WHERE symbol = 'QTA'`).first<{ price_usd: number }>();
    const p = Number(row?.price_usd || 0);
    if (p > 0) return p;
  } catch { /* ignore */ }
  return 0.00357142857; // fallback ≈ 5원 @1,400
}

// GET /admin/staking-grants — list admin-granted positions with progress.
app.get('/staking-grants', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT sp.*, u.email, u.nickname
       FROM staking_positions sp
       JOIN users u ON u.id = sp.user_id
      WHERE sp.granted_by IS NOT NULL
      ORDER BY sp.created_at DESC LIMIT 200`
  ).all<any>().catch(() => ({ results: [] as any[] }));
  return c.json({ ok: true, grants: results || [] });
});

// GET /admin/staking-positions?user_id=... OR ?q=email/nickname
//   List ALL staking positions (both user-created AND admin-granted) for a
//   member so the operator can spot & remove DUPLICATES. Returns per-position
//   detail + a duplicate flag (same product_id appears more than once).
app.get('/staking-positions', async (c) => {
  const db = c.env.DB;
  const userId = String(c.req.query('user_id') || '').trim();
  const q = String(c.req.query('q') || '').trim();

  let uid = userId;
  let userRow: any = null;
  if (!uid && q) {
    // Resolve a member by email / nickname / id / referral_code.
    userRow = await db.prepare(
      `SELECT id, email, nickname, referral_code FROM users
        WHERE id = ? OR email = ? OR nickname = ? OR referral_code = ?
        LIMIT 1`
    ).bind(q, q, q, q.toUpperCase()).first<any>().catch(() => null);
    if (userRow) uid = userRow.id;
  }
  if (!uid) return c.json({ ok: false, error: 'user_id 또는 q(이메일/닉네임/추천코드)가 필요합니다' }, 400);

  if (!userRow) {
    userRow = await db.prepare(
      `SELECT id, email, nickname, referral_code FROM users WHERE id = ?`
    ).bind(uid).first<any>().catch(() => null);
  }
  if (!userRow) return c.json({ ok: false, error: '회원을 찾을 수 없습니다' }, 404);

  const { results } = await db.prepare(
    `SELECT id, product_id, coin_symbol, status, principal_usd,
            real_principal_usd, bonus_principal_usd, principal_qta,
            term_days, granted_by, binary_counted_at, created_at, term_end_at
       FROM staking_positions
      WHERE user_id = ?
      ORDER BY created_at ASC`
  ).bind(uid).all<any>().catch(() => ({ results: [] as any[] }));

  // Flag duplicates: more than one position on the same product_id.
  const countByProduct: Record<string, number> = {};
  for (const p of (results || [])) countByProduct[p.product_id] = (countByProduct[p.product_id] || 0) + 1;
  const positions = (results || []).map((p: any) => ({
    ...p,
    is_admin: p.granted_by != null,
    is_duplicate: (countByProduct[p.product_id] || 0) > 1,
  }));
  const totalUsd = positions.reduce((s: number, p: any) => s + (Number(p.principal_usd) || 0), 0);

  return c.json({
    ok: true,
    user: { id: userRow.id, email: userRow.email, nickname: userRow.nickname, referral_code: userRow.referral_code },
    positions,
    count: positions.length,
    total_usd: totalUsd,
  });
});

// POST /admin/staking-grant — create a bonus-principal staking position.
// Body: { user_id, product_id, real_usd, bonus_usd }
app.post('/staking-grant', async (c) => {
  const admin = c.get('user') as any;
  const db = c.env.DB;
  let body: any = {};
  try { body = await c.req.json(); } catch { /* empty */ }

  const user_id = String(body.user_id || '').trim();
  const product_id = String(body.product_id || '').trim();
  const realUsd = Number(body.real_usd);
  const bonusUsd = Number(body.bonus_usd || 0);
  // Optional referral placement: the referrer (윗 직대) and the L/R leg the
  // referrer wants this new member placed on. Both optional — if referrer_code
  // is blank we skip placement entirely (standalone position).
  const referrerCode = String(body.referrer_code || '').trim().toUpperCase();
  const legRaw = String(body.leg || '').trim().toUpperCase();
  const leg: 'L' | 'R' | null = legRaw === 'L' || legRaw === 'R' ? legRaw : null;

  if (!user_id) return c.json({ ok: false, error: '회원(user_id)을 선택하세요' }, 400);
  if (!product_id) return c.json({ ok: false, error: '스테이킹 상품(product_id)을 선택하세요' }, 400);
  if (!isFinite(realUsd) || realUsd <= 0) return c.json({ ok: false, error: '실원금(real_usd)은 0보다 커야 합니다' }, 400);
  if (!isFinite(bonusUsd) || bonusUsd < 0) return c.json({ ok: false, error: '인정보너스(bonus_usd)가 올바르지 않습니다' }, 400);

  const principalUsd = realUsd + bonusUsd; // inflated base for dividend + matching

  const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(user_id).first();
  if (!u) return c.json({ ok: false, error: '회원을 찾을 수 없습니다' }, 404);

  // Resolve the referrer (윗 직대) from the referral code, if provided.
  let referrer: { id: string; nickname: string | null; email: string | null } | null = null;
  if (referrerCode) {
    const rf = await db.prepare(
      `SELECT id, nickname, email FROM users WHERE referral_code = ?`
    ).bind(referrerCode).first<any>();
    if (!rf) return c.json({ ok: false, error: `추천코드 "${referrerCode}"에 해당하는 회원을 찾을 수 없습니다` }, 404);
    if (rf.id === user_id) return c.json({ ok: false, error: '본인을 추천인으로 지정할 수 없습니다' }, 400);
    referrer = { id: rf.id, nickname: rf.nickname ?? null, email: rf.email ?? null };
  }
  if (leg && !referrer) {
    return c.json({ ok: false, error: '좌/우(L/R) 배치를 선택하려면 추천코드를 먼저 입력하세요' }, 400);
  }

  const product = await db.prepare(
    `SELECT id, min_usd, max_usd, term_days, daily_rate
       FROM staking_products WHERE id = ? AND is_active = 1`
  ).bind(product_id).first<any>();
  if (!product) return c.json({ ok: false, error: '스테이킹 상품을 찾을 수 없습니다' }, 404);

  // Validate the INFLATED principal against the tier band (dividend basis).
  if (product.min_usd != null && principalUsd < product.min_usd) {
    return c.json({ ok: false, error: `이 티어 최소 금액은 $${product.min_usd} 입니다 (실+보너스 합계 기준)` }, 400);
  }
  if (product.max_usd != null && principalUsd > product.max_usd) {
    return c.json({ ok: false, error: `이 티어 최대 금액은 $${product.max_usd} 입니다 (실+보너스 합계 기준)` }, 400);
  }

  const price = await qtaPriceUsd(db);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const termEndIso = new Date(now + Number(product.term_days) * 86_400_000).toISOString();
  const posId = uuid();

  // ── IDEMPOTENCY GUARD (prevents duplicate grants / double-click / retry) ──
  //   If an IDENTICAL admin grant for the same user+product+principal was
  //   created within the last 5 minutes, refuse — the earlier one already took.
  //   This is what caused the "볼륨 2배 / 중복 개설" report: a failing UI let the
  //   admin click 개설 multiple times, inserting the same position twice.
  try {
    const dupe = await db.prepare(
      `SELECT id, created_at FROM staking_positions
        WHERE user_id = ? AND product_id = ? AND granted_by IS NOT NULL
          AND ABS(COALESCE(principal_usd,0) - ?) < 0.5
          AND created_at >= ?
        ORDER BY created_at DESC LIMIT 1`
    ).bind(user_id, product_id, principalUsd, new Date(now - 5 * 60_000).toISOString())
     .first<any>();
    if (dupe) {
      return c.json({
        ok: false,
        error: `동일 조건(회원·상품·원금 $${principalUsd})의 개설이 방금(5분 이내) 이미 처리되었습니다. 중복 개설을 막았습니다. 개설 이력을 확인해 주세요.`,
        existing_id: dupe.id,
        existing_created_at: dupe.created_at,
      }, 409);
    }
  } catch { /* column may be missing pre-migration — skip guard */ }

  // principal_qta / qta_price_at_stake = 0 → binary tick uses principal_usd
  // fallback (full 2,000). principal_usd = inflated. real_principal_usd = real.
  await db.prepare(
    `INSERT INTO staking_positions
       (id, user_id, product_id, coin_symbol, kind, apr, principal,
        accrued_interest, status, lock_days,
        principal_usd, principal_qta, qta_price_at_stake,
        daily_rate, term_days, accrued_dividend_usd,
        paid_dividend_qta, payout_coin, lock_end_at, term_end_at,
        last_accrued_at, created_at,
        real_principal_usd, bonus_principal_usd, granted_by)
     VALUES (?,?,?, 'QTA','fixed', ?, ?, 0, 'active', ?,
             ?, 0, 0, ?,?,0, 0, 'QTA', ?,?, ?, ?,
             ?, ?, ?)`
  ).bind(
    posId, user_id, product.id, (Number(product.daily_rate) * Number(product.term_days)) || 0,
    0, product.term_days,
    principalUsd, product.daily_rate, product.term_days,
    termEndIso, termEndIso, nowIso, nowIso,
    realUsd, bonusUsd, admin.id,
  ).run();

  await db.prepare(
    `UPDATE staking_products SET total_staked = COALESCE(total_staked,0) + ?, updated_at = ? WHERE id = ?`
  ).bind(principalUsd, nowIso, product.id).run().catch(() => {});

  // ── REFERRAL PLACEMENT (윗 직대 연결 + 좌/우 바이너리 배치) ──────────────────
  //   If a referrer_code was given, link this member under the referrer so the
  //   referrer's team/직대 view shows "이 회원이 나를 추천인으로 $N 스테이킹" and
  //   the member's staking volume rolls UP the referrer's binary tree.
  //
  //   IMPORTANT: placement must happen BEFORE rollStakeUpBinary below, and the
  //   leg (L/R) must be assigned first, otherwise rollStakeUpBinary stops at the
  //   member (binary_leg NULL => no roll-up to the sponsor). We only place a
  //   binary parent/leg if the member is NOT already placed (one-time, like
  //   normal signup). The referrals(L1) row is idempotent (INSERT OR IGNORE).
  const placement: any = { referrer: referrer ? { id: referrer.id, nickname: referrer.nickname, email: referrer.email } : null, leg: null, leg_assigned: false, already_placed: false };
  if (referrer) {
    try {
      // 1) L1 referral relationship (used by the referrer's downline/team view).
      await db.prepare(
        `INSERT OR IGNORE INTO referrals
           (id, referrer_id, referred_id, referral_code, reward_qta, rewarded_in_qx, level)
         VALUES (?, ?, ?, ?, 0, 1, 1)`
      ).bind(uuid(), referrer.id, user_id, referrerCode).run();

      // 2) Binary placement — attach under the referrer if not already placed.
      const existing = await db.prepare(
        `SELECT binary_parent_id, binary_leg FROM users WHERE id = ?`
      ).bind(user_id).first<any>();
      if (existing?.binary_parent_id && (existing.binary_leg === 'L' || existing.binary_leg === 'R')) {
        // Already fully placed — don't move them, just report.
        placement.already_placed = true;
        placement.leg = existing.binary_leg;
        placement.leg_assigned = true;
      } else {
        // Attach under the referrer (sets binary_parent_id, leg stays NULL).
        await placeInBinaryTree(db, user_id, referrer.id);
        // If the admin chose a leg, assign it now (one-time, irreversible).
        if (leg) {
          const r = await assignBinaryLeg(db, referrer.id, user_id, leg);
          if (r.ok) { placement.leg = leg; placement.leg_assigned = true; }
          else { placement.leg_assign_error = r.code; }
        }
      }
    } catch (e) {
      console.warn('[staking-grant] referral placement failed:', e);
      placement.error = String((e as any)?.message || e).slice(0, 200);
    }
  }

  // Roll the FULL inflated principal into binary 몸값/volume for THIS position
  // ONLY — same mechanism as POST /earn/subscribe (rollStakeUpBinary = additive)
  // then stamp binary_counted_at so the cron sweeper never double-counts it.
  //
  // ⚠️ We deliberately do NOT call recomputeBinaryFromStaking here anymore.
  //   recompute does a full reset+rebuild (self_usd = SET), while subscribe and
  //   the cron sweeper are additive (self_usd += ). Mixing the two on every
  //   grant is what let volume drift / double-count. Additive + stamp keeps a
  //   single, consistent code path for ALL staking (self-subscribed OR granted).
  try {
    await rollStakeUpBinary(db, user_id, principalUsd, price);
    await db.prepare(
      `UPDATE staking_positions SET binary_counted_at = datetime('now')
        WHERE id = ? AND binary_counted_at IS NULL`
    ).bind(posId).run();
  } catch (e) {
    // On failure, leave binary_counted_at NULL so the cron sweeper rolls it in.
    console.warn('[staking-grant] binary roll-up failed (cron will retry):', e);
  }

  await logAdminAction(c, {
    action: 'staking.grant',
    targetType: 'staking_position',
    targetId: posId,
    payload: { user_id, product_id, real_usd: realUsd, bonus_usd: bonusUsd, principal_usd: principalUsd },
  }).catch(() => {});

  try {
    await createNotification(db, user_id, {
      type: 'staking',
      title: '스테이킹이 개설되었습니다',
      message: `관리자가 회원님의 스테이킹을 개설했습니다 (적용 원금 $${principalUsd}).`,
      data: { position_id: posId, principal_usd: principalUsd, real_usd: realUsd, bonus_usd: bonusUsd },
    });
  } catch { /* ignore */ }

  const created = await db.prepare('SELECT * FROM staking_positions WHERE id = ?').bind(posId).first<any>();
  return c.json({ ok: true, position: created, placement });
});

export default app;
