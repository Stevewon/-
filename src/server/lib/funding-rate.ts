/**
 * Sprint 4 Phase H1: Funding Rate (stub)
 * ----------------------------------------------------------------------------
 * Pure helpers + a thin DB writer for perpetual funding payments.
 *   - calcFundingRate(mark, index): reference formula clamped to ±0.0075 (0.75%)
 *   - shouldPayFunding(symbol, intervalSec): checks last paid_at vs now
 *   - recordFundingPayment(db, symbol, rate, mark, index): insert row only
 *
 * The actual cross-position funding application (debit/credit each open
 * position) lands in a follow-up cron-worker driver. This module only
 * computes + records funding ticks so the UI can render history.
 */

import type { D1Database } from '@cloudflare/workers-types';

const FUNDING_CAP = 0.0075;        // ±0.75% per interval
const DEFAULT_INTERVAL_SEC = 28800; // 8h

/**
 * Premium-based funding rate.
 *   rate = clamp((mark - index) / index, -CAP, +CAP)
 *
 * A positive rate means longs pay shorts; negative means shorts pay longs.
 */
export function calcFundingRate(markPrice: string, indexPrice: string): string {
  const mark = Number(markPrice);
  const idx = Number(indexPrice);
  if (!isFinite(mark) || !isFinite(idx) || idx <= 0) return '0';
  const raw = (mark - idx) / idx;
  const clamped = Math.max(-FUNDING_CAP, Math.min(FUNDING_CAP, raw));
  if (!isFinite(clamped)) return '0';
  return clamped.toFixed(8).replace(/\.?0+$/, '').replace(/^-0$/, '0');
}

/**
 * Check whether `intervalSec` has elapsed since the most recent funding tick.
 * Returns true if no prior tick exists for this symbol.
 */
export async function shouldPayFunding(
  db: D1Database,
  symbol: string,
  intervalSec: number = DEFAULT_INTERVAL_SEC
): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        `SELECT paid_at FROM futures_funding_rates
         WHERE symbol = ?
         ORDER BY paid_at DESC
         LIMIT 1`
      )
      .bind(symbol)
      .first<{ paid_at: string }>();
    if (!row || !row.paid_at) return true;
    const last = Date.parse(row.paid_at + 'Z');
    if (!isFinite(last)) return true;
    const ageSec = (Date.now() - last) / 1000;
    return ageSec >= intervalSec;
  } catch {
    // fail-open: do not block UI/admin on DB hiccup
    return false;
  }
}

/**
 * Insert a single funding tick. ID is a hex random (no nanoid dep).
 */
export async function recordFundingPayment(
  db: D1Database,
  symbol: string,
  fundingRate: string,
  markPrice: string,
  indexPrice: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const id = randomId();
  try {
    await db
      .prepare(
        `INSERT INTO futures_funding_rates
           (id, symbol, funding_rate, mark_price, index_price)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, symbol, fundingRate, markPrice, indexPrice)
      .run();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Return the last N funding ticks for a symbol (most recent first).
 */
export async function getRecentFundingHistory(
  db: D1Database,
  symbol: string,
  limit: number = 50
): Promise<Array<{
  id: string;
  symbol: string;
  funding_rate: string;
  mark_price: string;
  index_price: string;
  paid_at: string;
}>> {
  const lim = Math.min(Math.max(1, limit | 0), 500);
  try {
    const r = await db
      .prepare(
        `SELECT id, symbol, funding_rate, mark_price, index_price, paid_at
           FROM futures_funding_rates
          WHERE symbol = ?
          ORDER BY paid_at DESC
          LIMIT ?`
      )
      .bind(symbol, lim)
      .all<any>();
    return (r?.results ?? []) as any[];
  } catch {
    return [];
  }
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
