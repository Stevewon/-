import { Router } from 'express';
import db from '../database.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware, adminMiddleware);

// Dashboard stats
router.get('/stats', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const orders = db.prepare('SELECT COUNT(*) as count FROM orders').get();
  const trades = db.prepare('SELECT COUNT(*) as count FROM trades').get();
  const pendingKyc = db.prepare("SELECT COUNT(*) as count FROM users WHERE kyc_status = 'pending'").get();
  const pendingWithdrawals = db.prepare("SELECT COUNT(*) as count FROM withdrawals WHERE status = 'pending'").get();
  const totalVolume = db.prepare('SELECT SUM(total) as total FROM trades').get();

  res.json({
    users: users.count,
    orders: orders.count,
    trades: trades.count,
    pendingKyc: pendingKyc.count,
    pendingWithdrawals: pendingWithdrawals.count,
    totalVolume: totalVolume.total || 0,
  });
});

// User list
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, email, nickname, role, kyc_status, is_active, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

// KYC management
router.get('/kyc/pending', (req, res) => {
  const users = db.prepare("SELECT id, email, nickname, kyc_status, kyc_name, kyc_phone, kyc_id_number, created_at FROM users WHERE kyc_status = 'pending'").all();
  res.json(users);
});

router.post('/kyc/:userId/approve', (req, res) => {
  db.prepare("UPDATE users SET kyc_status = 'approved' WHERE id = ?").run(req.params.userId);
  res.json({ message: 'KYC approved' });
});

router.post('/kyc/:userId/reject', (req, res) => {
  db.prepare("UPDATE users SET kyc_status = 'rejected' WHERE id = ?").run(req.params.userId);
  res.json({ message: 'KYC rejected' });
});

// Withdrawal management
router.get('/withdrawals', (req, res) => {
  const withdrawals = db.prepare(`
    SELECT w.*, u.email, u.nickname FROM withdrawals w
    JOIN users u ON u.id = w.user_id
    ORDER BY w.created_at DESC
  `).all();
  res.json(withdrawals);
});

router.post('/withdrawals/:id/approve', (req, res) => {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE withdrawals SET status = 'completed', tx_hash = ? WHERE id = ?")
    .run(`0x${Date.now().toString(16)}`, w.id);
  res.json({ message: 'Withdrawal approved' });
});

router.post('/withdrawals/:id/reject', (req, res) => {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });

  // Refund
  db.prepare('UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = ?')
    .run(w.amount + w.fee, w.user_id, w.coin_symbol);
  db.prepare("UPDATE withdrawals SET status = 'rejected' WHERE id = ?").run(w.id);
  res.json({ message: 'Withdrawal rejected and refunded' });
});

// Coin management
router.get('/coins', (req, res) => {
  const coins = db.prepare('SELECT * FROM coins ORDER BY sort_order').all();
  res.json(coins);
});

router.put('/coins/:symbol', (req, res) => {
  const { price_usd, is_active } = req.body;
  if (price_usd !== undefined) {
    db.prepare('UPDATE coins SET price_usd = ? WHERE symbol = ?').run(price_usd, req.params.symbol);
  }
  if (is_active !== undefined) {
    db.prepare('UPDATE coins SET is_active = ? WHERE symbol = ?').run(is_active ? 1 : 0, req.params.symbol);
  }
  res.json({ message: 'Coin updated' });
});

export default router;
