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
  ).bind(currentNetwork(c.env)).first<any>().catch(() => null);

  // Real-chain identity (Quantarium, chain_id 60000). Reported alongside
  // whatever the ticker last wrote so admin UI / status pages can render
  // the correct on-chain metadata even before the first cron tick.
  const chainId = String((c.env as any).QTA_CHAIN_ID || '60000');
  const rpcUrl = String((c.env as any).QTA_RPC_URL || 'https://rpc.quantarium.io');
  const explorerUrl = String((c.env as any).QTA_EXPLORER_URL || 'https://scan.quantarium.io');
  const driver = String((c.env as any).QTA_CHAIN_DRIVER || 'mock').toLowerCase();
  const hotWallet = String(
    (c.env as any).QTA_HOT_WALLET_ADDRESS ||
      '0xdeB6BFE50EeE8D753313988c6d1E77f95322527b',
  );

  return c.json({
    ok: true,
    chain: {
      chain_id: chainId,
      name: 'Quantarium',
      rpc_url: rpcUrl,
      explorer_url: explorerUrl,
      driver, // 'mock' | 'real'
      integration_status: driver === 'real' ? 'live' : 'pending',
      exchange_hot_wallet: hotWallet,
      // The single company-designated MAIN Quantarium wallet — the ONLY
      // destination user QTA/QX/QKEY withdrawals are ever paid out to
      // (owner rule 2026-08-28). Exposed so the UI can show the fixed,
      // non-editable payout destination.
      main_payout_wallet: mainPayoutWallet(c.env),
      block_signature_scheme: 'SPHINCS+-SHA2-128s',
      tx_signature_scheme: 'ECDSA (EIP-1559)',
    },
    state: row || {
      network: currentNetwork(c.env),
      signature_scheme: 'SPHINCS+-SHA2-128s (blocks) / ECDSA (tx)',
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

  // Which Quantarium-native asset the user wants to deposit. QTA (native),
  // QX / QKEY (ERC-20) all live on the SAME Quantarium chain (chain_id 60000)
  // and therefore share ONE per-user EVM deposit address — exactly like USDT
  // where every BEP-20 token shares the same BSC address. So we accept `asset`
  // for clarity/consistency but always issue (and reuse) the single address.
  let body: any = {};
  try { body = await c.req.json(); } catch { /* empty body ok */ }
  const asset = normalizeQtaAsset(body?.asset);

  // ─── SAFETY GATE ───────────────────────────────────────────────────────
  // Do NOT issue mock qta1... addresses to real users. Quantarium is a live
  // EVM chain (chain_id 60000). Issuing a placeholder address would risk
  // permanent loss of any funds sent to it. The gate lifts the moment the
  // owner sets QTA_CHAIN_DRIVER='real' (or 'live') in the Cloudflare
  // dashboard — no code deploy needed.
  if (!isQtaChainLive(c.env)) {
    return c.json({
      ok: false,
      error: 'CHAIN_INTEGRATION_PENDING',
      message:
        'QTA/QX/QKEY on-chain deposit is being finalized against Quantarium (chain_id 60000). ' +
        'On-chain deposit addresses will be enabled shortly. ' +
        'Internal QTA/QX/QKEY balances and trading remain fully operational.',
    }, 503);
  }
  // ───────────────────────────────────────────────────────────────────────

  const existing = await c.env.DB.prepare(
    `SELECT id, address, pubkey, derivation, network
     FROM qta_addresses
     WHERE user_id = ? AND network = ? AND is_active = 1
     LIMIT 1`
  ).bind(user.id, network).first<any>();
  if (existing) return c.json({ ok: true, asset, address: existing, reused: true });

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
    asset,
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

  // ─── SAFETY GATE (mirror of /qta/deposit-address) ─────────────────────
  // Block on-chain withdrawal until the owner flips the driver to real/live.
  if (!isQtaChainLive(c.env)) {
    return c.json({
      ok: false,
      error: 'CHAIN_INTEGRATION_PENDING',
      message:
        'On-chain QTA/QX/QKEY withdrawal is being finalized against Quantarium ' +
        '(chain_id 60000). This feature will be enabled shortly.',
    }, 503);
  }
  // ───────────────────────────────────────────────────────────────────────

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400);
  }

  // Which Quantarium-native asset is being withdrawn: QTA | QX | QKEY.
  const asset = normalizeQtaAsset(body?.asset);

  // ★★★★★★★ OWNER RULE (2026-08-28) — DESTINATION IS FORCED ★★★★★★★
  // Every withdrawal of a Quantarium-native asset is paid out ONLY to the
  // single company-designated MAIN Quantarium wallet. The user does NOT — and
  // CANNOT — choose the destination. We IGNORE any client-supplied to_address
  // and hard-override it with the configured main wallet on the SERVER (the
  // only trustworthy boundary). Fund flow:
  //   user's Quantarium wallet → exchange → THIS main Quantarium wallet.
  const to = mainPayoutWallet(c.env);
  if (!to) {
    // Misconfiguration — refuse rather than pay to an unknown/empty address.
    return c.json({
      ok: false,
      error: 'main_wallet_not_configured',
      message: 'The main Quantarium payout wallet is not configured. Please contact support.',
    }, 503);
  }

  const amount = String(body.amount || '').trim();
  const amtNum = Number(amount);
  if (!isFinite(amtNum) || amtNum <= 0) {
    return c.json({ ok: false, error: 'invalid_amount' }, 400);
  }

  // ★★★★★★★ Boss's permanent rule (2026-06-22):
  // Block withdrawal if it would dip into company-issued initial balance.
  // Withdrawable = available - available_initial. Applied PER ASSET so QX and
  // QKEY are gated by their own wallet rows, not QTA's.
  const assetWallet = await c.env.DB.prepare(
    `SELECT available, COALESCE(available_initial, 0) AS available_initial
       FROM wallets WHERE user_id = ? AND coin_symbol = ?`
  ).bind(user.id, asset).first<any>();
  if (!assetWallet || Number(assetWallet.available || 0) < amtNum) {
    return c.json({ ok: false, error: 'insufficient_balance' }, 400);
  }
  const assetInitial = Number(assetWallet.available_initial || 0);
  const assetWithdrawable = Math.max(0, Number(assetWallet.available || 0) - assetInitial);
  if (amtNum > assetWithdrawable) {
    return c.json({
      ok: false,
      error: 'withdrawal_blocked_company_issued',
      message: `Company-issued ${asset} (sign-up bonus, daily rewards, referral rewards, admin credits) cannot be withdrawn externally. Use it for internal trading instead.`,
      asset,
      available: Number(assetWallet.available || 0),
      available_initial: assetInitial,
      withdrawable: assetWithdrawable,
      requested: amtNum,
    }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO qta_withdrawals
       (id, user_id, to_address, amount, fee, asset, status, network)
     VALUES (?, ?, ?, ?, '0', ?, 'pending', ?)`
  ).bind(id, user.id, to, amount, asset, currentNetwork(c.env)).run();

  return c.json({ ok: true, id, asset, to_address: to, status: 'pending' });
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

  // ⚠️ DO NOT sign+broadcast in this HTTP handler.
  //
  // SPHINCS+ (SLH-DSA-SHA2-128s) signing takes ~6-10 s of pure CPU and
  // produces a 7856-byte signature. Cloudflare Pages Functions have a
  // per-request CPU budget; a synchronous sign here would blow through it,
  // starve concurrent requests, and (worse) risk the request being killed
  // mid-broadcast leaving the row stuck in an ambiguous state.
  //
  // Instead we ONLY move the row to 'broadcasting' (an approved-but-not-yet-
  // signed queue state) and return immediately. The quantaex-cron Worker
  // picks up 'broadcasting' rows on its */5 tick, signs + broadcasts one at
  // a time (its own CPU budget), then advances the row to 'confirmed' (with
  // the real tx_hash) or back to 'failed'. See cron-worker/src/index.ts →
  // processQtaWithdrawals().
  const now = new Date().toISOString();
  // ★ A2 fix: only transition rows still in 'pending' (atomic claim). A
  //   duplicate/concurrent approve sees changes === 0 and is rejected, so a
  //   row can't be double-queued for the cron signer.
  const claim = await c.env.DB.prepare(
    `UPDATE qta_withdrawals
     SET status = 'broadcasting', approved_by = ?, approved_at = ?, updated_at = ?
     WHERE id = ? AND status = 'pending'`
  ).bind(admin.id, now, now, id).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ ok: false, error: 'invalid_status' }, 409);
  }

  await logAdminAction(c, {
    action: 'qta.withdraw.approve',
    targetType: 'withdrawal',
    targetId: id,
    payload: {
      amount: row.amount,
      to: row.to_address,
      network: row.network,
      note: 'queued for async sign+broadcast by cron worker',
    },
  });

  // status 'broadcasting' == "approved, awaiting on-chain broadcast".
  // tx_hash is intentionally still null until the cron worker signs it.
  return c.json({
    ok: true,
    id,
    status: 'broadcasting',
    tx_hash: null,
    note: 'Approved and queued. The cron worker will sign and broadcast this withdrawal within ~5 minutes; tx_hash will populate once broadcast.',
  });
});

// Manual withdrawal completion (boss decision 2026-08-17): while payouts are
// sent by a human operator directly from the Quantarium wallet app, the admin
// records the real on-chain tx_hash here and marks the row 'confirmed'. This
// finalizes the user's locked balance (the amount+fee locked at request time
// is consumed — NOT refunded). Works on 'broadcasting' or 'pending' rows so a
// payout can be settled whether or not it went through the approve step.
chain.post('/qta/admin/withdrawals/:id/manual-complete', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const admin = c.get('user') as { id: string; email: string };
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const txHash = String(body.tx_hash || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return c.json({ ok: false, error: 'invalid_tx_hash', hint: 'expected 0x + 64 hex chars' }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, user_id, to_address, amount, fee, asset, status, network
     FROM qta_withdrawals WHERE id = ?`
  ).bind(id).first<any>();
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  if (row.status !== 'broadcasting' && row.status !== 'pending') {
    return c.json({ ok: false, error: 'invalid_status', status: row.status }, 409);
  }

  const now = new Date().toISOString();
  // Consume the locked balance (payout actually left the exchange). The amount
  // + fee was moved available -> locked when the user requested the withdrawal;
  // on completion we simply drop it from locked (do NOT return to available).
  const asset = String(row.asset || 'QTA').toUpperCase();
  const lockedDelta = Number(row.amount || 0) + Number(row.fee || 0);
  // ★ A2 fix: claim the transition FIRST; only debit locked funds if THIS
  //   call flipped the row to 'confirmed' (changes === 1). Previously the
  //   wallet debit ran unconditionally in the same batch, so a duplicate
  //   manual-complete on an already-confirmed row would drop `locked` twice.
  const claim = await c.env.DB.prepare(
    `UPDATE qta_withdrawals
     SET status = 'confirmed', tx_hash = ?, broadcast_at = ?, confirmed_at = ?,
         approved_by = COALESCE(approved_by, ?), updated_at = ?
     WHERE id = ? AND status IN ('broadcasting','pending')`
  ).bind(txHash, now, now, admin.id, now, id).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ ok: false, error: 'invalid_status' }, 409);
  }
  await c.env.DB.prepare(
    `UPDATE wallets SET locked = MAX(0, locked - ?)
     WHERE user_id = ? AND coin_symbol = ?`
  ).bind(lockedDelta, row.user_id, asset).run();

  await logAdminAction(c, {
    action: 'qta.withdraw.manual_complete',
    targetType: 'withdrawal',
    targetId: id,
    payload: {
      amount: row.amount, fee: row.fee, asset,
      to: row.to_address, network: row.network, tx_hash: txHash,
      note: 'manually paid out from Quantarium wallet app by operator',
    },
  });

  return c.json({ ok: true, id, status: 'confirmed', tx_hash: txHash });
});

