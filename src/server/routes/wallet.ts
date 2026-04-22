import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const app = new Hono<AppEnv>();

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
// Real user deposits must come from on-chain confirmations (or admin credit
// for KRW bank rails).  Until the chain watcher is implemented, ordinary
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

// Withdraw
app.post('/withdraw', authMiddleware, async (c) => {
  const user = c.get('user');
  const { coin_symbol, amount, address } = await c.req.json();
  if (!coin_symbol || !amount || !address || amount <= 0) return c.json({ error: 'Invalid request' }, 400);

  const wallet = await c.env.DB.prepare('SELECT * FROM wallets WHERE user_id = ? AND coin_symbol = ?').bind(user.id, coin_symbol).first() as any;
  if (!wallet || wallet.available < amount) return c.json({ error: 'Insufficient balance' }, 400);

  const fee = amount * 0.001;
  await c.env.DB.prepare('UPDATE wallets SET available = available - ? WHERE id = ?').bind(amount, wallet.id).run();

  const withdrawalId = uuid();
  await c.env.DB.prepare("INSERT INTO withdrawals (id, user_id, coin_symbol, amount, fee, address, status) VALUES (?,?,?,?,?,?,'pending')")
    .bind(withdrawalId, user.id, coin_symbol, amount - fee, fee, address).run();

  return c.json({ message: 'Withdrawal submitted', withdrawal_id: withdrawalId });
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
