import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware } from '../middleware/auth';
import bcrypt from 'bcryptjs';

const app = new Hono<AppEnv>();

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
    'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(newHash, user.id).run();

  return c.json({ ok: true, message: 'Password changed successfully' });
});

// GET /api/profile/sessions - active sessions (placeholder: last logins)
app.get('/sessions', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM login_history WHERE user_id = ? ORDER BY logged_in_at DESC LIMIT 20`
  ).bind(user.id).all().catch(() => ({ results: [] as any[] }));
  return c.json(results);
});

// GET /api/profile/api-keys - list API keys
app.get('/api-keys', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT id, label, api_key, permissions, ip_whitelist, is_active, last_used_at, created_at, expires_at
     FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all().catch(() => ({ results: [] as any[] }));
  return c.json(results);
});

// POST /api/profile/api-keys - create API key
app.post('/api-keys', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { label, permissions, ip_whitelist } = body;

  if (!label) return c.json({ error: 'Label is required' }, 400);

  const id = crypto.randomUUID();
  const apiKey = 'qx_' + Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const apiSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const enc = new TextEncoder().encode(apiSecret);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const apiSecretHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

  await c.env.DB.prepare(
    `INSERT INTO api_keys (id, user_id, label, api_key, api_secret_hash, permissions, ip_whitelist, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(
    id, user.id, label, apiKey, apiSecretHash,
    permissions || 'read', ip_whitelist || null
  ).run();

  // Return secret ONCE only
  return c.json({ id, label, api_key: apiKey, api_secret: apiSecret, permissions, ip_whitelist, is_active: 1 }, 201);
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

export default app;
