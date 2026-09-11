/**
 * QTA DAY PLAN — "오늘은 X를 중심으로 오르내리다가 마감을 Y에 끝내라" 자동 실행기.
 *
 * The owner gives a one-line instruction per (KST) day:
 *   • an intraday CENTRE the price should oscillate around (± band %),
 *   • a CLOSE price the day must finish at (KST 24:00).
 *
 * This module turns that into a deterministic, stateless per-tick target that
 * the 1-minute QTA market-making tick (`POST /api/orders/qta-mm-tick`) follows:
 *
 *   phase 'ramp'      — from activation, glide the last price → centre over
 *                       `ramp_minutes` (linear, tiny noise) so the move is a
 *                       series of small candles, not one spike.
 *   phase 'oscillate' — random walk around centre, clamped to centre ± band %,
 *                       soft mean-reversion (never pins to an edge).
 *   phase 'close'     — from `close_start` (KST) glide toward `close` so that
 *                       it lands exactly at `close_end` (KST). Noise fades out.
 *   phase 'hold'      — close_end → 24:00 KST: sit exactly on `close`.
 *   phase 'carry'     — after the plan day ends (and until a new plan / clear):
 *                       hover at `close` ± carry_band_pct so the price does NOT
 *                       fall back to the old managed centre overnight.
 *
 * The plan lives in `system_state` (key PLAN_KEY) as JSON. A CLEARED plan is a
 * tombstone ({cleared:true}) so the built-in default plan is not re-seeded.
 *
 * Everything here is pure (no DB) except load/save helpers at the bottom, so
 * the path can be unit-simulated for a whole day (see scripts/simulate-day-plan.mjs).
 */

export const PLAN_KEY = 'qta_day_plan';
const KST_OFFSET_MS = 9 * 3600 * 1000;

export interface QtaDayPlan {
  /** KST calendar date the plan applies to, 'YYYY-MM-DD'. */
  date: string;
  /** Intraday oscillation centre (USD). */
  center: number;
  /** Half-band around centre in percent (e.g. 2.5 => ±2.5%). */
  band_pct: number;
  /** Target close price (USD) at close_end. */
  close: number;
  /** KST 'HH:MM' when the glide toward `close` begins. */
  close_start: string;
  /** KST 'HH:MM' when the price must be AT `close` (then held to 24:00). */
  close_end: string;
  /** Minutes to glide from the activation price to `center`. */
  ramp_minutes: number;
  /** Half-band (percent) used after the plan day ends (carry phase). */
  carry_band_pct: number;
  /** Epoch ms when the plan was activated (ramp anchor). */
  start_ms: number;
  /** Last trade price at activation (ramp origin, clamp bound). */
  start_price: number;
  /** Bookkeeping. */
  created_by?: string;
  created_at?: string;
  /** Tombstone — plan explicitly cleared by admin. */
  cleared?: boolean;
}

export type PlanPhase = 'inactive' | 'ramp' | 'oscillate' | 'close' | 'hold' | 'carry';

export interface PlanStep {
  phase: PlanPhase;
  /** Next mid price the MM tick should print. */
  mid: number;
  /** Bounds for the two-sided wall + the reference-price clamp. */
  lo: number;
  hi: number;
  /** The centre currently being tracked (centre / close). */
  anchor: number;
}

// ★ OWNER INSTRUCTION 2026-09-11 (KST):
//   "오늘은 0.007 ±2.5% 사이 오르내림 / 23:00 → 23:55 0.0065로 서서히 내려와 마감"
//   (2026-09-10: centre 0.006 → close 0.0058 — executed, carried at 0.0058.)
// Built-in default so the plan is live the moment this deploys — no DB write
// needed. A default whose date is NEWER than the stored plan (or tombstone)
// supersedes it — the owner's latest daily instruction always wins. Admin can
// still override / clear for the day via /api/admin/coins/QTA/day-plan.
export const DEFAULT_PLAN: Omit<QtaDayPlan, 'start_ms' | 'start_price'> = {
  date: '2026-09-11',
  center: 0.007,
  band_pct: 2.5,
  close: 0.0065,
  close_start: '23:00',
  close_end: '23:55',
  ramp_minutes: 90,
  carry_band_pct: 1.0,
  created_by: 'owner-rule-2026-09-11',
};

