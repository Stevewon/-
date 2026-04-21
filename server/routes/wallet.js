import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { createNotification } from '../services/notifications.js';

const router = Router();

// Withdrawal fee config per coin (fallback 0.1%)
const WITHDRAW_FEES = {
  BTC: { default: 0.0002, BTC: 0.0002 },
  ETH: { default: 0.004, ERC20: 0.004, ARBITRUM: 0.0002 },
  USDT: { default: 1, TRC20: 1, ERC20: 8, BEP20: 0.5 },
  BNB: { default: 0.0005, BEP20: 0.0005 },
  SOL: { default: 0.01, SOL: 0.01 },
  XRP: { default: 0.25, XRP: 0.25 },
  ADA: { default: 1, ADA: 1 },
  DOGE: { default: 5, DOGE: 5 },
  DOT: { default: 0.1, DOT: 0.1 },
  AVAX: { default: 0.01, AVAXC: 0.01 },
  MATIC: { default: 0.1, POLYGON: 0.1 },
  QTA: { default: 1, ERC20: 1 },
  KRW: { default: 1000, BANK: 1000 },
};

function getFee(coin, network) {
  const cfg = WITHDRAW_FEES[coin];
  if (!cfg) return 0.001; // 0.1%
  return cfg[network] ?? cfg.default ?? 0.001;
}

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
  let otherCoins = [];
  if (existingSymbols.length > 0) {
    otherCoins = db.prepare('SELECT * FROM coins WHERE symbol NOT IN (' + existingSymbols.map(() => '?').join(',') + ') AND is_active = 1')
      .all(...existingSymbols);
  } else {
    otherCoins = db.prepare('SELECT * FROM coins WHERE is_active = 1').all();
  }

  otherCoins.forEach(c => {
    wallets.push({
      id: null, user_id: req.user.id, coin_symbol: c.symbol,
      available: 0, locked: 0, coin_name: c.name, price_usd: c.price_usd,
      icon: c.icon, change_24h: c.change_24h,
    });
  });

  res.json(wallets);
});

// Get deposit history (must be BEFORE /:symbol routes)
router.get('/history/deposits', authMiddleware, (req, res) => {
  const deposits = db.prepare('SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(req.user.id);
  res.json(deposits);
});

// Get withdrawal history
router.get('/history/withdrawals', authMiddleware, (req, res) => {
  const withdrawals = db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(req.user.id);
  res.json(withdrawals);
});

// Deposit (simulated)
router.post('/deposit', authMiddleware, (req, res) => {
  try {
    const { coin_symbol, amount, network, from_address } = req.body;
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
    const txHash = `0x${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    db.prepare(`INSERT INTO deposits (id, user_id, coin_symbol, amount, status, tx_hash, network, from_address)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(depositId, req.user.id, coin_symbol, amount, 'completed', txHash, network || null, from_address || null);

    // Notification
    createNotification(req.user.id, {
      type: 'deposit',
      title: 'Deposit Completed',
      message: `+${amount} ${coin_symbol} credited to your wallet`,
      data: { coin: coin_symbol, amount, tx: txHash },
    });

    res.json({ message: 'Deposit successful', deposit_id: depositId, tx_hash: txHash });
  } catch (e) {
    console.error('[deposit] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Withdraw
router.post('/withdraw', authMiddleware, (req, res) => {
  try {
    const { coin_symbol, amount, address, network, memo } = req.body;
    if (!coin_symbol || !amount || !address || amount <= 0) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND coin_symbol = ?').get(req.user.id, coin_symbol);
    if (!wallet || wallet.available < amount) return res.status(400).json({ error: 'Insufficient balance' });

    const fee = getFee(coin_symbol, network || 'default');
    if (amount <= fee) return res.status(400).json({ error: 'Amount must exceed network fee' });

    // Deduct from available (full amount)
    db.prepare('UPDATE wallets SET available = available - ? WHERE id = ?').run(amount, wallet.id);

    const withdrawId = uuidv4();
    const receiveAmount = amount - fee;
    db.prepare(`INSERT INTO withdrawals (id, user_id, coin_symbol, amount, fee, address, status, network, memo)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(withdrawId, req.user.id, coin_symbol, receiveAmount, fee, address, 'pending', network || null, memo || null);

    createNotification(req.user.id, {
      type: 'withdraw',
      title: 'Withdrawal Submitted',
      message: `-${amount} ${coin_symbol} withdrawal request is pending approval`,
      data: { coin: coin_symbol, amount, address, network },
    });

    res.json({
      message: 'Withdrawal submitted',
      withdrawal_id: withdrawId,
      fee,
      receive_amount: receiveAmount,
    });
  } catch (e) {
    console.error('[withdraw] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get single wallet (place AFTER specific routes)
router.get('/:symbol', authMiddleware, (req, res) => {
  // Reject reserved paths
  if (['history', 'deposit', 'withdraw'].includes(req.params.symbol)) {
    return res.status(404).json({ error: 'Not found' });
  }

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

export default router;
