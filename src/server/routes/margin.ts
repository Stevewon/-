/**
 * Sprint 4 Phase H1: Margin routes (cross/isolated borrowing, stub).
 * ----------------------------------------------------------------------------
 * Per-user, per-asset margin accounts with borrow/repay flows. Forced 2FA
 * on borrow when Phase F `risk_force_2fa` marker is on. Liquidation engine
 * computes margin_level on every state-changing call.
 *
 * Endpoints:
 *   GET  /margin/accounts                : auth: my margin accounts
 *   GET  /margin/loans                   : auth: my loan ledger
 *   POST /margin/borrow                  : auth: take a loan (2FA-checked)
 *   POST /margin/repay                   : auth: repay a loan
 *   GET  /margin/admin/accounts          : admin: all margin accounts
 *   GET  /margin/admin/at-risk           : admin: margin_level <= 1.2 accounts
 *   POST /margin/admin/pause             : admin: pause/resume margin trading
 */

import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import type { AppEnv } from '../index';
import { logAdminAction } from '../utils/audit';
import { invalidateRiskCache } from '../lib/risk';
import { calcMarginLevel } from '../lib/liquidation-engine';
import { verifyTotp } from '../utils/totp';

const margin = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function uuid(): string {
  return crypto.randomUUID();
}

