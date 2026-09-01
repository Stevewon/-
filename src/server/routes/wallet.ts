import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { requireKyc } from '../middleware/kyc';
import { rateLimit } from '../middleware/rateLimit';
import { verifyTotp } from '../utils/totp';
import { tmplWithdrawSubmitted, fireAndForgetMail, metaFromReq } from '../utils/mailer';
import { getRiskState } from '../lib/risk';
import { isQuantariumAsset } from '../lib/asset-routing';
import { computeBalanceBreakdown } from '../lib/balance-breakdown';
import { getFeeExemption } from '../utils/fees';

const app = new Hono<AppEnv>();

// ★★★★★★★ OWNER RULE (2026-08-28) — FORCED PAYOUT DESTINATION ★★★★★★★
// EVERY withdrawal settled as a Quantarium-native asset (QTA / QX / QKEY) is
// paid out ONLY to the single company-designated MAIN Quantarium wallet. The
// user can NEVER choose their own destination — the server force-overrides
// the destination with this address (the only trustworthy boundary).
// Fund flow: user's Quantarium wallet → exchange → THIS main Quantarium wallet.
// Configured via QTA_MAIN_PAYOUT_WALLET; falls back to the exchange hot wallet
// (also company-controlled). Returns '' when misconfigured.
function mainPayoutWallet(env: any): string {
  const addr = String(
    env?.QTA_MAIN_PAYOUT_WALLET ||
    env?.QTA_HOT_WALLET_ADDRESS ||
    ''
  ).trim();
  return /^0x[0-9a-fA-F]{40}$/.test(addr) ? addr : '';
}

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

