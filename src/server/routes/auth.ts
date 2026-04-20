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
  const { email, password, nickname } = await c.req.json();
  if (!email || !password || !nickname) return c.json({ error: 'All fields required' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Email already registered' }, 400);

  const existingNick = await c.env.DB.prepare('SELECT id FROM users WHERE nickname = ?').bind(nickname).first();
  if (existingNick) return c.json({ error: 'Nickname already taken' }, 400);

  const id = uuid();
  const hashedPw = bcrypt.hashSync(password, 10);

  await c.env.DB.prepare('INSERT INTO users (id, email, password, nickname) VALUES (?,?,?,?)')
    .bind(id, email, hashedPw, nickname).run();

  // Default wallets with bonus
  const defaults = [
    { symbol: 'USDT', amount: 10000 },
    { symbol: 'KRW', amount: 10000000 },
    { symbol: 'BTC', amount: 0.1 },
    { symbol: 'ETH', amount: 2 },
    { symbol: 'QTA', amount: 100000 },
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
  const { email, password } = await c.req.json();
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first() as any;
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return c.json({ error: 'Invalid credentials' }, 401);
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
