import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { requireKyc } from '../middleware/kyc';
import { rateLimit } from '../middleware/rateLimit';
import { verifyTotp } from '../utils/totp';
import { tmplWithdrawSubmitted, fireAndForgetMail, metaFromReq } from '../utils/mailer';

const app = new Hono<AppEnv>();

// Per-KYC daily withdrawal USD limits.
// (For simplicity we evaluate against coins.price_usd snapshot at request time.)
const DAILY_WITHDRAW_USD_LIMIT = { none: 0, basic: 0, approved: 50_000 } as const;
const PER_REQUEST_USD_LIMIT    = { none: 0, basic: 0, approved: 10_000 } as const;

function uuid() {
  return crypto.randomUUID();
}

// Get all wallets
app.get('/', authMiddleware, async (c) => {
  const user = c.get('user');

  const { results: wallets } = await c.env.DB.prepare(`
    SELECT w.*, c.name as coin_name, c.price_usd, c.icon, c.change_24h
    FROM wallets w JOIN coins c ON c.symbol = w.coin_symbol
    WHERE w.user_id = ?
    ORDER BY (w.available + w.locked) * c.price_usd DESC
  `).bind(user.id).all();

  // Add coins that user doesn't have wallet for
  const existingSymbols = wallets.map((w: any) => w.coin_symbol);
  if (existingSymbols.length > 0) {
    const placeholders = existingSymbols.map(() => '?').join(',');
    const { results: otherCoins } = await c.env.DB.prepare(
      `SELECT * FROM coins WHERE symbol NOT IN (${placeholders}) AND is_active = 1`
    ).bind(...existingSymbols).all();

    for (const coin of otherCoins as any[]) {
      wallets.push({
        id: null, user_id: user.id, coin_symbol: coin.symbol,
        available: 0, locked: 0, coin_name: coin.name, price_usd: coin.price_usd,
        icon: coin.icon, change_24h: coin.change_24h,
      } as any);
    }
  } else {
    const { results: allCoins } = await c.env.DB.prepare('SELECT * FROM coins WHERE is_active = 1').all();
    for (const coin of allCoins as any[]) {
      wallets.push({
        id: null, user_id: user.id, coin_symbol: coin.symbol,
        available: 0, locked: 0, coin_name: coin.name, price_usd: coin.price_usd,
        icon: coin.icon, change_24h: coin.change_24h,
      } as any);
    }
  }

  return c.json(wallets);
});

// Get single wallet
app.get('/:symbol', authMiddleware, async (c) => {
  const user = c.get('user');
  const symbol = c.req.param('symbol');

  let wallet = await c.env.DB.prepare(`
    SELECT w.*, c.name as coin_name, c.price_usd, c.icon
    FROM wallets w JOIN coins c ON c.symbol = w.coin_symbol
    WHERE w.user_id = ? AND w.coin_symbol = ?
  `).bind(user.id, symbol).first();

  if (!wallet) {
    const coin = await c.env.DB.prepare('SELECT * FROM coins WHERE symbol = ?').bind(symbol).first() as any;
    if (!coin) return c.json({ error: 'Coin not found' }, 404);
    wallet = { available: 0, locked: 0, coin_symbol: coin.symbol, coin_name: coin.name, price_usd: coin.price_usd };
  }

  return c.json(wallet);
});

// 🚫 Self-service deposit REMOVED (2026-04-22)
// --------------------------------------------------------------------------
// The previous simulation endpoint let any authenticated user credit
// arbitrary amounts to their own wallet — effectively allowing self-minting
// of USDT / BTC / ETH etc.  That was the single biggest launch blocker
// surfaced by the exchange-readiness audit (see docs/EXCHANGE_READINESS_AUDIT.md §1.1).
//
// Real user deposits must come from on-chain confirmations only — QuantaEX
// is a global crypto-only exchange and does not accept fiat rails. Until the
// chain watcher is fully implemented for every supported network, ordinary
// users simply cannot deposit.  Admins can still credit test balances via
// the admin-only /api/wallet/admin-credit endpoint below for QA purposes.
app.post('/deposit', authMiddleware, async (c) => {
  return c.json({
    error: 'Self-service deposits are disabled. Please contact support.',
    code: 'DEPOSIT_DISABLED',
  }, 403);
});

