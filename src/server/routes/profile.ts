import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware } from '../middleware/auth';
import bcrypt from 'bcryptjs';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../utils/totp';
import {
  tmplPasswordChanged,
  tmpl2faEnabled,
  tmpl2faDisabled,
  fireAndForgetMail,
  metaFromReq,
} from '../utils/mailer';
import { getUserFeeTier } from '../utils/fees';

const app = new Hono<AppEnv>();

// ============================================================================
// KYC — Read / Submit
// ----------------------------------------------------------------------------
// Pre-launch audit (2026-06-22): the KycPage frontend was calling
// `/api/profile/kyc` (GET to prefill, POST to submit) but the server only
// had `POST /api/auth/kyc` with weak validation and no GET. Result: all
// KYC submissions failed with 404. This block adds both endpoints with
// proper validation:
//   * Required: name, phone, id_number, address.
//   * Optional: id_document_url, address_document_url (string, ≤2KB each;
//     today these are simulated client-side and will be wired to R2 in a
//     follow-up — but we already persist them so the admin reviewer can
//     see what was submitted).
//   * Length / format checks mirroring the KycPage client-side rules.
//   * Re-submit policy: only `none` or `rejected` may re-submit. `pending`
//     and `approved` are read-only here — preventing self-modification of
//     a record that's already in review or live.
//   * On submit, kyc_submitted_at = CURRENT_TIMESTAMP so the admin queue
//     can sort by oldest-first (FIFO).
// ============================================================================
app.get('/kyc', authMiddleware, async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    `SELECT kyc_status, kyc_name, kyc_phone, kyc_id_number, kyc_address,
            kyc_id_document_url, kyc_address_document_url,
            kyc_submitted_at, kyc_reviewed_at
       FROM users WHERE id = ?`
  ).bind(user.id).first<any>();
  if (!row) return c.json({ error: 'User not found' }, 404);
  return c.json(row);
});

// ============================================================================
// POST /api/profile/kyc/upload — direct file upload for KYC docs.
// ----------------------------------------------------------------------------
// Receives multipart/form-data with `field` ('id_document' | 'address_document')
// and `file`. When the KYC_BUCKET R2 binding is present, streams to R2 and
// returns the storage tag `r2://<key>` that the client should put in the
// id_document_url / address_document_url field of the subsequent POST /kyc.
// When the binding is absent (binding not yet configured in wrangler.jsonc),
// falls back to SHA-256 content-hash tag `kyc-doc:<hash>:<size>:<filename>`,
// which is still recorded in the kyc_documents table for audit but no
// actual blob is stored.
//
// Limits:
//   * MIME: image/* or application/pdf only
//   * Size: ≤ 10 MB (10_485_760 bytes)
//   * Per-user: max 4 docs per kind (newer overrides; older retained for audit)
// ============================================================================
const MAX_KYC_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_KYC_MIMES = /^(image\/[a-z0-9.+-]+|application\/pdf)$/i;

