// ============================================================================
// Convert — Bybit-style instant QTA → USDT swap  (OWNER_RULES §14, 2026-09-26)
// ----------------------------------------------------------------------------
// Owner: "바이빗처럼 우리도 데일리로 얻은 QTA를 바로 USDT로 스왑할 수 있게 …
//         바이빗은 어떤 식인지 분석해서 우리도 같은 케이스로 적용"
//
// How Bybit Convert works (and what we mirror 1:1):
//   • Two-step: [Quote] → price shown, valid ~10 s → [Confirm] executes at the
//     quoted price. No slippage, zero fee.
//   • OTC / RFQ model: the counter-party is Bybit's market makers, NOT the
//     spot order book. The fill is NOT a spot trade → it never appears on the
//     tape, never moves the candle chart, never changes 24h volume.
//   • The quote is derived from the spot index price, may differ slightly
//     from the last spot print (MM spread).
//
// QuantaEX mapping:
//   • Counter-party  = company treasury (admin account). Member's QTA moves to
//     the treasury wallet; USDT paid from the treasury wallet. No row in
//     `trades`, no candle update, no order-book touch, no price_usd update.
//   • Price          = best resting company BID (mm-bot wall) − spread_bps
//                      (system_state.convert_spread_bps, default 30 bps).
//   • Quote validity = 10 s (CONVERT_QUOTE_TTL_SEC).
//   • Fee            = 0.
//   • Gates (SAME as spot sell — nothing bypasses the owner's rules):
//       §12 sell pre-approval (approved OR shareholder)      → SELL_NOT_APPROVED
//       §6  KRW 50,000 / day SHARED with spot sells          → DAILY_SELL_CAP_REACHED
//       feature switch system_state.convert_enabled='on'     → CONVERT_DISABLED
//   • The USDT the member receives is NOT company-issued: available_initial
//     is NOT bumped, so it counts as withdrawable (normal §12 Friday window
//     rules apply). The QTA they spent may well have been company-issued
//     (daily reward) — that's the whole point: the company buys it back.
// ============================================================================

import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { loadSellApproval } from '../../shared/shareholder';
import {
  MEMBER_SELL_CAP_KRW, MEMBER_SELL_CAP_USDT, USDT_KRW_RATE,
  kstDayStart, memberSoldSince, memberSellRoomUsdt,
} from '../../shared/sell-cap';

const app = new Hono<AppEnv>();

export const CONVERT_QUOTE_TTL_SEC = 10;
const DEFAULT_SPREAD_BPS = 30;
const MIN_CONVERT_USDT = 1;          // ≥ 1 USDT out (market min_order_total)
const QTA_MARKET_SQL = "SELECT id, min_order_total, price_decimals, amount_decimals FROM markets WHERE base_coin='QTA' AND quote_coin='USDT' LIMIT 1";

const rlQuote = rateLimit({ key: 'convert:quote', max: 60, windowSec: 60, selector: (c) => (c.get('user') as any)?.id || 'anon' });
const rlAccept = rateLimit({ key: 'convert:accept', max: 30, windowSec: 60, selector: (c) => (c.get('user') as any)?.id || 'anon' });