async function getMarker(c: any, key: string): Promise<string | null> {
  try {
    const row = await c.env.DB.prepare(
      `SELECT value FROM system_markers WHERE key = ?`
    ).bind(key).first<any>();
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function isMarginPaused(c: any): Promise<boolean> {
  return (await getMarker(c, 'margin_paused')) === 'on';
}

async function getOrCreateAccount(
  c: any,
  userId: string,
  asset: string
): Promise<any | null> {
  try {
    let row = await c.env.DB.prepare(
      `SELECT * FROM margin_accounts WHERE user_id = ? AND asset = ?`
    ).bind(userId, asset).first<any>();
    if (row) return row;
    const id = uuid();
    await c.env.DB.prepare(
      `INSERT INTO margin_accounts (id, user_id, asset) VALUES (?, ?, ?)`
    ).bind(id, userId, asset).run();
    row = await c.env.DB.prepare(
      `SELECT * FROM margin_accounts WHERE id = ?`
    ).bind(id).first<any>();
    return row;
  } catch {
    return null;
  }
}

async function refreshAccountStatus(c: any, accountId: string): Promise<void> {
  try {
    const row = await c.env.DB.prepare(
      `SELECT balance, borrowed, interest_accrued FROM margin_accounts WHERE id = ?`
    ).bind(accountId).first<any>();
    if (!row) return;
    const { level, status } = calcMarginLevel(
      row.balance, row.borrowed, row.interest_accrued
    );
    await c.env.DB.prepare(
      `UPDATE margin_accounts
          SET margin_level = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).bind(level, status, accountId).run();
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// User: GET /accounts
// ---------------------------------------------------------------------------
margin.get('/accounts', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  try {
    const r = await c.env.DB.prepare(
      `SELECT id, asset, balance, borrowed, interest_accrued,
              margin_level, status, created_at, updated_at
         FROM margin_accounts
        WHERE user_id = ?
        ORDER BY asset`
    ).bind(user.id).all<any>();
    return c.json({ ok: true, accounts: r?.results ?? [] });
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to load accounts' }, 500);
  }
});

// ---------------------------------------------------------------------------
// User: GET /loans
// ---------------------------------------------------------------------------
margin.get('/loans', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const status = c.req.query('status') || 'active';
  try {
    const r = await c.env.DB.prepare(
      `SELECT id, asset, principal, interest_rate_bps, accrued_interest,
              status, borrowed_at, repaid_at, liquidated_at
         FROM margin_loans
        WHERE user_id = ? AND status = ?
        ORDER BY borrowed_at DESC
        LIMIT 200`
    ).bind(user.id, status).all<any>();
    return c.json({ ok: true, loans: r?.results ?? [] });
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to load loans' }, 500);
  }
});

// ---------------------------------------------------------------------------
// User: POST /borrow  (forced 2FA when risk_force_2fa = on)
// ---------------------------------------------------------------------------
margin.post('/borrow', authMiddleware, async (c) => {
  const user = c.get('user') as any;

  if (await isMarginPaused(c)) {
    return c.json({ ok: false, error: 'Margin trading is paused' }, 503);
  }

  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const asset = String(body?.asset || '').toUpperCase();
  const principal = String(body?.amount || body?.principal || '');
  const totpCode = String(body?.totp_code || '');

  if (!asset || !principal || Number(principal) <= 0) {
    return c.json({ ok: false, error: 'asset and positive amount required' }, 400);
  }

  // Forced 2FA enforcement (Phase F integration)
  const force2fa = (await getMarker(c, 'risk_force_2fa')) === 'on';
  if (force2fa) {
    if (!totpCode) {
      return c.json(
        { ok: false, error: '2FA required for margin borrow', code: 'TOTP_REQUIRED' },
        403
      );
    }
    try {
      const u = await c.env.DB.prepare(
        `SELECT totp_secret FROM users WHERE id = ?`
      ).bind(user.id).first<any>();
      if (!u?.totp_secret) {
        return c.json(
          { ok: false, error: '2FA is forced but not configured on this account', code: 'TOTP_NOT_SET' },
          403
        );
      }
      const ok = await verifyTotp(u.totp_secret, totpCode);
      if (!ok) {
        return c.json({ ok: false, error: 'Invalid 2FA code' }, 401);
      }
    } catch (e) {
      return c.json({ ok: false, error: '2FA verification failed' }, 500);
    }
  }

  const account = await getOrCreateAccount(c, user.id, asset);
  if (!account) return c.json({ ok: false, error: 'Account error' }, 500);

  const loanId = uuid();
  const interestBps = Math.max(1, Math.floor(Number(body?.interest_rate_bps || 10)));

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO margin_loans
           (id, user_id, asset, principal, interest_rate_bps, status)
         VALUES (?, ?, ?, ?, ?, 'active')`
      ).bind(loanId, user.id, asset, principal, interestBps),
      c.env.DB.prepare(
        `UPDATE margin_accounts
            SET balance = CAST(CAST(balance AS REAL) + CAST(? AS REAL) AS TEXT),
                borrowed = CAST(CAST(borrowed AS REAL) + CAST(? AS REAL) AS TEXT),
                updated_at = datetime('now')
          WHERE id = ?`
      ).bind(principal, principal, account.id),
    ]);
  } catch (e) {
    return c.json({ ok: false, error: 'Borrow failed', detail: String(e) }, 500);
  }
  await refreshAccountStatus(c, account.id);
  return c.json({ ok: true, loan_id: loanId, asset, principal, interest_rate_bps: interestBps });
});

// ---------------------------------------------------------------------------
// User: POST /repay
// ---------------------------------------------------------------------------
margin.post('/repay', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const loanId = String(body?.loan_id || '');
  const amount = String(body?.amount || '');
  if (!loanId || !amount || Number(amount) <= 0) {
    return c.json({ ok: false, error: 'loan_id and positive amount required' }, 400);
  }

  const loan = await c.env.DB.prepare(
    `SELECT * FROM margin_loans WHERE id = ? AND user_id = ? AND status='active'`
  ).bind(loanId, user.id).first<any>();
  if (!loan) return c.json({ ok: false, error: 'Active loan not found' }, 404);

  const owed = Number(loan.principal) + Number(loan.accrued_interest || 0);
  const repay = Number(amount);
  if (!isFinite(repay) || repay <= 0) {
    return c.json({ ok: false, error: 'Invalid amount' }, 400);
  }
  const fullRepay = repay >= owed;

  const account = await getOrCreateAccount(c, user.id, loan.asset);
  if (!account) return c.json({ ok: false, error: 'Account error' }, 500);

  try {
    if (fullRepay) {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE margin_loans
              SET status='repaid', repaid_at=datetime('now')
            WHERE id = ?`
        ).bind(loanId),
        c.env.DB.prepare(
          `UPDATE margin_accounts
              SET balance = CAST(MAX(CAST(balance AS REAL) - ?, 0) AS TEXT),
                  borrowed = CAST(MAX(CAST(borrowed AS REAL) - CAST(? AS REAL), 0) AS TEXT),
                  updated_at = datetime('now')
            WHERE id = ?`
        ).bind(owed, loan.principal, account.id),
      ]);
    } else {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE margin_loans
              SET principal = CAST(CAST(principal AS REAL) - ? AS TEXT)
            WHERE id = ?`
        ).bind(repay, loanId),
        c.env.DB.prepare(
          `UPDATE margin_accounts
              SET balance = CAST(MAX(CAST(balance AS REAL) - ?, 0) AS TEXT),
                  borrowed = CAST(MAX(CAST(borrowed AS REAL) - ?, 0) AS TEXT),
                  updated_at = datetime('now')
            WHERE id = ?`
        ).bind(repay, repay, account.id),
      ]);
    }
  } catch (e) {
    return c.json({ ok: false, error: 'Repay failed', detail: String(e) }, 500);
  }
  await refreshAccountStatus(c, account.id);
  return c.json({ ok: true, loan_id: loanId, repaid: amount, full_repay: fullRepay });
});

