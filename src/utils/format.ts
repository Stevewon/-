export function formatPrice(price: number, decimals: number = 2): string {
  if (price >= 1000000) return price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

export function formatAmount(amount: number): string {
  if (amount >= 1000000) return (amount / 1000000).toFixed(2) + 'M';
  if (amount >= 1000) return (amount / 1000).toFixed(2) + 'K';
  if (amount >= 1) return amount.toFixed(4);
  return amount.toFixed(6);
}

export function formatPercent(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatVolume(vol: number): string {
  if (vol >= 1e9) return (vol / 1e9).toFixed(2) + 'B';
  if (vol >= 1e6) return (vol / 1e6).toFixed(2) + 'M';
  if (vol >= 1e3) return (vol / 1e3).toFixed(2) + 'K';
  return vol.toFixed(2);
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
  }).format(price);
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
