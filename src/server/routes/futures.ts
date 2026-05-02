/**
 * Sprint 4 Phase H1: Futures routes (perpetual swaps, stub).
 * ----------------------------------------------------------------------------
 * State is fully in D1; no live mark-price feed yet — admin can submit a
 * mark price update which is what powers the liquidation preview today.
 *
 * Endpoints:
 *   GET  /futures/contracts                    : active perpetual contracts
 *   GET  /futures/state                        : public: integration phase + paused flag
 *   GET  /futures/positions                    : auth: my open positions
 *   POST /futures/positions                    : auth: open position (CB checked)
 *   POST /futures/positions/:id/close          : auth: user-initiated close
 *   POST /futures/positions/:id/leverage       : auth: change leverage
 *   GET  /futures/funding-rates                : last N funding ticks for symbol
 *   GET  /futures/admin/positions              : admin: all positions (paginated)
 *   GET  /futures/admin/at-risk                : admin: positions near liquidation
 *   POST /futures/admin/contracts              : admin: upsert a contract
 *   POST /futures/admin/positions/:id/liquidate: admin: force-liquidate a position
 *   POST /futures/admin/pause                  : admin: pause/resume futures markets
 */

import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import type { AppEnv } from '../index';
import { logAdminAction } from '../utils/audit';
import { invalidateRiskCache } from '../lib/risk';
import {
  calcLiquidationPrice,
  calcInitialMargin,
  calcUnrealizedPnl,
  type Side,
  type MarginMode,
} from '../lib/liquidation-engine';
import { getRecentFundingHistory } from '../lib/funding-rate';

const futures = new Hono<AppEnv>();

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

async function isFuturesPaused(c: any): Promise<boolean> {
  const v = await getMarker(c, 'futures_paused');
  return v === 'on';
}

async function isCircuitBreakerOn(c: any): Promise<{ on: boolean; reason: string | null }> {
  const cb = await getMarker(c, 'risk_circuit_breaker');
  const reason = await getMarker(c, 'risk_circuit_breaker_reason');
  return { on: cb === 'on', reason: reason || null };
}

