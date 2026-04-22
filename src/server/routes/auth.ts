import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { generateToken, authMiddleware } from '../middleware/auth';
import bcrypt from 'bcryptjs';

const app = new Hono<AppEnv>();

function uuid() {
  return crypto.randomUUID();
}

// Register
app.post('/register', async (c) => {
  const body = await c.req.json();
  const email = (body.email || '').toString().trim().toLowerCase();
  const password = (body.password || '').toString();
  const nickname = (body.nickname || '').toString().trim();
  const refCode = body.ref_code ? String(body.ref_code).trim().toUpperCase() : null;
  // agree_marketing accepted for future use; currently logged only.
  // const agreeMarketing = !!body.agree_marketing;

  // ---- Validation (matches frontend rules) ----
  if (!email || !password || !nickname) return c.json({ error: 'All fields required' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Invalid email format' }, 400);
  if (nickname.length < 2 || nickname.length > 20) return c.json({ error: 'Nickname must be 2-20 characters' }, 400);
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return c.json({ error: 'Password must contain both letters and numbers' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Email already registered' }, 400);

  const existingNick = await c.env.DB.prepare('SELECT id FROM users WHERE nickname = ?').bind(nickname).first();
  if (existingNick) return c.json({ error: 'Nickname already taken' }, 400);

  const id = uuid();
  const hashedPw = bcrypt.hashSync(password, 10);

  await c.env.DB.prepare('INSERT INTO users (id, email, password, nickname) VALUES (?,?,?,?)')
    .bind(id, email, hashedPw, nickname).run();

  // Referral code: record for future reward system (silent if column not present)
  if (refCode) {
    try {
      await c.env.DB.prepare(
        "INSERT INTO user_meta (user_id, key, value) VALUES (?, 'ref_code', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
      ).bind(id, refCode).run();
    } catch { /* table may not exist yet; ignore */ }
  }

  // Default wallets with bonus (1,000 QTA only)
  const defaults = [
    { symbol: 'USDT', amount: 0 },
    { symbol: 'KRW', amount: 0 },
    { symbol: 'BTC', amount: 0 },
    { symbol: 'ETH', amount: 0 },
    { symbol: 'QTA', amount: 1000 },
  ];

  const batch = defaults.map(d =>
    c.env.DB.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available) VALUES (?,?,?,?)')
      .bind(uuid(), id, d.symbol, d.amount)
  );
  await c.env.DB.batch(batch);

  const user = { id, email, nickname, role: 'user', kyc_status: 'none' };
  const token = await generateToken(user, c.env.JWT_SECRET);
  return c.json({ token, user });
});

// Login
app.post('/login', async (c) => {
  const body = await c.req.json();
  const email = (body.email || '').toString().trim().toLowerCase();
  const password = (body.password || '').toString();
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400);

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first() as any;
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }
  if (!user.is_active) return c.json({ error: 'Account disabled' }, 403);

  const token = await generateToken(user, c.env.JWT_SECRET);
  const { password: _, ...safeUser } = user;
  return c.json({ token, user: safeUser });
});

// Profile
app.get('/me', authMiddleware, async (c) => {
  const u = c.get('user');
  const user = await c.env.DB.prepare(
    'SELECT id, email, nickname, role, kyc_status, kyc_name, kyc_phone, created_at FROM users WHERE id = ?'
  ).bind(u.id).first();
  return c.json(user);
});

// KYC
app.post('/kyc', authMiddleware, async (c) => {
  const u = c.get('user');
  const { name, phone, id_number } = await c.req.json();
  await c.env.DB.prepare('UPDATE users SET kyc_status = ?, kyc_name = ?, kyc_phone = ?, kyc_id_number = ? WHERE id = ?')
    .bind('pending', name, phone, id_number, u.id).run();
  return c.json({ message: 'KYC submitted' });
});

export default app;
