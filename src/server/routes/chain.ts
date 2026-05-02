/**
 * QTA native chain routes — Phase B (stub) + Phase D (admin observability).
 *
 * Endpoints:
 *   POST /chain/qta/deposit-address          : issue / fetch user's deposit address
 *   GET  /chain/qta/deposits                 : list current user's QTA deposits
 *   POST /chain/qta/withdraw                 : enqueue a withdrawal (admin must approve)
 *   GET  /chain/qta/withdrawals              : list current user's withdrawals
 *   GET  /chain/qta/state                    : public chain state (head, scheme, confs)
 *   GET  /chain/qta/admin/withdrawals        : (admin) list withdrawals by status
 *   POST /chain/qta/admin/withdrawals/:id/approve : (admin) approve + sign + broadcast (mock)
 *   POST /chain/qta/admin/withdrawals/:id/reject  : (admin) reject with reason
 *   GET  /chain/qta/admin/wallets            : (admin, Phase D) hot/cold balances + user address search
 *   GET  /chain/qta/admin/health             : (admin, Phase D) chain_state + 24h tick stats
 *   GET  /chain/qta/admin/deposits           : (admin, Phase D) recent deposits (audit)
 *
 * All write paths require auth; admin paths require admin role.
 */

import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { getQtaChainClient, type QtaNetwork } from '../lib/qta-chain';
import type { AppEnv } from '../index';
import { logAdminAction } from '../utils/audit';

const chain = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Public — chain state (used by Home/Wallet pages and admin System tab)
// ---------------------------------------------------------------------------
chain.get('/qta/state', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT network, last_scanned_block, head_block, hot_wallet_addr,
            hot_wallet_balance, validators_online, signature_scheme,
            block_time_ms, required_confs, last_tick_at, last_error
     FROM qta_chain_state
     WHERE network = ?`
  ).bind(currentNetwork(c.env)).first<any>();

  return c.json({
    ok: true,
    state: row || {
      network: currentNetwork(c.env),
      signature_scheme: 'CRYSTALS-Dilithium3',
      block_time_ms: 2000,
      required_confs: 12,
    },
  });
});

// ---------------------------------------------------------------------------
// Authenticated user — issue / fetch a deposit address
// ---------------------------------------------------------------------------
chain.post('/qta/deposit-address', authMiddleware, async (c) => {
  const user = c.get('user') as { id: string };
  const network = currentNetwork(c.env);

  const existing = await c.env.DB.prepare(
    `SELECT id, address, pubkey, derivation, network
     FROM qta_addresses
     WHERE user_id = ? AND network = ? AND is_active = 1
     LIMIT 1`
  ).bind(user.id, network).first<any>();
  if (existing) return c.json({ ok: true, address: existing, reused: true });

  const client = getQtaChainClient(c.env as any);
  const addr = await client.generateAddress(user.id);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO qta_addresses (id, user_id, address, pubkey, derivation, network)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, addr.address, addr.pubkey, addr.derivation || null, network).run();

  return c.json({
    ok: true,
    reused: false,
    address: { id, address: addr.address, pubkey: addr.pubkey, derivation: addr.derivation, network },
  });
});

// ---------------------------------------------------------------------------
// Authenticated user — deposit list
// ---------------------------------------------------------------------------
chain.get('/qta/deposits', authMiddleware, async (c) => {
  const user = c.get('user') as { id: string };
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);
  const { results } = await c.env.DB.prepare(
    `SELECT id, address, tx_hash, block_height, amount, confirmations,
            required_confs, status, credited_at, network, created_at
     FROM qta_deposits
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(user.id, limit).all<any>();
  return c.json({ ok: true, deposits: results || [] });
});

