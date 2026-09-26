// ============================================================================
// QTA member-sell daily cap — ONE budget shared by SPOT sells and CONVERT
// (OWNER_RULES §6 + §12 + §14, owner 2026-09-26: "데일리로 얻은 QTA를 바로
// USDT로 스왑" — Bybit-style Convert)
// ----------------------------------------------------------------------------
// The company buys back at most KRW 50,000 (= 34.48 USDT @ 1,450) of QTA per
// member per KST day. Two channels consume this SAME budget:
//   • spot market : trades WHERE buyer_id IN (mm-bot-a, mm-bot-b) AND seller=u
//   • convert     : convert_orders WHERE user_id=u AND status='filled'
//                   (from QTA → USDT, off-book OTC, never touches trades /
//                   candles / order book — exactly like Bybit Convert)
// Every gate (order placement, matchOrder fill clamp, mm-tick sweep,
// /qta-sell-status widget, admin sellers list, convert quote) MUST use
// `memberSoldTodayUsdt()` so a member cannot double-dip 5만원 twice.
//
// Shared by the Pages API (src/server/**) and copied verbatim to
// cron-worker/src/sell-cap.ts.
// ============================================================================

export const MM_BOT_A = 'mm-bot-a';
export const MM_BOT_B = 'mm-bot-b';
/** ★ OWNER RULE (2026-09-05): fixed USDT↔KRW rate while the market is seeded. */
export const USDT_KRW_RATE = 1450;
export const MEMBER_SELL_CAP_KRW = 50000;
/** ≈ 34.4828 USDT / member / KST day */
export const MEMBER_SELL_CAP_USDT = MEMBER_SELL_CAP_KRW / USDT_KRW_RATE;

type DbLike = {
  prepare(sql: string): {
    bind(...args: any[]): { first<T = any>(col?: string): Promise<T | null>; all<T = any>(): Promise<{ results?: T[] }>; run(): Promise<any> };
  };
};

/** Start of the current KST day, as an SQLite 'YYYY-MM-DD HH:MM:SS' UTC string, plus the next reset ISO. */
export function kstDayStart(nowMs = Date.now()): { dayStartUtc: string; resetsAtIso: string; kstDate: string } {
  const nowKst = new Date(nowMs + 9 * 3600 * 1000);
  const midnightUtcMs = Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()) - 9 * 3600 * 1000;
  return {
    dayStartUtc: new Date(midnightUtcMs).toISOString().slice(0, 19).replace('T', ' '),
    resetsAtIso: new Date(midnightUtcMs + 24 * 3600 * 1000).toISOString(),
    kstDate: new Date(midnightUtcMs + 9 * 3600 * 1000).toISOString().slice(0, 10),
  };
}

export interface SoldBreakdown {
  usdt: number;      // total company buy-back from this member (spot + convert)
  qta: number;
  n: number;         // number of fills (trades + converts)
  spot_usdt: number;
  spot_qta: number;
  convert_usdt: number;
  convert_qta: number;
}

/**
 * How much the company has already bought from `userId` since `sinceUtc`
 * (omit → lifetime). Combines spot trades vs the MM bots AND filled Convert
 * orders. `convert_orders` may not exist yet on a fresh DB → treated as 0.
 */
export async function memberSoldSince(DB: DbLike, marketId: string, userId: string, sinceUtc?: string): Promise<SoldBreakdown> {
  const tradeSql = `SELECT COALESCE(SUM(total),0) usdt, COALESCE(SUM(amount),0) qta, COUNT(*) n FROM trades
     WHERE market_id=? AND buyer_id IN (?, ?) AND seller_id=?` + (sinceUtc ? ' AND created_at >= ?' : '');
  const tradeArgs: any[] = [marketId, MM_BOT_A, MM_BOT_B, userId];
  if (sinceUtc) tradeArgs.push(sinceUtc);
  const convSql = `SELECT COALESCE(SUM(to_amount),0) usdt, COALESCE(SUM(from_amount),0) qta, COUNT(*) n FROM convert_orders
     WHERE user_id=? AND from_coin='QTA' AND to_coin='USDT' AND status='filled'` + (sinceUtc ? ' AND filled_at >= ?' : '');
  const convArgs: any[] = [userId];
  if (sinceUtc) convArgs.push(sinceUtc);
  const [t, cv] = await Promise.all([
    DB.prepare(tradeSql).bind(...tradeArgs).first<any>().catch(() => null),
    DB.prepare(convSql).bind(...convArgs).first<any>().catch(() => null),
  ]);
  const spot_usdt = Number(t?.usdt || 0), spot_qta = Number(t?.qta || 0);
  const convert_usdt = Number(cv?.usdt || 0), convert_qta = Number(cv?.qta || 0);
  return {
    usdt: spot_usdt + convert_usdt,
    qta: spot_qta + convert_qta,
    n: Number(t?.n || 0) + Number(cv?.n || 0),
    spot_usdt, spot_qta, convert_usdt, convert_qta,
  };
}

/** USDT the company already bought from this member TODAY (KST), spot + convert. */
export async function memberSoldTodayUsdt(DB: DbLike, marketId: string, userId: string, nowMs = Date.now()): Promise<number> {
  const { dayStartUtc } = kstDayStart(nowMs);
  return (await memberSoldSince(DB, marketId, userId, dayStartUtc)).usdt;
}

/** Remaining USDT room today (never negative). */
export async function memberSellRoomUsdt(DB: DbLike, marketId: string, userId: string, nowMs = Date.now()): Promise<number> {
  return Math.max(0, MEMBER_SELL_CAP_USDT - await memberSoldTodayUsdt(DB, marketId, userId, nowMs));
}

/**
 * SQL fragment (correlated sub-select) — today's or lifetime company buy-back
 * USDT for `alias`.id, spot + convert. For admin list queries. Requires the
 * caller to bind `dayStartUtc` once for the today variant.
 */
export function soldUsdtSql(alias = 'u', today: boolean): string {
  const tradeWhere = today ? ' AND t.created_at >= ?' : '';
  const convWhere = today ? ' AND cv.filled_at >= ?' : '';
  return `(COALESCE((SELECT SUM(t.total) FROM trades t WHERE t.seller_id = ${alias}.id AND t.buyer_id IN ('${MM_BOT_A}','${MM_BOT_B}')${tradeWhere}),0)
         + COALESCE((SELECT SUM(cv.to_amount) FROM convert_orders cv WHERE cv.user_id = ${alias}.id AND cv.from_coin='QTA' AND cv.to_coin='USDT' AND cv.status='filled'${convWhere}),0))`;
}
