/**
 * QTA <-> ETH Bridge routes — Sprint 4 Phase G (stub).
 *
 * Bidirectional bridge between QuantaEX QTA mainnet and Ethereum (qQTA
 * ERC-20). Stub-first: this module manages the DB state machine and
 * issues mock tx hashes via lib/eth-bridge.ts. A follow-up cron-worker
 * commit will wire in real RPC submission.
 *
 * State flow per direction
 *   qta_to_eth : pending_lock -> locked    -> minting   -> minted
 *   eth_to_qta : pending_burn -> burned    -> releasing -> released
 *   either side may transition to `failed` or `cancelled`.
 *
 * Endpoints (mounted at /api/bridge in src/server/index.ts)
 *   GET  /state                           : public bridge stats (no auth)
 *   POST /qta-to-eth                      : user locks QTA, requests qQTA mint
 *   POST /eth-to-qta                      : user burns qQTA, requests QTA release
 *   GET  /transfers                       : caller's own transfers
 *   GET  /transfers/:id                   : single transfer (caller-owned)
 *   GET  /admin/transfers                 : admin audit (status/dir filters)
 *   POST /admin/transfers/:id/advance     : admin advances state (mock broadcast)
 *   POST /admin/transfers/:id/fail        : admin marks failed with reason
 *   POST /admin/pause                     : admin toggles bridge_paused marker
 */

import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import type { AppEnv } from '../index';
import { logAdminAction } from '../utils/audit';
import {
  getEthBridgeClient,
  bridgeNetworkFromEnv,
  isHexAddress,
  isPositiveDecimal,
  isQtaAddress,
  type EthNetwork,
} from '../lib/eth-bridge';

const bridge = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function uuid() {
  return crypto.randomUUID();
}

async function getMarker(c: any, key: string): Promise<string | null> {
  const row = await c.env.DB.prepare(
    `SELECT value FROM system_markers WHERE key = ?`
  ).bind(key).first<any>();
  return row?.value ?? null;
}

async function setMarker(c: any, key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO system_markers (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, now).run();
}

async function isBridgePaused(c: any): Promise<boolean> {
  return (await getMarker(c, 'bridge_paused')) === 'on';
}

/** Multiply two string-decimals safely (max 18 frac digits per side). */
function mulDecimal(a: string, b: string): string {
  // Cheap path for single-side fractional fee bps math
  const x = Number(a);
  const y = Number(b);
  if (!isFinite(x) || !isFinite(y)) return '0';
  return (x * y).toFixed(8).replace(/\.?0+$/, '');
}

function subDecimal(a: string, b: string): string {
  const x = Number(a);
  const y = Number(b);
  return (x - y).toFixed(8).replace(/\.?0+$/, '');
}

function addDecimal(a: string, b: string): string {
  return (Number(a) + Number(b)).toFixed(8).replace(/\.?0+$/, '');
}

function gteDecimal(a: string, b: string): boolean {
  return Number(a) >= Number(b);
}

