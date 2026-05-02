/**
 * Risk control routes — Sprint 4 Phase D.
 *
 * Lightweight admin-controlled risk levers, persisted via the existing
 * `system_markers` key/value store (no schema migration needed).
 *
 * Markers used:
 *   risk_circuit_breaker        → 'on' | 'off'   (global trade halt)
 *   risk_circuit_breaker_reason → free text
 *   risk_force_2fa              → 'on' | 'off'   (force 2FA on withdrawals)
 *   risk_ip_blocklist           → JSON array of CIDR/IP strings
 *
 * Endpoints:
 *   GET  /risk/state                         : current risk state snapshot
 *   POST /risk/circuit-breaker               : toggle global trade halt
 *   POST /risk/force-2fa                     : toggle forced 2FA on withdrawals
 *   POST /risk/ip-block                      : add IP to blocklist
 *   POST /risk/ip-unblock                    : remove IP from blocklist
 *
 * All endpoints require authMiddleware + adminMiddleware. Each mutation
 * is recorded via logAdminAction for the audit log.
 */

import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import type { AppEnv } from '../index';
import { logAdminAction } from '../utils/audit';

const risk = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getMarker(c: any, key: string): Promise<string | null> {
  const row = await c.env.DB.prepare(
    `SELECT value FROM system_markers WHERE key = ?`
  ).bind(key).first<any>();
  return row?.value ?? null;
}

async function setMarker(c: any, key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO system_markers (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, now).run();
}

function parseList(s: string | null): string[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET /risk/state — admin snapshot of all risk levers
// ---------------------------------------------------------------------------
risk.get('/state', authMiddleware, adminMiddleware, async (c) => {
  const [breaker, breakerReason, force2fa, blocklist] = await Promise.all([
    getMarker(c, 'risk_circuit_breaker'),
    getMarker(c, 'risk_circuit_breaker_reason'),
    getMarker(c, 'risk_force_2fa'),
    getMarker(c, 'risk_ip_blocklist'),
  ]);

  return c.json({
    ok: true,
    circuit_breaker: {
      enabled: breaker === 'on',
      reason: breakerReason || null,
    },
    force_2fa: { enabled: force2fa === 'on' },
    ip_blocklist: parseList(blocklist),
  });
});

// ---------------------------------------------------------------------------
// POST /risk/circuit-breaker  { enabled: boolean, reason?: string }
//   Global trade halt — order route should consult this marker before
//   accepting new orders. (Wiring in order.ts can land in a follow-up PR.)
// ---------------------------------------------------------------------------
risk.post('/circuit-breaker', authMiddleware, adminMiddleware, async (c) => {
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const enabled = !!body.enabled;
  const reason = String(body.reason || '').slice(0, 200);

  await setMarker(c, 'risk_circuit_breaker', enabled ? 'on' : 'off');
  if (reason) await setMarker(c, 'risk_circuit_breaker_reason', reason);

  await logAdminAction(c, {
    action: enabled ? 'risk.circuit_breaker.enable' : 'risk.circuit_breaker.disable',
    targetType: 'system',
    payload: { enabled, reason },
  });

  return c.json({ ok: true, circuit_breaker: { enabled, reason: reason || null } });
});

// ---------------------------------------------------------------------------
// POST /risk/force-2fa  { enabled: boolean }
//   When enabled, withdrawals must include a valid 2FA challenge regardless
//   of per-user setting. (Wiring in wallet.ts can land in a follow-up PR.)
// ---------------------------------------------------------------------------
risk.post('/force-2fa', authMiddleware, adminMiddleware, async (c) => {
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const enabled = !!body.enabled;

  await setMarker(c, 'risk_force_2fa', enabled ? 'on' : 'off');

  await logAdminAction(c, {
    action: enabled ? 'risk.force_2fa.enable' : 'risk.force_2fa.disable',
    targetType: 'system',
    payload: { enabled },
  });

  return c.json({ ok: true, force_2fa: { enabled } });
});

// ---------------------------------------------------------------------------
// POST /risk/ip-block    { ip: string, reason?: string }
//   Adds an IP / CIDR string to the blocklist marker. Callers (auth + order
//   routes) consult this list and reject matching requests.
// ---------------------------------------------------------------------------
risk.post('/ip-block', authMiddleware, adminMiddleware, async (c) => {
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const ip = String(body.ip || '').trim();
  const reason = String(body.reason || '').slice(0, 200);
  if (!ip || !/^[0-9a-fA-F:.\/]+$/.test(ip) || ip.length > 64) {
    return c.json({ ok: false, error: 'invalid_ip' }, 400);
  }

  const list = parseList(await getMarker(c, 'risk_ip_blocklist'));
  if (!list.includes(ip)) list.push(ip);
  await setMarker(c, 'risk_ip_blocklist', JSON.stringify(list));

  await logAdminAction(c, {
    action: 'risk.ip_block',
    targetType: 'system',
    payload: { ip, reason },
  });

  return c.json({ ok: true, ip_blocklist: list });
});

// ---------------------------------------------------------------------------
// POST /risk/ip-unblock  { ip: string }
// ---------------------------------------------------------------------------
risk.post('/ip-unblock', authMiddleware, adminMiddleware, async (c) => {
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const ip = String(body.ip || '').trim();
  if (!ip) return c.json({ ok: false, error: 'invalid_ip' }, 400);

  const list = parseList(await getMarker(c, 'risk_ip_blocklist')).filter((x) => x !== ip);
  await setMarker(c, 'risk_ip_blocklist', JSON.stringify(list));

  await logAdminAction(c, {
    action: 'risk.ip_unblock',
    targetType: 'system',
    payload: { ip },
  });

  return c.json({ ok: true, ip_blocklist: list });
});

export default risk;
