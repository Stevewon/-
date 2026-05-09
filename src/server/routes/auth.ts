import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { generateToken, authMiddleware } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import {
  sendMail,
  templateBasic,
  tmplLoginAlert,
  fireAndForgetMail,
  metaFromReq,
} from '../utils/mailer';
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

// Rate limits
const rlRegister  = rateLimit({ key: 'auth:register',  max: 5,  windowSec: 3600 });   // 5/h per IP
const rlLogin     = rateLimit({ key: 'auth:login',     max: 10, windowSec: 300 });    // 10/5min per IP
const rlForgotPw  = rateLimit({ key: 'auth:forgot-pw', max: 5,  windowSec: 3600 });   // 5/h per IP
const rlReqVerify = rateLimit({ key: 'auth:req-verif', max: 5,  windowSec: 3600 });   // 5/h per IP

// ============================================================================
// Referral helpers
// ----------------------------------------------------------------------------
// REFERRAL_CODE_ALPHABET excludes ambiguous chars (0/O, 1/I/L) so the code
// is easy to share verbally. Codes are 8 chars long → ~26^8 = ~2*10^11
// keyspace; collisions are extremely unlikely but we still retry on conflict.
// REFERRER_REWARD_QTA: amount given to the existing user whose code is used.
// REFERRED_WELCOME_QTA: amount given to the NEW user (same as the regular
// signup bonus 1000; declared here to keep all referral knobs in one place).
// ============================================================================
const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const REFERRER_REWARD_QTA   = 500;
const REFERRED_WELCOME_QTA  = 1000;