// ---------------------------------------------------------------------------
// GET /bridge/state — public bridge stats
// ---------------------------------------------------------------------------
bridge.get('/state', async (c) => {
  const network = bridgeNetworkFromEnv(c.env);
  const stateRow = await c.env.DB.prepare(
    `SELECT network, total_locked, total_minted, fee_bps, min_amount, max_amount,
            qqta_contract_addr, custody_qta_addr, last_eth_block, last_qta_block,
            last_tick_at, last_error
     FROM bridge_state WHERE network = ?`
  ).bind(network).first<any>();

  const [paused, integration] = await Promise.all([
    isBridgePaused(c),
    getMarker(c, 'bridge_integration'),
  ]);

  return c.json({
    ok: true,
    state: {
      network,
      paused,
      integration_phase: integration || 'phase-g-stub',
      total_locked: stateRow?.total_locked || '0',
      total_minted: stateRow?.total_minted || '0',
      fee_bps: stateRow?.fee_bps ?? 30,
      min_amount: stateRow?.min_amount || '1',
      max_amount: stateRow?.max_amount || '1000000',
      qqta_contract_addr: stateRow?.qqta_contract_addr || null,
      custody_qta_addr: stateRow?.custody_qta_addr || null,
      last_eth_block: stateRow?.last_eth_block || 0,
      last_qta_block: stateRow?.last_qta_block || 0,
      last_tick_at: stateRow?.last_tick_at || null,
      last_error: stateRow?.last_error || null,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /bridge/qta-to-eth
//   { amount, eth_address, qta_address? }
//   Locks QTA in bridge custody, queues qQTA mint to eth_address.
// ---------------------------------------------------------------------------
bridge.post('/qta-to-eth', authMiddleware, async (c) => {
  if (await isBridgePaused(c)) {
    return c.json({ error: 'Bridge temporarily paused' }, 503);
  }

  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const amount = String(body.amount || '').trim();
  const ethAddr = String(body.eth_address || '').trim();
  const qtaAddr = String(body.qta_address || '').trim();

  if (!isPositiveDecimal(amount)) {
    return c.json({ error: 'invalid_amount' }, 400);
  }
  if (!isHexAddress(ethAddr)) {
    return c.json({ error: 'invalid_eth_address' }, 400);
  }
  if (qtaAddr && !isQtaAddress(qtaAddr)) {
    return c.json({ error: 'invalid_qta_address' }, 400);
  }

  const network: EthNetwork = bridgeNetworkFromEnv(c.env);
  const stateRow = await c.env.DB.prepare(
    `SELECT fee_bps, min_amount, max_amount FROM bridge_state WHERE network = ?`
  ).bind(network).first<any>();
  const feeBps = Number(stateRow?.fee_bps ?? 30);
  const minAmt = String(stateRow?.min_amount ?? '1');
  const maxAmt = String(stateRow?.max_amount ?? '1000000');

  if (!gteDecimal(amount, minAmt)) {
    return c.json({ error: 'amount_below_minimum', min_amount: minAmt }, 400);
  }
  if (!gteDecimal(maxAmt, amount)) {
    return c.json({ error: 'amount_above_maximum', max_amount: maxAmt }, 400);
  }

  // Compute fee in source asset (QTA)
  const fee = mulDecimal(amount, String(feeBps / 10_000));
  const netAmount = subDecimal(amount, fee);
  if (!isPositiveDecimal(netAmount)) {
    return c.json({ error: 'amount_too_small_after_fee' }, 400);
  }

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO bridge_transfers
       (id, user_id, direction, amount, fee, qta_address, eth_address,
        status, network)
     VALUES (?, ?, 'qta_to_eth', ?, ?, ?, ?, 'pending_lock', ?)`
  ).bind(id, user.id, amount, fee, qtaAddr || null, ethAddr.toLowerCase(), network).run();

  return c.json({
    ok: true,
    transfer: {
      id,
      direction: 'qta_to_eth',
      amount,
      fee,
      net_amount: netAmount,
      eth_address: ethAddr.toLowerCase(),
      qta_address: qtaAddr || null,
      status: 'pending_lock',
      network,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /bridge/eth-to-qta
//   { amount, qta_address, eth_address? }
//   Records intent to burn qQTA on Ethereum and release QTA to qta_address.
//   Real burn requires user wallet signature; stub records intent only.
// ---------------------------------------------------------------------------
bridge.post('/eth-to-qta', authMiddleware, async (c) => {
  if (await isBridgePaused(c)) {
    return c.json({ error: 'Bridge temporarily paused' }, 503);
  }

  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const amount = String(body.amount || '').trim();
  const qtaAddr = String(body.qta_address || '').trim();
  const ethAddr = String(body.eth_address || '').trim();

  if (!isPositiveDecimal(amount)) {
    return c.json({ error: 'invalid_amount' }, 400);
  }
  if (!isQtaAddress(qtaAddr)) {
    return c.json({ error: 'invalid_qta_address' }, 400);
  }
  if (ethAddr && !isHexAddress(ethAddr)) {
    return c.json({ error: 'invalid_eth_address' }, 400);
  }

  const network: EthNetwork = bridgeNetworkFromEnv(c.env);
  const stateRow = await c.env.DB.prepare(
    `SELECT fee_bps, min_amount, max_amount FROM bridge_state WHERE network = ?`
  ).bind(network).first<any>();
  const feeBps = Number(stateRow?.fee_bps ?? 30);
  const minAmt = String(stateRow?.min_amount ?? '1');
  const maxAmt = String(stateRow?.max_amount ?? '1000000');

  if (!gteDecimal(amount, minAmt)) {
    return c.json({ error: 'amount_below_minimum', min_amount: minAmt }, 400);
  }
  if (!gteDecimal(maxAmt, amount)) {
    return c.json({ error: 'amount_above_maximum', max_amount: maxAmt }, 400);
  }

  const fee = mulDecimal(amount, String(feeBps / 10_000));
  const netAmount = subDecimal(amount, fee);
  if (!isPositiveDecimal(netAmount)) {
    return c.json({ error: 'amount_too_small_after_fee' }, 400);
  }

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO bridge_transfers
       (id, user_id, direction, amount, fee, qta_address, eth_address,
        status, network)
     VALUES (?, ?, 'eth_to_qta', ?, ?, ?, ?, 'pending_burn', ?)`
  ).bind(id, user.id, amount, fee, qtaAddr, ethAddr ? ethAddr.toLowerCase() : null, network).run();

  return c.json({
    ok: true,
    transfer: {
      id,
      direction: 'eth_to_qta',
      amount,
      fee,
      net_amount: netAmount,
      qta_address: qtaAddr,
      eth_address: ethAddr ? ethAddr.toLowerCase() : null,
      status: 'pending_burn',
      network,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /bridge/transfers — caller's transfers (status/dir filters, paginated)
// ---------------------------------------------------------------------------
bridge.get('/transfers', authMiddleware, async (c) => {
  const user = c.get('user');
  const status = (c.req.query('status') || '').trim();
  const direction = (c.req.query('direction') || '').trim();
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);

  let sql = `SELECT id, direction, amount, fee, qta_address, eth_address,
                    qta_tx_hash, eth_tx_hash, status, failure_reason,
                    network, created_at, updated_at, completed_at
             FROM bridge_transfers
             WHERE user_id = ?`;
  const binds: any[] = [user.id];
  if (status)    { sql += ` AND status = ?`;    binds.push(status); }
  if (direction) { sql += ` AND direction = ?`; binds.push(direction); }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  binds.push(limit);

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<any>();
  return c.json({ ok: true, transfers: results || [], count: (results || []).length });
});

// ---------------------------------------------------------------------------
// GET /bridge/transfers/:id — caller-owned single transfer
// ---------------------------------------------------------------------------
bridge.get('/transfers/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT id, direction, amount, fee, qta_address, eth_address,
            qta_tx_hash, eth_tx_hash, status, failure_reason,
            network, created_at, updated_at, completed_at
     FROM bridge_transfers
     WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first<any>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, transfer: row });
});

// ---------------------------------------------------------------------------
// GET /bridge/admin/transfers — admin audit
// ---------------------------------------------------------------------------
bridge.get('/admin/transfers', authMiddleware, adminMiddleware, async (c) => {
  const status = (c.req.query('status') || '').trim();
  const direction = (c.req.query('direction') || '').trim();
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);

  let sql = `SELECT t.id, t.user_id, u.email, t.direction, t.amount, t.fee,
                    t.qta_address, t.eth_address, t.qta_tx_hash, t.eth_tx_hash,
                    t.status, t.failure_reason, t.network,
                    t.created_at, t.updated_at, t.completed_at
             FROM bridge_transfers t
             LEFT JOIN users u ON u.id = t.user_id
             WHERE 1=1`;
  const binds: any[] = [];
  if (status)    { sql += ` AND t.status = ?`;    binds.push(status); }
  if (direction) { sql += ` AND t.direction = ?`; binds.push(direction); }
  sql += ` ORDER BY t.created_at DESC LIMIT ?`;
  binds.push(limit);

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<any>();

  // Aggregate state for the panel header
  const network = bridgeNetworkFromEnv(c.env);
  const agg = await c.env.DB.prepare(
    `SELECT
       COUNT(*)                                                        AS total,
       COUNT(CASE WHEN status IN ('pending_lock','pending_burn') THEN 1 END) AS pending,
       COUNT(CASE WHEN status IN ('locked','burned')           THEN 1 END) AS in_flight,
       COUNT(CASE WHEN status IN ('minting','releasing')       THEN 1 END) AS broadcasting,
       COUNT(CASE WHEN status IN ('minted','released')         THEN 1 END) AS completed,
       COUNT(CASE WHEN status = 'failed'                       THEN 1 END) AS failed
     FROM bridge_transfers WHERE network = ?`
  ).bind(network).first<any>();

  const stateRow = await c.env.DB.prepare(
    `SELECT total_locked, total_minted, fee_bps FROM bridge_state WHERE network = ?`
  ).bind(network).first<any>();

  return c.json({
    ok: true,
    transfers: results || [],
    count: (results || []).length,
    network,
    aggregate: {
      total: agg?.total || 0,
      pending: agg?.pending || 0,
      in_flight: agg?.in_flight || 0,
      broadcasting: agg?.broadcasting || 0,
      completed: agg?.completed || 0,
      failed: agg?.failed || 0,
    },
    bridge: {
      total_locked: stateRow?.total_locked || '0',
      total_minted: stateRow?.total_minted || '0',
      fee_bps: stateRow?.fee_bps ?? 30,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /bridge/admin/transfers/:id/advance
//   Stub: advances the state machine one step + records a mock tx hash.
//   Real broadcast lands in cron-worker driver.
// ---------------------------------------------------------------------------
bridge.post('/admin/transfers/:id/advance', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT * FROM bridge_transfers WHERE id = ?`
  ).bind(id).first<any>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status === 'failed' || row.status === 'cancelled') {
    return c.json({ error: 'terminal_state', status: row.status }, 400);
  }

  const client = getEthBridgeClient(c.env);
  const now = new Date().toISOString();
  let nextStatus: string = row.status;
  let qtaTx: string | null = row.qta_tx_hash;
  let ethTx: string | null = row.eth_tx_hash;
  let completedAt: string | null = row.completed_at;
  let totalLockedDelta = 0;
  let totalMintedDelta = 0;

  try {
    if (row.direction === 'qta_to_eth') {
      if (row.status === 'pending_lock') {
        // Mock: assume QTA lock confirmed on chain
        qtaTx = qtaTx || `qta:lock:${id.slice(0, 8)}:${Date.now().toString(16)}`;
        nextStatus = 'locked';
      } else if (row.status === 'locked') {
        const r = await client.mintQQTA(row.eth_address, row.amount);
        ethTx = r.txHash;
        nextStatus = 'minting';
      } else if (row.status === 'minting') {
        nextStatus = 'minted';
        completedAt = now;
        totalLockedDelta = +Number(row.amount);
        totalMintedDelta = +Number(row.amount);
      } else {
        return c.json({ error: 'no_advance_for_state', status: row.status }, 400);
      }
    } else if (row.direction === 'eth_to_qta') {
      if (row.status === 'pending_burn') {
        const r = await client.burnQQTA(row.eth_address || '0x0000000000000000000000000000000000000000', row.amount);
        ethTx = r.txHash;
        nextStatus = 'burned';
      } else if (row.status === 'burned') {
        nextStatus = 'releasing';
      } else if (row.status === 'releasing') {
        qtaTx = qtaTx || `qta:release:${id.slice(0, 8)}:${Date.now().toString(16)}`;
        nextStatus = 'released';
        completedAt = now;
        totalLockedDelta = -Number(row.amount);
        totalMintedDelta = -Number(row.amount);
      } else {
        return c.json({ error: 'no_advance_for_state', status: row.status }, 400);
      }
    } else {
      return c.json({ error: 'unknown_direction' }, 400);
    }
  } catch (e: any) {
    return c.json({ error: 'advance_failed', detail: String(e?.message || e) }, 500);
  }

  const network = row.network || bridgeNetworkFromEnv(c.env);

  // Persist state machine + bridge_state aggregates atomically
  const ops: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE bridge_transfers
       SET status = ?, qta_tx_hash = ?, eth_tx_hash = ?,
           updated_at = ?, completed_at = ?
       WHERE id = ?`
    ).bind(nextStatus, qtaTx, ethTx, now, completedAt, id),
  ];
  if (totalLockedDelta !== 0 || totalMintedDelta !== 0) {
    ops.push(
      c.env.DB.prepare(
        `UPDATE bridge_state
         SET total_locked = CAST((CAST(total_locked AS REAL) + ?) AS TEXT),
             total_minted = CAST((CAST(total_minted AS REAL) + ?) AS TEXT),
             updated_at = ?
         WHERE network = ?`
      ).bind(totalLockedDelta, totalMintedDelta, now, network)
    );
  }
  await c.env.DB.batch(ops);

  await logAdminAction(c, {
    action: 'bridge.advance',
    targetType: 'bridge_transfer',
    targetId: id,
    payload: { from: row.status, to: nextStatus, direction: row.direction },
  });

  return c.json({
    ok: true,
    transfer: {
      id,
      status: nextStatus,
      qta_tx_hash: qtaTx,
      eth_tx_hash: ethTx,
      completed_at: completedAt,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /bridge/admin/transfers/:id/fail   { reason }
// ---------------------------------------------------------------------------
bridge.post('/admin/transfers/:id/fail', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body.reason || '').slice(0, 200);

  const row = await c.env.DB.prepare(
    `SELECT id, status FROM bridge_transfers WHERE id = ?`
  ).bind(id).first<any>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status === 'minted' || row.status === 'released') {
    return c.json({ error: 'already_completed' }, 400);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE bridge_transfers
     SET status = 'failed', failure_reason = ?, updated_at = ?
     WHERE id = ?`
  ).bind(reason || 'admin_marked_failed', now, id).run();

  await logAdminAction(c, {
    action: 'bridge.fail',
    targetType: 'bridge_transfer',
    targetId: id,
    payload: { reason, prev_status: row.status },
  });

  return c.json({ ok: true, id, status: 'failed', reason });
});

// ---------------------------------------------------------------------------
// POST /bridge/admin/pause   { paused: boolean }
// ---------------------------------------------------------------------------
bridge.post('/admin/pause', authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const paused = !!body.paused;
  await setMarker(c, 'bridge_paused', paused ? 'on' : 'off');

  await logAdminAction(c, {
    action: paused ? 'bridge.pause' : 'bridge.resume',
    targetType: 'system',
    payload: { paused },
  });

  return c.json({ ok: true, paused });
});

export default bridge;