// ---------------------------------------------------------------------------
// Admin: GET /admin/accounts
// ---------------------------------------------------------------------------
margin.get('/admin/accounts', authMiddleware, adminMiddleware, async (c) => {
  const status = c.req.query('status'); // optional filter
  try {
    let rows: any;
    if (status) {
      rows = await c.env.DB.prepare(
        `SELECT a.id, a.user_id, u.email, a.asset, a.balance, a.borrowed,
                a.interest_accrued, a.margin_level, a.status, a.updated_at
           FROM margin_accounts a
           LEFT JOIN users u ON u.id = a.user_id
          WHERE a.status = ?
          ORDER BY a.updated_at DESC
          LIMIT 500`
      ).bind(status).all<any>();
    } else {
      rows = await c.env.DB.prepare(
        `SELECT a.id, a.user_id, u.email, a.asset, a.balance, a.borrowed,
                a.interest_accrued, a.margin_level, a.status, a.updated_at
           FROM margin_accounts a
           LEFT JOIN users u ON u.id = a.user_id
          ORDER BY a.updated_at DESC
          LIMIT 500`
      ).all<any>();
    }
    return c.json({ ok: true, accounts: rows?.results ?? [] });
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to load admin accounts' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Admin: GET /admin/at-risk  (margin_level <= 1.2 and active)
// ---------------------------------------------------------------------------
margin.get('/admin/at-risk', authMiddleware, adminMiddleware, async (c) => {
  try {
    const r = await c.env.DB.prepare(
      `SELECT a.id, a.user_id, u.email, a.asset, a.balance, a.borrowed,
              a.interest_accrued, a.margin_level, a.status, a.updated_at
         FROM margin_accounts a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.status IN ('margin_call', 'liquidating')
           OR (CAST(a.margin_level AS REAL) > 0
               AND CAST(a.margin_level AS REAL) <= 1.2)
        ORDER BY CAST(a.margin_level AS REAL) ASC
        LIMIT 500`
    ).all<any>();
    return c.json({ ok: true, accounts: r?.results ?? [] });
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to load at-risk accounts' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Admin: POST /admin/pause
// ---------------------------------------------------------------------------
margin.post('/admin/pause', authMiddleware, adminMiddleware, async (c) => {
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const paused = !!body?.paused;
  const value = paused ? 'on' : 'off';
  try {
    await c.env.DB.prepare(
      `INSERT INTO system_markers (key, value, updated_at)
       VALUES ('margin_paused', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
    ).bind(value).run();
    invalidateRiskCache();
    await logAdminAction(c, {
      action: 'margin.pause',
      targetType: 'system',
      targetId: 'margin_paused',
      payload: { paused },
    });
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to set pause', detail: String(e) }, 500);
  }
  return c.json({ ok: true, paused });
});

export default margin;