chain.post('/qta/admin/withdrawals/:id/reject', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const admin = c.get('user') as { id: string; email: string };
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const reason = String(body.reason || 'rejected by admin').slice(0, 200);

  const row = await c.env.DB.prepare(
    `SELECT user_id, amount, fee, asset, status FROM qta_withdrawals WHERE id = ?`
  ).bind(id).first<any>();
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  if (row.status !== 'pending' && row.status !== 'broadcasting') {
    return c.json({ ok: false, error: 'invalid_status', status: row.status }, 409);
  }

  const now = new Date().toISOString();
  // ★ A2 fix: claim the state transition atomically. Only the call that
  //   actually flipped the row to 'rejected' (changes === 1) performs the
  //   refund, so a duplicate/concurrent reject cannot refund twice.
  const claim = await c.env.DB.prepare(
    `UPDATE qta_withdrawals
     SET status = 'rejected', rejected_reason = ?, approved_by = ?, approved_at = ?, updated_at = ?
     WHERE id = ? AND status IN ('pending','broadcasting')`
  ).bind(reason, admin.id, now, now, id).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ ok: false, error: 'invalid_status' }, 409);
  }
  // Refund the locked funds back to available (amount+fee was moved
  // available -> locked when the user requested the withdrawal).
  const asset = String(row.asset || 'QTA').toUpperCase();
  const refund = Number(row.amount || 0) + Number(row.fee || 0);
  await c.env.DB.prepare(
    `UPDATE wallets SET available = available + ?, locked = MAX(0, locked - ?)
     WHERE user_id = ? AND coin_symbol = ?`
  ).bind(refund, refund, row.user_id, asset).run();

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
// (admin) Env diagnostic — reports which QTA_* env bindings are present,
// their approximate shape (never their value), and pinpoints why the
// integration_status is 'pending' if it is.
//
// SECURITY: This endpoint NEVER returns:
//   - The mnemonic
//   - The private key
//   - The first/last N chars of any secret
// It only returns: presence flag, length, and (for QTA_CHAIN_DRIVER only)
// the plaintext value because that's a config flag, not a secret.
// ---------------------------------------------------------------------------
// ─── TEMPORARY: unauthenticated alias ──────────────────────────────────
// Boss cannot admin-login right now and needs to unblock the real-adapter
// activation. This alias exposes the SAME diagnostic that the admin-only
// endpoint below does. It NEVER returns secret values (no mnemonic words,
// no privkey bytes, not even prefix/suffix fragments) — only presence,
// length, shape flags, and (for the driver flag only) the plaintext value
// which /api/chain/qta/state already exposes publicly.
//
// TO BE REMOVED once boss confirms admin login is restored and the
// real adapter is active. Tracking commit: fc0c8ce → follow-up.
chain.get('/qta/env-check-temporary', async (c) => envCheckHandler(c as any));