function genReferralCode(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += REFERRAL_CODE_ALPHABET[buf[i] % REFERRAL_CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Allocate a fresh referral_code for a user. Retries up to 5 times if the
 * randomly chosen code happens to collide with an existing one. The DB has
 * a UNIQUE index on users.referral_code so we rely on the constraint to
 * keep us safe even under concurrency.
 */
async function allocateReferralCode(db: D1Database, userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genReferralCode();
    try {
      const r = await db.prepare(
        `UPDATE users SET referral_code = ?
         WHERE id = ? AND (referral_code IS NULL OR referral_code = '')`
      ).bind(code, userId).run();
      // SQLite/D1 sets meta.changes>0 if the row was actually written.
      if ((r as any).meta?.changes && (r as any).meta.changes > 0) return code;
      // Already had one — fetch it.
      const existing = await db.prepare(
        `SELECT referral_code FROM users WHERE id = ?`
      ).bind(userId).first<{ referral_code: string | null }>();
      if (existing?.referral_code) return existing.referral_code;
    } catch (e) {
      // UNIQUE collision — try again with a new random code.
      console.warn('[allocateReferralCode] collision, retrying:', e);
    }
  }
  throw new Error('Failed to allocate referral code after 5 attempts');
}

// Register
app.post('/register', rlRegister, async (c) => {
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

  // Validate referral code (if supplied) BEFORE creating the user so we can
  // return a clean 400 if the code is invalid. Self-referral is impossible
  // here because the user does not exist yet.
  let referrer: { id: string; email: string; nickname: string } | null = null;
  if (refCode) {
    referrer = await c.env.DB.prepare(
      `SELECT id, email, nickname FROM users WHERE referral_code = ?`
    ).bind(refCode).first<any>();
    if (!referrer) {
      return c.json({ error: 'Invalid referral code' }, 400);
    }
  }

  const id = uuid();
  const hashedPw = bcrypt.hashSync(password, 10);

  await c.env.DB.prepare('INSERT INTO users (id, email, password, nickname) VALUES (?,?,?,?)')
    .bind(id, email, hashedPw, nickname).run();

  // Allocate a unique referral code for the new user (so they can refer
  // others immediately).
  let myReferralCode = '';
  try {
    myReferralCode = await allocateReferralCode(c.env.DB, id);
  } catch (e) {
    console.warn('[register] referral code allocation failed:', e);
  }

  // Legacy: also keep the raw entered code in user_meta for analytics
  // (silent if table missing). The authoritative relationship is in
  // the `referrals` table below.
  if (refCode) {
    try {
      await c.env.DB.prepare(
        "INSERT INTO user_meta (user_id, key, value) VALUES (?, 'ref_code', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
      ).bind(id, refCode).run();
    } catch { /* table may not exist yet; ignore */ }
  }

  // Default wallets. QTA sign-up bonus (1,000) is credited to `locked`
  // so it cannot be traded or withdrawn until the user verifies their
  // email. This prevents multi-account abuse where throwaway addresses
  // farm the bonus. Unlock happens in POST /verify-email below.
  const defaults = [
    { symbol: 'USDT', available: 0, locked: 0 },
    { symbol: 'USDC', available: 0, locked: 0 },
    { symbol: 'BTC',  available: 0, locked: 0 },
    { symbol: 'ETH',  available: 0, locked: 0 },
    { symbol: 'QTA',  available: 0, locked: 1000 },
  ];

  const batch = defaults.map(d =>
    c.env.DB.prepare(
      'INSERT INTO wallets (id, user_id, coin_symbol, available, locked) VALUES (?,?,?,?,?)'
    ).bind(uuid(), id, d.symbol, d.available, d.locked),
  );
  await c.env.DB.batch(batch);

  // ──────────────────────────────────────────────────────────────────────────
  // Referrer reward: 500 QTA credited DIRECTLY to `available`.
  // ──────────────────────────────────────────────────────────────────────────
  // The referrer is presumed to be already verified (they have a code and
  // shared it). We credit 500 QTA available immediately, log the
  // relationship in `referrals` (UNIQUE referred_id prevents double-credit),
  // and best-effort notify them by email.
  let referrerCreditedQta = 0;
  if (referrer) {
    try {
      // Ensure referrer has a QTA wallet row (older accounts might not).
      const refWallet = await c.env.DB.prepare(
        `SELECT id, available FROM wallets WHERE user_id = ? AND coin_symbol = 'QTA'`
      ).bind(referrer.id).first<any>();

      if (refWallet) {
        await c.env.DB.batch([
          c.env.DB.prepare(
            `UPDATE wallets SET available = available + ? WHERE id = ?`
          ).bind(REFERRER_REWARD_QTA, refWallet.id),
          c.env.DB.prepare(
            `INSERT INTO referrals (id, referrer_id, referred_id, referral_code, reward_qta)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(uuid(), referrer.id, id, refCode, REFERRER_REWARD_QTA),
        ]);
      } else {
        // Create QTA wallet for legacy referrer with the bonus directly.
        await c.env.DB.batch([
          c.env.DB.prepare(
            `INSERT INTO wallets (id, user_id, coin_symbol, available, locked)
             VALUES (?, ?, 'QTA', ?, 0)`
          ).bind(uuid(), referrer.id, REFERRER_REWARD_QTA),
          c.env.DB.prepare(
            `INSERT INTO referrals (id, referrer_id, referred_id, referral_code, reward_qta)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(uuid(), referrer.id, id, refCode, REFERRER_REWARD_QTA),
        ]);
      }
      referrerCreditedQta = REFERRER_REWARD_QTA;

      // Best-effort notification (does not block signup).
      try {
        const ctx = c.executionCtx as any;
        const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
        const send = sendMail(c.env as any, {
          to: referrer.email,
          subject: `+${REFERRER_REWARD_QTA} QTA — your referral just signed up!`,
          html: templateBasic(
            'Referral reward',
            `Great news! ${nickname} just signed up using your referral code <b>${refCode}</b>. ` +
            `<b>${REFERRER_REWARD_QTA} QTA</b> has been credited to your wallet's available balance.`,
            { label: 'Open wallet', url: `${appUrl}/wallet` },
          ),
          text: `+${REFERRER_REWARD_QTA} QTA credited for referring ${nickname}. ${appUrl}/wallet`,
        });
        if (ctx?.waitUntil) ctx.waitUntil(send); else await send;
      } catch (e) {
        console.warn('[register] referrer alert mail failed:', e);
      }
    } catch (e) {
      // Never block signup if the bonus credit fails — the new user must
      // still be able to register. Log and continue.
      console.error('[register] referrer reward failed:', e);
    }
  }

  // Fire off a verification email in the background (non-blocking)
  try {
    const verifTok = randomToken(32);
    const verifHash = await sha256Hex(verifTok);
    const verifExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await c.env.DB.prepare(
      `INSERT INTO email_verifications (id, user_id, email, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(uuid(), id, email, verifHash, verifExpires).run();

    const ctx = c.executionCtx as any;
    const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
    const link = `${appUrl}/verify-email?token=${verifTok}`;
    const send = sendMail(c.env as any, {
      to: email,
      subject: 'Welcome to QuantaEX — verify your email',
      html: templateBasic(
        'Welcome to QuantaEX',
        `Thanks for joining! Please verify your email to unlock deposits, trading, and withdrawals. The link expires in 24 hours.`,
        { label: 'Verify email', url: link },
      ),
      text: `Verify: ${link}`,
    });
    if (ctx?.waitUntil) ctx.waitUntil(send); else await send;
  } catch (e) {
    console.warn('[register] sending verification email failed:', e);
  }

  const user = {
    id, email, nickname,
    role: 'user',
    kyc_status: 'none',
    token_version: 0,
    referral_code: myReferralCode,
  };
  const token = await generateToken(user, c.env.JWT_SECRET);
  return c.json({
    token,
    user,
    referral: {
      code: myReferralCode,
      referrer_credited_qta: referrerCreditedQta,
      welcome_qta_locked: REFERRED_WELCOME_QTA, // unlocks on email verify
    },
  });
});

// Login
app.post('/login', rlLogin, async (c) => {
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

  // S3-6: login-alert email (fire-and-forget, never blocks login).
  try {
    const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
    fireAndForgetMail(
      c.env as any,
      user.email,
      tmplLoginAlert(appUrl, metaFromReq(c.req)),
      c.executionCtx as any,
    );
  } catch (e) { console.warn('[login] alert mail failed:', e); }

  const token = await generateToken({ ...user, token_version: user.token_version || 0 }, c.env.JWT_SECRET);
  const { password: _, two_factor_secret: __, two_factor_pending_secret: ___, ...safeUser } = user;
  return c.json({ token, user: safeUser });
});

// Profile
app.get('/me', authMiddleware, async (c) => {
  const u = c.get('user');
  const user = await c.env.DB.prepare(
    `SELECT id, email, nickname, role, kyc_status, kyc_name, kyc_phone,
            two_factor_enabled, email_verified_at, avatar_url, created_at,
            referral_code
     FROM users WHERE id = ?`
  ).bind(u.id).first<any>();

  // Legacy users created before the referral migration won't have a code yet.
  // Allocate one lazily on first /me hit so every account has one.
  if (user && !user.referral_code) {
    try {
      user.referral_code = await allocateReferralCode(c.env.DB, user.id);
    } catch (e) {
      console.warn('[me] lazy referral_code allocation failed:', e);
    }
  }

  return c.json(user);
});

// ============================================================================
// Referral endpoints
// ----------------------------------------------------------------------------
// GET  /api/auth/referrals          — my code + list of users I referred
// GET  /api/auth/referrals/check/:code — public lookup (used by RegisterPage
//                                         to live-validate a code without
//                                         leaking who owns it)
// ============================================================================
app.get('/referrals', authMiddleware, async (c) => {
  const u = c.get('user');

  // Make sure the caller has a code (lazy-allocate for legacy accounts).
  let me = await c.env.DB.prepare(
    `SELECT id, referral_code FROM users WHERE id = ?`
  ).bind(u.id).first<{ id: string; referral_code: string | null }>();

  if (me && !me.referral_code) {
    try {
      const code = await allocateReferralCode(c.env.DB, me.id);
      me = { ...me, referral_code: code };
    } catch (e) {
      console.warn('[referrals] lazy code alloc failed:', e);
    }
  }

  // List users this person has referred so far + total QTA earned.
  let invited: any[] = [];
  let totalReward = 0;
  try {
    const r = await c.env.DB.prepare(
      `SELECT r.referred_id, r.reward_qta, r.created_at,
              u.nickname AS referred_nickname,
              u.email_verified_at
       FROM referrals r
       JOIN users u ON u.id = r.referred_id
       WHERE r.referrer_id = ?
       ORDER BY r.created_at DESC
       LIMIT 200`
    ).bind(u.id).all<any>();
    invited = r.results || [];
    totalReward = invited.reduce((sum: number, row: any) => sum + Number(row.reward_qta || 0), 0);
  } catch (e) {
    console.warn('[referrals] list query failed:', e);
  }

  // Was this user themselves referred by someone?
  let referredBy: { nickname: string; code: string } | null = null;
  try {
    const row = await c.env.DB.prepare(
      `SELECT r.referral_code, ru.nickname
       FROM referrals r
       JOIN users ru ON ru.id = r.referrer_id
       WHERE r.referred_id = ?`
    ).bind(u.id).first<any>();
    if (row) referredBy = { nickname: row.nickname, code: row.referral_code };
  } catch { /* ignore */ }

  return c.json({
    code: me?.referral_code || null,
    reward_per_referral_qta: REFERRER_REWARD_QTA,
    welcome_bonus_qta: REFERRED_WELCOME_QTA,
    invited_count: invited.length,
    total_reward_qta: totalReward,
    invited,
    referred_by: referredBy,
  });
});

// Public live-check used during signup. Returns just whether the code is
// valid (and the masked nickname of the owner, for friendly feedback).
// We do NOT leak the email.
app.get('/referrals/check/:code', async (c) => {
  const code = (c.req.param('code') || '').toUpperCase().trim();
  if (!code || code.length < 4 || code.length > 16) {
    return c.json({ valid: false }, 200);
  }
  const owner = await c.env.DB.prepare(
    `SELECT nickname FROM users WHERE referral_code = ?`
  ).bind(code).first<{ nickname: string } | null>();
  if (!owner) return c.json({ valid: false });
  // Mask: show first 2 chars + "*"
  const nick = owner.nickname || '';
  const masked = nick.length <= 2 ? nick : nick.slice(0, 2) + '*'.repeat(Math.max(1, nick.length - 2));
  return c.json({ valid: true, masked_nickname: masked });
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
app.post('/request-verification', rlReqVerify, async (c) => {
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

    const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
    const link = `${appUrl}/verify-email?token=${token}`;
    const mail = await sendMail(c.env as any, {
      to: user.email,
      subject: 'Verify your QuantaEX email',
      html: templateBasic(
        'Verify your email',
        `Click the button below to confirm this is your email address. The link expires in 24 hours.`,
        { label: 'Verify email', url: link },
      ),
      text: `Verify: ${link}`,
    });

    // Only surface dev_token when the real mail provider is NOT wired up.
    return c.json({
      ok: true,
      message: 'Verification email sent',
      sent: mail.sent,
      ...(mail.sent ? {} : { dev_token: token, dev_url: link }),
    });
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

  // Was this the first successful verification for this user?
  // Only unlock the sign-up bonus on the first verify to prevent repeat
  // unlocks if the user gets a new verification email later.
  const userRow = await c.env.DB.prepare(
    `SELECT email_verified_at FROM users WHERE id = ?`
  ).bind(row.user_id).first<any>();
  const firstVerification = !userRow?.email_verified_at;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(row.user_id),
    c.env.DB.prepare(
      `UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(row.id),
  ]);

  // Unlock the QTA sign-up bonus: move any `locked` QTA (up to 1000)
  // into `available`. Idempotent because we run it only on first verify.
  let bonusUnlocked = 0;
  if (firstVerification) {
    try {
      const qta = await c.env.DB.prepare(
        `SELECT id, available, locked FROM wallets
         WHERE user_id = ? AND coin_symbol = 'QTA'`
      ).bind(row.user_id).first<any>();
      if (qta && qta.locked > 0) {
        bonusUnlocked = Math.min(qta.locked, 1000);
        await c.env.DB.prepare(
          `UPDATE wallets
           SET available = available + ?, locked = locked - ?
           WHERE id = ?`
        ).bind(bonusUnlocked, bonusUnlocked, qta.id).run();
      }
    } catch (e) {
      console.warn('[verify-email] bonus unlock failed:', e);
    }
  }

  return c.json({
    ok: true,
    message: 'Email verified',
    bonus_unlocked: bonusUnlocked,
  });
});

// ============================================================================
// Password reset
// ----------------------------------------------------------------------------
// POST /api/auth/forgot-password { email } -> always 200 (no user enumeration)
// POST /api/auth/reset-password   { token, new_password }
// ============================================================================
app.post('/forgot-password', rlForgotPw, async (c) => {
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
    const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
    const link = `${appUrl}/reset-password?token=${token}`;
    const mail = await sendMail(c.env as any, {
      to: rawEmail,
      subject: 'Reset your QuantaEX password',
      html: templateBasic(
        'Reset your password',
        `We received a request to reset your password. This link expires in 1 hour. If it wasn't you, you can ignore this email.`,
        { label: 'Reset password', url: link },
      ),
      text: `Reset: ${link}`,
    });
    return c.json({
      ok: true,
      message: 'Password reset email sent',
      sent: mail.sent,
      ...(mail.sent ? {} : { dev_token: token, dev_url: link }),
    });
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
      `UPDATE users
       SET password = ?,
           token_version = COALESCE(token_version, 0) + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
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
