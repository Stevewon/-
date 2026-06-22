/**
 * Notices route — public read endpoint for the marketing notice board.
 * Admin CRUD lives in /api/admin/notices (admin.ts).
 *
 * The DB schema and seed live in migration 0033 +
 * src/server/index.ts ageGateNoticesKycDocsBootstrap.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../index';

const app = new Hono<AppEnv>();

/**
 * GET /api/notices
 * Public — anyone (logged in or not) can read published notices.
 *
 * Query params:
 *   - type?: 'notice' | 'event' | 'maintenance' | 'listing'
 *   - limit?: number (default 100, max 200)
 *
 * Returns:
 *   { notices: [{ id, type, title_ko, title_en, content_ko, content_en,
 *                 pinned, created_at, updated_at }] }
 *
 * Pinned notices always come first; ties break by created_at DESC.
 * Soft-deleted (published=0) entries are excluded.
 */
app.get('/', async (c) => {
  const type = (c.req.query('type') || '').trim();
  const limitRaw = parseInt(c.req.query('limit') || '100', 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? 100 : limitRaw, 1), 200);

  try {
    let query =
      `SELECT id, type, title_ko, title_en, content_ko, content_en,
              pinned, created_at, updated_at
         FROM notices
        WHERE published = 1`;
    const bindings: any[] = [];
    if (type && ['notice', 'event', 'maintenance', 'listing'].includes(type)) {
      query += ' AND type = ?';
      bindings.push(type);
    }
    query += ' ORDER BY pinned DESC, created_at DESC LIMIT ?';
    bindings.push(limit);

    const res = await c.env.DB.prepare(query).bind(...bindings).all<any>();
    return c.json({ notices: res.results || [] });
  } catch (e: any) {
    // If the notices table doesn't exist yet (cold deploy before bootstrap
    // finishes), return an empty list rather than 500. The bootstrap is
    // running asynchronously and will catch up.
    if (String(e?.message || '').includes('no such table')) {
      return c.json({ notices: [] });
    }
    throw e;
  }
});

/**
 * GET /api/notices/:id
 * Public — single notice detail. Useful for deep links from email/social.
 */
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  try {
    const row = await c.env.DB.prepare(
      `SELECT id, type, title_ko, title_en, content_ko, content_en,
              pinned, created_at, updated_at
         FROM notices
        WHERE id = ? AND published = 1`
    ).bind(id).first();
    if (!row) return c.json({ error: 'Notice not found' }, 404);
    return c.json({ notice: row });
  } catch (e: any) {
    if (String(e?.message || '').includes('no such table')) {
      return c.json({ error: 'Notice not found' }, 404);
    }
    throw e;
  }
});

export default app;
