/**
 * QTA native chain routes — Phase B (stub).
 *
 * Endpoints:
 *   POST /chain/qta/deposit-address          : issue / fetch user's deposit address
 *   GET  /chain/qta/deposits                 : list current user's QTA deposits
 *   POST /chain/qta/withdraw                 : enqueue a withdrawal (admin must approve)
 *   GET  /chain/qta/withdrawals              : list current user's withdrawals
 *   GET  /chain/qta/state                    : public chain state (head, scheme, confs)
 *   GET  /chain/qta/admin/withdrawals        : (admin) list pending withdrawals
 *   POST /chain/qta/admin/withdrawals/:id/approve : (admin) approve + sign + broadcast (mock)
 *   POST /chain/qta/admin/withdrawals/:id/reject  : (admin) reject with reason
 *
 * All write paths require auth; admin paths require admin role.
 */

import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { getQtaChainClient, type QtaNetwork } from '../lib/qta-chain';
import type { AppEnv } from '../index';
import { logAdminAction } from '../utils/audit';

const chain = new Hono<AppEnv>();

function currentNetwork(env: any): QtaNetwork {
  return env.QTA_NETWORK === 'qta-testnet' ? 'qta-testnet' : 'qta-mainnet';
}

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

export default chain;
