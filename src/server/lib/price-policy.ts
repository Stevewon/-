/**
 * Coin price policy engine — the single place that decides what price OUR OWN
 * coins (QTA / QX / QKEY, gated by isQuantariumAsset) should show.
 *
 * Standard external coins (BTC, ETH, ...) never go through here — their price
 * is the real market feed. This module only steers in-house coins so the
 * exchange can control their chart the way it wants.
 *
 * The four modes an admin can pick:
 *
 *   • 'market'  — legacy free random walk around the base price. The caller
 *                 keeps doing whatever it already did; nextPrice() just returns
 *                 the caller's proposed walk value unchanged.
 *   • 'peg'     — hold EXACTLY at target (a hard peg / instant jump).
 *   • 'target'  — glide from driftFrom -> target linearly between driftStart and
 *                 driftEnd (epoch ms), then hold at target. A small deterministic
 *                 wobble is layered on so the chart still looks alive.
 *   • 'managed' — random walk clamped to center ± bandPct%, nudged by bias
 *                 (-1 fully downward .. +1 fully upward).
 */

export type PriceMode = 'market' | 'peg' | 'target' | 'managed';

export interface CoinPricePolicy {
  mode: PriceMode;
  target: number | null;      // peg / target destination
  center: number | null;      // managed midpoint
  bandPct: number | null;     // managed half-band, percent (e.g. 3 => ±3%)
  bias: number;               // -1..+1
  driftFrom: number | null;   // target-mode start price
  driftStart: number | null;  // epoch ms
  driftEnd: number | null;    // epoch ms
}

/** Read a coin row (from the `coins` table) into a normalized policy object. */
export function policyFromCoinRow(row: any): CoinPricePolicy {
  const num = (v: any): number | null =>
    v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
  const mode = (row?.price_mode as PriceMode) || 'market';
  return {
    mode: (['market', 'peg', 'target', 'managed'] as const).includes(mode) ? mode : 'market',
    target: num(row?.price_target),
    center: num(row?.price_center),
    bandPct: num(row?.price_band_pct),
    bias: Number(row?.price_bias) || 0,
    driftFrom: num(row?.price_drift_from),
    driftStart: num(row?.price_drift_start),
    driftEnd: num(row?.price_drift_end),
  };
}

/**
 * Compute the next price for an in-house coin.
 *
 * @param policy    the coin's price policy
 * @param current   the coin's current live price
 * @param proposed  the value a plain random walk would have produced this tick
 *                  (used only in 'market' mode, and as a gentle wobble source)
 * @param now       current epoch ms (injectable for tests)
 */
export function nextPolicyPrice(
  policy: CoinPricePolicy,
  current: number,
  proposed: number,
  now: number = Date.now(),
): number {
  const cur = current > 0 ? current : proposed > 0 ? proposed : 1;

  switch (policy.mode) {
    // ---- Hard peg / instant jump ----
    case 'peg': {
      if (policy.target && policy.target > 0) return policy.target;
      return cur;
    }

    // ---- Smooth glide to a target over a window, then hold ----
    case 'target': {
      const target = policy.target;
      if (!target || target <= 0) return cur;
      const from = policy.driftFrom && policy.driftFrom > 0 ? policy.driftFrom : cur;
      const start = policy.driftStart ?? now;
      const end = policy.driftEnd ?? now;

      let base: number;
      if (end <= start || now >= end) {
        base = target; // window finished (or degenerate) -> hold at target
      } else if (now <= start) {
        base = from; // not started yet
      } else {
        const p = (now - start) / (end - start); // 0..1
        // ease-in-out for a natural curve
        const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        base = from + (target - from) * eased;
      }
      // tiny alive-looking wobble (±0.15%) that never derails the glide
      const wobble = 1 + (deterministicNoise(now) - 0.5) * 0.003;
      return base * wobble;
    }

    // ---- Constrained random walk around a center, biased up/down ----
    case 'managed': {
      const center = policy.center && policy.center > 0 ? policy.center : cur;
      const band = Math.max(0, (policy.bandPct ?? 2)) / 100; // e.g. 0.02
      const bias = Math.max(-1, Math.min(1, policy.bias || 0));

      // Step from current: baseline volatility + bias drift.
      const vol = 0.0006 + deterministicNoise(now + 7) * 0.0004;
      const rnd = (deterministicNoise(now) - 0.5) * 2 * vol; // symmetric noise
      const driftTowardCenter = (center - cur) / cur * 0.05; // pull back to center
      const biasDrift = bias * 0.0008;
      let next = cur * (1 + rnd + biasDrift + driftTowardCenter);

      // Clamp to the band around center.
      const hi = center * (1 + band);
      const lo = center * (1 - band);
      if (next > hi) next = hi;
      if (next < lo) next = lo;
      return next;
    }

    // ---- Default: caller's own random walk ----
    case 'market':
    default:
      return proposed;
  }
}

/**
 * Cheap deterministic 0..1 noise from a number, so a stateless per-request
 * Worker still gets a "moving" chart without needing a seeded PRNG carried
 * across ticks. Good enough for cosmetic wobble.
 */
function deterministicNoise(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** True when a policy actively steers the price (i.e. not plain 'market'). */
export function isManagedPolicy(policy: CoinPricePolicy): boolean {
  return policy.mode !== 'market';
}
