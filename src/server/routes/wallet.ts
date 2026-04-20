import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware } from '../middleware/auth';

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

// Deposit (simulated)
app.post('/deposit', authMiddleware, async (c) => {
  const user = c.get('user');
  const { coin_symbol, amount } = await c.req.json();
  if (!coin_symbol || !amount || amount <= 0) return c.json({ error: 'Invalid request' }, 400);

  const coin = await c.env.DB.prepare('SELECT * FROM coins WHERE symbol = ?').bind(coin_symbol).first();
  if (!coin) return c.json({ error: 'Coin not found' }, 404);

  const wallet = await c.env.DB.prepare('SELECT * FROM wallets WHERE user_id = ? AND coin_symbol = ?').bind(user.id, coin_symbol).first() as any;
  if (wallet) {
    await c.env.DB.prepare('UPDATE wallets SET available = available + ? WHERE id = ?').bind(amount, wallet.id).run();
  } else {
    await c.env.DB.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available) VALUES (?,?,?,?)').bind(uuid(), user.id, coin_symbol, amount).run();
  }

  const depositId = uuid();
  const txHash = `0x${depositId.replace(/-/g, '')}`;
  await c.env.DB.prepare("INSERT INTO deposits (id, user_id, coin_symbol, amount, status, tx_hash) VALUES (?,?,?,?,'completed',?)")
    .bind(depositId, user.id, coin_symbol, amount, txHash).run();

  return c.json({ message: 'Deposit successful', deposit_id: depositId });
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