// ============================================================================
// GET /wallet/breakdown/:symbol — where the current balance came from.
// Read-only reconstruction (welcome bonus / referral rewards / deposits /
// admin credits / withdrawals). Shown to the user so a 3,060 QX balance is
// explained as e.g. 2,910 referral + 150 sign-up bonus.
// NOTE: must be declared BEFORE '/:symbol' so it isn't captured by it.
// ============================================================================
app.get('/breakdown/:symbol', authMiddleware, async (c) => {
  const user = c.get('user');
  const symbol = (c.req.param('symbol') || '').toUpperCase();
  if (!symbol) return c.json({ error: 'symbol required' }, 400);
  try {
    const breakdown = await computeBalanceBreakdown(c.env.DB, user.id, symbol);
    return c.json(breakdown);
  } catch (e) {
    console.error('[wallet/breakdown] failed:', e);
    return c.json({ error: 'Failed to compute balance breakdown' }, 500);
  }
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

// --------------------------------------------------------------------------
// External deposit address (Phase B) — real per-user derived address.
//
// POST /api/wallet/ext/deposit-address  { network: 'ERC20' | 'BEP20' }
//
// Returns a REAL address derived from the exchange HD mnemonic
// (EXT_HD_WALLET_MNEMONIC). Idempotent per (user, chain, network). Gated by
// EXT_DEPOSITS_ENABLED='true' + the mnemonic secret being present — otherwise
// returns 503 EXTERNAL_DEPOSIT_PENDING so the UI keeps showing the "being
// prepared" notice. NEVER falls back to a fake/simulated address.
// --------------------------------------------------------------------------
app.post('/ext/deposit-address', authMiddleware, async (c) => {
  const user = c.get('user');
  let body: any = {};
  try { body = await c.req.json(); } catch { /* empty body ok */ }
  const networkId = String(body?.network || 'ERC20').toUpperCase();

  const { getOrCreateExtAddress, ExtDepositPendingError } = await import('../lib/ext-deposit');
  try {
    const res = await getOrCreateExtAddress(c.env as any, user.id, networkId);
    return c.json({
      ok: true,
      address: res.address,
      chain: res.chain,
      network: res.network,
      derivation: res.derivation,
    });
  } catch (e: any) {
    if (e instanceof ExtDepositPendingError || e?.name === 'ExtDepositPendingError') {
      return c.json({
        ok: false,
        error: 'EXTERNAL_DEPOSIT_PENDING',
        message: 'External deposits are being finalized and will be enabled shortly.',
      }, 503);
    }
    console.error('[ext-deposit-address] failed:', e);
    return c.json({ ok: false, error: 'internal_error' }, 500);
  }
});

// Admin-only credit (kept for QA / compensation). Requires admin role.
app.post('/admin-credit', authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json();
  const { user_id, coin_symbol, amount, memo } = body;
  if (!user_id || !coin_symbol || !amount || amount <= 0) {
    return c.json({ error: 'Invalid request' }, 400);
  }
  // ★★★★★★★ Boss's permanent rule (2026-06-22):
  // Default: admin credit is COMPANY-ISSUED (locked from external
  // withdrawal). Pass { withdrawable: true } to credit as user-owned.
  const isWithdrawable = body.withdrawable === true;

  const coin = await c.env.DB.prepare('SELECT symbol FROM coins WHERE symbol = ?').bind(coin_symbol).first();
  if (!coin) return c.json({ error: 'Coin not found' }, 404);

  const wallet = await c.env.DB.prepare('SELECT id FROM wallets WHERE user_id = ? AND coin_symbol = ?').bind(user_id, coin_symbol).first() as any;
  if (wallet) {
    if (isWithdrawable) {
      await c.env.DB.prepare('UPDATE wallets SET available = available + ? WHERE id = ?').bind(amount, wallet.id).run();
    } else {
      await c.env.DB.prepare('UPDATE wallets SET available = available + ?, available_initial = COALESCE(available_initial, 0) + ? WHERE id = ?').bind(amount, amount, wallet.id).run();
    }
  } else {
    if (isWithdrawable) {
      await c.env.DB.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available, available_initial) VALUES (?,?,?,?,0)').bind(uuid(), user_id, coin_symbol, amount).run();
    } else {
      await c.env.DB.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available, available_initial) VALUES (?,?,?,?,?)').bind(uuid(), user_id, coin_symbol, amount, amount).run();
    }
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
  const { coin_symbol, amount: rawAmount, network, memo, totp_code } = body;
  // `address` is mutable: for Quantarium-native payouts the server force-
  // overrides it with the company main wallet (owner rule 2026-08-28).
  let address = body.address;
  const amount = Number(rawAmount);
  if (!coin_symbol || !isFinite(amount) || amount <= 0) {
    return c.json({ error: 'Invalid request' }, 400);
  }

  // ── Payout-coin choice (boss's 2026-08-26 rule) ────────────────────────
  // The user debits `coin_symbol` from their wallet but may CHOOSE to receive
  // the value paid out as QTA or USDT, converted at THIS moment's live prices.
  // Default: pay out in the same coin being withdrawn (no conversion).
  const payoutCoinRaw = String(body.payout_coin || coin_symbol).toUpperCase();
  const payoutCoin = (payoutCoinRaw === 'QTA' || payoutCoinRaw === 'USDT')
    ? payoutCoinRaw
    : String(coin_symbol).toUpperCase();

  // ─── COIN-FAMILY WALLET ROUTING (boss's 2026-08-13 default) ────────────
  // QuantaEX bridges two worlds:
  //   • Quantarium-native assets (QTA coin + QX / QKEY tokens we issued on
  //     chain_id 60000) are sent through OUR OWN Quantarium SPHINCS+ HD
  //     wallet. Those withdrawals go into the `qta_withdrawals` queue and are
  //     signed + broadcast asynchronously by the cron worker (SPHINCS+ signing
  //     is 6-10s CPU — far too heavy for a request handler).
  //   • Everything else (BTC, ETH, USDT, …) is a standard, externally-issued
  //     coin handled by its own compatible wallet via the legacy `withdrawals`
  //     table + admin approval.
  // isQuantariumAsset() is the single source of truth for this split.
  const routeQuantarium = isQuantariumAsset(coin_symbol);
  const driver = String((c.env as any).QTA_CHAIN_DRIVER || 'mock').toLowerCase();

  // ★★★ FIX (2026-09-01, owner): a user withdrawing their OWN QTA (bought or
  // earned via staking) MUST be able to send it to their OWN external
  // Quantarium wallet. The forced company-wallet destination is therefore now
  // used ONLY for CONVERTED payouts — i.e. the user withdraws a DIFFERENT coin
  // but asks to be paid out in QTA, so we mint/convert QTA on their behalf and
  // settle that conversion via the company treasury wallet.
  //
  // Withdrawing a Quantarium-native asset IN-KIND (coin === payout === QTA/QX/
  // QKEY) no longer forces the company wallet: the user supplies their own
  // Quantarium address (validated to 0x + 40 hex below).
  const isConvertedQtaPayout = payoutCoin === 'QTA' && coin_symbol !== 'QTA';
  const settleAsQtaEarly = isConvertedQtaPayout;
  const forcedMainWallet = settleAsQtaEarly ? mainPayoutWallet(c.env as any) : '';
  if (settleAsQtaEarly) {
    if (!forcedMainWallet) {
      return c.json({
        error: 'MAIN_WALLET_NOT_CONFIGURED',
        message: 'The main Quantarium payout wallet is not configured. Please contact support.',
      }, 503);
    }
    // FORCE the destination — ignore whatever the client sent.
    address = forcedMainWallet;
  } else if (!address) {
    // All user-destination payouts (incl. in-kind QTA) require an address.
    return c.json({ error: 'Invalid request' }, 400);
  } else if (routeQuantarium) {
    // In-kind Quantarium withdrawal → validate the user-supplied destination is
    // a well-formed Quantarium Network address (0x + 40 hex). Wrong-format /
    // wrong-network sends are unrecoverable, so reject up-front.
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(address).trim())) {
      return c.json({
        error: 'INVALID_QUANTARIUM_ADDRESS',
        message: `${coin_symbol} can only be withdrawn to a valid Quantarium Network (chain_id 60000) address (0x + 40 hex).`,
      }, 400);
    }
    address = String(address).trim();
  }

  // Quantarium on-chain withdrawal requires the real chain adapter (RPC + HD
  // mnemonic + hot wallet) to be configured. Until then, block external
  // withdrawal to avoid asset loss — internal balances and trading are
  // unaffected.
  if (routeQuantarium && driver !== 'real') {
    return c.json({
      error: 'CHAIN_INTEGRATION_PENDING',
      message:
        `External on-chain withdrawal for ${coin_symbol} is being finalized ` +
        `against Quantarium (chain_id 60000). It will be enabled shortly. ` +
        `Internal balance and trading are unaffected.`,
    }, 503);
  }
  // ───────────────────────────────────────────────────────────────────────

  // Load user + coin meta
  const [u, coin, risk] = await Promise.all([
    c.env.DB.prepare(
      'SELECT two_factor_enabled, two_factor_secret FROM users WHERE id = ?'
    ).bind(user.id).first<any>(),
    c.env.DB.prepare('SELECT symbol, price_usd FROM coins WHERE symbol = ?').bind(coin_symbol).first<any>(),
    getRiskState(c),
  ]);
  if (!coin) return c.json({ error: 'Coin not found' }, 404);

  // Phase F: forced 2FA on withdrawals. When admin enables risk_force_2fa,
  // every withdrawal must clear a TOTP challenge regardless of the user's
  // own 2FA setting. If the user hasn't set up 2FA at all, withdrawals are
  // hard-blocked until they do.
  const forced2fa = risk.force_2fa.enabled;
  if (forced2fa && !u?.two_factor_enabled) {
    return c.json(
      {
        error: '2FA setup required by exchange policy. Enable 2FA before withdrawing.',
        requires_2fa_setup: true,
      },
      403,
    );
  }

  // 2FA if configured OR forced by admin policy.
  if (u?.two_factor_enabled || forced2fa) {
    if (!totp_code) return c.json({ error: '2FA code required', requires_2fa: true }, 401);
    const ok = await verifyTotp(u.two_factor_secret, String(totp_code));
    if (!ok) return c.json({ error: 'Invalid 2FA code' }, 401);
  }

  // Whitelist check — SKIPPED for Quantarium-native withdrawals:
  //   • CONVERTED QTA payouts go to the fixed company wallet (nothing to
  //     whitelist), and
  //   • IN-KIND QTA/QX/QKEY sends go to the user's own Quantarium address,
  //     which we already strict-format-validate above and which the user must
  //     explicitly acknowledge as irreversible in the UI. QTA has no
  //     whitelist-management UI, so requiring one would hard-block the very
  //     withdrawal the owner wants enabled.
  // Every non-Quantarium coin (BTC/ETH/USDT/…) still requires a whitelist.
  if (!settleAsQtaEarly && !routeQuantarium) {
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
  }

  // Per-request + daily USD limits (approved tier only — others blocked by requireKyc)
  const tier: keyof typeof DAILY_WITHDRAW_USD_LIMIT = 'approved';
  const usdPerUnit = Number(coin.price_usd || 0);
  const notional = usdPerUnit * amount;
  // ★★★★★★★ Boss's minimum-withdrawal rule (2026-08-26): $50 USD equivalent,
  //   valued at the coin's live price. Below $50 is hard-blocked server-side.
  const MIN_WITHDRAW_USD = 50;
  if (usdPerUnit > 0 && notional < MIN_WITHDRAW_USD) {
    return c.json({
      error: `Minimum withdrawal is $${MIN_WITHDRAW_USD} (valued at the current live price).`,
      code: 'BELOW_MIN_WITHDRAWAL',
      min_usd: MIN_WITHDRAW_USD,
      requested_usd: Math.round(notional * 100) / 100,
    }, 400);
  }
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
    'SELECT id, available, COALESCE(available_initial, 0) AS available_initial FROM wallets WHERE user_id = ? AND coin_symbol = ?'
  ).bind(user.id, coin_symbol).first<any>();
  if (!wallet || wallet.available < amount) return c.json({ error: 'Insufficient balance' }, 400);

  // ★★★★★★★ Boss's permanent rule (2026-06-22):
  // Company-issued amounts (welcome bonus, referral rewards, daily rewards,
  // admin manual credit, etc.) are tracked in `available_initial` and MUST
  // NOT leave the exchange. Withdrawable = available - available_initial.
  // Internal trading still works against `available` (locked_initial only
  // matters at external withdrawal time).
  const initial = Number(wallet.available_initial || 0);
  const withdrawable = Math.max(0, Number(wallet.available || 0) - initial);
  if (amount > withdrawable) {
    return c.json({
      error: 'Insufficient withdrawable balance. Company-issued amounts (sign-up bonus, referral rewards, daily rewards) cannot be withdrawn externally — they can only be used for internal trading.',
      code: 'WITHDRAWAL_BLOCKED_COMPANY_ISSUED',
      available: Number(wallet.available || 0),
      available_initial: initial,
      withdrawable,
      requested: amount,
    }, 400);
  }

  // ★★★★★★★ Owner rule (2026-08-28, supersedes all previous fee logic):
  //   The withdrawal fee rate is decided SOLELY by the user's combined QX+QKEY
  //   holding inside the exchange (available+locked). Ladder:
  //     < 10k = 5.0% | >=10k = 4.5% | >=50k = 4.0% | >=100k = 3.5%
  //     | >=500k = 3.0% | >=1,000,000 = FREE (0%).
  //   All old tier-exemption / shareholder rules are IGNORED.
  const feeExemption = await getFeeExemption(c.env.DB, user.id);
  const fee = amount * feeExemption.withdrawFeeRate;
  const withdrawalId = uuid();
  const assetSymbol = String(coin_symbol).toUpperCase();

  // ── Live payout conversion. The user is debited `amount` of `coin_symbol`
  //    (net of the coin's own fee), but the payout is settled in `payoutCoin`
  //    at THIS moment's live prices:
  //        payout_amount = (amount - fee) * price(coin_symbol) / price(payoutCoin)
  //    If the payout coin == withdrawn coin, this is a no-op (ratio 1).
  const netCoin = amount - fee;
  let payoutPriceUsd = usdPerUnit;         // price of the coin being withdrawn
  let payoutFee = fee;
  if (payoutCoin !== assetSymbol) {
    const payoutRow = await c.env.DB.prepare(
      'SELECT price_usd FROM coins WHERE symbol = ?'
    ).bind(payoutCoin).first<any>();
    payoutPriceUsd = Number(payoutRow?.price_usd || 0) || (payoutCoin === 'USDT' ? 1 : 0);
    if (payoutPriceUsd <= 0) {
      return c.json({ error: `Payout coin ${payoutCoin} price unavailable` }, 400);
    }
  }
  // Value the user actually receives, denominated in payoutCoin.
  const payoutNet = payoutCoin === assetSymbol
    ? netCoin
    : (netCoin * usdPerUnit) / payoutPriceUsd;
  if (payoutCoin !== assetSymbol) {
    payoutFee = (fee * usdPerUnit) / payoutPriceUsd;
  }

  // Move to `locked` (NOT subtracted) so admin reject cleanly refunds without
  // a race window. Admin/cron approve will do the final deduction.
  //
  // Coin-family routing decides the destination queue:
  //   • Quantarium-native assets → `qta_withdrawals` (cron SPHINCS+ signer).
  //     The destination must be a 0x EVM address on the Quantarium chain.
  //   • Standard coins → legacy `withdrawals` table (admin approval).
  // ★ A1 fix: perform the balance lock as a single atomic conditional UPDATE.
  //   The WHERE guard folds BOTH invariants into the debit so two concurrent
  //   withdrawals can never both pass:
  //     • available >= amount                          (enough balance)
  //     • (available - available_initial) >= amount    (enough WITHDRAWABLE,
  //       i.e. does not dip into company-issued funds — boss's rule)
  //   Only when the lock actually happened (changes === 1) do we insert the
  //   pending withdrawal row. If it didn't, the wallet is untouched and we
  //   return without creating any queue entry.
  // Address format: QTA payout (Quantarium) and USDT-BEP20 payout both require
  // a 0x EVM-style address (0x + 40 hex). Enforce when the settlement coin is
  // one of these (either the withdrawn coin is Quantarium-native, or the user
  // chose a QTA/USDT payout that differs from the withdrawn coin).
  const needs0xAddr = routeQuantarium || payoutCoin === 'QTA'
    || (payoutCoin === 'USDT' && payoutCoin !== assetSymbol);
  if (needs0xAddr) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(address))) {
      return c.json({ error: 'Invalid destination address (expected 0x + 40 hex)' }, 400);
    }
  }
  const lockRes = await c.env.DB.prepare(
    'UPDATE wallets SET available = available - ?, locked = locked + ? ' +
    'WHERE id = ? AND available >= ? AND (available - COALESCE(available_initial, 0)) >= ?'
  ).bind(amount, amount, wallet.id, amount, amount).run();
  if (!lockRes.meta || lockRes.meta.changes === 0) {
    // Balance moved by a concurrent request in the meantime, or would dip into
    // company-issued funds. Re-read to return an accurate error.
    const fresh = await c.env.DB.prepare(
      'SELECT available, COALESCE(available_initial, 0) AS available_initial FROM wallets WHERE id = ?'
    ).bind(wallet.id).first<any>();
    const av = Number(fresh?.available || 0);
    const init = Number(fresh?.available_initial || 0);
    const wd = Math.max(0, av - init);
    if (amount > wd && amount <= av) {
      return c.json({
        error: 'Insufficient withdrawable balance. Company-issued amounts (sign-up bonus, referral rewards, daily rewards) cannot be withdrawn externally — they can only be used for internal trading.',
        code: 'WITHDRAWAL_BLOCKED_COMPANY_ISSUED',
        available: av, available_initial: init, withdrawable: wd, requested: amount,
      }, 400);
    }
    return c.json({ error: 'Insufficient balance' }, 400);
  }

  // Settlement queue is chosen by the PAYOUT coin (what the user receives):
  //   • QTA payout  → qta_withdrawals (cron SPHINCS+ signer), 0x address
  //   • USDT payout → withdrawals table (admin approval), BEP-20 network
  //   • payout == withdrawn coin → original routing (routeQuantarium)
  const settleAsQta = payoutCoin === 'QTA' || (payoutCoin === assetSymbol && routeQuantarium);
  if (settleAsQta) {
    await c.env.DB.prepare(
      `INSERT INTO qta_withdrawals (id, user_id, to_address, amount, fee, asset, status, network)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 'qta-mainnet')`
    ).bind(withdrawalId, user.id, String(address), String(payoutNet), String(payoutFee), payoutCoin).run();
  } else {
    // USDT (or same-coin standard) payout → legacy withdrawals table.
    const settleCoin = payoutCoin === assetSymbol ? coin_symbol : payoutCoin;
    const settleNetwork = payoutCoin === assetSymbol ? (network || null) : 'bep20';
    await c.env.DB.prepare(
      `INSERT INTO withdrawals (id, user_id, coin_symbol, amount, fee, address, network, memo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).bind(withdrawalId, user.id, settleCoin, payoutNet, payoutFee, address, settleNetwork, memo || null).run();
  }

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
  // Merge two deposit sources into one history feed:
  //   (1) `deposits`     — internal / legacy deposit rows
  //   (2) `ext_deposits` — real on-chain external deposits (BEP-20 sweep model).
  // ext_deposits stores `amount` as a decimal string and uses its own status
  // vocabulary (detected|confirming|credited|swept|...), so we CAST the amount
  // to REAL and normalize the status to the labels the UI already understands
  // (completed | pending) so the Detail history shows the on-chain deposit.
  let extResults: any[] = [];
  try {
    const ext = await c.env.DB.prepare(
      `SELECT
         id,
         coin_symbol,
         CAST(amount AS REAL)         AS amount,
         tx_hash,
         network,
         address,
         CASE
           WHEN status IN ('credited','swept') THEN 'completed'
           WHEN status IN ('detected','confirming') THEN 'pending'
           ELSE status
         END                          AS status,
         confirmations,
         required_confs,
         created_at,
         'external'                   AS source
       FROM ext_deposits
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`
    ).bind(user.id).all();
    extResults = ext.results || [];
  } catch {
    // ext_deposits may not exist on older DBs; fail soft.
    extResults = [];
  }

  const { results: baseResults } = await c.env.DB.prepare(
    "SELECT *, 'internal' AS source FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
  ).bind(user.id).all();

  const merged = [...(baseResults || []), ...extResults].sort((a: any, b: any) => {
    const ta = String(a.created_at || '');
    const tb = String(b.created_at || '');
    return tb.localeCompare(ta);
  }).slice(0, 50);

  return c.json(merged);
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