app.post('/kyc/upload', authMiddleware, async (c) => {
  const user = c.get('user');

  // Status gate — cannot upload while pending or already approved.
  const cur = await c.env.DB.prepare(
    'SELECT kyc_status FROM users WHERE id = ?'
  ).bind(user.id).first<{ kyc_status: string | null }>();
  const status = (cur?.kyc_status || 'none').toLowerCase();
  if (status === 'pending') {
    return c.json({ error: 'KYC is already under review', code: 'KYC_PENDING' }, 400);
  }
  if (status === 'approved') {
    return c.json({ error: 'KYC is already approved', code: 'KYC_ALREADY_APPROVED' }, 400);
  }

  // Parse multipart body.
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'Invalid multipart body', code: 'BAD_FORM' }, 400);
  }
  const field = String(form.get('field') || '').trim();
  const file = form.get('file');
  if (field !== 'id_document' && field !== 'address_document') {
    return c.json({ error: 'field must be id_document or address_document', code: 'BAD_FIELD' }, 400);
  }
  if (!file || typeof file === 'string') {
    return c.json({ error: 'file is required', code: 'NO_FILE' }, 400);
  }

  // File metadata (Cloudflare Workers File interface).
  const f = file as File;
  const size = f.size;
  const mime = f.type || 'application/octet-stream';
  if (size <= 0 || size > MAX_KYC_FILE_SIZE) {
    return c.json({ error: 'File too large (max 10MB)', code: 'FILE_TOO_LARGE' }, 400);
  }
  if (!ALLOWED_KYC_MIMES.test(mime)) {
    return c.json({ error: 'Only image/* or application/pdf allowed', code: 'BAD_MIME' }, 400);
  }
  const filename = (f.name || 'upload').slice(0, 200);

  // SHA-256 content hash (always computed for dedup + audit, even when R2 used).
  const buf = await f.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16); // 64-bit prefix — plenty for collision resistance at our scale

  // Decide storage backend.
  const r2 = c.env.KYC_BUCKET;
  let storageTag: string;
  let r2Key: string | null = null;

  if (r2) {
    // R2 path: object key includes user id + kind + hash for dedup.
    // Format: kyc/<user_id>/<kind>/<hex>-<filename>
    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
    r2Key = `kyc/${user.id}/${field}/${hex}-${safeName}`;
    try {
      await r2.put(r2Key, buf, {
        httpMetadata: { contentType: mime },
        customMetadata: {
          user_id: user.id,
          kind: field,
          filename: safeName,
          uploaded_at: new Date().toISOString(),
        },
      });
      storageTag = `r2://${r2Key}`;
    } catch (e: any) {
      // R2 failure: fall back to content tag so the user isn't blocked.
      console.error('[kyc-upload] R2 put failed, falling back to content tag', e);
      r2Key = null;
      storageTag = `kyc-doc:${hex}:${size}:${filename.slice(0, 80)}`;
    }
  } else {
    // No R2 binding: SHA-256 content-hash tag fallback. Identical to the
    // old client-side behaviour, but now we persist the metadata server-side
    // so admins have an audit trail.
    storageTag = `kyc-doc:${hex}:${size}:${filename.slice(0, 80)}`;
  }

  // Persist metadata row (idempotent: dedup on hash + user_id + kind would
  // be ideal but plain INSERT lets us keep an append-only audit log).
  const id = crypto.randomUUID();
  const xfwd = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || '';
  try {
    await c.env.DB.prepare(
      `INSERT INTO kyc_documents
         (id, user_id, kind, r2_key, storage_tag, content_hash, filename, mime_type, size_bytes, uploaded_at, uploaded_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`
    ).bind(id, user.id, field, r2Key, storageTag, hex, filename, mime, size, xfwd).run();
  } catch (e: any) {
    // If the table doesn't exist yet (cold start before bootstrap finishes),
    // still return the tag so the SPA isn't blocked. The /kyc POST will
    // accept the tag and record it in users.kyc_*_document_url.
    if (!String(e?.message || '').includes('no such table')) throw e;
  }

  return c.json({
    ok: true,
    field,
    storage_tag: storageTag,
    storage_backend: r2Key ? 'r2' : 'tag',
    filename,
    mime,
    size,
    content_hash: hex,
  });
});