function uuid(): string { return crypto.randomUUID(); }
function floorTo(n: number, d: number): number { const p = Math.pow(10, Math.max(0, Math.min(18, d | 0))); return Math.floor(n * p + 1e-9) / p; }
function nowSql(): string { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

async function ensureSchema(DB: D1Database): Promise<void> {
  try {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS convert_orders (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, from_coin TEXT NOT NULL, to_coin TEXT NOT NULL,
      from_amount REAL NOT NULL, to_amount REAL NOT NULL, price REAL NOT NULL, ref_price REAL,
      spread_bps INTEGER NOT NULL DEFAULT 0, fee_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'quoted', quote_expires_at TEXT NOT NULL, filled_at TEXT,
      treasury_user_id TEXT, source TEXT NOT NULL DEFAULT 'convert', error TEXT, ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  } catch { /* ignore */ }
}

async function stateGet(DB: D1Database, key: string): Promise<string | null> {
  const r = await DB.prepare('SELECT value FROM system_state WHERE key = ?').bind(key).first<{ value: string }>().catch(() => null);
  return r?.value ?? null;
}

async function convertEnabled(DB: D1Database): Promise<boolean> {
  const v = await stateGet(DB, 'convert_enabled');
  return v == null ? true : v !== 'off';
}

async function spreadBps(DB: D1Database): Promise<number> {
  const v = Number(await stateGet(DB, 'convert_spread_bps'));
  return Number.isFinite(v) && v >= 0 && v <= 1000 ? Math.round(v) : DEFAULT_SPREAD_BPS;
}

async function treasuryUserId(DB: D1Database): Promise<string | null> {
  const r = await DB.prepare(
    "SELECT id FROM users WHERE role = 'admin' OR email = 'admin@quantaex.io' ORDER BY (email='admin@quantaex.io') DESC LIMIT 1",
  ).first<{ id: string }>().catch(() => null);
  return r?.id ?? null;
}

/** Reference price = best resting company bid; fallback coins.price_usd. */
async function referencePrice(DB: D1Database, marketId: string): Promise<number> {
  const bid = await DB.prepare(
    "SELECT price FROM orders WHERE market_id=? AND side='buy' AND status IN ('open','partial') ORDER BY price DESC LIMIT 1",
  ).bind(marketId).first<{ price: number }>().catch(() => null);
  let px = Number(bid?.price || 0);
  if (!(px > 0)) {
    const coin = await DB.prepare("SELECT price_usd FROM coins WHERE symbol='QTA'").first<{ price_usd: number }>().catch(() => null);
    px = Number(coin?.price_usd || 0);
  }
  return px;
}

function isCompany(user: any): boolean {
  return user?.role === 'admin' || user?.email === 'admin@quantaex.io';
}

// ----------------------------------------------------------------------------
// GET /convert/status — everything the Convert screen needs to render
// ----------------------------------------------------------------------------
app.get('/status', authMiddleware, async (c) => {
  const user = c.get('user');
  const DB = c.env.DB;
  await ensureSchema(DB);
  const market = await DB.prepare(QTA_MARKET_SQL).first<any>();
  if (!market) return c.json({ error: 'market not found' }, 404);
  const [enabled, bps, approval, ref, wallet] = await Promise.all([
    convertEnabled(DB), spreadBps(DB), loadSellApproval(DB as any, user.id), referencePrice(DB, market.id),
    DB.prepare("SELECT available, COALESCE(available_initial,0) available_initial FROM wallets WHERE user_id=? AND coin_symbol='QTA'").bind(user.id).first<any>().catch(() => null),
  ]);
  const { dayStartUtc, resetsAtIso } = kstDayStart();
  const [today, total] = await Promise.all([
    memberSoldSince(DB as any, market.id, user.id, dayStartUtc),
    memberSoldSince(DB as any, market.id, user.id),
  ]);
  const company = isCompany(user);
  const remaining = company ? null : Math.max(0, MEMBER_SELL_CAP_USDT - today.usdt);
  const price = ref > 0 ? floorTo(ref * (1 - bps / 10000), Number(market.price_decimals) || 8) : 0;
  return c.json({
    enabled,
    approved: company || approval.approved,
    approval_source: company ? 'company' : approval.explicit ? 'admin' : approval.via_shareholder ? 'shareholder' : null,
    from_coin: 'QTA', to_coin: 'USDT',
    qta_available: Number(wallet?.available || 0),
    ref_price: ref, price, spread_bps: bps, fee: 0,
    quote_ttl_sec: CONVERT_QUOTE_TTL_SEC,
    min_to_amount: MIN_CONVERT_USDT,
    cap_krw: MEMBER_SELL_CAP_KRW, cap_usdt: Math.round(MEMBER_SELL_CAP_USDT * 100) / 100, usdt_krw_rate: USDT_KRW_RATE,
    today_sold_usdt: Math.round(today.usdt * 1e4) / 1e4, today_sold_qta: today.qta,
    today_convert_usdt: Math.round(today.convert_usdt * 1e4) / 1e4, today_spot_usdt: Math.round(today.spot_usdt * 1e4) / 1e4,
    remaining_usdt: remaining == null ? null : Math.round(remaining * 1e4) / 1e4,
    remaining_krw: remaining == null ? null : Math.round(remaining * USDT_KRW_RATE),
    remaining_qta: remaining == null || !(price > 0) ? null : floorTo(remaining / price, Number(market.amount_decimals) || 4),
    total_sold_usdt: Math.round(total.usdt * 1e4) / 1e4, total_sold_qta: total.qta, total_fills: total.n,
    resets_at: resetsAtIso,
  });
});

// ----------------------------------------------------------------------------
// POST /convert/quote  { from_amount?: number, to_amount?: number }
//   → { quote_id, price, from_amount, to_amount, expires_at, ttl_sec }
// Funds are NOT locked at quote time (Bybit behaviour) — the accept step does
// an atomic conditional debit.
// ----------------------------------------------------------------------------
app.post('/quote', authMiddleware, rlQuote, async (c) => {
  const user = c.get('user');
  const DB = c.env.DB;
  await ensureSchema(DB);
  if (!(await convertEnabled(DB))) return c.json({ error: 'CONVERT_DISABLED', message: 'Convert is temporarily unavailable.' }, 503);

  const body = await c.req.json().catch(() => ({} as any));
  const fromCoin = String(body.from_coin || 'QTA').toUpperCase();
  const toCoin = String(body.to_coin || 'USDT').toUpperCase();
  if (fromCoin !== 'QTA' || toCoin !== 'USDT') return c.json({ error: 'PAIR_NOT_SUPPORTED', message: 'Only QTA → USDT is supported.' }, 400);

  const market = await DB.prepare(QTA_MARKET_SQL).first<any>();
  if (!market) return c.json({ error: 'market not found' }, 404);
  const pdec = Number(market.price_decimals) || 8, adec = Number(market.amount_decimals) || 4;

  // §12 — pre-approved sellers only (shareholders auto).
  const company = isCompany(user);
  if (!company) {
    const approval = await loadSellApproval(DB as any, user.id);
    if (!approval.approved) {
      return c.json({ error: 'SELL_NOT_APPROVED', message: 'Selling QTA requires prior approval from the exchange. Please contact support.' }, 403);
    }
  }

  const ref = await referencePrice(DB, market.id);
  if (!(ref > 0)) return c.json({ error: 'PRICE_UNAVAILABLE', message: 'Reference price unavailable. Try again shortly.' }, 503);
  const bps = await spreadBps(DB);
  const price = floorTo(ref * (1 - bps / 10000), pdec);
  if (!(price > 0)) return c.json({ error: 'PRICE_UNAVAILABLE' }, 503);

  // Amount: either side may be given; we always settle on from_amount (QTA).
  let fromAmount = Number(body.from_amount);
  if (!(fromAmount > 0) && Number(body.to_amount) > 0) fromAmount = Number(body.to_amount) / price;
  if (!isFinite(fromAmount) || !(fromAmount > 0)) return c.json({ error: 'Invalid request' }, 400);
  fromAmount = floorTo(fromAmount, adec);

  // Balance check (informational here; hard-guarded at accept).
  const wallet = await DB.prepare("SELECT available FROM wallets WHERE user_id=? AND coin_symbol='QTA'").bind(user.id).first<{ available: number }>().catch(() => null);
  const avail = Number(wallet?.available || 0);
  if (fromAmount > avail + 1e-12) return c.json({ error: 'INSUFFICIENT_BALANCE', message: 'Insufficient QTA balance.', available: avail }, 400);

  // §6 daily cap — shared with spot sells. Clamp like a market sell would be.
  let clamped = false;
  if (!company) {
    const room = await memberSellRoomUsdt(DB as any, market.id, user.id);
    if (room < MIN_CONVERT_USDT) {
      return c.json({ error: 'DAILY_SELL_CAP_REACHED', message: 'Daily QTA sell limit (KRW 50,000) reached. Try again after 00:00 KST.', remaining_usdt: room }, 400);
    }
    const maxQty = floorTo(room / price, adec);
    if (fromAmount > maxQty) { fromAmount = maxQty; clamped = true; }
  }
  const toAmount = floorTo(fromAmount * price, 6);
  if (!(fromAmount > 0) || toAmount < MIN_CONVERT_USDT) {
    return c.json({ error: 'BELOW_MINIMUM', message: `Minimum conversion is ${MIN_CONVERT_USDT} USDT.`, min_to_amount: MIN_CONVERT_USDT }, 400);
  }

  const id = uuid();
  const expiresAt = new Date(Date.now() + CONVERT_QUOTE_TTL_SEC * 1000);
  const ip = c.req.header('CF-Connecting-IP') || null;
  await DB.prepare(
    `INSERT INTO convert_orders (id, user_id, from_coin, to_coin, from_amount, to_amount, price, ref_price, spread_bps, fee_amount, status, quote_expires_at, ip_address)
     VALUES (?,?,?,?,?,?,?,?,?,0,'quoted',?,?)`,
  ).bind(id, user.id, 'QTA', 'USDT', fromAmount, toAmount, price, ref, bps, expiresAt.toISOString().slice(0, 19).replace('T', ' '), ip).run();

  return c.json({
    quote_id: id, from_coin: 'QTA', to_coin: 'USDT',
    from_amount: fromAmount, to_amount: toAmount, price, ref_price: ref, spread_bps: bps, fee: 0,
    inverse_price: price > 0 ? 1 / price : 0,
    clamped_to_daily_cap: clamped,
    expires_at: expiresAt.toISOString(), ttl_sec: CONVERT_QUOTE_TTL_SEC,
  });
});

// ----------------------------------------------------------------------------
// POST /convert/accept  { quote_id }
// Atomic settlement against the treasury. Re-checks every gate at fill time.
// ----------------------------------------------------------------------------
app.post('/accept', authMiddleware, rlAccept, async (c) => {
  const user = c.get('user');
  const DB = c.env.DB;
  await ensureSchema(DB);
  const body = await c.req.json().catch(() => ({} as any));
  const quoteId = String(body.quote_id || '');
  if (!quoteId) return c.json({ error: 'Invalid request' }, 400);

  const q = await DB.prepare('SELECT * FROM convert_orders WHERE id=? AND user_id=?').bind(quoteId, user.id).first<any>();
  if (!q) return c.json({ error: 'QUOTE_NOT_FOUND' }, 404);
  if (q.status !== 'quoted') return c.json({ error: 'QUOTE_ALREADY_USED', status: q.status }, 409);
  if (new Date(String(q.quote_expires_at).replace(' ', 'T') + 'Z').getTime() < Date.now()) {
    await DB.prepare("UPDATE convert_orders SET status='expired', updated_at=datetime('now') WHERE id=? AND status='quoted'").bind(quoteId).run();
    return c.json({ error: 'QUOTE_EXPIRED', message: 'Quote expired. Please request a new quote.' }, 410);
  }
  if (!(await convertEnabled(DB))) return c.json({ error: 'CONVERT_DISABLED' }, 503);

  const market = await DB.prepare(QTA_MARKET_SQL).first<any>();
  if (!market) return c.json({ error: 'market not found' }, 404);
  const company = isCompany(user);

  // §12 re-check at fill time (approval could have been revoked in the 10 s).
  if (!company) {
    const approval = await loadSellApproval(DB as any, user.id);
    if (!approval.approved) {
      await DB.prepare("UPDATE convert_orders SET status='cancelled', error='SELL_NOT_APPROVED', updated_at=datetime('now') WHERE id=?").bind(quoteId).run();
      return c.json({ error: 'SELL_NOT_APPROVED' }, 403);
    }
    // §6 re-check — the shared cap may have been consumed by a spot fill meanwhile.
    const room = await memberSellRoomUsdt(DB as any, market.id, user.id);
    if (Number(q.to_amount) > room + 1e-9) {
      await DB.prepare("UPDATE convert_orders SET status='cancelled', error='DAILY_SELL_CAP_REACHED', updated_at=datetime('now') WHERE id=?").bind(quoteId).run();
      return c.json({ error: 'DAILY_SELL_CAP_REACHED', message: 'Daily QTA sell limit (KRW 50,000) reached.', remaining_usdt: room }, 400);
    }
  }

  const treasury = await treasuryUserId(DB);
  if (!treasury) return c.json({ error: 'TREASURY_NOT_CONFIGURED' }, 500);
  if (treasury === user.id) return c.json({ error: 'COMPANY_ACCOUNT_CANNOT_CONVERT' }, 400);

  const fromAmt = Number(q.from_amount), toAmt = Number(q.to_amount);

  // 1) Claim the quote (single-use, status-guarded).
  const claim = await DB.prepare(
    "UPDATE convert_orders SET status='filling', updated_at=datetime('now') WHERE id=? AND status='quoted'",
  ).bind(quoteId).run();
  if (!claim.meta || claim.meta.changes === 0) return c.json({ error: 'QUOTE_ALREADY_USED' }, 409);

  // 2) Treasury must have the USDT (atomic conditional debit).
  const payUsdt = await DB.prepare(
    "UPDATE wallets SET available = available - ? WHERE user_id=? AND coin_symbol='USDT' AND available >= ?",
  ).bind(toAmt, treasury, toAmt).run();
  if (!payUsdt.meta || payUsdt.meta.changes === 0) {
    await DB.prepare("UPDATE convert_orders SET status='failed', error='TREASURY_INSUFFICIENT_USDT', updated_at=datetime('now') WHERE id=?").bind(quoteId).run();
    return c.json({ error: 'LIQUIDITY_UNAVAILABLE', message: 'Convert liquidity is temporarily unavailable. Please try again later.' }, 503);
  }

  // 3) Debit the member's QTA (atomic conditional).
  const takeQta = await DB.prepare(
    "UPDATE wallets SET available = available - ? WHERE user_id=? AND coin_symbol='QTA' AND available >= ?",
  ).bind(fromAmt, user.id, fromAmt).run();
  if (!takeQta.meta || takeQta.meta.changes === 0) {
    // roll back treasury USDT
    await DB.prepare("UPDATE wallets SET available = available + ? WHERE user_id=? AND coin_symbol='USDT'").bind(toAmt, treasury).run();
    await DB.prepare("UPDATE convert_orders SET status='failed', error='INSUFFICIENT_BALANCE', updated_at=datetime('now') WHERE id=?").bind(quoteId).run();
    return c.json({ error: 'INSUFFICIENT_BALANCE', message: 'Insufficient QTA balance.' }, 400);
  }
  // The spent QTA may have been company-issued; shrink available_initial so it
  // never exceeds available (keeps withdrawable math consistent).
  await DB.prepare(
    "UPDATE wallets SET available_initial = MIN(COALESCE(available_initial,0), available) WHERE user_id=? AND coin_symbol='QTA'",
  ).bind(user.id).run().catch(() => {});

  // 4) Credit member USDT (withdrawable — NOT company-issued) and treasury QTA.
  const credit = await DB.prepare(
    "UPDATE wallets SET available = available + ? WHERE user_id=? AND coin_symbol='USDT'",
  ).bind(toAmt, user.id).run();
  if (!credit.meta || credit.meta.changes === 0) {
    await DB.prepare("INSERT INTO wallets (id, user_id, coin_symbol, available, locked, available_initial) VALUES (?,?,'USDT',?,0,0)").bind(uuid(), user.id, toAmt).run();
  }
  const tq = await DB.prepare("UPDATE wallets SET available = available + ? WHERE user_id=? AND coin_symbol='QTA'").bind(fromAmt, treasury).run();
  if (!tq.meta || tq.meta.changes === 0) {
    await DB.prepare("INSERT INTO wallets (id, user_id, coin_symbol, available, locked) VALUES (?,?,'QTA',?,0)").bind(uuid(), treasury, fromAmt).run();
  }

  // 5) Finalise.
  const filledAt = nowSql();
  await DB.prepare(
    "UPDATE convert_orders SET status='filled', filled_at=?, treasury_user_id=?, updated_at=datetime('now') WHERE id=?",
  ).bind(filledAt, treasury, quoteId).run();

  // Notification (member-facing → English).
  await DB.prepare(
    `INSERT INTO notifications (id, user_id, type, title, message, data) VALUES (?,?,'convert',?,?,?)`,
  ).bind(
    uuid(), user.id, 'Convert completed',
    `Converted ${fromAmt.toLocaleString('en-US', { maximumFractionDigits: 6 })} QTA → ${toAmt.toFixed(4)} USDT @ ${Number(q.price)} USDT/QTA (0 fee).`,
    JSON.stringify({ convert_id: quoteId, from_amount: fromAmt, to_amount: toAmt, price: Number(q.price) }),
  ).run().catch(() => {});

  const { dayStartUtc } = kstDayStart();
  const today = await memberSoldSince(DB as any, market.id, user.id, dayStartUtc);
  return c.json({
    ok: true, id: quoteId, status: 'filled',
    from_coin: 'QTA', to_coin: 'USDT', from_amount: fromAmt, to_amount: toAmt, price: Number(q.price), fee: 0,
    filled_at: filledAt,
    today_sold_usdt: Math.round(today.usdt * 1e4) / 1e4,
    remaining_usdt: company ? null : Math.round(Math.max(0, MEMBER_SELL_CAP_USDT - today.usdt) * 1e4) / 1e4,
  });
});

// ----------------------------------------------------------------------------
// GET /convert/history — member's own conversions (filled / failed)
// ----------------------------------------------------------------------------
app.get('/history', authMiddleware, async (c) => {
  const user = c.get('user');
  await ensureSchema(c.env.DB);
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
  const { results } = await c.env.DB.prepare(
    `SELECT id, from_coin, to_coin, from_amount, to_amount, price, ref_price, spread_bps, fee_amount, status, filled_at, error, created_at
       FROM convert_orders WHERE user_id=? AND status IN ('filled','failed','expired','cancelled')
       ORDER BY created_at DESC LIMIT ?`,
  ).bind(user.id, limit).all<any>();
  return c.json(results || []);
});

export default app;
