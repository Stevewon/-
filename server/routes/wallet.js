import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Get all wallets
router.get('/', authMiddleware, (req, res) => {
  const wallets = db.prepare(`
    SELECT w.*, c.name as coin_name, c.price_usd, c.icon, c.change_24h
    FROM wallets w JOIN coins c ON c.symbol = w.coin_symbol
    WHERE w.user_id = ?
    ORDER BY (w.available + w.locked) * c.price_usd DESC
  `).all(req.user.id);

  // Add coins that user doesn't have wallet for
  const existingSymbols = wallets.map(w => w.coin_symbol);
  const otherCoins = db.prepare('SELECT * FROM coins WHERE symbol NOT IN (' + existingSymbols.map(() => '?').join(',') + ') AND is_active = 1')
    .all(...existingSymbols);

  otherCoins.forEach(c => {
    wallets.push({
      id: null, user_id: req.user.id, coin_symbol: c.symbol,
      available: 0, locked: 0, coin_name: c.name, price_usd: c.price_usd,
      icon: c.icon, change_24h: c.change_24h,
    });
  });

  res.json(wallets);
});

// Get single wallet
router.get('/:symbol', authMiddleware, (req, res) => {
  let wallet = db.prepare(`
    SELECT w.*, c.name as coin_name, c.price_usd, c.icon
    FROM wallets w JOIN coins c ON c.symbol = w.coin_symbol
    WHERE w.user_id = ? AND w.coin_symbol = ?
  `).get(req.user.id, req.params.symbol);

  if (!wallet) {
    const coin = db.prepare('SELECT * FROM coins WHERE symbol = ?').get(req.params.symbol);
    if (!coin) return res.status(404).json({ error: 'Coin not found' });
    wallet = { available: 0, locked: 0, coin_symbol: coin.symbol, coin_name: coin.name, price_usd: coin.price_usd };
  }

  res.json(wallet);
});

// Deposit (simulated)
router.post('/deposit', authMiddleware, (req, res) => {
  try {
    const { coin_symbol, amount } = req.body;
    if (!coin_symbol || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid request' });

    const coin = db.prepare('SELECT * FROM coins WHERE symbol = ?').get(coin_symbol);
    if (!coin) return res.status(404).json({ error: 'Coin not found' });

    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND coin_symbol = ?').get(req.user.id, coin_symbol);
    if (wallet) {
      db.prepare('UPDATE wallets SET available = available + ? WHERE id = ?').run(amount, wallet.id);
    } else {
      db.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available) VALUES (?,?,?,?)').run(uuidv4(), req.user.id, coin_symbol, amount);
    }

    const depositId = uuidv4();
    db.prepare('INSERT INTO deposits (id, user_id, coin_symbol, amount, status, tx_hash) VALUES (?,?,?,?,?,?)')
      .run(depositId, req.user.id, coin_symbol, amount, 'completed', `0x${uuidv4().replace(/-/g, '')}`);

    res.json({ message: 'Deposit successful', deposit_id: depositId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Withdraw
router.post('/withdraw', authMiddleware, (req, res) => {
  try {
    const { coin_symbol, amount, address } = req.body;
    if (!coin_symbol || !amount || !address || amount <= 0) return res.status(400).json({ error: 'Invalid request' });

    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND coin_symbol = ?').get(req.user.id, coin_symbol);
    if (!wallet || wallet.available < amount) return res.status(400).json({ error: 'Insufficient balance' });

    const fee = amount * 0.001;
    db.prepare('UPDATE wallets SET available = available - ? WHERE id = ?').run(amount, wallet.id);

    const withdrawId = uuidv4();
    db.prepare('INSERT INTO withdrawals (id, user_id, coin_symbol, amount, fee, address, status) VALUES (?,?,?,?,?,?,?)')
      .run(withdrawId, req.user.id, coin_symbol, amount - fee, fee, address, 'pending');

    res.json({ message: 'Withdrawal submitted', withdrawal_id: withdrawId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Transaction history
router.get('/history/:symbol', authMiddleware, (req, res) => {
  const deposits = db.prepare('SELECT *, "deposit" as type FROM deposits WHERE user_id = ? AND coin_symbol = ? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.id, req.params.symbol);
  const withdrawals = db.prepare('SELECT *, "withdrawal" as type FROM withdrawals WHERE user_id = ? AND coin_symbol = ? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.id, req.params.symbol);

  const history = [...deposits, ...withdrawals].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(history);
});

export default router;