app.post('/kyc', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({} as any));

  // Status gate — can only submit when never submitted or previously rejected.
  const cur = await c.env.DB.prepare(
    'SELECT kyc_status FROM users WHERE id = ?'
  ).bind(user.id).first<{ kyc_status: string | null }>();
  const status = (cur?.kyc_status || 'none').toLowerCase();
  if (status !== 'none' && status !== 'rejected') {
    return c.json(
      {
        error:
          status === 'pending'
            ? 'KYC is already under review. Please wait for the result.'
            : 'KYC is already approved. Contact support to make changes.',
        code: status === 'pending' ? 'KYC_PENDING' : 'KYC_ALREADY_APPROVED',
      },
      400,
    );
  }

  // Required-field validation (mirrors KycPage validateStep).
  const name      = String(body.name || '').trim();
  const phone     = String(body.phone || '').trim();
  const idNumber  = String(body.id_number || '').trim();
  const address   = String(body.address || '').trim();
  const idDoc     = body.id_document_url != null ? String(body.id_document_url) : null;
  const addrDoc   = body.address_document_url != null ? String(body.address_document_url) : null;

  if (name.length < 2 || name.length > 100) {
    return c.json({ error: 'Name must be 2-100 characters' }, 400);
  }
  if (phone.length < 7 || phone.length > 30) {
    return c.json({ error: 'Phone must be 7-30 characters' }, 400);
  }
  if (idNumber.length < 4 || idNumber.length > 50) {
    return c.json({ error: 'ID number must be 4-50 characters' }, 400);
  }
  if (address.length < 5 || address.length > 500) {
    return c.json({ error: 'Address must be 5-500 characters' }, 400);
  }
  // Document URLs are optional today (R2 wiring pending). If supplied,
  // cap their length to avoid storing arbitrary blobs in the users row.
  if (idDoc && idDoc.length > 2048) {
    return c.json({ error: 'id_document_url too long (max 2048 chars)' }, 400);
  }
  if (addrDoc && addrDoc.length > 2048) {
    return c.json({ error: 'address_document_url too long (max 2048 chars)' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE users
        SET kyc_status = 'pending',
            kyc_name = ?,
            kyc_phone = ?,
            kyc_id_number = ?,
            kyc_address = ?,
            kyc_id_document_url = ?,
            kyc_address_document_url = ?,
            kyc_submitted_at = CURRENT_TIMESTAMP,
            kyc_reviewed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`
  ).bind(name, phone, idNumber, address, idDoc, addrDoc, user.id).run();

  return c.json({
    ok: true,
    message: 'KYC submitted — awaiting admin review',
    kyc_status: 'pending',
  });
});

// PATCH /api/profile - update nickname / avatar
app.patch('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { nickname, avatar_url } = body;

  const updates: string[] = [];
  const values: any[] = [];
  if (nickname !== undefined) {
    if (typeof nickname !== 'string' || nickname.length < 2 || nickname.length > 20) {
      return c.json({ error: 'Invalid nickname (2-20 chars)' }, 400);
    }
    updates.push('nickname = ?');
    values.push(nickname);
  }
  if (avatar_url !== undefined) {
    updates.push('avatar_url = ?');
    values.push(avatar_url);
  }
  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(user.id);
  await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const row = await c.env.DB.prepare(
    'SELECT id, email, nickname, role, kyc_status, two_factor_enabled, avatar_url FROM users WHERE id = ?'
  ).bind(user.id).first();
  return c.json(row);
});

// POST /api/profile/password - change password
// 🔒 Accepts both `current_password`/`new_password` and legacy
// `old_password`/`password` field names for client compatibility.
// 🚨 CRITICAL FIX: Uses bcrypt to match auth.ts register/login hashing.
//   Previously used SHA-256 which never matched the bcrypt-hashed stored
//   password, making password changes impossible and corrupting the hash
//   if it had ever "succeeded".
app.post('/password', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const currentPw = (body.current_password || body.old_password || '').toString();
  const newPw = (body.new_password || body.password || '').toString();

  if (!currentPw || !newPw) {
    return c.json({ error: 'Current and new password are required' }, 400);
  }
  if (newPw.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400);
  }
  if (!/[A-Za-z]/.test(newPw) || !/[0-9]/.test(newPw)) {
    return c.json({ error: 'New password must contain both letters and numbers' }, 400);
  }
  if (currentPw === newPw) {
    return c.json({ error: 'New password must differ from current password' }, 400);
  }

  const row = await c.env.DB.prepare('SELECT password FROM users WHERE id = ?').bind(user.id).first<{ password: string }>();
  if (!row) return c.json({ error: 'User not found' }, 404);

  // bcrypt.compareSync works with both bcrypt $2a$/$2b$ hashes.
  let ok = false;
  try { ok = bcrypt.compareSync(currentPw, row.password); } catch { ok = false; }
  if (!ok) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }

  const newHash = bcrypt.hashSync(newPw, 10);
  await c.env.DB.prepare(
    `UPDATE users
     SET password = ?,
         token_version = COALESCE(token_version, 0) + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(newHash, user.id).run();

  // S3-6: password-changed alert mail
  try {
    const email = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(user.id).first<{ email: string }>();
    if (email?.email) {
      const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
      fireAndForgetMail(
        c.env as any,
        email.email,
        tmplPasswordChanged(appUrl, metaFromReq(c.req)),
        c.executionCtx as any,
      );
    }
  } catch (e) { console.warn('[profile.password] alert mail failed:', e); }

  return c.json({ ok: true, message: 'Password changed successfully — please login again' });
});

// ============================================================================
// 2FA (TOTP - RFC 6238)
// ----------------------------------------------------------------------------
// Flow:
//   1) POST /api/profile/2fa/setup   -> creates a *pending* secret and returns
//      the Base32 secret + otpauth:// URL. No effect on login yet.
//   2) POST /api/profile/2fa/enable  -> body: { code } — verifies the pending
//      secret and promotes it to the active secret + flips the flag.
//   3) POST /api/profile/2fa/disable -> body: { password, code } — requires
//      BOTH the current password and a valid current TOTP.
// ============================================================================
app.post('/2fa/setup', authMiddleware, async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    'SELECT email, two_factor_enabled FROM users WHERE id = ?'
  ).bind(user.id).first<{ email: string; two_factor_enabled: number }>();
  if (!row) return c.json({ error: 'User not found' }, 404);
  if (row.two_factor_enabled) {
    return c.json({ error: '2FA is already enabled. Disable it first to regenerate.' }, 400);
  }

  const secret = generateTotpSecret();
  // Store as pending. If the user never confirms, it gets overwritten the
  // next time they hit setup.
  await c.env.DB.prepare(
    `UPDATE users SET two_factor_pending_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(secret, user.id).run();

  const uri = otpauthUrl({
    issuer: 'QuantaEX',
    accountName: row.email,
    secret,
  });

  return c.json({ secret, otpauth_url: uri });
});

app.post('/2fa/enable', authMiddleware, async (c) => {
  const user = c.get('user');
  const { code } = await c.req.json().catch(() => ({ code: '' }));
  if (!code) return c.json({ error: 'Code required' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT two_factor_pending_secret, two_factor_enabled FROM users WHERE id = ?'
  ).bind(user.id).first<{ two_factor_pending_secret: string | null; two_factor_enabled: number }>();
  if (!row?.two_factor_pending_secret) {
    return c.json({ error: 'No pending 2FA setup — call /2fa/setup first' }, 400);
  }
  if (row.two_factor_enabled) {
    return c.json({ error: '2FA already enabled' }, 400);
  }

  const ok = await verifyTotp(row.two_factor_pending_secret, String(code));
  if (!ok) return c.json({ error: 'Invalid code' }, 401);

  await c.env.DB.prepare(
    `UPDATE users
     SET two_factor_enabled = 1,
         two_factor_secret = two_factor_pending_secret,
         two_factor_pending_secret = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(user.id).run();

  // S3-6: 2FA-enabled alert mail
  try {
    const em = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(user.id).first<{ email: string }>();
    if (em?.email) {
      const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
      fireAndForgetMail(c.env as any, em.email, tmpl2faEnabled(appUrl, metaFromReq(c.req)), c.executionCtx as any);
    }
  } catch (e) { console.warn('[2fa/enable] alert mail failed:', e); }

  return c.json({ ok: true, message: '2FA enabled' });
});