// ---------------------------------------------------------------------------
// KST helpers
// ---------------------------------------------------------------------------
export function kstDateString(nowMs: number): string {
  return new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Epoch ms of KST midnight that starts `date` ('YYYY-MM-DD'). */
export function kstDayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00+09:00`);
}

/** Epoch ms for KST 'HH:MM' on `date`. */
export function kstTimeMs(date: string, hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  const h = m ? Math.min(23, Math.max(0, Number(m[1]))) : 23;
  const mi = m ? Math.min(59, Math.max(0, Number(m[2]))) : 0;
  return kstDayStartMs(date) + (h * 60 + mi) * 60_000;
}

// ---------------------------------------------------------------------------
// Validation / normalisation
// ---------------------------------------------------------------------------
export function normalizePlan(input: any, nowMs: number, lastPrice: number): QtaDayPlan {
  const num = (v: any, d: number) =>
    v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.date || '')) ? String(input.date) : kstDateString(nowMs);
  const center = num(input?.center, 0);
  const close = num(input?.close, center);
  if (!(center > 0)) throw new Error('center must be > 0');
  if (!(close > 0)) throw new Error('close must be > 0');
  const band_pct = Math.min(30, Math.max(0.2, num(input?.band_pct, 2.5)));
  const carry_band_pct = Math.min(10, Math.max(0.1, num(input?.carry_band_pct, 1.0)));
  const ramp_minutes = Math.min(600, Math.max(1, num(input?.ramp_minutes, 90)));
  const close_start = /^\d{1,2}:\d{2}$/.test(String(input?.close_start || '')) ? String(input.close_start) : '23:00';
  const close_end = /^\d{1,2}:\d{2}$/.test(String(input?.close_end || '')) ? String(input.close_end) : '23:55';
  if (kstTimeMs(date, close_end) <= kstTimeMs(date, close_start)) throw new Error('close_end must be after close_start');
  const start_ms = num(input?.start_ms, 0) > 0 ? Number(input.start_ms) : nowMs;
  const start_price = num(input?.start_price, 0) > 0 ? Number(input.start_price) : (lastPrice > 0 ? lastPrice : center);
  return {
    date, center, band_pct, close, close_start, close_end, ramp_minutes, carry_band_pct,
    start_ms, start_price,
    created_by: input?.created_by ? String(input.created_by) : undefined,
    created_at: input?.created_at ? String(input.created_at) : new Date(nowMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Phase + target computation (pure)
// ---------------------------------------------------------------------------
export function planPhase(plan: QtaDayPlan, nowMs: number): PlanPhase {
  if (!plan || plan.cleared) return 'inactive';
  const dayStart = kstDayStartMs(plan.date);
  const dayEnd = dayStart + 86_400_000;
  const start = Math.max(plan.start_ms || 0, dayStart);
  if (nowMs < start) return 'inactive';
  if (nowMs >= dayEnd) return 'carry';
  const rampEnd = start + plan.ramp_minutes * 60_000;
  const closeStart = kstTimeMs(plan.date, plan.close_start);
  const closeEnd = kstTimeMs(plan.date, plan.close_end);
  if (nowMs >= closeEnd) return 'hold';
  if (nowMs >= closeStart) return 'close';
  if (nowMs < rampEnd) return 'ramp';
  return 'oscillate';
}

/** Overall [lo, hi] envelope of the whole plan (for the ref-price clamp). */
export function planEnvelope(plan: QtaDayPlan): { lo: number; hi: number } {
  const band = Math.max(plan.band_pct, plan.carry_band_pct) / 100;
  const pts = [plan.center, plan.close, plan.start_price].filter((v) => v > 0);
  return {
    lo: Math.min(...pts) * (1 - band),
    hi: Math.max(...pts) * (1 + band),
  };
}

/**
 * One MM tick under the plan.
 * @param last     last traded price (anchor for continuity)
 * @param nowMs    current time
 * @param rnd      0..1 uniform random (injectable for simulation)
 * @param tickMs   cadence of the MM tick (60s in prod)
 */
export function planStep(
  plan: QtaDayPlan,
  last: number,
  nowMs: number,
  rnd: number = Math.random(),
  tickMs: number = 60_000,
): PlanStep | null {
  const phase = planPhase(plan, nowMs);
  if (phase === 'inactive') return null;
  const cur = last > 0 ? last : plan.start_price > 0 ? plan.start_price : plan.center;
  const band = plan.band_pct / 100;
  const noise = (rnd - 0.5) * 2; // -1..1

  // Fraction of the remaining window one tick covers → linear glide that lands
  // exactly at the destination when the window ends. Stateless.
  const stepFrac = (endMs: number) => {
    const remain = endMs - nowMs;
    if (remain <= tickMs) return 1;
    return tickMs / remain;
  };

  switch (phase) {
    case 'ramp': {
      const start = Math.max(plan.start_ms || 0, kstDayStartMs(plan.date));
      const rampEnd = start + plan.ramp_minutes * 60_000;
      const f = stepFrac(rampEnd);
      let mid = cur + (plan.center - cur) * f;
      mid *= 1 + noise * 0.0012; // ±0.12% texture so the ramp isn't a ruler line
      return { phase, mid, lo: Math.min(mid, plan.center) * (1 - band), hi: Math.max(mid, plan.center) * (1 + band), anchor: plan.center };
    }
    case 'oscillate': {
      const center = plan.center;
      // Symmetric random step (±~0.35%) + pull toward centre.
      const vol = 0.0035;
      const pull = ((center - cur) / cur) * 0.08;
      let mid = cur * (1 + noise * vol + pull);
      const hi = center * (1 + band), lo = center * (1 - band);
      // Soft edge: outer 15% of the band pushes back toward the centre.
      const innerHi = center + (hi - center) * 0.85;
      const innerLo = center - (center - lo) * 0.85;
      if (mid > innerHi) mid = mid + (innerHi - mid) * 0.5;
      if (mid < innerLo) mid = mid + (innerLo - mid) * 0.5;
      if (mid > hi) mid = hi;
      if (mid < lo) mid = lo;
      return { phase, mid, lo, hi, anchor: center };
    }
    case 'close': {
      const closeEnd = kstTimeMs(plan.date, plan.close_end);
      const closeStart = kstTimeMs(plan.date, plan.close_start);
      const f = stepFrac(closeEnd);
      let mid = cur + (plan.close - cur) * f;
      // Noise fades to zero as we approach close_end.
      const remainFrac = Math.max(0, Math.min(1, (closeEnd - nowMs) / Math.max(1, closeEnd - closeStart)));
      mid *= 1 + noise * 0.0015 * remainFrac;
      const span = Math.max(plan.center, plan.close) * (1 + band);
      const floorP = Math.min(plan.center, plan.close) * (1 - band);
      return { phase, mid, lo: floorP, hi: span, anchor: plan.close };
    }
    case 'hold': {
      const b = plan.carry_band_pct / 100;
      return { phase, mid: plan.close, lo: plan.close * (1 - b), hi: plan.close * (1 + b), anchor: plan.close };
    }
    case 'carry': {
      const center = plan.close;
      const b = plan.carry_band_pct / 100;
      const pull = ((center - cur) / cur) * 0.15;
      let mid = cur * (1 + noise * 0.0015 + pull);
      const hi = center * (1 + b), lo = center * (1 - b);
      if (mid > hi) mid = hi;
      if (mid < lo) mid = lo;
      return { phase, mid, lo, hi, anchor: center };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Persistence (D1 system_state)
// ---------------------------------------------------------------------------
export async function loadPlan(DB: D1Database): Promise<QtaDayPlan | null> {
  try {
    const row = await DB.prepare('SELECT value FROM system_state WHERE key = ?')
      .bind(PLAN_KEY).first<{ value: string }>();
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' ? (parsed as QtaDayPlan) : null;
  } catch {
    return null;
  }
}

export async function savePlan(DB: D1Database, plan: QtaDayPlan | { cleared: true; date: string; cleared_at: string; cleared_by?: string }): Promise<void> {
  await DB.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).bind(PLAN_KEY, JSON.stringify(plan)).run();
}

/**
 * Resolve the EFFECTIVE plan for the MM tick:
 *   • the built-in DEFAULT_PLAN, once its date has arrived (KST), supersedes
 *     any stored plan / tombstone whose date is OLDER — it is seeded now
 *     (anchoring the ramp at `lastPrice`);
 *   • otherwise the stored plan wins (tombstone → no plan);
 *   • no stored plan and default not yet due → null.
 */
export async function resolveEffectivePlan(
  DB: D1Database,
  nowMs: number,
  lastPrice: number,
): Promise<QtaDayPlan | null> {
  const stored = await loadPlan(DB);
  const today = kstDateString(nowMs);
  const defaultDue = DEFAULT_PLAN.date <= today;
  const storedDate = String((stored as any)?.date || '');
  const defaultNewer = defaultDue && (!stored || storedDate < DEFAULT_PLAN.date);
  if (defaultNewer) {
    const seeded = normalizePlan({ ...DEFAULT_PLAN }, nowMs, lastPrice);
    try { await savePlan(DB, seeded); } catch { /* best-effort */ }
    return seeded;
  }
  if (stored) return stored.cleared ? null : stored;
  return null;
}