// ---------------------------------------------------------------------------
// Authenticated user — submit a withdrawal (admin must approve before broadcast)
// ---------------------------------------------------------------------------
chain.post('/qta/withdraw', authMiddleware, async (c) => {
  const user = c.get('user') as { id: string };
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400);
  }

  const to = String(body.to_address || '').trim();
  const amount = String(body.amount || '').trim();
  if (!to || !/^qta1[a-z0-9]{20,}$/i.test(to)) {
    return c.json({ ok: false, error: 'invalid_address' }, 400);
  }
  const amtNum = Number(amount);
  if (!isFinite(amtNum) || amtNum <= 0) {
    return c.json({ ok: false, error: 'invalid_amount' }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO qta_withdrawals
       (id, user_id, to_address, amount, fee, status, network)
     VALUES (?, ?, ?, ?, '0', 'pending', ?)`
  ).bind(id, user.id, to, amount, currentNetwork(c.env)).run();

  return c.json({ ok: true, id, status: 'pending' });
});

// ---------------------------------------------------------------------------
// Authenticated user — list own withdrawals
// ---------------------------------------------------------------------------
chain.get('/qta/withdrawals', authMiddleware, async (c) => {
  const user = c.get('user') as { id: string };
  const { results } = await c.env.DB.prepare(
    `SELECT id, to_address, amount, fee, status, tx_hash, block_height,
            approved_at, broadcast_at, confirmed_at, rejected_reason,
            network, created_at, updated_at
     FROM qta_withdrawals
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 100`
  ).bind(user.id).all<any>();
  return c.json({ ok: true, withdrawals: results || [] });
});

// ===========================================================================
// Admin endpoints
// ===========================================================================

chain.get('/qta/admin/withdrawals', authMiddleware, adminMiddleware, async (c) => {
  const status = c.req.query('status') || 'pending';
  const { results } = await c.env.DB.prepare(
    `SELECT w.id, w.user_id, u.email, w.to_address, w.amount, w.fee, w.status,
            w.tx_hash, w.network, w.created_at, w.updated_at
     FROM qta_withdrawals w
     LEFT JOIN users u ON u.id = w.user_id
     WHERE w.status = ?
     ORDER BY w.created_at ASC
     LIMIT 200`
  ).bind(status).all<any>();
  return c.json({ ok: true, withdrawals: results || [] });
});

chain.post('/qta/admin/withdrawals/:id/approve', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const admin = c.get('user') as { id: string; email: string };

  const row = await c.env.DB.prepare(
    `SELECT id, user_id, to_address, amount, status, network
     FROM qta_withdrawals WHERE id = ?`
  ).bind(id).first<any>();
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  if (row.status !== 'pending') {
    return c.json({ ok: false, error: 'invalid_status', status: row.status }, 409);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE qta_withdrawals
     SET status = 'broadcasting', approved_by = ?, approved_at = ?, updated_at = ?
     WHERE id = ?`
  ).bind(admin.id, now, now, id).run();

  const client = getQtaChainClient(c.env as any);
  let result;
  try {
    result = await client.signAndBroadcast({ to: row.to_address, amount: row.amount });
  } catch (e: any) {
    await c.env.DB.prepare(
      `UPDATE qta_withdrawals
       SET status = 'failed', rejected_reason = ?, updated_at = ?
       WHERE id = ?`
    ).bind(String(e?.message || e), new Date().toISOString(), id).run();
    return c.json({ ok: false, error: 'broadcast_failed', detail: String(e?.message || e) }, 502);
  }

  const broadcastAt = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE qta_withdrawals
     SET tx_hash = ?, broadcast_at = ?, updated_at = ?
     WHERE id = ?`
  ).bind(result.hash, broadcastAt, broadcastAt, id).run();

  await logAdminAction(c, {
    action: 'qta.withdraw.approve',
    targetType: 'withdrawal',
    targetId: id,
    payload: {
      tx_hash: result.hash,
      amount: row.amount,
      to: row.to_address,
      network: row.network,
    },
  });

  return c.json({ ok: true, id, tx_hash: result.hash, status: 'broadcasting' });
});

chain.post('/qta/admin/withdrawals/:id/reject', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const admin = c.get('user') as { id: string; email: string };
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const reason = String(body.reason || 'rejected by admin').slice(0, 200);

  const row = await c.env.DB.prepare(
    `SELECT status FROM qta_withdrawals WHERE id = ?`
  ).bind(id).first<any>();
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  if (row.status !== 'pending') {
    return c.json({ ok: false, error: 'invalid_status', status: row.status }, 409);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE qta_withdrawals
     SET status = 'rejected', rejected_reason = ?, approved_by = ?, approved_at = ?, updated_at = ?
     WHERE id = ?`
  ).bind(reason, admin.id, now, now, id).run();

  await logAdminAction(c, {
    action: 'qta.withdraw.reject',
    targetType: 'withdrawal',
    targetId: id,
    payload: { reason },
  });

  return c.json({ ok: true, id, status: 'rejected' });
});

