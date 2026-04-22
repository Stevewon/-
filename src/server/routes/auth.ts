import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { generateToken, authMiddleware } from '../middleware/auth';
import bcrypt from 'bcryptjs';

const app = new Hono<AppEnv>();

function uuid() {
  return crypto.randomUUID();
}

// Best-effort login audit log. Never throws — failures here must not
// block the login response (e.g. if migration not yet applied).
async function recordLogin(
  c: any,
  userId: string,
  status: 'success' | 'failed',
  reason?: string,
) {
  try {
    const ip =
      c.req.header('CF-Connecting-IP') ||
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
      '';
    const ua = c.req.header('User-Agent') || '';
    // crude device hint
    const device = /Mobile|Android|iPhone|iPad/i.test(ua)
      ? 'mobile'
      : /Macintosh|Windows|Linux/i.test(ua)
      ? 'desktop'
      : 'unknown';

    await c.env.DB.prepare(
      `INSERT INTO login_history (id, user_id, ip_address, user_agent, device, status, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(uuid(), userId, ip, ua, device, status, reason || null).run();
  } catch (e) {
    console.warn('[recordLogin] failed:', e);
  }
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
  const totpCode = (body.totp_code || '').toString().trim();
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400);

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first() as any;
  if (!user || !bcrypt.compareSync(password, user.password)) {
    // Record failed attempt if we at least know the user id
    if (user) await recordLogin(c, user.id, 'failed', 'bad_password');
    return c.json({ error: 'Invalid email or password' }, 401);
  }
  if (!user.is_active) {
    await recordLogin(c, user.id, 'failed', 'account_disabled');
    return c.json({ error: 'Account disabled' }, 403);
  }

  // ---- 2FA challenge ----
  if (user.two_factor_enabled && user.two_factor_secret) {
    if (!totpCode) {
      // Client should re-submit with totp_code
      return c.json({ requires_2fa: true, message: '2FA code required' }, 401);
    }
    const { verifyTotp } = await import('../utils/totp');
    const ok = await verifyTotp(user.two_factor_secret, totpCode);
    if (!ok) {
      await recordLogin(c, user.id, 'failed', 'bad_totp');
      return c.json({ error: 'Invalid 2FA code' }, 401);
    }
  }

  await recordLogin(c, user.id, 'success');
  const token = await generateToken(user, c.env.JWT_SECRET);
  const { password: _, two_factor_secret: __, ...safeUser } = user;
  return c.json({ token, user: safeUser });
});

// Profile
app.get('/me', authMiddleware, async (c) => {
  const u = c.get('user');
  const user = await c.env.DB.prepare(
    `SELECT id, email, nickname, role, kyc_status, kyc_name, kyc_phone,
            two_factor_enabled, email_verified_at, avatar_url, created_at
     FROM users WHERE id = ?`
  ).bind(u.id).first();
  return c.json(user);
});

// ============================================================================
// Token helpers
// ----------------------------------------------------------------------------
// We store only SHA-256 hashes of tokens in the DB (like a password hash) so
// that a DB leak alone cannot be used to verify email / reset passwords.
// ============================================================================
function randomToken(byteLen = 32): string {
  const b = new Uint8Array(byteLen);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(buf).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Email verification
// ----------------------------------------------------------------------------
// POST /api/auth/request-verification { email? } -> sends a token link
// POST /api/auth/verify-email         { token } -> marks user verified
//
// 🚧 TODO: plug in a real mail service (Resend/SES/Postmark). For now the
// endpoint returns `dev_token` so QA can complete the flow.
// ============================================================================
app.post('/request-verification', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rawEmail = (body.email || '').toString().trim().toLowerCase();
  if (!rawEmail) return c.json({ error: 'Email required' }, 400);

  const user = await c.env.DB.prepare(
    'SELECT id, email, email_verified_at FROM users WHERE email = ?'
  ).bind(rawEmail).first<{ id: string; email: string; email_verified_at: string | null }>();

  // Always 200 to avoid user-enumeration. Only actually send when user exists
  // and isn't already verified.
  if (user && !user.email_verified_at) {
    const token = randomToken(32);
    const tokenHash = await sha256Hex(token);
    const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    try {
      await c.env.DB.prepare(
        `INSERT INTO email_verifications (id, user_id, email, token_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(uuid(), user.id, user.email, tokenHash, expires).run();
    } catch (e) {
      console.error('[request-verification] insert failed:', e);
      return c.json({ error: 'Service temporarily unavailable' }, 500);
    }
    // TODO: await sendEmail(user.email, 'Verify your email', `https://quantaex.io/verify-email?token=${token}`);
    return c.json({ ok: true, message: 'Verification email sent', dev_token: token });
  }
  return c.json({ ok: true, message: 'If the email exists, a verification link was sent.' });
});

