import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';

/**
 * SSE subscribers per user.
 * Map<userId, Set<Response>>
 */
const subscribers = new Map();

/**
 * Subscribe a response stream to a user's notifications.
 */
export function subscribe(userId, res) {
  if (!subscribers.has(userId)) subscribers.set(userId, new Set());
  subscribers.get(userId).add(res);
}

export function unsubscribe(userId, res) {
  const set = subscribers.get(userId);
  if (set) {
    set.delete(res);
    if (set.size === 0) subscribers.delete(userId);
  }
}

/**
 * Create a notification and persist it, plus push via SSE to subscribed clients.
 */
export function createNotification(userId, { type, title, message, data }) {
  const id = uuidv4();
  try {
    db.prepare(`INSERT INTO notifications (id, user_id, type, title, message, data) VALUES (?,?,?,?,?,?)`)
      .run(id, userId, type, title, message || null, data ? JSON.stringify(data) : null);
  } catch (e) {
    console.error('[notifications] insert failed:', e);
    return null;
  }

  const payload = {
    id, type, title, message,
    data: data || null,
    is_read: 0,
    created_at: new Date().toISOString(),
  };

  const set = subscribers.get(userId);
  if (set) {
    const frame = `event: notification\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of set) {
      try { res.write(frame); } catch (_) { /* ignored */ }
    }
  }

  return payload;
}

/**
 * Get notifications for a user.
 */
export function getNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  const rows = unreadOnly
    ? db.prepare('SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC LIMIT ?').all(userId, limit)
    : db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
  return rows.map(r => ({
    ...r,
    data: r.data ? safeParse(r.data) : null,
  }));
}

export function markRead(userId, id) {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id = ?').run(userId, id);
}

export function markAllRead(userId) {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);
}

export function deleteNotification(userId, id) {
  db.prepare('DELETE FROM notifications WHERE user_id = ? AND id = ?').run(userId, id);
}

export function unreadCount(userId) {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0').get(userId);
  return row?.cnt || 0;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
