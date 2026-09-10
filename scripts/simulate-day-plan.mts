// Simulate one full KST day of the QTA MM tick under the day plan (1-min cadence).
import { DEFAULT_PLAN, normalizePlan, planStep, kstTimeMs } from '../src/server/lib/qta-day-plan';

const startMs = Date.parse('2026-09-10T15:30:00+09:00'); // deploy time (KST)
let last = 0.004907;
const plan = normalizePlan({ ...DEFAULT_PLAN }, startMs, last);
let seed = 42; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const marks = ['15:30','15:45','16:00','16:30','17:00','18:00','20:00','22:00','22:59','23:00','23:15','23:30','23:45','23:54','23:55','23:59'];
const out: Record<string, any> = {};
let osc: number[] = [];
for (let t = startMs; t < kstTimeMs(plan.date, '23:59') + 60_000 + 3 * 3600_000; t += 60_000) {
  const s = planStep(plan, last, t, rnd());
  if (!s) continue;
  last = Math.floor(s.mid * 1e6) / 1e6;
  if (s.phase === 'oscillate') osc.push(last);
  const hh = new Date(t + 9 * 3600_000).toISOString().slice(11, 16);
  if (marks.includes(hh) && !out[hh]) out[hh] = { phase: s.phase, mid: last, lo: +s.lo.toFixed(6), hi: +s.hi.toFixed(6) };
  if (t === kstTimeMs('2026-09-11', '02:00')) out['next-day 02:00'] = { phase: s.phase, mid: last };
}
console.table(out);
console.log('oscillate: n=%d min=%s max=%s mean=%s', osc.length, Math.min(...osc), Math.max(...osc), (osc.reduce((a, b) => a + b, 0) / osc.length).toFixed(6));
