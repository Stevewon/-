// ============================================================================
// KYC dual verification — EMAIL code + SMS code (6 digits each).
// OWNER_RULES §13 (2026-09-22): "이메일 인증하고 SMS 인증하는 이중방식."
// ----------------------------------------------------------------------------
// Telegram-style: the member types a 6-digit code delivered to (a) their
// registered email and (b) the phone number they entered on the KYC form.
// KYC cannot be SUBMITTED until BOTH are verified for the current phone.
//
// Storage: kyc_verifications (one row per issued code; hashed; single-use).
//          users.kyc_email_verified_at / kyc_phone_verified_at / kyc_phone_e164.
//
// Cost control (owner: SMS costs money — spend only when needed):
//   • codes are issued ON DEMAND by the member (never bulk)
//   • 60 s resend cooldown per channel, max 5 sends / channel / day
//   • 5 wrong attempts → code burned; must request a new one
//   • SMS provider = Twilio when TWILIO_* env is set; otherwise DEV mode
//     (code is returned to the admin log + `dev_code` so the flow can be
//     tested before the account is funded). Email uses the existing mailer.
// ============================================================================
import { sendMail, templateBasic } from '../utils/mailer';

export interface KycVerifyEnv {
  DB: D1Database;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;          // E.164 number or alphanumeric sender id (e.g. "QuantaEX")
  TWILIO_MESSAGING_SERVICE_SID?: string; // optional alternative to FROM
  KYC_SMS_DEV_MODE?: string;     // 'true' forces dev mode even if Twilio set
  [k: string]: unknown;
}

export type Channel = 'email' | 'sms';

const CODE_TTL_MS = 10 * 60 * 1000;      // 10 min
const RESEND_COOLDOWN_MS = 60 * 1000;    // 60 s
const MAX_SENDS_PER_DAY = 5;
const MAX_ATTEMPTS = 5;

export async function ensureKycVerifySchema(DB: D1Database): Promise<void> {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS kyc_verifications (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    channel       TEXT NOT NULL,            -- email | sms
    target        TEXT NOT NULL,            -- email address or E.164 phone
    code_hash     TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    delivered     INTEGER NOT NULL DEFAULT 0,
    provider      TEXT,
    provider_ref  TEXT,
    error         TEXT,
    used_at       TEXT,
    ip_address    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_kyc_verif_user ON kyc_verifications(user_id, channel, created_at DESC)`).run();
  for (const col of ['kyc_email_verified_at TEXT', 'kyc_phone_verified_at TEXT', 'kyc_phone_e164 TEXT']) {
    try { await DB.prepare(`ALTER TABLE users ADD COLUMN ${col}`).run(); } catch { /* exists */ }
  }
}

export function randomCode6(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Normalise to E.164. Accepts "+81 90-1234-5678", "08012345678" with a country calling code. */
export function toE164(raw: string, defaultCc?: string): string | null {
  let s = String(raw || '').replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    const cc = String(defaultCc || '').replace(/[^\d]/g, '');
    if (!cc) return null;
    if (s.startsWith('0')) s = s.slice(1); // trunk prefix (JP/KR/UK…)
    s = '+' + cc + s;
  }
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

export function maskTarget(channel: Channel, target: string): string {
  if (channel === 'email') {
    const [u, d] = target.split('@');
    if (!d) return target;
    return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
  }
  return target.slice(0, 4) + '*'.repeat(Math.max(0, target.length - 7)) + target.slice(-3);
}

export function smsConfigured(env: KycVerifyEnv): boolean {
  if (String(env.KYC_SMS_DEV_MODE || '').toLowerCase() === 'true') return false;
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID));
}

async function sendSms(env: KycVerifyEnv, to: string, body: string): Promise<{ sent: boolean; provider: string; ref?: string; error?: string }> {
  if (!smsConfigured(env)) return { sent: false, provider: 'dev', error: 'sms_not_configured' };
  const sid = env.TWILIO_ACCOUNT_SID as string;
  const token = env.TWILIO_AUTH_TOKEN as string;
  const form = new URLSearchParams({ To: to, Body: body });
  if (env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', env.TWILIO_FROM as string);
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`), 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { sent: false, provider: 'twilio', error: `${r.status} ${j?.message || j?.code || ''}`.trim() };
    return { sent: true, provider: 'twilio', ref: j?.sid };
  } catch (e: any) {
    return { sent: false, provider: 'twilio', error: String(e?.message || e) };
  }
}

