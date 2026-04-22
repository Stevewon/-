// ============================================================================
// RFC 6238 TOTP (Time-based One-Time Password) for Cloudflare Workers.
// Pure Web-Crypto implementation — no Node Buffer, no npm dependencies.
// ============================================================================

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode a byte array as RFC 4648 Base32 (no padding). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode RFC 4648 Base32 (case-insensitive, padding optional) -> bytes. */
export function base32Decode(s: string): Uint8Array {
  const cleaned = s.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid Base32 character: ' + ch);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Generate a fresh 20-byte (160-bit) TOTP secret in Base32. */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/** Compute an 8-byte big-endian counter from a timestep integer. */
function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  // JS bitshift is 32-bit; split into hi/lo
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  buf[0] = (hi >>> 24) & 0xff;
  buf[1] = (hi >>> 16) & 0xff;
  buf[2] = (hi >>> 8) & 0xff;
  buf[3] = hi & 0xff;
  buf[4] = (lo >>> 24) & 0xff;
  buf[5] = (lo >>> 16) & 0xff;
  buf[6] = (lo >>> 8) & 0xff;
  buf[7] = lo & 0xff;
  return buf;
}

/** HOTP (RFC 4226) — returns a `digits`-digit string. */
export async function hotp(
  secret: Uint8Array,
  counter: number,
  digits = 6,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(counter)));
  const offset = sig[sig.length - 1] & 0x0f;
  const binCode =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return (binCode % mod).toString().padStart(digits, '0');
}

/** Current TOTP (RFC 6238) for a Base32-encoded secret. */
export async function totp(
  base32Secret: string,
  stepSeconds = 30,
  digits = 6,
  at: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = base32Decode(base32Secret);
  return hotp(key, Math.floor(at / stepSeconds), digits);
}

/**
 * Verify a user-submitted TOTP with ±1 time-step tolerance (default window=1).
 * Uses a simple constant-time compare to avoid timing leaks.
 */
export async function verifyTotp(
  base32Secret: string,
  code: string,
  { window = 1, stepSeconds = 30, digits = 6 }: { window?: number; stepSeconds?: number; digits?: number } = {},
): Promise<boolean> {
  if (!base32Secret || !code) return false;
  const clean = code.replace(/\s+/g, '');
  if (!/^\d+$/.test(clean) || clean.length !== digits) return false;

  const key = base32Decode(base32Secret);
  const now = Math.floor(Date.now() / 1000);
  const currentStep = Math.floor(now / stepSeconds);

  for (let i = -window; i <= window; i++) {
    const candidate = await hotp(key, currentStep + i, digits);
    if (timingSafeEqual(candidate, clean)) return true;
  }
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Build a otpauth:// URL suitable for QR-code apps (Google Authenticator, 1Password, …). */
export function otpauthUrl(params: {
  issuer: string;
  accountName: string;
  secret: string;
  digits?: number;
  period?: number;
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
}): string {
  const { issuer, accountName, secret, digits = 6, period = 30, algorithm = 'SHA1' } = params;
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm,
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