async function getContract(c: any, symbol: string): Promise<any | null> {
  try {
    return await c.env.DB.prepare(
      `SELECT * FROM futures_contracts WHERE symbol = ? AND is_active = 1`
    ).bind(symbol).first<any>();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public: GET /contracts
// ---------------------------------------------------------------------------
futures.get('/contracts', async (c) => {
  try {
    const r = await c.env.DB.prepare(
      `SELECT symbol, base_asset, quote_asset, contract_size, tick_size,
              max_leverage, maintenance_margin_bps, initial_margin_bps,
              funding_interval_sec, taker_fee_bps, maker_fee_bps, is_active
         FROM futures_contracts
        WHERE is_active = 1
        ORDER BY symbol`
    ).all<any>();
    return c.json({ ok: true, contracts: r?.results ?? [] });
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to load contracts' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Public: GET /state
// ---------------------------------------------------------------------------
futures.get('/state', async (c) => {
  const paused = await isFuturesPaused(c);
  const integration = (await getMarker(c, 'futures_integration')) || 'phase-h1-stub';
  const liqEngine = (await getMarker(c, 'liquidation_engine_enabled')) || 'on';
  return c.json({
    ok: true,
    state: {
      paused,
      integration_phase: integration,
      liquidation_engine: liqEngine,
    },
  });
});

// ---------------------------------------------------------------------------
// User: GET /positions
// ---------------------------------------------------------------------------
futures.get('/positions', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const status = c.req.query('status') || 'open';
  try {
    const r = await c.env.DB.prepare(
      `SELECT id, symbol, side, size, entry_price, mark_price, leverage,
              margin_mode, isolated_margin, unrealized_pnl, realized_pnl,
              liquidation_price, status, opened_at, closed_at, closed_price
         FROM futures_positions
        WHERE user_id = ? AND status = ?
        ORDER BY opened_at DESC
        LIMIT 200`
    ).bind(user.id, status).all<any>();
    return c.json({ ok: true, positions: r?.results ?? [] });
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to load positions' }, 500);
  }
});

// ---------------------------------------------------------------------------
// User: POST /positions  (open a new position)
// ---------------------------------------------------------------------------
futures.post('/positions', authMiddleware, async (c) => {
  const user = c.get('user') as any;

  if (await isFuturesPaused(c)) {
    return c.json({ ok: false, error: 'Futures trading is paused' }, 503);
  }
  const cb = await isCircuitBreakerOn(c);
  if (cb.on) {
    return c.json(
      { ok: false, error: 'Circuit breaker is engaged', reason: cb.reason },
      503
    );
  }

  let body: any = {};
  try { body = await c.req.json(); } catch {}

  const symbol = String(body?.symbol || '').toUpperCase();
  const side = body?.side as Side;
  const size = String(body?.size || '');
  const entryPrice = String(body?.entry_price || body?.price || '');
  const leverage = Math.max(1, Math.floor(Number(body?.leverage || 1)));
  const marginMode = (body?.margin_mode || 'cross') as MarginMode;

  if (!symbol || !side || !size || !entryPrice) {
    return c.json({ ok: false, error: 'symbol, side, size, entry_price required' }, 400);
  }
  if (side !== 'long' && side !== 'short') {
    return c.json({ ok: false, error: 'side must be long or short' }, 400);
  }
  if (marginMode !== 'cross' && marginMode !== 'isolated') {
    return c.json({ ok: false, error: 'margin_mode must be cross or isolated' }, 400);
  }
  if (Number(size) <= 0 || Number(entryPrice) <= 0) {
    return c.json({ ok: false, error: 'size and entry_price must be positive' }, 400);
  }

  const contract = await getContract(c, symbol);
  if (!contract) {
    return c.json({ ok: false, error: 'Unknown or inactive contract' }, 404);
  }
  if (leverage > contract.max_leverage) {
    return c.json(
      { ok: false, error: `leverage exceeds max ${contract.max_leverage}x for ${symbol}` },
      400
    );
  }

  const liqPrice = calcLiquidationPrice(
    side,
    entryPrice,
    leverage,
    contract.maintenance_margin_bps
  );
  const initialMargin = calcInitialMargin(size, entryPrice, leverage);

  const id = uuid();
  try {
    await c.env.DB.prepare(
      `INSERT INTO futures_positions
         (id, user_id, symbol, side, size, entry_price, mark_price,
          leverage, margin_mode, isolated_margin, liquidation_price, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`
    ).bind(
      id, user.id, symbol, side, size, entryPrice, entryPrice,
      leverage, marginMode, marginMode === 'isolated' ? initialMargin : '0',
      liqPrice
    ).run();
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to open position', detail: String(e) }, 500);
  }

  return c.json({
    ok: true,
    position: {
      id, symbol, side, size, entry_price: entryPrice,
      leverage, margin_mode: marginMode,
      liquidation_price: liqPrice, initial_margin: initialMargin,
      status: 'open',
    },
  });
});

// ---------------------------------------------------------------------------
// User: POST /positions/:id/close
// ---------------------------------------------------------------------------
futures.post('/positions/:id/close', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const id = c.req.param('id');
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const closePrice = String(body?.close_price || body?.price || '');
  if (!closePrice || Number(closePrice) <= 0) {
    return c.json({ ok: false, error: 'close_price required' }, 400);
  }

  const pos = await c.env.DB.prepare(
    `SELECT * FROM futures_positions WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first<any>();
  if (!pos) return c.json({ ok: false, error: 'Position not found' }, 404);
  if (pos.status !== 'open') {
    return c.json({ ok: false, error: 'Position is not open' }, 400);
  }

  const realized = calcUnrealizedPnl(pos.side, pos.size, pos.entry_price, closePrice);
  try {
    await c.env.DB.prepare(
      `UPDATE futures_positions
          SET status='closed', mark_price=?, realized_pnl=?,
              closed_price=?, closed_reason='user',
              closed_at=datetime('now')
        WHERE id = ? AND user_id = ?`
    ).bind(closePrice, realized, closePrice, id, user.id).run();
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to close position' }, 500);
  }
  return c.json({ ok: true, id, status: 'closed', realized_pnl: realized });
});

// ---------------------------------------------------------------------------
// User: POST /positions/:id/leverage
// ---------------------------------------------------------------------------
futures.post('/positions/:id/leverage', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const id = c.req.param('id');
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const leverage = Math.max(1, Math.floor(Number(body?.leverage || 1)));

  const pos = await c.env.DB.prepare(
    `SELECT * FROM futures_positions WHERE id = ? AND user_id = ? AND status='open'`
  ).bind(id, user.id).first<any>();
  if (!pos) return c.json({ ok: false, error: 'Open position not found' }, 404);

  const contract = await getContract(c, pos.symbol);
  if (!contract) return c.json({ ok: false, error: 'Contract not active' }, 404);
  if (leverage > contract.max_leverage) {
    return c.json(
      { ok: false, error: `leverage exceeds max ${contract.max_leverage}x` },
      400
    );
  }

  const liqPrice = calcLiquidationPrice(
    pos.side, pos.entry_price, leverage, contract.maintenance_margin_bps
  );
  try {
    await c.env.DB.prepare(
      `UPDATE futures_positions
          SET leverage=?, liquidation_price=?
        WHERE id = ? AND user_id = ?`
    ).bind(leverage, liqPrice, id, user.id).run();
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to update leverage' }, 500);
  }
  return c.json({ ok: true, id, leverage, liquidation_price: liqPrice });
});

// ---------------------------------------------------------------------------
// Public: GET /funding-rates?symbol=BTC-PERP&limit=50
// ---------------------------------------------------------------------------
futures.get('/funding-rates', async (c) => {
  const symbol = (c.req.query('symbol') || '').toUpperCase();
  const limit = Math.min(Math.max(1, Number(c.req.query('limit') || 50) | 0), 500);
  if (!symbol) return c.json({ ok: false, error: 'symbol required' }, 400);
  const rows = await getRecentFundingHistory(c.env.DB, symbol, limit);
  return c.json({ ok: true, symbol, history: rows });
});

// ---------------------------------------------------------------------------
// Admin: GET /admin/positions?status=open&limit=200
// ---------------------------------------------------------------------------
futures.get('/admin/positions', authMiddleware, adminMiddleware, async (c) => {
  const status = c.req.query('status') || 'open';
  const limit = Math.min(Math.max(1, Number(c.req.query('limit') || 200) | 0), 1000);
  try {
    const r = await c.env.DB.prepare(
      `SELECT p.id, p.user_id, u.email, p.symbol, p.side, p.size,
              p.entry_price, p.mark_price, p.leverage, p.margin_mode,
              p.unrealized_pnl, p.realized_pnl, p.liquidation_price,
              p.status, p.opened_at, p.closed_at, p.closed_reason
         FROM futures_positions p
         LEFT JOIN users u ON u.id = p.user_id
        WHERE p.status = ?
        ORDER BY p.opened_at DESC
        LIMIT ?`
    ).bind(status, limit).all<any>();
    return c.json({ ok: true, positions: r?.results ?? [] });
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to load admin positions' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Admin: GET /admin/at-risk  (positions where mark within 5% of liq price)
// ---------------------------------------------------------------------------
futures.get('/admin/at-risk', authMiddleware, adminMiddleware, async (c) => {
  try {
    const r = await c.env.DB.prepare(
      `SELECT p.id, p.user_id, u.email, p.symbol, p.side, p.size,
              p.entry_price, p.mark_price, p.leverage, p.liquidation_price,
              p.unrealized_pnl, p.opened_at
         FROM futures_positions p
         LEFT JOIN users u ON u.id = p.user_id
        WHERE p.status = 'open'
          AND p.liquidation_price IS NOT NULL
          AND CAST(p.mark_price AS REAL) > 0
          AND CAST(p.liquidation_price AS REAL) > 0
          AND ABS(CAST(p.mark_price AS REAL) - CAST(p.liquidation_price AS REAL))
              / CAST(p.mark_price AS REAL) <= 0.05
        ORDER BY p.opened_at DESC
        LIMIT 500`
    ).all<any>();
    return c.json({ ok: true, positions: r?.results ?? [] });
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to load at-risk positions' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Admin: POST /admin/contracts  (upsert)
// ---------------------------------------------------------------------------
futures.post('/admin/contracts', authMiddleware, adminMiddleware, async (c) => {
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const symbol = String(body?.symbol || '').toUpperCase();
  if (!symbol) return c.json({ ok: false, error: 'symbol required' }, 400);

  const baseAsset = String(body?.base_asset || symbol.split('-')[0]);
  const quoteAsset = String(body?.quote_asset || 'USDT');
  const maxLev = Math.max(1, Math.floor(Number(body?.max_leverage || 100)));
  const mmBps = Math.max(1, Math.floor(Number(body?.maintenance_margin_bps || 50)));
  const imBps = Math.max(1, Math.floor(Number(body?.initial_margin_bps || 100)));
  const isActive = body?.is_active === false ? 0 : 1;

  try {
    await c.env.DB.prepare(
      `INSERT INTO futures_contracts
         (symbol, base_asset, quote_asset, max_leverage,
          maintenance_margin_bps, initial_margin_bps, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         base_asset=excluded.base_asset,
         quote_asset=excluded.quote_asset,
         max_leverage=excluded.max_leverage,
         maintenance_margin_bps=excluded.maintenance_margin_bps,
         initial_margin_bps=excluded.initial_margin_bps,
         is_active=excluded.is_active`
    ).bind(symbol, baseAsset, quoteAsset, maxLev, mmBps, imBps, isActive).run();
    await logAdminAction(c, {
      action: 'futures.contract_upsert',
      targetType: 'system',
      targetId: symbol,
      payload: { max_leverage: maxLev, mm_bps: mmBps, im_bps: imBps, is_active: isActive },
    });
  } catch (e) {
    return c.json({ ok: false, error: 'Upsert failed', detail: String(e) }, 500);
  }
  return c.json({ ok: true, symbol });
});

// ---------------------------------------------------------------------------
// Admin: POST /admin/positions/:id/liquidate  (force liquidation)
// ---------------------------------------------------------------------------
futures.post('/admin/positions/:id/liquidate', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const markPrice = String(body?.mark_price || '');
  if (!markPrice) return c.json({ ok: false, error: 'mark_price required' }, 400);

  const pos = await c.env.DB.prepare(
    `SELECT * FROM futures_positions WHERE id = ? AND status='open'`
  ).bind(id).first<any>();
  if (!pos) return c.json({ ok: false, error: 'Open position not found' }, 404);

  const realized = calcUnrealizedPnl(pos.side, pos.size, pos.entry_price, markPrice);
  const liqId = uuid();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE futures_positions
            SET status='liquidated', mark_price=?, realized_pnl=?,
                closed_price=?, closed_reason='liquidation',
                closed_at=datetime('now')
          WHERE id = ?`
      ).bind(markPrice, realized, markPrice, id),
      c.env.DB.prepare(
        `INSERT INTO liquidations
           (id, user_id, type, position_id, symbol, side, size,
            liquidation_price, fee, reason)
         VALUES (?, ?, 'futures', ?, ?, ?, ?, ?, '0', 'admin')`
      ).bind(liqId, pos.user_id, id, pos.symbol, pos.side, pos.size, markPrice),
    ]);
    await logAdminAction(c, {
      action: 'futures.force_liquidate',
      targetType: 'system',
      targetId: id,
      payload: { mark_price: markPrice, realized_pnl: realized },
    });
  } catch (e) {
    return c.json({ ok: false, error: 'Liquidation failed', detail: String(e) }, 500);
  }
  return c.json({ ok: true, id, liquidation_id: liqId, realized_pnl: realized });
});

// ---------------------------------------------------------------------------
// Admin: POST /admin/pause  ({ paused: true|false })
// ---------------------------------------------------------------------------
futures.post('/admin/pause', authMiddleware, adminMiddleware, async (c) => {
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const paused = !!body?.paused;
  const value = paused ? 'on' : 'off';
  try {
    await c.env.DB.prepare(
      `INSERT INTO system_markers (key, value, updated_at)
       VALUES ('futures_paused', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
    ).bind(value).run();
    invalidateRiskCache();
    await logAdminAction(c, {
      action: 'futures.pause',
      targetType: 'system',
      targetId: 'futures_paused',
      payload: { paused },
    });
  } catch (e) {
    return c.json({ ok: false, error: 'Failed to set pause', detail: String(e) }, 500);
  }
  return c.json({ ok: true, paused });
});

export default futures;
