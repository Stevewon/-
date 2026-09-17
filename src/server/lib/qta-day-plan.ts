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
  /** Half-band around centre in percent (e.g. 2.5 => ±2.5%). Derived from high/low when those are given. */
  band_pct: number;
  /** Target close price (USD) at close_end. */
  close: number;
  /** ★ Admin OHLC controls (USD). `open` = where the day should START (ramp
   *  origin; if omitted the live last price is used). `high`/`low` = HARD
   *  ceiling/floor once the ramp has delivered the price into range — no
   *  oscillation tick, dump, close glide or carry ever prints outside
   *  [low, high]. When present they also define the oscillation band. */
  open?: number | null;
  high?: number | null;
  low?: number | null;
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
  /** Market-texture event in force this tick (see dumpEvent). */
  event?: 'dump' | 'recover' | null;
  /** Trade-size multiplier for the cosmetic print (dump = bigger lots). */
  sizeMul?: number;
}

// ---------------------------------------------------------------------------
// "Someone is selling" texture — owner 2026-09-11:
//   "가장 자연스럽게 내림폭도 가끔은 있어야 하잖아, 누군가 파는 것처럼"
// A real market is not a symmetric wobble: every so often a seller dumps and
// the price drops 1–2.5% over a handful of minutes with FAT red prints, then
// bids absorb it and the price creeps back over 10–25 minutes. We schedule
// these deterministically from the clock (stateless per tick): each 20-minute
// slot has a ~45% chance of a dump starting at a pseudo-random minute inside
// it, lasting 3–7 ticks, followed by a recovery window.
// ---------------------------------------------------------------------------
export interface DumpEvent {
  kind: 'dump' | 'recover';
  /** 0..1 progress inside the dump (kind='dump'). */
  progress: number;
  /** Total depth of this dump as a fraction (e.g. 0.018 = -1.8%). */
  depth: number;
  /** Ticks (minutes) the dump lasts. */
  dumpTicks: number;
  /** 0..1 progress inside the recovery (kind='recover'). */
  recoverProgress: number;
}

const SLOT_MS = 20 * 60_000;

