import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /api/price-alerts - list user's alerts
router.get('/', authMiddleware, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT pa.*, c.price_usd AS current_price
      FROM price_alerts pa
      LEFT JOIN coins c ON c.symbol = pa.symbol
      WHERE pa.user_id = ?
      ORDER BY pa.is_active DESC, pa.created_at DESC
    `).all(req.user.id);
    res.json(rows);
  } catch (e) {
    console.error('[price-alerts] list failed:', e);
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});

// POST /api/price-alerts - create a new alert
router.post('/', authMiddleware, (req, res) => {
  const { symbol, direction, target_price, note, quote_coin } = req.body || {};

  if (!symbol || !direction || !target_price) {
    return res.status(400).json({ error: 'symbol, direction and target_price are required' });
  }
  if (!['above', 'below'].includes(direction)) {
    return res.status(400).json({ error: "direction must be 'above' or 'below'" });
  }
  const target = Number(target_price);
  if (!(target > 0) || !isFinite(target)) {
    return res.status(400).json({ error: 'target_price must be a positive number' });
  }

  // Limit active alerts per user (prevent abuse)
  const activeCount = db.prepare('SELECT COUNT(*) AS cnt FROM price_alerts WHERE user_id = ? AND is_active = 1').get(req.user.id).cnt;
  if (activeCount >= 20) {
    return res.status(400).json({ error: 'You can have at most 20 active alerts' });
  }

  // Validate symbol exists
  const coin = db.prepare('SELECT symbol, price_usd FROM coins WHERE symbol = ?').get(symbol);
  if (!coin) return res.status(400).json({ error: 'Unknown symbol' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO price_alerts (id, user_id, symbol, quote_coin, direction, target_price, base_price, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, symbol, quote_coin || 'USDT', direction, target, coin.price_usd, note || null);

  const alert = db.prepare('SELECT * FROM price_alerts WHERE id = ?').get(id);
  res.json({ ...alert, current_price: coin.price_usd });
});

// DELETE /api/price-alerts/:id
router.delete('/:id', authMiddleware, (req, res) => {
  const result = db.prepare('DELETE FROM price_alerts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Alert not found' });
  res.json({ ok: true });
});

// POST /api/price-alerts/:id/toggle - re-arm a triggered alert
router.post('/:id/toggle', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT * FROM price_alerts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Alert not found' });

  const newActive = row.is_active ? 0 : 1;
  db.prepare('UPDATE price_alerts SET is_active = ?, triggered_at = CASE WHEN ? = 1 THEN NULL ELSE triggered_at END WHERE id = ?')
    .run(newActive, newActive, row.id);
  const updated = db.prepare('SELECT * FROM price_alerts WHERE id = ?').get(row.id);
  res.json(updated);
});

export default router;