chain.get('/qta/admin/env-check', authMiddleware, adminMiddleware, async (c) => envCheckHandler(c as any));

async function envCheckHandler(c: any) {
  const env = c.env as any;

  const describeSecret = (name: string) => {
    const v = env[name];
    if (v === undefined || v === null || v === '') {
      return { present: false, reason: 'MISSING' };
    }
    if (typeof v !== 'string') {
      return { present: true, type: typeof v, note: 'non-string binding' };
    }
    const trimmed = v.trim();
    const hasWhitespaceEdges = trimmed !== v;
    return {
      present: true,
      length: v.length,
      trimmed_length: trimmed.length,
      has_whitespace_edges: hasWhitespaceEdges,
    };
  };

  // Driver is a config flag (not a secret), so it's safe to echo the actual value.
  const rawDriver = env.QTA_CHAIN_DRIVER;
  const driverInfo = rawDriver === undefined || rawDriver === null
    ? { present: false, value: null, effective: 'mock', reason: 'not set' }
    : {
        present: true,
        raw_value: String(rawDriver),
        trimmed_value: String(rawDriver).trim(),
        effective: String(rawDriver).trim().toLowerCase(),
        has_whitespace_edges: String(rawDriver).trim() !== String(rawDriver),
      };

  // Mnemonic shape check (word count) without ever echoing content.
  const mnemonicRaw = env.QTA_HD_WALLET_MNEMONIC;
  let mnemonicInfo: Record<string, unknown> = { present: false, reason: 'MISSING' };
  if (typeof mnemonicRaw === 'string' && mnemonicRaw.trim()) {
    const trimmed = mnemonicRaw.trim();
    const words = trimmed.split(/\s+/);
    mnemonicInfo = {
      present: true,
      char_length: mnemonicRaw.length,
      trimmed_char_length: trimmed.length,
      word_count: words.length,
      has_whitespace_edges: trimmed !== mnemonicRaw,
      shape_ok: words.length === 12 || words.length === 24,
      shape_reason: words.length === 12 || words.length === 24
        ? 'valid word count'
        : `expected 12 or 24 words, got ${words.length}`,
    };
  }

  // Legacy: private-key shape check (still parsed for backwards compat with
  // any secret operators may have registered before the PQ revelation, but
  // NO LONGER REQUIRED — SPHINCS+ has no 32-byte ECDSA private key).
  const pkRaw = env.QTA_HOT_WALLET_PRIVATE_KEY;
  let pkInfo: Record<string, unknown> = {
    present: false,
    reason: 'MISSING (no longer required — SPHINCS+ has no ECDSA privkey)',
  };
  if (typeof pkRaw === 'string' && pkRaw.trim()) {
    const trimmed = pkRaw.trim();
    pkInfo = {
      present: true,
      char_length: pkRaw.length,
      trimmed_char_length: trimmed.length,
      status: 'DEPRECATED — SPHINCS+ mode ignores this. Safe to delete from Cloudflare dashboard.',
    };
  }

  // Mnemonic <-> hot wallet address match check (SPHINCS+ HD index 0).
  // This is the critical safety check: if the mnemonic's index-0 SPHINCS+
  // derivation does not match the declared exchange hot wallet, every
  // withdrawal signed by the server would come from the wrong address and
  // fail on-chain. Verifying now blocks activation before that ever happens.
  let mnemonicMatch: Record<string, unknown> = { checked: false, reason: 'skipped' };
  const hotAddrRaw = env.QTA_HOT_WALLET_ADDRESS;
  if (
    typeof mnemonicRaw === 'string' && mnemonicRaw.trim() &&
    (mnemonicInfo as any).shape_ok &&
    typeof hotAddrRaw === 'string' && hotAddrRaw.trim()
  ) {
    try {
      const { verifyMnemonicMatchesHotWallet, isValidMnemonic } =
        await import('../lib/qta-sphincs');
      const trimmedMnem = mnemonicRaw.trim();
      if (!isValidMnemonic(trimmedMnem)) {
        mnemonicMatch = {
          checked: true,
          ok: false,
          reason: 'mnemonic fails BIP-39 English wordlist validation (word not in list or bad checksum)',
        };
      } else {
        // NOTE: SPHINCS+ keygen is CPU-intensive (few seconds). This endpoint
        // may take 5-10 s to respond when a mnemonic is present — expected.
        const check = verifyMnemonicMatchesHotWallet(trimmedMnem, hotAddrRaw.trim());
        if (check.ok) {
          mnemonicMatch = { checked: true, ok: true };
        } else {
          mnemonicMatch = {
            checked: true,
            ok: false,
            derived_address: check.derived,
            expected_address: check.expected,
            reason: 'mnemonic index-0 does NOT derive the expected hot wallet address',
          };
        }
      }
    } catch (e: any) {
      mnemonicMatch = { checked: true, ok: false, error: String(e?.message || e) };
    }
  } else if ((mnemonicInfo as any).present && !(mnemonicInfo as any).shape_ok) {
    mnemonicMatch = { checked: false, reason: 'mnemonic shape invalid — cannot verify' };
  }

  // MANUAL WITHDRAWAL MODE: when QTA_MANUAL_WITHDRAWALS is on (default true),
  // the server NEVER signs withdrawals — a human operator pays them out from
  // the wallet app. In that mode the mnemonic index-0 does NOT need to match
  // the hot wallet (deposits still auto-credit; withdrawals stay pending for
  // manual payout). So the mismatch must NOT block "live" status.
  const manualWithdrawals =
    String(env.QTA_MANUAL_WITHDRAWALS ?? 'true').toLowerCase() !== 'false';

  // Diagnose why integration_status is still 'pending'.
  const reasons: string[] = [];
  if (driverInfo.effective !== 'real') {
    reasons.push(`QTA_CHAIN_DRIVER must be 'real' (currently: '${driverInfo.effective || '<missing>'}')`);
  }
  if (!(env.QTA_RPC_URL)) reasons.push('QTA_RPC_URL missing');
  if (!(env.QTA_HOT_WALLET_ADDRESS)) reasons.push('QTA_HOT_WALLET_ADDRESS missing');
  if (!(mnemonicInfo as any).present) {
    reasons.push('QTA_HD_WALLET_MNEMONIC missing');
  } else if (!(mnemonicInfo as any).shape_ok) {
    reasons.push(`QTA_HD_WALLET_MNEMONIC shape: ${(mnemonicInfo as any).shape_reason}`);
  }
  // The mnemonic/hot-wallet mismatch only blocks activation when the server
  // is expected to sign (auto mode). In manual mode it is tolerated.
  if (
    !manualWithdrawals &&
    (mnemonicMatch as any).checked && (mnemonicMatch as any).ok === false
  ) {
    const detail = (mnemonicMatch as any).derived_address
      ? ` (derived=${(mnemonicMatch as any).derived_address}, expected=${(mnemonicMatch as any).expected_address})`
      : ` (${(mnemonicMatch as any).reason || (mnemonicMatch as any).error})`;
    reasons.push(`mnemonic does not match hot wallet${detail}`);
  }

  const willRouteToRealAdapter =
    driverInfo.effective === 'real' &&
    !!env.QTA_RPC_URL &&
    !!env.QTA_HOT_WALLET_ADDRESS &&
    (mnemonicInfo as any).shape_ok === true &&
    // In manual mode, index-0 match is not required (server never signs).
    (manualWithdrawals || (mnemonicMatch as any).ok === true);

  return c.json({
    ok: true,
    signature_scheme: 'SPHINCS+-SHA2-128s (SLH-DSA, typed tx 0x7f)',
    integration_status: willRouteToRealAdapter ? 'live' : 'pending',
    manual_withdrawal_mode: manualWithdrawals,
    verdict: reasons.length === 0
      ? (manualWithdrawals
          ? 'MANUAL withdrawal mode: real driver is LIVE. Deposits auto-credit on-chain; withdrawals are paid out manually by an operator (server never signs), so the mnemonic index-0 does not need to match the hot wallet.'
          : 'All required env vars are set, mnemonic shape is valid, and mnemonic index-0 matches the declared hot wallet. Real SPHINCS+ adapter should route on next request.')
      : `Real adapter is NOT active because: ${reasons.join(' | ')}`,
    reasons_pending: reasons,
    env: {
      QTA_CHAIN_DRIVER: driverInfo,
      QTA_NETWORK: describeSecret('QTA_NETWORK'),
      QTA_CHAIN_ID: describeSecret('QTA_CHAIN_ID'),
      QTA_RPC_URL: describeSecret('QTA_RPC_URL'),
      QTA_EXPLORER_URL: describeSecret('QTA_EXPLORER_URL'),
      QTA_HOT_WALLET_ADDRESS: describeSecret('QTA_HOT_WALLET_ADDRESS'),
      QTA_HD_WALLET_MNEMONIC: mnemonicInfo,
      QTA_HOT_WALLET_PRIVATE_KEY: pkInfo,
      QTA_TOKEN_QX_ADDRESS: describeSecret('QTA_TOKEN_QX_ADDRESS'),
      QTA_TOKEN_QKEY_ADDRESS: describeSecret('QTA_TOKEN_QKEY_ADDRESS'),
    },
    mnemonic_check: mnemonicMatch,
    note:
      'This endpoint intentionally never returns secret values, not even fragments. ' +
      'Only presence, length, and shape are reported. Access requires admin role, ' +
      'except for /qta/env-check-temporary which is unauthenticated and TO BE REMOVED ' +
      'once real-adapter activation is confirmed. Mnemonic verification triggers a ' +
      'SPHINCS+ keygen which takes 5-10 seconds — response latency is expected.',
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function currentNetwork(env: any): QtaNetwork {
  return env.QTA_NETWORK === 'qta-testnet' ? 'qta-testnet' : 'qta-mainnet';
}

// The three Quantarium-native assets whose on-chain deposit/withdrawal all
// flow through our own Quantarium SPHINCS+ HD wallet. QTA is the native coin;
// QX / QKEY are ERC-20 tokens on the same chain.
const QTA_ASSETS = ['QTA', 'QX', 'QKEY'] as const;
type QtaAsset = (typeof QTA_ASSETS)[number];

// Normalize a client-supplied asset symbol to one of QTA | QX | QKEY.
// Unknown / missing → 'QTA' (the native coin, safest default).
function normalizeQtaAsset(raw: unknown): QtaAsset {
  const s = String(raw || 'QTA').toUpperCase().trim();
  return (QTA_ASSETS as readonly string[]).includes(s) ? (s as QtaAsset) : 'QTA';
}

// The on-chain adapter is "live" once the owner flips the driver to 'real'
// (or 'live') in the Cloudflare dashboard. Until then the 503 pending gate
// stays on for both deposit-address issuance and withdrawal enqueue.
function isQtaChainLive(env: any): boolean {
  const driver = String(env?.QTA_CHAIN_DRIVER || 'mock').toLowerCase();
  return driver === 'real' || driver === 'live';
}

// The single, company-designated MAIN Quantarium payout wallet. EVERY user
// withdrawal of QTA / QX / QKEY is paid out ONLY here — users can never pick
// their own destination. Configured via QTA_MAIN_PAYOUT_WALLET (falls back to
// the exchange hot wallet, which is also company-controlled). Returns a
// checksum-agnostic 0x… string or '' when misconfigured.
function mainPayoutWallet(env: any): string {
  const addr = String(
    env?.QTA_MAIN_PAYOUT_WALLET ||
    env?.QTA_HOT_WALLET_ADDRESS ||
    ''
  ).trim();
  return /^0x[0-9a-fA-F]{40}$/.test(addr) ? addr : '';
}

export default chain;
