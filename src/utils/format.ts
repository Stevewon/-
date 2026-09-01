// ── Robust numeric coercion ─────────────────────────────────────────────
// API rows can carry null / undefined / string amounts. Passing those into
// .toLocaleString()/.toFixed() throws a TypeError which, during React render,
// crashes the whole page ("오류가 발생했습니다"). Every formatter below first
// coerces its input to a finite number (fallback 0) so a single bad row can
// never take down a table/screen.
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function formatPrice(price: number, decimals: number = 2): string {
  const p = num(price);
  if (p >= 1000000) return p.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

export function formatAmount(amount: number): string {
  // No K/M abbreviation — show the full number with thousand separators so
  // it's always unambiguous (e.g. 1,000 / 1,000,000 instead of 1.00K / 1.00M).
  const a = num(amount);
  if (a >= 1000) {
    return a.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  if (a >= 1) return a.toFixed(4);
  return a.toFixed(6);
}

// Whole-number amount for low-priced coins (e.g. QTA at a few KRW): showing
// "1,741.57" or "891.9409" units of a sub-cent coin looks wrong. Round to a
// clean integer with thousand separators (e.g. 1,742 / 892).
export function formatAmountWhole(amount: number): string {
  return Math.round(num(amount)).toLocaleString('en-US');
}

export function formatPercent(pct: number): string {
  const p = num(pct);
  const sign = p >= 0 ? '+' : '';
  return `${sign}${p.toFixed(2)}%`;
}

export function formatVolume(vol: number): string {
  // No B/M/K abbreviation — full number with thousand separators so large
  // volumes read as 1,234,567 instead of 1.23M.
  return num(vol).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Format a USD-denominated price with two decimals and thousand separators.
 * QuantaEX is a USD-based global exchange — both USDT and USDC peg to ~$1
 * so we treat the underlying USD price as the canonical fiat reference.
 */
export function formatUSD(price: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num(price));
}

export function timeAgo(dateStr: string, t?: (key: string, params?: Record<string, string | number>) => string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);

  if (t) {
    if (mins < 1) return t('time.justNow');
    if (mins < 60) return t('time.minsAgo', { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('time.hoursAgo', { n: hrs });
    const days = Math.floor(hrs / 24);
    if (days < 30) return t('time.daysAgo', { n: days });
    return t('time.monthsAgo', { n: Math.floor(days / 30) });
  }

  // Fallback English
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
