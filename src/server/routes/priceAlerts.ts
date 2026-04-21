import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware } from '../middleware/auth';

const app = new Hono<AppEnv>();

function uuid() { return crypto.randomUUID(); }

// GET /api/price-alerts - list user alerts
app.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM price_alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`
  ).bind(user.id).all();
  return c.json(results);
});

// POST /api/price-alerts - create alert
app.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { symbol, direction, target_price, note } = body;

  if (!symbol || !direction || !['above', 'below'].includes(direction)) {
    return c.json({ error: 'Invalid symbol or direction' }, 400);
  }
  const price = parseFloat(target_price);
  if (!(price > 0)) return c.json({ error: 'Invalid target price' }, 400);

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO price_alerts (id, user_id, symbol, direction, target_price, note, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).bind(id, user.id, symbol.toUpperCase(), direction, price, note || null).run();

  const row = await c.env.DB.prepare('SELECT * FROM price_alerts WHERE id = ?').bind(id).first();
  return c.json(row, 201);
});

// PATCH /api/price-alerts/:id - toggle active
app.patch('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const isActive = body.is_active ? 1 : 0;

  const existing = await c.env.DB.prepare(
    'SELECT * FROM price_alerts WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare(
    'UPDATE price_alerts SET is_active = ?, triggered_at = NULL WHERE id = ?'
  ).bind(isActive, id).run();

  const row = await c.env.DB.prepare('SELECT * FROM price_alerts WHERE id = ?').bind(id).first();
  return c.json(row);
});

// DELETE /api/price-alerts/:id
app.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'DELETE FROM price_alerts WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).run();
  return c.json({ ok: true });
});

export default app;