function hashNoise(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Returns the dump/recovery event active at `nowMs`, or null. */
export function dumpEvent(nowMs: number, tickMs: number = 60_000, salt = 0): DumpEvent | null {
  // Look at this slot and the previous one (a recovery may spill over).
  for (let back = 0; back <= 1; back++) {
    const slotIdx = Math.floor(nowMs / SLOT_MS) - back;
    const r1 = hashNoise(slotIdx * 3 + 1 + salt);
    if (r1 > 0.40) continue; // no dump in this slot (~40% of 20-min slots)
    const r2 = hashNoise(slotIdx * 3 + 2 + salt);
    const r3 = hashNoise(slotIdx * 3 + 3 + salt);
    const dumpTicks = 3 + Math.floor(r2 * 5);                 // 3..7 ticks
    const depth = 0.010 + r3 * 0.015;                          // -1.0% .. -2.5%
    const startOffset = Math.floor(hashNoise(slotIdx * 7 + 5 + salt) * 10) * tickMs; // minute 0..9 of slot
    const start = slotIdx * SLOT_MS + startOffset;
    const dumpEnd = start + dumpTicks * tickMs;
    const recoverTicks = 10 + Math.floor(r2 * 15);             // 10..24 ticks
    const recoverEnd = dumpEnd + recoverTicks * tickMs;
    if (nowMs >= start && nowMs < dumpEnd) {
      return { kind: 'dump', progress: (nowMs - start) / (dumpEnd - start), depth, dumpTicks, recoverProgress: 0 };
    }
    if (nowMs >= dumpEnd && nowMs < recoverEnd) {
      return { kind: 'recover', progress: 1, depth, dumpTicks, recoverProgress: (nowMs - dumpEnd) / (recoverEnd - dumpEnd) };
    }
  }
  return null;
}

// ★ OWNER INSTRUCTION 2026-09-17 (Thu, 12:10 KST):
//   "오늘은 저녁 11시 59분에 0.0091로 끝내고, 내일은 0.0086, 일요일은 0.0092,
//    월요일은 0.0102로 끝내. 가장 자연스럽게, 오르내리게."
//   Multi-day BUILT-IN schedule (KST dates). Each day: ramp from the live last
//   price into the day's range, oscillate between Low/High with seller dumps
//   and recoveries, glide to Close from close_start, land at 23:59, hold.
//   Saturday 09-19 was NOT specified → keeps Friday's close (0.0086) as its
//   close with a wider intraday range so the tape still breathes.
//   Admin schedule (system_state.qta_day_plan_schedule) always wins over these.
type DefaultTpl = Omit<QtaDayPlan, 'start_ms' | 'start_price'>;
export const DEFAULT_SCHEDULE: Record<string, DefaultTpl> = {
  '2026-09-17': { date: '2026-09-17', open: null, center: 0.0089, high: 0.00925, low: 0.0086, band_pct: 3.0, close: 0.0091, close_start: '21:30', close_end: '23:59', ramp_minutes: 240, carry_band_pct: 1.0, created_by: 'owner-rule-2026-09-17' },
  '2026-09-18': { date: '2026-09-18', open: null, center: 0.0088, high: 0.00930, low: 0.0084, band_pct: 3.0, close: 0.0086, close_start: '22:00', close_end: '23:59', ramp_minutes: 300, carry_band_pct: 1.0, created_by: 'owner-rule-2026-09-17' },
  '2026-09-19': { date: '2026-09-19', open: null, center: 0.0087, high: 0.00900, low: 0.0083, band_pct: 3.0, close: 0.0086, close_start: '22:00', close_end: '23:59', ramp_minutes: 240, carry_band_pct: 1.0, created_by: 'owner-rule-2026-09-17 (Sat fill: keep Fri close)' },
  '2026-09-20': { date: '2026-09-20', open: null, center: 0.0090, high: 0.00940, low: 0.0086, band_pct: 3.0, close: 0.0092, close_start: '22:00', close_end: '23:59', ramp_minutes: 300, carry_band_pct: 1.0, created_by: 'owner-rule-2026-09-17' },
  '2026-09-21': { date: '2026-09-21', open: null, center: 0.0100, high: 0.01040, low: 0.0095, band_pct: 3.0, close: 0.0102, close_start: '22:00', close_end: '23:59', ramp_minutes: 300, carry_band_pct: 1.0, created_by: 'owner-rule-2026-09-17' },
};
// Back-compat: the single "default plan" = today's (or the latest past) entry.
export const DEFAULT_PLAN: DefaultTpl = DEFAULT_SCHEDULE['2026-09-17'];

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
  const open = num(input?.open, 0) > 0 ? Number(input.open) : null;
  let high = num(input?.high, 0) > 0 ? Number(input.high) : null;
  let low = num(input?.low, 0) > 0 ? Number(input.low) : null;
  let band_pct = Math.min(30, Math.max(0.2, num(input?.band_pct, 2.5)));
  if (high != null || low != null) {
    // Derive the oscillation band from the tighter of the two distances so
    // the walk stays comfortably inside [low, high]; hard clamps do the rest.
    const upPct = high != null ? ((high - center) / center) * 100 : Infinity;
    const dnPct = low != null ? ((center - low) / center) * 100 : Infinity;
    const b = Math.min(upPct, dnPct);
    if (!(b > 0)) throw new Error('high must be above centre and low below centre');
    band_pct = Math.min(30, Math.max(0.2, b));
    if (high != null && close > high) throw new Error('close cannot exceed high');
    if (low != null && close < low) throw new Error('close cannot be below low');
  }
  const carry_band_pct = Math.min(10, Math.max(0.1, num(input?.carry_band_pct, 1.0)));
  const ramp_minutes = Math.min(600, Math.max(1, num(input?.ramp_minutes, 90)));
  const close_start = /^\d{1,2}:\d{2}$/.test(String(input?.close_start || '')) ? String(input.close_start) : '23:00';
  const close_end = /^\d{1,2}:\d{2}$/.test(String(input?.close_end || '')) ? String(input.close_end) : '23:55';
  if (kstTimeMs(date, close_end) <= kstTimeMs(date, close_start)) throw new Error('close_end must be after close_start');
  const start_ms = num(input?.start_ms, 0) > 0 ? Number(input.start_ms) : nowMs;
  // Ramp origin: explicit `open` wins; else the stored start_price; else the live last price.
  const start_price = open != null ? open
    : num(input?.start_price, 0) > 0 ? Number(input.start_price)
    : (lastPrice > 0 ? lastPrice : center);
  return {
    date, center, band_pct, close, close_start, close_end, ramp_minutes, carry_band_pct,
    open, high, low,
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
  let lo = Math.min(...pts) * (1 - band);
  let hi = Math.max(...pts) * (1 + band);
  if (plan.low && plan.low > 0) lo = Math.min(lo, plan.low);
  if (plan.high && plan.high > 0) hi = Math.max(hi, plan.high);
  return { lo, hi };
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
  const raw = planStepRaw(plan, last, nowMs, rnd, tickMs);
  if (!raw) return null;
  // ★ Admin HARD floor / ceiling: nothing prints outside [low, high] — except
  //   during the RAMP, which by design travels from Open (often yesterday's
  //   close, outside today's range) up/down into the range.
  if (raw.phase === 'ramp') return raw;
  const hardLo = plan.low && plan.low > 0 ? plan.low : 0;
  const hardHi = plan.high && plan.high > 0 ? plan.high : Number.POSITIVE_INFINITY;
  if (raw.mid < hardLo) raw.mid = hardLo * (1 + (rnd * 0.0008)); // sit on the floor with a wobble
  if (raw.mid > hardHi) raw.mid = hardHi * (1 - (rnd * 0.0008));
  if (raw.mid > hardHi) raw.mid = hardHi;
  if (raw.mid < hardLo) raw.mid = hardLo;
  raw.lo = Math.max(raw.lo, hardLo);
  raw.hi = Math.min(raw.hi, hardHi);
  return raw;
}

function planStepRaw(
  plan: QtaDayPlan,
  last: number,
  nowMs: number,
  rnd: number,
  tickMs: number,
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
      // ★ 2026-09-11 owner: "마냥 올리기만 하면 어쯔나" — the ramp must look like a
      //   real up-trend: ~35% of ticks are RED pull-backs. We aim a little
      //   ahead of the linear path (overshoot) so the pull-backs still land on
      //   the centre in time, and use a large symmetric noise term.
      const f = stepFrac(rampEnd);
      const remain = Math.max(0, rampEnd - nowMs);
      const overshoot = remain > tickMs ? 1.6 : 1; // push a bit harder, then let noise retrace
      const drift = (plan.center - cur) * Math.min(1, f * overshoot);
      let mid = cur + drift;
      mid *= 1 + noise * 0.005; // ±0.5% — red candles appear regularly on the way up
      // Never run past the centre band during the ramp.
      const hiCap = plan.center * (1 + band * 0.6);
      let loCap = Math.min(cur, plan.center) * (1 - band);
      // If the ramp already starts INSIDE the admin range, honour Low/High as
      // the floor/ceiling right away (only an out-of-range Open may sit outside).
      if (plan.low && plan.low > 0 && cur >= plan.low) loCap = Math.max(loCap, plan.low);
      if (mid > hiCap) mid = hiCap;
      if (plan.high && plan.high > 0 && cur <= plan.high && mid > plan.high) mid = plan.high;
      if (mid < loCap) mid = loCap;
      return { phase, mid, lo: Math.min(mid, plan.center) * (1 - band), hi: Math.max(mid, plan.center) * (1 + band), anchor: plan.center };
    }
    case 'oscillate': {
      const center = plan.center;
      const hi = center * (1 + band), lo = center * (1 - band);
      const ev = dumpEvent(nowMs, tickMs);
      let mid: number;
      let sizeMul = 1;
      if (ev?.kind === 'dump') {
        // Someone is selling: a run of red ticks. Per-tick drop = depth /
        // dumpTicks with front-loading (first ticks biggest), fat prints.
        // A dump may pierce the soft band slightly but never below the hard
        // floor; if we are ALREADY low, the seller has less room → shallower.
        const hardLo = center * (1 - band * 1.3);
        const room = Math.max(0, Math.min(1, (cur - hardLo) / Math.max(1e-12, center - hardLo)));
        const perTick = (ev.depth * (0.35 + 0.65 * room)) / ev.dumpTicks;
        const frontLoad = 1.5 - ev.progress;                 // 1.5 → 0.5
        const drop = perTick * frontLoad * (0.7 + rnd * 0.6); // jittered
        mid = cur * (1 - drop);
        sizeMul = 2.5 + rnd * 3;                             // 2.5x .. 5.5x lots
        if (mid < hardLo) mid = hardLo * (1 + rnd * 0.0012); // sit on the floor with a wobble, never flat-line
      } else if (ev?.kind === 'recover') {
        // Bids absorb it: slow creep back toward the centre, mostly green,
        // with small red re-tests in between.
        const gap = center - cur;
        const creep = gap * (0.06 + 0.10 * ev.recoverProgress);
        mid = cur + creep + cur * noise * 0.0022;
        sizeMul = 1.2 + rnd * 0.8;
      } else {
        // Calm regime: symmetric wobble (±~0.35%) + gentle pull to centre.
        const vol = 0.0035;
        const pull = ((center - cur) / cur) * 0.08;
        mid = cur * (1 + noise * vol + pull);
        // Soft edge: outer 15% of the band pushes back toward the centre.
        const innerHi = center + (hi - center) * 0.85;
        const innerLo = center - (center - lo) * 0.85;
        if (mid > innerHi) mid = mid + (innerHi - mid) * 0.5;
        if (mid < innerLo) mid = mid + (innerLo - mid) * 0.5;
        if (mid > hi) mid = hi;
        if (mid < lo) mid = lo;
      }
      const outLo = Math.min(lo, mid), outHi = hi;
      return { phase, mid, lo: outLo, hi: outHi, anchor: center, event: ev?.kind ?? null, sizeMul };
    }
    case 'close': {
      const closeEnd = kstTimeMs(plan.date, plan.close_end);
      const closeStart = kstTimeMs(plan.date, plan.close_start);
      const f = stepFrac(closeEnd);
      const remain = Math.max(0, closeEnd - nowMs);
      const overshoot = remain > tickMs ? 1.6 : 1;
      let mid = cur + (plan.close - cur) * Math.min(1, f * overshoot);
      // Real-looking glide: green bounces on the way down; noise fades to zero
      // as we approach close_end so the landing is exact.
      const remainFrac = Math.max(0, Math.min(1, (closeEnd - nowMs) / Math.max(1, closeEnd - closeStart)));
      mid *= 1 + noise * 0.004 * remainFrac;
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
      const hi = center * (1 + b), lo = center * (1 - b);
      const ev = dumpEvent(nowMs, tickMs, 11);
      let mid: number;
      let sizeMul = 1;
      if (ev?.kind === 'dump') {
        const hardLo = center * (1 - b * 1.5);
        const room = Math.max(0, Math.min(1, (cur - hardLo) / Math.max(1e-12, center - hardLo)));
        const perTick = (ev.depth * 0.5 * (0.35 + 0.65 * room)) / ev.dumpTicks; // half-depth overnight dumps
        mid = cur * (1 - perTick * (1.5 - ev.progress) * (0.7 + rnd * 0.6));
        sizeMul = 2 + rnd * 2;
        if (mid < hardLo) mid = hardLo * (1 + rnd * 0.0012);
      } else if (ev?.kind === 'recover') {
        mid = cur + (center - cur) * (0.06 + 0.10 * ev.recoverProgress) + cur * noise * 0.0015;
      } else {
        const pull = ((center - cur) / cur) * 0.15;
        mid = cur * (1 + noise * 0.0015 + pull);
        if (mid > hi) mid = hi;
        if (mid < lo) mid = lo;
      }
      return { phase, mid, lo: Math.min(lo, mid), hi, anchor: center, event: ev?.kind ?? null, sizeMul };
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

// ---------------------------------------------------------------------------
// ★ MULTI-DAY SCHEDULE (owner 2026-09-14): "오늘부터 1주일간 이런 식으로".
//   Admin stores one plan TEMPLATE per future KST date under SCHEDULE_KEY
//   (JSON map date → template, no start_ms/start_price). At 00:00 KST of that
//   date the MM tick promotes the template into the live plan (PLAN_KEY),
//   anchoring the ramp at the live last price (or the template's `open`).
//   Priority when a day begins:  schedule[date]  >  DEFAULT_PLAN  >  carry.
// ---------------------------------------------------------------------------
export const SCHEDULE_KEY = 'qta_day_plan_schedule';
export type PlanTemplate = Omit<QtaDayPlan, 'start_ms' | 'start_price' | 'cleared'>;

export async function loadSchedule(DB: D1Database): Promise<Record<string, PlanTemplate>> {
  try {
    const row = await DB.prepare('SELECT value FROM system_state WHERE key = ?')
      .bind(SCHEDULE_KEY).first<{ value: string }>();
    if (!row?.value) return {};
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveSchedule(DB: D1Database, sched: Record<string, PlanTemplate>): Promise<void> {
  await DB.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).bind(SCHEDULE_KEY, JSON.stringify(sched)).run();
}

/** Validate a template for `date` (throws on bad input). Returns a clean template. */
export function normalizeTemplate(input: any, date: string): PlanTemplate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD');
  // Reuse normalizePlan for validation; strip the runtime anchors.
  const full = normalizePlan({ ...input, date, start_ms: 1, start_price: input?.open || input?.center }, kstDayStartMs(date), Number(input?.open || input?.center || 0));
  const { start_ms, start_price, cleared, ...tpl } = full as any;
  void start_ms; void start_price; void cleared;
  return tpl as PlanTemplate;
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
  const storedDate = String((stored as any)?.date || '');

  // 1) Admin SCHEDULE for today (highest priority). Promote once per day:
  //    only when the live plan is for an OLDER date (or missing).
  if (!stored || storedDate < today) {
    const sched = await loadSchedule(DB);
    const tpl = sched[today];
    if (tpl) {
      const seeded = normalizePlan({ ...tpl, date: today, created_by: tpl.created_by || 'admin-schedule' }, nowMs, lastPrice);
      try { await savePlan(DB, seeded); } catch { /* best-effort */ }
      return seeded;
    }
  }

  // 2) Built-in DEFAULT_SCHEDULE for today (owner's standing instructions
  //    baked into code), promoted once when the live plan is OLDER than today.
  if (!stored || storedDate < today) {
    const tpl = DEFAULT_SCHEDULE[today];
    if (tpl) {
      const seeded = normalizePlan({ ...tpl }, nowMs, lastPrice);
      try { await savePlan(DB, seeded); } catch { /* best-effort */ }
      return seeded;
    }
  }
  // 3) Stored plan (today's, or yesterday's carrying over).
  if (stored) return stored.cleared ? null : stored;
  return null;
}