export interface IssueResult {
  ok: boolean;
  sent: boolean;
  channel: Channel;
  target_masked: string;
  cooldown_sec?: number;
  daily_limit?: boolean;
  dev_code?: string;      // ONLY when the provider is not configured (dev mode)
  provider?: string;
  error?: string;
  expires_in_sec: number;
}

export async function issueCode(
  env: KycVerifyEnv,
  user: { id: string; email: string },
  channel: Channel,
  target: string,
  ip: string,
): Promise<IssueResult> {
  const DB = env.DB;
  await ensureKycVerifySchema(DB);
  const masked = maskTarget(channel, target);

  // Cooldown (only successfully delivered rows count) + daily cap.
  const recent = await DB.prepare(
    `SELECT created_at FROM kyc_verifications WHERE user_id = ? AND channel = ? AND delivered = 1 ORDER BY created_at DESC LIMIT 1`,
  ).bind(user.id, channel).first<{ created_at: string }>();
  if (recent) {
    const age = Date.now() - new Date(recent.created_at.replace(' ', 'T') + 'Z').getTime();
    if (age < RESEND_COOLDOWN_MS) {
      return { ok: false, sent: false, channel, target_masked: masked, cooldown_sec: Math.ceil((RESEND_COOLDOWN_MS - age) / 1000), expires_in_sec: 0 };
    }
  }
  const dayCount = await DB.prepare(
    `SELECT COUNT(*) n FROM kyc_verifications WHERE user_id = ? AND channel = ? AND delivered = 1 AND created_at >= datetime('now','-1 day')`,
  ).bind(user.id, channel).first<{ n: number }>();
  if (Number(dayCount?.n || 0) >= MAX_SENDS_PER_DAY) {
    return { ok: false, sent: false, channel, target_masked: masked, daily_limit: true, expires_in_sec: 0 };
  }

  // Burn older unused codes on this channel so only the newest is valid.
  await DB.prepare(`UPDATE kyc_verifications SET used_at = datetime('now') WHERE user_id = ? AND channel = ? AND used_at IS NULL`).bind(user.id, channel).run();

  const code = randomCode6();
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await DB.prepare(
    `INSERT INTO kyc_verifications (id, user_id, channel, target, code_hash, expires_at, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, user.id, channel, target, await sha256Hex(`${user.id}:${channel}:${code}`), expires, ip).run();

  let result: { sent: boolean; provider: string; ref?: string; error?: string };
  if (channel === 'email') {
    const m = await sendMail(env as any, {
      to: target,
      subject: `${code} is your QuantaEX verification code`,
      html: templateBasic(
        'Identity verification',
        `Enter the code below on the QuantaEX verification page. It expires in 10 minutes.
         <div style="margin:20px 0;text-align:center">
           <span style="display:inline-block;font-size:34px;font-weight:700;letter-spacing:10px;color:#f0b90b;font-family:monospace">${code}</span>
         </div>
         If you did not request this, ignore this email. QuantaEX staff will never ask for this code.`,
      ),
      text: `Your QuantaEX verification code is ${code}. It expires in 10 minutes.`,
    });
    result = { sent: m.sent, provider: m.provider, error: m.error };
  } else {
    result = await sendSms(env, target, `QuantaEX verification code: ${code}\nValid for 10 minutes. Never share this code.`);
  }

  await DB.prepare(
    `UPDATE kyc_verifications SET delivered = ?, provider = ?, provider_ref = ?, error = ? WHERE id = ?`,
  ).bind(result.sent ? 1 : 0, result.provider, result.ref || null, result.error || null, id).run();

  const devMode = channel === 'sms' && !smsConfigured(env);
  if (!result.sent && !devMode) {
    // Real provider failed → burn the code so the cooldown does not trap the user.
    await DB.prepare(`UPDATE kyc_verifications SET used_at = datetime('now') WHERE id = ?`).bind(id).run();
    return { ok: false, sent: false, channel, target_masked: masked, provider: result.provider, error: result.error, expires_in_sec: 0 };
  }
  if (devMode) {
    // Dev mode: keep the code valid; mark delivered so cooldown applies; surface it.
    await DB.prepare(`UPDATE kyc_verifications SET delivered = 1, provider = 'dev' WHERE id = ?`).bind(id).run();
    console.warn(`[kyc-verify] SMS DEV MODE — code for ${masked} (${user.email}): ${code}`);
    return { ok: true, sent: false, channel, target_masked: masked, provider: 'dev', dev_code: code, expires_in_sec: CODE_TTL_MS / 1000 };
  }
  return { ok: true, sent: true, channel, target_masked: masked, provider: result.provider, expires_in_sec: CODE_TTL_MS / 1000 };
}

export interface VerifyResult { ok: boolean; error?: string; attempts_left?: number; verified_at?: string; target?: string }

export async function verifyCode(env: KycVerifyEnv, userId: string, channel: Channel, code: string): Promise<VerifyResult> {
  const DB = env.DB;
  await ensureKycVerifySchema(DB);
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return { ok: false, error: 'CODE_FORMAT' };
  const row = await DB.prepare(
    `SELECT id, target, code_hash, expires_at, attempts FROM kyc_verifications
      WHERE user_id = ? AND channel = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
  ).bind(userId, channel).first<any>();
  if (!row) return { ok: false, error: 'NO_ACTIVE_CODE' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await DB.prepare(`UPDATE kyc_verifications SET used_at = datetime('now') WHERE id = ?`).bind(row.id).run();
    return { ok: false, error: 'CODE_EXPIRED' };
  }
  const hash = await sha256Hex(`${userId}:${channel}:${c}`);
  if (hash !== row.code_hash) {
    const attempts = Number(row.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await DB.prepare(`UPDATE kyc_verifications SET attempts = ?, used_at = datetime('now') WHERE id = ?`).bind(attempts, row.id).run();
      return { ok: false, error: 'TOO_MANY_ATTEMPTS', attempts_left: 0 };
    }
    await DB.prepare(`UPDATE kyc_verifications SET attempts = ? WHERE id = ?`).bind(attempts, row.id).run();
    return { ok: false, error: 'CODE_MISMATCH', attempts_left: MAX_ATTEMPTS - attempts };
  }
  const now = new Date().toISOString();
  await DB.batch([
    DB.prepare(`UPDATE kyc_verifications SET used_at = ? WHERE id = ?`).bind(now, row.id),
    channel === 'email'
      ? DB.prepare(`UPDATE users SET kyc_email_verified_at = ? WHERE id = ?`).bind(now, userId)
      : DB.prepare(`UPDATE users SET kyc_phone_verified_at = ?, kyc_phone_e164 = ? WHERE id = ?`).bind(now, row.target, userId),
  ]);
  return { ok: true, verified_at: now, target: row.target };
}

export interface KycVerifyStatus {
  email_verified: boolean; email_verified_at: string | null; email_masked: string;
  phone_verified: boolean; phone_verified_at: string | null; phone_e164: string | null; phone_masked: string | null;
  sms_mode: 'live' | 'dev';
}

export async function verifyStatus(env: KycVerifyEnv, user: { id: string; email: string }): Promise<KycVerifyStatus> {
  await ensureKycVerifySchema(env.DB);
  const r = await env.DB.prepare(`SELECT kyc_email_verified_at, kyc_phone_verified_at, kyc_phone_e164 FROM users WHERE id = ?`).bind(user.id).first<any>();
  return {
    email_verified: Boolean(r?.kyc_email_verified_at),
    email_verified_at: r?.kyc_email_verified_at || null,
    email_masked: maskTarget('email', user.email),
    phone_verified: Boolean(r?.kyc_phone_verified_at),
    phone_verified_at: r?.kyc_phone_verified_at || null,
    phone_e164: r?.kyc_phone_e164 || null,
    phone_masked: r?.kyc_phone_e164 ? maskTarget('sms', r.kyc_phone_e164) : null,
    sms_mode: smsConfigured(env) ? 'live' : 'dev',
  };
}
