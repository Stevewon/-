import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware } from '../middleware/auth';

const app = new Hono<AppEnv>();

function uuid() {
  return crypto.randomUUID();
}

function safeParse(s: any) {
  if (!s) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

// Helper: create notification (reusable from other routes in future)
export async function createNotification(
  db: D1Database,
  userId: string,
  payload: { type: string; title: string; message: string; data?: any }
) {
  const id = uuid();
  await db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, message, data)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    id, userId, payload.type, payload.title, payload.message,
    payload.data ? JSON.stringify(payload.data) : null
  ).run();
  return { id, ...payload, is_read: 0, created_at: new Date().toISOString() };
}

// GET /api/notifications - list notifications
app.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const unreadOnly = c.req.query('unread') === '1';

  const where = unreadOnly ? 'WHERE user_id = ? AND is_read = 0' : 'WHERE user_id = ?';
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ?`
  ).bind(user.id, limit).all();

  const items = (results as any[]).map((r) => ({ ...r, data: safeParse(r.data) }));
  return c.json(items);
});

// GET /api/notifications/unread-count
app.get('/unread-count', authMiddleware, async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
  ).bind(user.id).first<{ count: number }>();
  return c.json({ count: row?.count || 0 });
});

// POST /api/notifications/:id/read
app.post('/:id/read', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).run();
  return c.json({ ok: true });
});

// POST /api/notifications/read-all
app.post('/read-all', authMiddleware, async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
  ).bind(user.id).run();
  return c.json({ ok: true });
});

// DELETE /api/notifications/:id
app.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'DELETE FROM notifications WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).run();
  return c.json({ ok: true });
});

// Note: /stream (SSE) is intentionally omitted on Cloudflare Pages.
// Client will poll /api/notifications every N seconds instead.

export default app;
