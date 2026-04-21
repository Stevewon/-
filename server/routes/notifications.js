import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';
import {
  getNotifications, markRead, markAllRead, deleteNotification,
  unreadCount, subscribe, unsubscribe,
} from '../services/notifications.js';
import db from '../database.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'quantaex-dev-secret';

// List notifications
router.get('/', authMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const unreadOnly = req.query.unread === '1';
  const rows = getNotifications(req.user.id, { limit, unreadOnly });
  res.json(rows);
});

// Unread count
router.get('/unread-count', authMiddleware, (req, res) => {
  res.json({ count: unreadCount(req.user.id) });
});

// Mark one as read
router.post('/:id/read', authMiddleware, (req, res) => {
  markRead(req.user.id, req.params.id);
  res.json({ ok: true });
});

// Mark all as read
router.post('/read-all', authMiddleware, (req, res) => {
  markAllRead(req.user.id);
  res.json({ ok: true });
});

// Delete one
router.delete('/:id', authMiddleware, (req, res) => {
  deleteNotification(req.user.id, req.params.id);
  res.json({ ok: true });
});

/**
 * SSE stream of live notifications.
 * Token is passed via ?token=... query param because EventSource doesn't
 * support custom headers.
 */
router.get('/stream', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).end();

  let userId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.id;
  } catch (e) {
    return res.status(401).end();
  }

  // Verify user still exists
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(401).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial heartbeat
  res.write(`event: ready\ndata: {"ok":true}\n\n`);

  subscribe(userId, res);

  // Heartbeat every 20s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch { /* ignored */ }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe(userId, res);
  });
});

export default router;