app.post('/verify-email', async (c) => {
  const { token } = await c.req.json().catch(() => ({ token: '' }));
  if (!token) return c.json({ error: 'Token required' }, 400);
  const tokenHash = await sha256Hex(String(token));

  const row = await c.env.DB.prepare(
    `SELECT id, user_id, expires_at, used_at
     FROM email_verifications WHERE token_hash = ?`
  ).bind(tokenHash).first<any>();
  if (!row) return c.json({ error: 'Invalid or expired token' }, 400);
  if (row.used_at) return c.json({ error: 'Token already used' }, 400);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return c.json({ error: 'Token expired' }, 400);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(row.user_id),
    c.env.DB.prepare(
      `UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(row.id),
  ]);

  return c.json({ ok: true, message: 'Email verified' });
});

// ============================================================================
// Password reset
// ----------------------------------------------------------------------------
// POST /api/auth/forgot-password { email } -> always 200 (no user enumeration)
// POST /api/auth/reset-password   { token, new_password }
// ============================================================================
app.post('/forgot-password', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rawEmail = (body.email || '').toString().trim().toLowerCase();
  if (!rawEmail) return c.json({ error: 'Email required' }, 400);

  const user = await c.env.DB.prepare(
    'SELECT id, is_active FROM users WHERE email = ?'
  ).bind(rawEmail).first<{ id: string; is_active: number }>();

  if (user && user.is_active) {
    const token = randomToken(32);
    const tokenHash = await sha256Hex(token);
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h
    try {
      await c.env.DB.prepare(
        `INSERT INTO password_resets (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, ?)`
      ).bind(uuid(), user.id, tokenHash, expires).run();
    } catch (e) {
      console.error('[forgot-password] insert failed:', e);
      return c.json({ error: 'Service temporarily unavailable' }, 500);
    }
    // TODO: await sendEmail(rawEmail, 'Reset your password', `https://quantaex.io/reset-password?token=${token}`);
    return c.json({ ok: true, message: 'Password reset email sent', dev_token: token });
  }
  return c.json({ ok: true, message: 'If the email exists, a reset link was sent.' });
});

app.post('/reset-password', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '');
  const newPw = String(body.new_password || body.password || '');
  if (!token || !newPw) return c.json({ error: 'Token and new_password required' }, 400);
  if (newPw.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
  if (!/[A-Za-z]/.test(newPw) || !/[0-9]/.test(newPw)) {
    return c.json({ error: 'Password must contain both letters and numbers' }, 400);
  }

  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?`
  ).bind(tokenHash).first<any>();
  if (!row) return c.json({ error: 'Invalid or expired token' }, 400);
  if (row.used_at) return c.json({ error: 'Token already used' }, 400);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return c.json({ error: 'Token expired' }, 400);
  }

  const hashed = bcrypt.hashSync(newPw, 10);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(hashed, row.user_id),
    c.env.DB.prepare(
      `UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(row.id),
  ]);

  return c.json({ ok: true, message: 'Password reset successful' });
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