// ===========================================================================
// Phase D — Admin observability endpoints
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /qta/admin/wallets
//   Returns hot wallet balance, aggregated user-address count, total credited
//   deposit volume, and (optional) per-user search by email or address.
// ---------------------------------------------------------------------------
chain.get('/qta/admin/wallets', authMiddleware, adminMiddleware, async (c) => {
  const network = currentNetwork(c.env);
  const q = (c.req.query('q') || '').trim();

  // Hot wallet snapshot from chain_state
  const stateRow = await c.env.DB.prepare(
    `SELECT network, hot_wallet_addr, hot_wallet_balance, head_block,
            validators_online, signature_scheme, last_tick_at, last_error
     FROM qta_chain_state
     WHERE network = ?`
  ).bind(network).first<any>();

  // Aggregate stats across all users
  const aggDeposits = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total_count,
       COALESCE(SUM(CASE WHEN status = 'credited' THEN CAST(amount AS REAL) ELSE 0 END), 0) AS credited_amount,
       COUNT(CASE WHEN status = 'credited' THEN 1 END) AS credited_count,
       COUNT(CASE WHEN status = 'confirming' THEN 1 END) AS confirming_count,
       COUNT(CASE WHEN status = 'detected' THEN 1 END) AS detected_count
     FROM qta_deposits
     WHERE network = ?`
  ).bind(network).first<any>();

  const aggWithdrawals = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total_count,
       COALESCE(SUM(CASE WHEN status = 'confirmed' THEN CAST(amount AS REAL) ELSE 0 END), 0) AS confirmed_amount,
       COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_count,
       COUNT(CASE WHEN status = 'broadcasting' THEN 1 END) AS broadcasting_count,
       COUNT(CASE WHEN status = 'confirmed' THEN 1 END) AS confirmed_count,
       COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed_count,
       COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected_count
     FROM qta_withdrawals
     WHERE network = ?`
  ).bind(network).first<any>();

  const addrCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM qta_addresses WHERE network = ? AND is_active = 1`
  ).bind(network).first<any>();

  // Optional user search (by email or QTA address)
  let users: any[] = [];
  if (q.length > 0) {
    const like = `%${q}%`;
    const { results } = await c.env.DB.prepare(
      `SELECT a.id, a.user_id, a.address, a.pubkey, a.network, a.created_at,
              u.email
       FROM qta_addresses a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.network = ?
         AND a.is_active = 1
         AND (u.email LIKE ? OR a.address LIKE ?)
       ORDER BY a.created_at DESC
       LIMIT 50`
    ).bind(network, like, like).all<any>();
    users = results || [];
  }

  return c.json({
    ok: true,
    network,
    hot_wallet: {
      address: stateRow?.hot_wallet_addr || null,
      balance: stateRow?.hot_wallet_balance || '0',
      head_block: stateRow?.head_block || 0,
      validators_online: stateRow?.validators_online || 0,
      signature_scheme: stateRow?.signature_scheme || 'CRYSTALS-Dilithium3',
      last_tick_at: stateRow?.last_tick_at || null,
      last_error: stateRow?.last_error || null,
    },
    deposits: {
      total: aggDeposits?.total_count || 0,
      credited: aggDeposits?.credited_count || 0,
      confirming: aggDeposits?.confirming_count || 0,
      detected: aggDeposits?.detected_count || 0,
      credited_amount: aggDeposits?.credited_amount || 0,
    },
    withdrawals: {
      total: aggWithdrawals?.total_count || 0,
      pending: aggWithdrawals?.pending_count || 0,
      broadcasting: aggWithdrawals?.broadcasting_count || 0,
      confirmed: aggWithdrawals?.confirmed_count || 0,
      failed: aggWithdrawals?.failed_count || 0,
      rejected: aggWithdrawals?.rejected_count || 0,
      confirmed_amount: aggWithdrawals?.confirmed_amount || 0,
    },
    addresses_active: addrCount?.n || 0,
    users,
    query: q || null,
  });
});

// ---------------------------------------------------------------------------
// GET /qta/admin/health
//   Chain state + 24h tick statistics (deposits credited, withdrawals
//   broadcast, errors, latest tick freshness).
// ---------------------------------------------------------------------------
chain.get('/qta/admin/health', authMiddleware, adminMiddleware, async (c) => {
  const network = currentNetwork(c.env);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const state = await c.env.DB.prepare(
    `SELECT network, last_scanned_block, head_block, hot_wallet_addr,
            hot_wallet_balance, validators_online, signature_scheme,
            block_time_ms, required_confs, last_tick_at, last_error, updated_at
     FROM qta_chain_state
     WHERE network = ?`
  ).bind(network).first<any>();

  const credited24h = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CAST(amount AS REAL)), 0) AS total_amount
     FROM qta_deposits
     WHERE network = ? AND status = 'credited' AND credited_at >= ?`
  ).bind(network, since).first<any>();

  const broadcast24h = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CAST(amount AS REAL)), 0) AS total_amount
     FROM qta_withdrawals
     WHERE network = ? AND broadcast_at >= ?`
  ).bind(network, since).first<any>();

  const failed24h = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n
     FROM qta_withdrawals
     WHERE network = ? AND status = 'failed' AND updated_at >= ?`
  ).bind(network, since).first<any>();

  // Tick freshness — derive seconds since last_tick_at
  let tick_age_sec: number | null = null;
  if (state?.last_tick_at) {
    const t = new Date(state.last_tick_at).getTime();
    if (!isNaN(t)) tick_age_sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  }

  // Health rollup: ok if tick within last 10 min and no last_error.
  const STALE_SECS = 600;
  const status =
    !state ? 'unknown'
    : state.last_error ? 'error'
    : tick_age_sec === null ? 'idle'
    : tick_age_sec > STALE_SECS ? 'stale'
    : 'ok';

  return c.json({
    ok: true,
    status,
    network,
    state: state || null,
    tick_age_sec,
    stats_24h: {
      deposits_credited: credited24h?.n || 0,
      deposits_credited_amount: credited24h?.total_amount || 0,
      withdrawals_broadcast: broadcast24h?.n || 0,
      withdrawals_broadcast_amount: broadcast24h?.total_amount || 0,
      withdrawals_failed: failed24h?.n || 0,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /qta/admin/deposits
//   Recent deposits across all users (audit / forensics).
//   Optional ?status=credited|confirming|detected|orphaned, ?limit=200
// ---------------------------------------------------------------------------
chain.get('/qta/admin/deposits', authMiddleware, adminMiddleware, async (c) => {
  const network = currentNetwork(c.env);
  const status = (c.req.query('status') || '').trim();
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);

  let sql = `SELECT d.id, d.user_id, u.email, d.address, d.tx_hash, d.block_height,
                    d.amount, d.confirmations, d.required_confs, d.status,
                    d.credited_at, d.network, d.created_at
             FROM qta_deposits d
             LEFT JOIN users u ON u.id = d.user_id
             WHERE d.network = ?`;
  const binds: any[] = [network];
  if (status) { sql += ` AND d.status = ?`; binds.push(status); }
  sql += ` ORDER BY d.created_at DESC LIMIT ?`;
  binds.push(limit);

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<any>();
  return c.json({ ok: true, deposits: results || [], count: (results || []).length });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function currentNetwork(env: any): QtaNetwork {
  return env.QTA_NETWORK === 'qta-testnet' ? 'qta-testnet' : 'qta-mainnet';
}

export default chain;
