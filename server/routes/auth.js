import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';

const router = Router();

// Register
router.post('/register', (req, res) => {
  try {
    const { email, password, nickname } = req.body;
    if (!email || !password || !nickname) return res.status(400).json({ error: 'All fields required' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const existingNick = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname);
    if (existingNick) return res.status(400).json({ error: 'Nickname already taken' });

    const id = uuidv4();
    const hashedPw = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id, email, password, nickname) VALUES (?,?,?,?)').run(id, email, hashedPw, nickname);

    // Create default wallets with bonus
    const defaultCoins = [
      { symbol: 'USDT', amount: 10000 },
      { symbol: 'KRW', amount: 10000000 },
      { symbol: 'BTC', amount: 0.1 },
      { symbol: 'ETH', amount: 2 },
      { symbol: 'QTA', amount: 100000 },
    ];
    defaultCoins.forEach(c => {
      db.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available) VALUES (?,?,?,?)').run(uuidv4(), id, c.symbol, c.amount);
    });

    const user = db.prepare('SELECT id, email, nickname, role, kyc_status FROM users WHERE id = ?').get(id);
    const token = generateToken(user);

    res.json({ token, user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helpers for login history
function parseDevice(ua = '') {
  if (!ua) return 'Unknown';
  const s = ua.toLowerCase();
  if (s.includes('iphone')) return 'iPhone';
  if (s.includes('ipad')) return 'iPad';
  if (s.includes('android')) return 'Android';
  if (s.includes('mac os') || s.includes('macintosh')) return 'Mac';
  if (s.includes('windows')) return 'Windows';
  if (s.includes('linux')) return 'Linux';
  return 'Browser';
}
function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || null;
}
function recordLogin(userId, req, status, reason = null) {
  try {
    const ua = req.headers['user-agent'] || '';
    db.prepare(`
      INSERT INTO login_history (id, user_id, ip_address, user_agent, device, status, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), userId, getClientIp(req), ua.slice(0, 500), parseDevice(ua), status, reason);
  } catch (e) { /* ignore logging errors */ }
}

// Login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      if (user) recordLogin(user.id, req, 'failed', 'Invalid credentials');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.is_active) {
      recordLogin(user.id, req, 'failed', 'Account disabled');
      return res.status(403).json({ error: 'Account disabled' });
    }

    const token = generateToken(user);
    const { password: _, two_factor_secret: __, ...safeUser } = user;
    recordLogin(user.id, req, 'success');
    res.json({ token, user: safeUser });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get profile
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, email, nickname, role, kyc_status, kyc_name, kyc_phone, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// KYC submit
router.post('/kyc', authMiddleware, (req, res) => {
  const { name, phone, id_number } = req.body;
  db.prepare('UPDATE users SET kyc_status = ?, kyc_name = ?, kyc_phone = ?, kyc_id_number = ? WHERE id = ?')
    .run('pending', name, phone, id_number, req.user.id);
  res.json({ message: 'KYC submitted' });
});

export default router;