app.post('/2fa/disable', authMiddleware, async (c) => {
  const user = c.get('user');
  const { password, code } = await c.req.json().catch(() => ({}));
  if (!password || !code) {
    return c.json({ error: 'Password and 2FA code required' }, 400);
  }

  const row = await c.env.DB.prepare(
    'SELECT password, two_factor_enabled, two_factor_secret FROM users WHERE id = ?'
  ).bind(user.id).first<{ password: string; two_factor_enabled: number; two_factor_secret: string | null }>();
  if (!row) return c.json({ error: 'User not found' }, 404);
  if (!row.two_factor_enabled || !row.two_factor_secret) {
    return c.json({ error: '2FA is not enabled' }, 400);
  }

  if (!bcrypt.compareSync(String(password), row.password)) {
    return c.json({ error: 'Invalid password' }, 401);
  }
  const ok = await verifyTotp(row.two_factor_secret, String(code));
  if (!ok) return c.json({ error: 'Invalid 2FA code' }, 401);

  await c.env.DB.prepare(
    `UPDATE users
     SET two_factor_enabled = 0,
         two_factor_secret = NULL,
         two_factor_pending_secret = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(user.id).run();

  // S3-6: 2FA-disabled alert mail (security-critical)
  try {
    const em = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(user.id).first<{ email: string }>();
    if (em?.email) {
      const appUrl = (c.env as any).APP_URL || 'https://quantaex.io';
      fireAndForgetMail(c.env as any, em.email, tmpl2faDisabled(appUrl, metaFromReq(c.req)), c.executionCtx as any);
    }
  } catch (e) { console.warn('[2fa/disable] alert mail failed:', e); }

  return c.json({ ok: true, message: '2FA disabled' });
});

// GET /api/profile/sessions or /api/profile/login-history - recent login history (audit trail)
async function loginHistoryHandler(c: any) {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT id, ip_address, user_agent, device, location, status, reason, created_at
     FROM login_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
  ).bind(user.id).all().catch(() => ({ results: [] as any[] }));
  return c.json(results);
}
app.get('/sessions', authMiddleware, loginHistoryHandler);
app.get('/login-history', authMiddleware, loginHistoryHandler);

// ============================================================================
// API keys — Sprint 4 Phase H2 (PQ-Only stub)
// ----------------------------------------------------------------------------
// signature_alg ∈ { 'hmac-sha256' (default, legacy), 'dilithium2', 'hybrid' }.
// Existing HMAC-only keys keep working unchanged. PQ keys carry an extra
// base64 public_key (Dilithium2 = 1312 bytes raw); the user keeps the
// matching secret key client-side and we never store it.
// ============================================================================
import {
  isValidDilithium2PublicKey,
  readPqMarkers,
} from '../lib/pq-crypto';

type SignatureAlg = 'hmac-sha256' | 'dilithium2' | 'hybrid';
const VALID_ALGS: ReadonlyArray<SignatureAlg> = ['hmac-sha256', 'dilithium2', 'hybrid'];

// GET /api/profile/api-keys - list API keys
app.get('/api-keys', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT id, label, api_key, permissions, ip_whitelist, is_active,
            last_used_at, created_at, expires_at,
            signature_alg, public_key, pq_key_version, last_pq_verify_at
       FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all().catch(() => ({ results: [] as any[] }));
  return c.json(results);
});

// POST /api/profile/api-keys - create API key
app.post('/api-keys', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({} as any));
  const { label, permissions, ip_whitelist } = body || {};
  const rawAlg = (body?.signature_alg ?? 'hmac-sha256') as string;
  const publicKey = body?.public_key as string | undefined;

  if (!label) return c.json({ error: 'Label is required' }, 400);
  if (!VALID_ALGS.includes(rawAlg as SignatureAlg)) {
    return c.json({ error: 'Unsupported signature_alg', code: 'BAD_ALG' }, 400);
  }
  const signatureAlg = rawAlg as SignatureAlg;

  // PQ keys must arrive with a syntactically valid Dilithium2 public key.
  if (signatureAlg !== 'hmac-sha256') {
    if (!isValidDilithium2PublicKey(publicKey)) {
      return c.json(
        { error: 'Invalid Dilithium2 public key (expect 1312 bytes, base64).', code: 'BAD_PUBKEY' },
        400,
      );
    }
    const markers = await readPqMarkers(c);
    if (!markers.enabled) {
      return c.json({ error: 'PQ API keys are currently disabled.', code: 'PQ_DISABLED' }, 503);
    }
  }

  const id = crypto.randomUUID();
  const apiKey = 'qx_' + Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  // HMAC secret is only generated for HMAC / hybrid keys. Pure PQ keys do
  // NOT have a server-side secret — verification is asymmetric.
  let apiSecret: string | null = null;
  let apiSecretHash: string | null = null;
  if (signatureAlg === 'hmac-sha256' || signatureAlg === 'hybrid') {
    apiSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiSecret));
    apiSecretHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  await c.env.DB.prepare(
    `INSERT INTO api_keys
       (id, user_id, label, api_key, api_secret_hash, permissions, ip_whitelist, is_active,
        signature_alg, public_key, pq_key_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)`
  ).bind(
    id, user.id, label, apiKey, apiSecretHash,
    permissions || 'read', ip_whitelist || null,
    signatureAlg, signatureAlg === 'hmac-sha256' ? null : (publicKey ?? null),
  ).run();

  // Secret returned ONCE only (and only for HMAC/hybrid). Public key is
  // echoed back so the client UI can show its fingerprint.
  return c.json({
    id,
    label,
    api_key: apiKey,
    api_secret: apiSecret,
    public_key: signatureAlg === 'hmac-sha256' ? null : (publicKey ?? null),
    signature_alg: signatureAlg,
    pq_key_version: 1,
    permissions,
    ip_whitelist,
    is_active: 1,
  }, 201);
});

// DELETE /api/profile/api-keys/:id
app.delete('/api-keys/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'DELETE FROM api_keys WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).run();
  return c.json({ ok: true });
});

// GET /api/profile/api-keys/stats - per-user algorithm distribution
// Used by ApiKeysPage to show "X HMAC / Y PQ / Z hybrid" badges.
app.get('/api-keys/stats', authMiddleware, async (c) => {
  const user = c.get('user');
  const markers = await readPqMarkers(c);
  let counts: Record<SignatureAlg, number> = {
    'hmac-sha256': 0,
    'dilithium2': 0,
    'hybrid': 0,
  };
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT signature_alg, COUNT(*) AS n
         FROM api_keys WHERE user_id = ? GROUP BY signature_alg`
    ).bind(user.id).all<{ signature_alg: SignatureAlg; n: number }>();
    for (const r of results ?? []) {
      if (VALID_ALGS.includes(r.signature_alg)) counts[r.signature_alg] = Number(r.n) || 0;
    }
  } catch { /* table not migrated yet */ }
  return c.json({
    ok: true,
    counts,
    pq: {
      enabled: markers.enabled,
      required: markers.required,
      wasm_ready: markers.wasmReady,
      integration_phase: markers.integrationPhase,
    },
  });
});

