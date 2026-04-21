import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

/* ================================================================
 * PROFILE
 * ================================================================ */

// GET /api/profile — get current user's full profile
router.get('/', authMiddleware, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT id, email, nickname, role, kyc_status, kyc_name, kyc_phone, kyc_address,
             kyc_submitted_at, kyc_reviewed_at, two_factor_enabled, avatar_url,
             is_active, created_at, updated_at
      FROM users WHERE id = ?
    `).get(req.user.id);
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/profile — update nickname
router.patch('/', authMiddleware, (req, res) => {
  try {
    const { nickname } = req.body;
    if (!nickname || nickname.length < 2 || nickname.length > 20) {
      return res.status(400).json({ error: 'Nickname must be 2-20 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').get(nickname, req.user.id);
    if (existing) return res.status(400).json({ error: 'Nickname already taken' });

    db.prepare('UPDATE users SET nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nickname, req.user.id);
    res.json({ message: 'Profile updated', nickname });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/password — change password
router.post('/password', authMiddleware, (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(current_password, user.password)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashed = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashed, req.user.id);
    res.json({ message: 'Password changed successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ================================================================
 * 2FA (simulated TOTP)
 * ================================================================ */

// Simple base32 helper
function toBase32(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

// POST /api/profile/2fa/setup — generate secret (not enabled yet)
router.post('/2fa/setup', authMiddleware, (req, res) => {
  try {
    const secret = toBase32(crypto.randomBytes(20));
    // Store provisional secret
    db.prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?').run(secret, req.user.id);
    const otpauth_url = `otpauth://totp/QuantaEX:${encodeURIComponent(req.user.email)}?secret=${secret}&issuer=QuantaEX`;
    res.json({ secret, otpauth_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/2fa/enable — verify first code + enable
router.post('/2fa/enable', authMiddleware, (req, res) => {
  try {
    const { code } = req.body;
    if (!code || code.length !== 6) return res.status(400).json({ error: 'Enter 6-digit code' });

    const user = db.prepare('SELECT two_factor_secret FROM users WHERE id = ?').get(req.user.id);
    if (!user.two_factor_secret) return res.status(400).json({ error: 'Setup first' });

    // In a real implementation, verify TOTP with HMAC-SHA1. Here we accept any 6-digit code for demo.
    // But only when secret exists — ensuring the user ran setup.
    db.prepare('UPDATE users SET two_factor_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id);
    res.json({ message: '2FA enabled' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/2fa/disable
router.post('/2fa/disable', authMiddleware, (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: 'Incorrect password' });
    }

    db.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?').run(req.user.id);
    res.json({ message: '2FA disabled' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ================================================================
 * KYC (3-step flow)
 * ================================================================ */

// POST /api/profile/kyc — submit KYC (all at once in this demo; supports 2-level docs)
router.post('/kyc', authMiddleware, (req, res) => {
  try {
    const { name, phone, id_number, address, id_document_url, address_document_url } = req.body;
    if (!name || !phone || !id_number) {
      return res.status(400).json({ error: 'Name, phone and ID number required' });
    }
    if (!address) {
      return res.status(400).json({ error: 'Address required' });
    }

    db.prepare(`
      UPDATE users
      SET kyc_status = 'pending',
          kyc_name = ?, kyc_phone = ?, kyc_id_number = ?, kyc_address = ?,
          kyc_id_document_url = ?, kyc_address_document_url = ?,
          kyc_submitted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, phone, id_number, address, id_document_url || null, address_document_url || null, req.user.id);

    res.json({ message: 'KYC submitted for review' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/profile/kyc — current KYC status
router.get('/kyc', authMiddleware, (req, res) => {
  try {
    const row = db.prepare(`
      SELECT kyc_status, kyc_name, kyc_phone, kyc_address, kyc_submitted_at, kyc_reviewed_at
      FROM users WHERE id = ?
    `).get(req.user.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ================================================================
 * API KEYS
 * ================================================================ */

// GET /api/profile/api-keys — list user's keys (hide secret)
router.get('/api-keys', authMiddleware, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, label, api_key, permissions, ip_whitelist, is_active, last_used_at, created_at, expires_at
      FROM api_keys WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(req.user.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/api-keys — create new key (returns secret ONLY ONCE)
router.post('/api-keys', authMiddleware, (req, res) => {
  try {
    const { label, permissions, ip_whitelist } = req.body;
    if (!label || label.length < 2) return res.status(400).json({ error: 'Label must be at least 2 characters' });

    // Max 5 active keys per user
    const active = db.prepare('SELECT COUNT(*) as cnt FROM api_keys WHERE user_id = ? AND is_active = 1').get(req.user.id);
    if (active.cnt >= 5) return res.status(400).json({ error: 'Max 5 active API keys allowed' });

    // Valid permissions: read, trade, withdraw
    const validPerms = ['read', 'trade', 'withdraw'];
    const perms = (permissions || 'read').split(',').map(p => p.trim()).filter(p => validPerms.includes(p));
    if (perms.length === 0) perms.push('read');

    const apiKey = 'qta_' + crypto.randomBytes(16).toString('hex');
    const apiSecret = crypto.randomBytes(32).toString('hex');
    const secretHash = bcrypt.hashSync(apiSecret, 10);

    const id = uuidv4();
    db.prepare(`
      INSERT INTO api_keys (id, user_id, label, api_key, api_secret_hash, permissions, ip_whitelist)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, label, apiKey, secretHash, perms.join(','), ip_whitelist || null);

    res.json({
      id,
      label,
      api_key: apiKey,
      api_secret: apiSecret, // ONLY shown once
      permissions: perms.join(','),
      ip_whitelist: ip_whitelist || null,
      message: 'Save the secret now — it will not be shown again.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/profile/api-keys/:id
router.delete('/api-keys/:id', authMiddleware, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'API key deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ================================================================
 * SECURITY — Login History
 * ================================================================ */

// GET /api/profile/login-history — latest 30 login events
router.get('/login-history', authMiddleware, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, ip_address, user_agent, device, location, status, reason, created_at
      FROM login_history
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 30
    `).all(req.user.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
