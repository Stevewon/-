/**
 * Sprint 4 Phase H1: Liquidation Engine (stub)
 * ----------------------------------------------------------------------------
 * Pure functions for liquidation price calculation + condition checks for
 * perpetual futures positions. Actual auto-liquidation cron lands later;
 * this module is consumed by:
 *   - POST /api/futures/positions          (preview liq price on open)
 *   - POST /api/futures/positions/:id/close
 *   - GET  /api/futures/admin/at-risk      (list near-liquidation positions)
 *
 * Conventions:
 *   - All amounts are string-decimal (consistent with bridge/QTA chain modules)
 *   - bps = basis points (1 bp = 0.01%)
 *   - leverage is integer (1..max_leverage from futures_contracts)
 */

export type Side = 'long' | 'short';
export type MarginMode = 'cross' | 'isolated';

export interface PositionLike {
  id: string;
  user_id: string;
  symbol: string;
  side: Side;
  size: string;
  entry_price: string;
  leverage: number;
  margin_mode: MarginMode;
  isolated_margin: string;
  status: string;
}

export interface LiquidationCheck {
  shouldLiquidate: boolean;
  liquidationPrice: string;
  distancePct: string;        // % distance between mark and liq price
  reason?: 'maintenance_margin' | 'margin_call';
}

/**
 * Calculate liquidation price for a perpetual futures position.
 *
 * Long  liq = entry * (1 - (1/leverage) + (maintenance_bps/10000))
 * Short liq = entry * (1 + (1/leverage) - (maintenance_bps/10000))
 *
 * Conservative: ignores fees on liq leg (real engine adds taker fee buffer).
 */
export function calcLiquidationPrice(
  side: Side,
  entryPrice: string,
  leverage: number,
  maintenanceMarginBps: number
): string {
  const entry = Number(entryPrice);
  if (!isFinite(entry) || entry <= 0) return '0';
  if (!isFinite(leverage) || leverage <= 0) return '0';

  const mmRate = maintenanceMarginBps / 10000;     // 50 bps -> 0.005
  const invLev = 1 / leverage;                     // 10x   -> 0.1

  let liq: number;
  if (side === 'long') {
    liq = entry * (1 - invLev + mmRate);
  } else {
    liq = entry * (1 + invLev - mmRate);
  }
  if (!isFinite(liq) || liq < 0) return '0';
  // 8 decimals is enough for both BTC and QTA price ranges
  return liq.toFixed(8).replace(/\.?0+$/, '');
}

/**
 * Check if a position should be liquidated at the current mark price.
 */
export function checkLiquidation(
  pos: PositionLike,
  markPrice: string,
  maintenanceMarginBps: number
): LiquidationCheck {
  const liqPrice = calcLiquidationPrice(
    pos.side,
    pos.entry_price,
    pos.leverage,
    maintenanceMarginBps
  );
  const liq = Number(liqPrice);
  const mark = Number(markPrice);
  if (!isFinite(liq) || !isFinite(mark) || liq <= 0 || mark <= 0) {
    return { shouldLiquidate: false, liquidationPrice: liqPrice, distancePct: '0' };
  }

  const shouldLiquidate =
    pos.side === 'long' ? mark <= liq : mark >= liq;

  // distance% relative to mark
  const dist = Math.abs((mark - liq) / mark) * 100;
  const distPct = isFinite(dist) ? dist.toFixed(4).replace(/\.?0+$/, '') : '0';

  return {
    shouldLiquidate,
    liquidationPrice: liqPrice,
    distancePct: distPct,
    reason: shouldLiquidate ? 'maintenance_margin' : undefined,
  };
}

/**
 * Calculate unrealized PnL for a position at the given mark price.
 *  long  : (mark - entry) * size
 *  short : (entry - mark) * size
 */
export function calcUnrealizedPnl(
  side: Side,
  size: string,
  entryPrice: string,
  markPrice: string
): string {
  const sz = Number(size);
  const entry = Number(entryPrice);
  const mark = Number(markPrice);
  if (!isFinite(sz) || !isFinite(entry) || !isFinite(mark)) return '0';
  const diff = side === 'long' ? mark - entry : entry - mark;
  const pnl = diff * sz;
  if (!isFinite(pnl)) return '0';
  return pnl.toFixed(8).replace(/\.?0+$/, '').replace(/^-0$/, '0');
}

/**
 * Required initial margin to open a position.
 *  margin = (entry * size) / leverage
 */
export function calcInitialMargin(
  size: string,
  entryPrice: string,
  leverage: number
): string {
  const sz = Number(size);
  const entry = Number(entryPrice);
  if (!isFinite(sz) || !isFinite(entry) || sz <= 0 || entry <= 0) return '0';
  if (!isFinite(leverage) || leverage <= 0) return '0';
  const margin = (entry * sz) / leverage;
  if (!isFinite(margin)) return '0';
  return margin.toFixed(8).replace(/\.?0+$/, '');
}

/**
 * Margin level for a margin account.
 *   level = equity / debt
 *   - level > 1.5 : healthy
 *   - 1.2 < level <= 1.5 : warning
 *   - 1.0 < level <= 1.2 : margin call
 *   - level <= 1.0 : liquidate
 */
export function calcMarginLevel(
  balance: string,
  borrowed: string,
  interestAccrued: string
): { level: string; status: 'active' | 'margin_call' | 'liquidating' } {
  const bal = Number(balance);
  const bor = Number(borrowed);
  const intr = Number(interestAccrued);
  if (!isFinite(bal) || !isFinite(bor) || !isFinite(intr)) {
    return { level: '0', status: 'active' };
  }
  const debt = bor + intr;
  if (debt <= 0) {
    return { level: '999', status: 'active' };
  }
  const equity = bal;
  const level = equity / debt;
  let status: 'active' | 'margin_call' | 'liquidating' = 'active';
  if (level <= 1.0) status = 'liquidating';
  else if (level <= 1.2) status = 'margin_call';
  const levelStr = isFinite(level) ? level.toFixed(4).replace(/\.?0+$/, '') : '0';
  return { level: levelStr, status };
}