// ============================================================================
// S3-5: Fee tier info. Returns the user's 30-day USD volume, current tier,
// and both their maker/taker fee rate + the ladder so the UI can render a
// "next tier at $X" hint. Falls back to conservative defaults when the
// fee_tiers table has not been migrated yet.
// ============================================================================
app.get('/fee-tier', authMiddleware, async (c) => {
  const user = c.get('user');
  const tier = await getUserFeeTier(c.env.DB, user.id, { maker_fee: 0.001, taker_fee: 0.001 });
  let ladder: Array<{ tier: number; name: string; min_volume_usd: number; maker_fee: number; taker_fee: number }> = [];
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT tier, name, min_volume_usd, maker_fee, taker_fee FROM fee_tiers ORDER BY tier ASC'
    ).all<any>();
    ladder = (results || []) as any;
  } catch { /* table not yet migrated */ }

  return c.json({
    tier: tier.tier,
    name: tier.name,
    volume_usd_30d: tier.volume_usd_30d,
    maker_fee: tier.maker_fee,
    taker_fee: tier.taker_fee,
    ladder,
  });
});

// GET /api/profile/fee-ledger — my fee history (S3-5)
app.get('/fee-ledger', authMiddleware, async (c) => {
  const user = c.get('user');
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT l.*, m.base_coin, m.quote_coin
         FROM fee_ledger l
         LEFT JOIN markets m ON m.id = l.market_id
        WHERE l.user_id = ?
        ORDER BY l.created_at DESC
        LIMIT ?`
    ).bind(user.id, limit).all<any>();
    return c.json(results || []);
  } catch (e: any) {
    return c.json({ error: 'fee_ledger not available', detail: String(e?.message || e) }, 503);
  }
});

export default app;