// Admin-only credit (kept for QA / compensation). Requires admin role.
app.post('/admin-credit', authMiddleware, adminMiddleware, async (c) => {
  const { user_id, coin_symbol, amount, memo } = await c.req.json();
  if (!user_id || !coin_symbol || !amount || amount <= 0) {
    return c.json({ error: 'Invalid request' }, 400);
  }

  const coin = await c.env.DB.prepare('SELECT symbol FROM coins WHERE symbol = ?').bind(coin_symbol).first();
  if (!coin) return c.json({ error: 'Coin not found' }, 404);

  const wallet = await c.env.DB.prepare('SELECT id FROM wallets WHERE user_id = ? AND coin_symbol = ?').bind(user_id, coin_symbol).first() as any;
  if (wallet) {
    await c.env.DB.prepare('UPDATE wallets SET available = available + ? WHERE id = ?').bind(amount, wallet.id).run();
  } else {
    await c.env.DB.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available) VALUES (?,?,?,?)').bind(uuid(), user_id, coin_symbol, amount).run();
  }

  const depositId = uuid();
  const txHash = `admin-${depositId.replace(/-/g, '').slice(0, 16)}`;
  await c.env.DB.prepare(
    "INSERT INTO deposits (id, user_id, coin_symbol, amount, status, tx_hash) VALUES (?,?,?,?,'completed',?)"
  ).bind(depositId, user_id, coin_symbol, amount, txHash).run();

  // Best-effort audit log
  try {
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, payload)
       VALUES (?, ?, 'admin_credit', 'user', ?, ?)`
    ).bind(uuid(), c.get('user').id, user_id, JSON.stringify({ coin_symbol, amount, memo: memo || null })).run();
  } catch { /* table may not exist in older DBs; ignore */ }

  return c.json({ message: 'Credit applied', deposit_id: depositId, tx_hash: txHash });
});

// ============================================================================
// Withdrawal address whitelist
// ----------------------------------------------------------------------------
// Users manage a list of pre-approved destination addresses.  Adding an
// address creates a 24-hour cooldown before it can be used.  Only addresses
// in the whitelist are accepted by /withdraw.  This stops one-click theft
// from a compromised session.
// ============================================================================
app.get('/withdraw/whitelist', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT id, coin_symbol, network, memo, address, label, is_active, cooldown_until, created_at
     FROM withdraw_whitelist WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all().catch(() => ({ results: [] as any[] }));
  return c.json(results);
});

app.post('/withdraw/whitelist', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const { coin_symbol, network, address, memo, label, totp_code } = body;
  if (!coin_symbol || !address) return c.json({ error: 'coin_symbol and address required' }, 400);

  // Require 2FA for adding an address if the user has 2FA enabled
  const u = await c.env.DB.prepare(
    'SELECT two_factor_enabled, two_factor_secret FROM users WHERE id = ?'
  ).bind(user.id).first<any>();
  if (u?.two_factor_enabled) {
    if (!totp_code) return c.json({ error: '2FA code required', requires_2fa: true }, 401);
    const ok = await verifyTotp(u.two_factor_secret, String(totp_code));
    if (!ok) return c.json({ error: 'Invalid 2FA code' }, 401);
  }

  const cooldownUntil = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO withdraw_whitelist (id, user_id, coin_symbol, network, memo, address, label, cooldown_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, coin_symbol, network || null, memo || null, address, label || null, cooldownUntil).run();

  return c.json({ id, cooldown_until: cooldownUntil, message: 'Address added — 24h cooldown before first use' }, 201);
});

app.delete('/withdraw/whitelist/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare(
    'DELETE FROM withdraw_whitelist WHERE id = ? AND user_id = ?'
  ).bind(c.req.param('id'), user.id).run();
  return c.json({ ok: true });
});

// ============================================================================
// Withdraw
// ----------------------------------------------------------------------------
// Hardened: KYC approved, whitelist address past cooldown, 2FA if enabled,
// per-request USD limit, 24h rolling USD limit, moved to `locked` (not
// deducted) until admin approves so rejection can cleanly refund.
// ============================================================================
const rlWithdraw = rateLimit({ key: 'wallet:withdraw', max: 20, windowSec: 3600 });

app.post('/withdraw', authMiddleware, rlWithdraw, requireKyc('approved'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const { coin_symbol, amount: rawAmount, address, network, memo, totp_code } = body;
  const amount = Number(rawAmount);
  if (!coin_symbol || !address || !isFinite(amount) || amount <= 0) {
    return c.json({ error: 'Invalid request' }, 400);
  }

  // Load user + coin meta
  const [u, coin] = await Promise.all([
    c.env.DB.prepare(
      'SELECT two_factor_enabled, two_factor_secret FROM users WHERE id = ?'
    ).bind(user.id).first<any>(),
    c.env.DB.prepare('SELECT symbol, price_usd FROM coins WHERE symbol = ?').bind(coin_symbol).first<any>(),
  ]);
  if (!coin) return c.json({ error: 'Coin not found' }, 404);

  // 2FA if configured (highly recommended to enforce before we add the "gate all")
  if (u?.two_factor_enabled) {
    if (!totp_code) return c.json({ error: '2FA code required', requires_2fa: true }, 401);
    const ok = await verifyTotp(u.two_factor_secret, String(totp_code));
    if (!ok) return c.json({ error: 'Invalid 2FA code' }, 401);
  }

  // Whitelist check
  const wl = await c.env.DB.prepare(
    `SELECT id, cooldown_until, is_active FROM withdraw_whitelist
     WHERE user_id = ? AND coin_symbol = ? AND address = ?
       AND (network IS ? OR network = ?)`
  ).bind(user.id, coin_symbol, address, network || null, network || null)
    .first<{ id: string; cooldown_until: string; is_active: number }>().catch(() => null);
  if (!wl) return c.json({ error: 'Address not in whitelist. Add it first.' }, 400);
  if (!wl.is_active) return c.json({ error: 'Address disabled' }, 400);
  if (wl.cooldown_until && new Date(wl.cooldown_until).getTime() > Date.now()) {
    return c.json({ error: 'Address is in 24h cooldown', cooldown_until: wl.cooldown_until }, 400);
  }

  // Per-request + daily USD limits (approved tier only — others blocked by requireKyc)
  const tier: keyof typeof DAILY_WITHDRAW_USD_LIMIT = 'approved';
  const usdPerUnit = Number(coin.price_usd || 0);
  const notional = usdPerUnit * amount;
  if (PER_REQUEST_USD_LIMIT[tier] > 0 && notional > PER_REQUEST_USD_LIMIT[tier]) {
    return c.json({ error: `Per-request limit exceeded (max ${PER_REQUEST_USD_LIMIT[tier]} USD)` }, 400);
  }
  if (DAILY_WITHDRAW_USD_LIMIT[tier] > 0) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const row = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(w.amount * COALESCE(c.price_usd, 0)), 0) AS used_usd
      FROM withdrawals w LEFT JOIN coins c ON c.symbol = w.coin_symbol
      WHERE w.user_id = ? AND w.status IN ('pending','completed') AND w.created_at >= ?
    `).bind(user.id, since).first<{ used_usd: number }>();
    const usedUsd = Number(row?.used_usd || 0);
    if (usedUsd + notional > DAILY_WITHDRAW_USD_LIMIT[tier]) {
      return c.json({
        error: `24h withdrawal limit reached (${DAILY_WITHDRAW_USD_LIMIT[tier]} USD)`,
        used_usd: Math.round(usedUsd),
        requested_usd: Math.round(notional),
      }, 400);
    }
  }

  const wallet = await c.env.DB.prepare(
    'SELECT id, available FROM wallets WHERE user_id = ? AND coin_symbol = ?'
  ).bind(user.id, coin_symbol).first<any>();
  if (!wallet || wallet.available < amount) return c.json({ error: 'Insufficient balance' }, 400);

  const fee = amount * 0.001;
  const withdrawalId = uuid();

  // Move to `locked` (NOT subtracted) so admin reject cleanly refunds without
  // a race window. Admin approve will do the final deduction.
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE wallets SET available = available - ?, locked = locked + ? WHERE id = ?'
    ).bind(amount, amount, wallet.id),
    c.env.DB.prepare(
      `INSERT INTO withdrawals (id, user_id, coin_symbol, amount, fee, address, network, memo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).bind(withdrawalId, user.id, coin_symbol, amount - fee, fee, address, network || null, memo || null),
  ]);

  // S3-6: withdrawal-submitted confirmation email
  try {
    const em = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(user.id).first<{ email: string }>();
    if (em?.email) {
      const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
      fireAndForgetMail(
        c.env as any,
        em.email,
        tmplWithdrawSubmitted(
          appUrl,
          { amount: amount - fee, coin: coin_symbol, address, network: network || null, fee },
          metaFromReq(c.req),
        ),
        c.executionCtx as any,
      );
    }
  } catch (e) { console.warn('[withdraw] submit mail failed:', e); }

  return c.json({ message: 'Withdrawal submitted — awaiting admin approval', withdrawal_id: withdrawalId });
});

// Get deposit history
app.get('/history/deposits', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(user.id).all();
  return c.json(results);
});

// Get withdrawal history
app.get('/history/withdrawals', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(user.id).all();
  return c.json(results);
});

export default app;
