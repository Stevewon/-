// ============================================================================
// Admin staking console — totals (with a per-KST-day series), per-member
// cumulative ledger, Friday withdrawal-eligible list, and the downloadable
// staking policy report.
// Owner 2026-09-30: "금요일 출금신청을 할 수 있는 대상자의 금액순 리스트와 정확한 각
// 스테이킹 회원의 누적내역을 개별로 볼 수 있게 관리자에 기능을 만들어라! 스테이킹
// 총액을 관리자에서 항상 볼 수 있는 창구(일별 포함). 그리고 스테이킹 현재의 정책을
// 보고서 형태로 다운받게."
// READ-ONLY: every function here only SELECTs. Admin console → Korean OK (§0
// applies to member screens only).
// ============================================================================
import { pegQtaUsd, PEG_WINDOWS } from '../../shared/qta-peg';
import { getFeeTierByHolding } from '../utils/fees';

const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 86_400_000;
const USDT_KRW = 1450;
const BAD_WD = "('rejected','failed','cancelled')";

function parseTs(v: any): number {
  if (!v) return NaN;
  const s = String(v);
  return Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
}
function kstDate(ms: number): string { return new Date(ms + KST_MS).toISOString().slice(0, 10); }
function kstDayIdx(ms: number): number { return Math.floor((ms + KST_MS) / DAY_MS); }
function dateOfIdx(idx: number): string { return new Date(idx * DAY_MS).toISOString().slice(0, 10); }
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Current payout basis (USD per QTA) — §9 fixed peg, else 10 KRW fallback. */
function basisNow(): number { return pegQtaUsd(Date.now()) ?? 10 / USDT_KRW; }

/** Daily QTA a position earns (same rule as earn.ts accrual). */
function dailyQtaOf(p: any, basis: number): number {
  const rate = Number(p.daily_rate || 0);
  const explicit = Number(p.principal_qta || 0), stakePx = Number(p.qta_price_at_stake || 0);
  if (explicit > 0) return explicit * rate;
  if (stakePx > 0) return (Number(p.principal_usd || 0) / stakePx) * rate;
  return (Number(p.principal_usd || 0) * rate) / basis;
}

async function all(DB: D1Database, sql: string, ...b: any[]): Promise<any[]> {
  try { return ((await DB.prepare(sql).bind(...b).all()).results || []) as any[]; } catch { return []; }
}
async function one(DB: D1Database, sql: string, ...b: any[]): Promise<any> {
  try { return await DB.prepare(sql).bind(...b).first(); } catch { return null; }
}

// ----------------------------------------------------------------------------
// 1) Staking totals + per-day series
// ----------------------------------------------------------------------------
export async function stakingSummary(DB: D1Database, days = 30) {
  const now = Date.now();
  const basis = basisNow();
  const positions = await all(DB,
    `SELECT sp.*, u.nickname FROM staking_positions sp JOIN users u ON u.id = sp.user_id
      WHERE u.id NOT IN ('mm-bot-a','mm-bot-b')`);
  const active = positions.filter(p => p.status === 'active');
  const realOf = (p: any) => p.real_principal_usd != null ? Number(p.real_principal_usd) : (p.granted_by ? 0 : Number(p.principal_usd || 0));

  const byProduct: Record<string, any> = {};
  for (const p of active) {
    const k = p.product_id || '-';
    byProduct[k] ||= { product_id: k, daily_rate: Number(p.daily_rate || 0), term_days: Number(p.term_days || 0), positions: 0, principal_usd: 0, daily_usd: 0, daily_qta: 0 };
    const b = byProduct[k];
    b.positions++; b.principal_usd += Number(p.principal_usd || 0);
    b.daily_usd += Number(p.principal_usd || 0) * Number(p.daily_rate || 0);
    b.daily_qta += dailyQtaOf(p, basis);
  }
  const dailyUsd = active.reduce((a, p) => a + Number(p.principal_usd || 0) * Number(p.daily_rate || 0), 0);
  const dailyQta = active.reduce((a, p) => a + dailyQtaOf(p, basis), 0);

  const [div, match, matchPending, swaps, wd, members] = await Promise.all([
    one(DB, `SELECT COALESCE(SUM(qta_amount),0) q, COALESCE(SUM(usd_amount),0) u FROM staking_dividends WHERE kind='dividend'`),
    one(DB, `SELECT COALESCE(SUM(bonus_qta),0) q, COALESCE(SUM(bonus_usd),0) u FROM binary_match_bonuses WHERE COALESCE(claimed,0)=1`),
    one(DB, `SELECT COALESCE(SUM(bonus_qta),0) q FROM binary_match_bonuses WHERE COALESCE(claimed,0)=0`),
    one(DB, `SELECT COUNT(*) n, COALESCE(SUM(from_amount),0) q, COALESCE(SUM(to_amount),0) u FROM convert_orders WHERE source='staking_reward' AND status='filled'`),
    one(DB, `SELECT COALESCE(SUM(w.amount),0) u FROM withdrawals w WHERE w.coin_symbol='USDT' AND w.status NOT IN ${BAD_WD}
               AND w.user_id IN (SELECT user_id FROM staking_positions)`),
    one(DB, `SELECT COUNT(DISTINCT sp.user_id) n FROM staking_positions sp WHERE sp.status='active' AND sp.user_id NOT IN ('mm-bot-a','mm-bot-b')`),
  ]);

  // ---- per-KST-day series ------------------------------------------------
  const todayIdx = kstDayIdx(now);
  const startIdx = todayIdx - Math.max(1, Math.min(365, days)) + 1;
  const startDate = dateOfIdx(startIdx);
  const accr = await all(DB,
    `SELECT kst_date d, COALESCE(SUM(daily_qta),0) q, COALESCE(SUM(daily_usd),0) u, COUNT(*) n
       FROM staking_daily_accruals WHERE kst_date >= ? GROUP BY kst_date`, startDate);
  const credits = await all(DB,
    `SELECT date(created_at, '+9 hours') d, COALESCE(SUM(qta_amount),0) q FROM staking_dividends
      WHERE kind='dividend' AND date(created_at, '+9 hours') >= ? GROUP BY d`, startDate);
  const matches = await all(DB,
    `SELECT date(created_at, '+9 hours') d, COALESCE(SUM(bonus_qta),0) q, COALESCE(SUM(bonus_usd),0) u FROM binary_match_bonuses
      WHERE date(created_at, '+9 hours') >= ? GROUP BY d`, startDate);
  const swapDays = await all(DB,
    `SELECT date(filled_at, '+9 hours') d, COALESCE(SUM(from_amount),0) q, COALESCE(SUM(to_amount),0) u FROM convert_orders
      WHERE source='staking_reward' AND status='filled' AND date(filled_at, '+9 hours') >= ? GROUP BY d`, startDate);
  const m = (rows: any[]) => Object.fromEntries(rows.map(r => [r.d, r]));
  const A = m(accr), C = m(credits), M = m(matches), S = m(swapDays);

  const series: any[] = [];
  for (let idx = startIdx; idx <= todayIdx; idx++) {
    const d = dateOfIdx(idx);
    const dayEnd = idx * DAY_MS - KST_MS + DAY_MS; // UTC ms of next KST midnight
    let activeUsd = 0, activeN = 0, newN = 0, newUsd = 0;
    for (const p of positions) {
      const c = parseTs(p.created_at); if (isNaN(c) || c >= dayEnd) continue;
      const red = parseTs(p.redeemed_at);
      if (p.status === 'active' || (!isNaN(red) && red >= dayEnd)) { activeUsd += Number(p.principal_usd || 0); activeN++; }
      if (kstDayIdx(c) === idx) { newN++; newUsd += Number(p.principal_usd || 0); }
    }
    series.push({
      date: d, active_positions: activeN, active_principal_usd: r2(activeUsd),
      new_positions: newN, new_principal_usd: r2(newUsd),
      accrued_qta: r2(Number(A[d]?.q || 0)), accrued_usd: r2(Number(A[d]?.u || 0)),
      credited_qta: r2(Number(C[d]?.q || 0)),
      match_qta: r2(Number(M[d]?.q || 0)), match_usd: r2(Number(M[d]?.u || 0)),
      swap_qta: r2(Number(S[d]?.q || 0)), swap_usdt: r2(Number(S[d]?.u || 0)),
    });
  }

  return {
    generated_at: new Date(now).toISOString(), kst_today: kstDate(now),
    basis: { usd_per_qta: basis, krw_per_qta: r2(basis * USDT_KRW), usdt_krw: USDT_KRW },
    totals: {
      members: Number(members?.n || 0), positions: active.length,
      principal_usd: r2(active.reduce((a, p) => a + Number(p.principal_usd || 0), 0)),
      real_usd: r2(active.reduce((a, p) => a + realOf(p), 0)),
      bonus_usd: r2(active.reduce((a, p) => a + Number(p.bonus_principal_usd || 0), 0)),
      daily_usd: r2(dailyUsd), daily_qta: r2(dailyQta), daily_krw: Math.round(dailyUsd * USDT_KRW),
      dividends_credited_qta: r2(Number(div?.q || 0)), dividends_credited_usd: r2(Number(div?.u || 0)),
      match_claimed_qta: r2(Number(match?.q || 0)), match_claimed_usd: r2(Number(match?.u || 0)),
      match_pending_qta: r2(Number(matchPending?.q || 0)),
      reward_swaps: Number(swaps?.n || 0), reward_swap_qta: r2(Number(swaps?.q || 0)), reward_swap_usdt: r2(Number(swaps?.u || 0)),
      staker_usdt_withdrawn: r2(Number(wd?.u || 0)),
      redeemed_positions: positions.filter(p => p.status !== 'active').length,
    },
    by_product: Object.values(byProduct).map((b: any) => ({ ...b, principal_usd: r2(b.principal_usd), daily_usd: r2(b.daily_usd), daily_qta: r2(b.daily_qta) }))
      .sort((a: any, b: any) => b.principal_usd - a.principal_usd),
    series,
  };
}

// ----------------------------------------------------------------------------
// 2) One member's full cumulative ledger
// ----------------------------------------------------------------------------
export async function stakerLedger(DB: D1Database, userId: string) {
  const now = Date.now();
  const basis = basisNow();
  const user = await one(DB, `SELECT id, email, nickname, kyc_name, kyc_status, referral_code, created_at FROM users WHERE id = ?`, userId);
  if (!user) return null;
  const wallets = await all(DB, `SELECT coin_symbol, available, locked, COALESCE(available_initial,0) available_initial FROM wallets WHERE user_id = ? AND coin_symbol IN ('QTA','USDT')`, userId);
  const positions = (await all(DB, `SELECT * FROM staking_positions WHERE user_id = ? ORDER BY created_at`, userId)).map(p => {
    const start = parseTs(p.created_at);
    const daysAcc = isNaN(start) ? 0 : Math.max(0, Math.min(kstDayIdx(now) - kstDayIdx(start), Number(p.term_days || 0)));
    return {
      id: p.id, product_id: p.product_id, status: p.status, created_at: p.created_at, redeemed_at: p.redeemed_at,
      term_days: p.term_days, term_end_at: p.term_end_at, daily_rate: p.daily_rate,
      principal_usd: p.principal_usd, real_principal_usd: p.real_principal_usd, bonus_principal_usd: p.bonus_principal_usd,
      principal_qta: p.principal_qta, granted: !!p.granted_by,
      daily_usd: r2(Number(p.principal_usd || 0) * Number(p.daily_rate || 0)),
      daily_qta_now: r2(dailyQtaOf(p, basis)),
      days_accrued: daysAcc, paid_dividend_qta: r2(Number(p.paid_dividend_qta || 0)),
    };
  });
  const daily = await all(DB,
    `SELECT kst_date, COUNT(*) positions, SUM(daily_qta) daily_qta, SUM(daily_usd) daily_usd
       FROM staking_daily_accruals WHERE user_id = ? GROUP BY kst_date ORDER BY kst_date`, userId);
  let run = 0;
  const dailyRows = daily.map(d => { run += Number(d.daily_qta || 0); return { date: d.kst_date, positions: d.positions, qta: r2(Number(d.daily_qta || 0)), usd: r2(Number(d.daily_usd || 0)), cumulative_qta: r2(run) }; });
  const credits = await all(DB, `SELECT created_at, kind, qta_amount, usd_amount, qta_price, position_id FROM staking_dividends WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`, userId);
  const matches = await all(DB, `SELECT created_at, matched_usd, rate, bonus_usd, bonus_qta, qta_price, COALESCE(claimed,0) claimed FROM binary_match_bonuses WHERE user_id = ? ORDER BY created_at DESC`, userId);
  const converts = await all(DB, `SELECT filled_at, created_at, source, from_amount, to_amount, price, status, error FROM convert_orders WHERE user_id = ? AND status IN ('filled','failed','cancelled') ORDER BY created_at DESC LIMIT 300`, userId);
  const clawbacks = await all(DB, `SELECT convert_id, from_amount, paid_usdt, fair_usdt, over_usdt, taken_usdt, applied_at FROM convert_clawbacks WHERE user_id = ? ORDER BY applied_at`, userId);
  const wds = [
    ...(await all(DB, `SELECT created_at, coin_symbol coin, amount, fee, status, address FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC`, userId)).map(w => ({ ...w, kind: 'wallet' })),
    ...(await all(DB, `SELECT created_at, COALESCE(asset,'QTA') coin, CAST(amount AS REAL) amount, CAST(fee AS REAL) fee, status, to_address address FROM qta_withdrawals WHERE user_id = ? ORDER BY created_at DESC`, userId)).map(w => ({ ...w, kind: 'dividend' })),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const sum = (rows: any[], k: string, f: (r: any) => boolean = () => true) => r2(rows.filter(f).reduce((a, r) => a + Number(r[k] || 0), 0));
  return {
    user, wallets, positions,
    totals: {
      principal_usd: r2(positions.filter(p => p.status === 'active').reduce((a, p) => a + Number(p.principal_usd || 0), 0)),
      daily_usd: r2(positions.filter(p => p.status === 'active').reduce((a, p) => a + p.daily_usd, 0)),
      daily_qta_now: r2(positions.filter(p => p.status === 'active').reduce((a, p) => a + p.daily_qta_now, 0)),
      accrued_qta: dailyRows.length ? dailyRows[dailyRows.length - 1].cumulative_qta : 0,
      credited_dividend_qta: sum(credits, 'qta_amount', r => r.kind === 'dividend'),
      match_claimed_qta: sum(matches, 'bonus_qta', r => !!r.claimed), match_pending_qta: sum(matches, 'bonus_qta', r => !r.claimed),
      swapped_qta: sum(converts, 'from_amount', r => r.status === 'filled'), swapped_usdt: sum(converts, 'to_amount', r => r.status === 'filled'),
      clawed_back_usdt: sum(clawbacks, 'taken_usdt'),
      withdrawn_usdt: sum(wds, 'amount', r => r.coin === 'USDT' && !['rejected', 'failed', 'cancelled'].includes(r.status)),
      withdrawn_qta: sum(wds, 'amount', r => r.coin === 'QTA' && !['rejected', 'failed', 'cancelled'].includes(r.status)),
    },
    daily: dailyRows.reverse(), credits, matches, converts, clawbacks, withdrawals: wds,
  };
}

// ----------------------------------------------------------------------------
// 3) Friday withdrawal-eligible members, by amount
// ----------------------------------------------------------------------------
export async function withdrawEligible(DB: D1Database) {
  const rows = await all(DB, `
    SELECT u.id, u.email, u.nickname, u.kyc_name, u.kyc_status,
           COALESCE(wu.available,0) usdt_available, COALESCE(wu.locked,0) usdt_locked, COALESCE(wu.available_initial,0) usdt_initial,
           COALESCE(wq.available,0) qta_available, COALESCE(wq.available_initial,0) qta_initial,
           (SELECT COUNT(*) FROM withdraw_whitelist ww WHERE ww.user_id=u.id AND ww.coin_symbol='USDT' AND COALESCE(ww.is_active,1)=1
               AND (ww.cooldown_until IS NULL OR ww.cooldown_until <= datetime('now'))) usdt_whitelist_ready,
           (SELECT COUNT(*) FROM withdraw_whitelist ww WHERE ww.user_id=u.id AND ww.coin_symbol='USDT' AND COALESCE(ww.is_active,1)=1) usdt_whitelist_total,
           (SELECT COUNT(*) FROM staking_positions sp WHERE sp.user_id=u.id AND sp.status='active') active_positions,
           (SELECT COALESCE(SUM(sp.principal_usd),0) FROM staking_positions sp WHERE sp.user_id=u.id AND sp.status='active') staked_usd,
           (SELECT COALESCE(SUM(available+locked),0) FROM wallets wx WHERE wx.user_id=u.id AND wx.coin_symbol IN ('QX','QKEY')) qx_qkey,
           (SELECT COUNT(*) FROM withdrawals w WHERE w.user_id=u.id AND w.status IN ('pending','approved','processing')) pending_withdrawals
      FROM users u
      LEFT JOIN wallets wu ON wu.user_id=u.id AND wu.coin_symbol='USDT'
      LEFT JOIN wallets wq ON wq.user_id=u.id AND wq.coin_symbol='QTA'
     WHERE u.role <> 'admin' AND u.id NOT IN ('mm-bot-a','mm-bot-b')
       AND (COALESCE(wu.available,0) - COALESCE(wu.available_initial,0) >= 10
            OR COALESCE(wq.available,0) - COALESCE(wq.available_initial,0) >= 100)`);
  const basis = basisNow();
  const out = rows.map(r => {
    const usdtFree = Math.max(0, Number(r.usdt_available) - Number(r.usdt_initial));
    const usdtReq = Math.floor(usdtFree / 10) * 10;             // §7: 10 USDT unit
    const qtaFree = Math.max(0, Number(r.qta_available) - Number(r.qta_initial));
    const qtaReq = Math.floor(qtaFree / 100) * 100;             // dividend QTA: 100 unit
    const fee = getFeeTierByHolding(Number(r.qx_qkey || 0)).withdraw_fee;
    const blockers: string[] = [];
    if (r.kyc_status !== 'approved') blockers.push('KYC 미승인');
    if (usdtReq >= 10 && Number(r.usdt_whitelist_ready) === 0) blockers.push(Number(r.usdt_whitelist_total) ? 'USDT 주소 쿨다운 중' : 'USDT 출금주소 미등록');
    return {
      id: r.id, email: r.email, nickname: r.nickname, kyc_name: r.kyc_name, kyc_status: r.kyc_status,
      is_staker: Number(r.active_positions) > 0, staked_usd: r2(Number(r.staked_usd)),
      usdt_available: r2(Number(r.usdt_available)), usdt_locked: r2(Number(r.usdt_locked)), usdt_company: r2(Number(r.usdt_initial)),
      usdt_withdrawable: r2(usdtFree), usdt_requestable: usdtReq,
      usdt_fee_rate: fee, usdt_net_after_fee: r2(usdtReq * (1 - fee)),
      qta_withdrawable: r2(qtaFree), qta_requestable: qtaReq, qta_value_usd: r2(qtaReq * basis),
      whitelist_ready: Number(r.usdt_whitelist_ready) > 0, pending_withdrawals: Number(r.pending_withdrawals),
      ready: blockers.length === 0, blockers,
    };
  }).sort((a, b) => (b.usdt_requestable - a.usdt_requestable) || (b.qta_value_usd - a.qta_value_usd));
  const ready = out.filter(r => r.ready);
  const treasury = await one(DB, `SELECT COALESCE(available,0) v FROM wallets WHERE user_id='admin-001' AND coin_symbol='USDT'`);
  // next Friday 10:00–16:00 KST
  const kst = new Date(Date.now() + KST_MS);
  let add = (5 - kst.getUTCDay() + 7) % 7;
  if (add === 0 && kst.getUTCHours() >= 16) add = 7;
  const open = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + add, 10) - KST_MS;
  return {
    generated_at: new Date().toISOString(),
    window: { opens_at: new Date(open).toISOString(), closes_at: new Date(open + 6 * 3600e3).toISOString(),
      open_now: kst.getUTCDay() === 5 && kst.getUTCHours() >= 10 && kst.getUTCHours() < 16 },
    totals: {
      members: out.length, ready: ready.length,
      usdt_requestable: r2(out.reduce((a, r) => a + r.usdt_requestable, 0)),
      usdt_requestable_ready: r2(ready.reduce((a, r) => a + r.usdt_requestable, 0)),
      usdt_net_ready: r2(ready.reduce((a, r) => a + r.usdt_net_after_fee, 0)),
      qta_requestable: r2(out.reduce((a, r) => a + r.qta_requestable, 0)),
      treasury_usdt: r2(Number(treasury?.v || 0)),
    },
    rows: out,
  };
}

// ----------------------------------------------------------------------------
// 4) Staking policy report — Word-openable HTML (.doc), live numbers + rules
// ----------------------------------------------------------------------------
function esc(s: any) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
const n0 = (n: number) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const n2 = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function stakingPolicyReport(DB: D1Database): Promise<{ html: string; filename: string }> {
  const s = await stakingSummary(DB, 14);
  const products = await all(DB, `SELECT id, min_usd, max_usd, term_days, daily_rate, is_active FROM staking_products ORDER BY sort_order`);
  const today = s.kst_today;
  const pegRows = PEG_WINDOWS.map(w => `<tr><td>${esc(kstDate(w.startMs))} ~ ${Number.isFinite(w.endMs) ? esc(kstDate(w.endMs - 1)) : '별도 지시까지'}</td><td>${w.krw}원</td><td>${n2(w.krw / USDT_KRW * 1000)} / 1,000 QTA</td></tr>`).join('');
  const t = s.totals;
  const table = (head: string[], rows: (string | number)[][]) =>
    `<table><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
<title>QuantaEX 스테이킹 정책 보고서 ${esc(today)}</title>
<style>
body{font-family:'Malgun Gothic',sans-serif;font-size:10.5pt;line-height:1.5;color:#1b2430}
h1{font-size:20pt;color:#1F4E79;margin:0 0 4pt} h2{font-size:13pt;color:#1F4E79;border-bottom:1pt solid #1F4E79;padding-bottom:2pt;margin:16pt 0 6pt}
.sub{color:#5b6878;margin:0 0 12pt} table{border-collapse:collapse;width:100%;margin:4pt 0 8pt}
th,td{border:0.75pt solid #bfc7d2;padding:3pt 6pt;text-align:left;vertical-align:top} th{background:#dce6f1}
td.n,th.n{text-align:right} li{margin:2pt 0} .warn{color:#a15c00}
</style></head><body>
<h1>QuantaEX 스테이킹 정책 보고서</h1>
<p class="sub">기준: ${esc(today)} (KST) · 생성 ${esc(new Date().toISOString().replace('T', ' ').slice(0, 16))} UTC · 운영 DB 실시간 수치</p>

<h2>1. 현재 스테이킹 현황</h2>
${table(['항목', '값'], [
    ['활성 스테이커 / 포지션', `${t.members}명 / ${t.positions}개`],
    ['스테이킹 총액 (인정 포함)', `$${n2(t.principal_usd)} (실입금 $${n2(t.real_usd)} + 인정 $${n2(t.bonus_usd)})`],
    ['하루 배당 (현재)', `$${n2(t.daily_usd)} = ${n0(t.daily_qta)} QTA ≈ ${n0(t.daily_krw)}원`],
    ['누적 지급 배당', `${n0(t.dividends_credited_qta)} QTA ($${n2(t.dividends_credited_usd)})`],
    ['누적 지급 매칭 / 미지급', `${n0(t.match_claimed_qta)} QTA ($${n2(t.match_claimed_usd)}) / ${n0(t.match_pending_qta)} QTA`],
    ['보상 스왑 (한도 예외)', `${t.reward_swaps}건 · ${n0(t.reward_swap_qta)} QTA → ${n2(t.reward_swap_usdt)} USDT`],
    ['수당 환산 단가', `QTA ${s.basis.krw_per_qta}원 (= ${s.basis.usd_per_qta.toFixed(6)} USDT), 테더 ${USDT_KRW}원 고정`],
  ])}

<h2>2. 상품·요율 (운영 DB)</h2>
${table(['상품', '진입 금액 (USD)', '기간', '일 요율', '기간 총 수익', '활성 포지션', '스테이킹 금액'], products.map(p => {
    const b = s.by_product.find((x: any) => x.product_id === p.id);
    return [esc(p.id), `$${n0(p.min_usd)} – $${n0(p.max_usd)}`, `${p.term_days}일`, `${(Number(p.daily_rate) * 100).toFixed(2)}%`,
      `${(Number(p.daily_rate) * Number(p.term_days) * 100).toFixed(0)}%`, b ? b.positions : 0, b ? `$${n2(b.principal_usd)}` : '$0'];
  }))}

<h2>3. 데일리 배당 규칙</h2>
<ul>
<li>기준: <b>진입금액(총금액) × 일 요율 × 경과일수</b>, 만기일까지만 발생.</li>
<li><b>익일부터</b> 발생, 한국시간(KST) 자정이 지날 때마다 1일치. 진입 당일은 0.</li>
<li><b>포지션별 개별 계산</b>: 각자 금액·요율·기간·시작일로 따로 계산 (합산 금지).</li>
<li><b>매일 자동 지갑 입금</b>: KST 자정 후 5분 내 배당·매칭이 Spot 지갑(출금 가능)에 자동 입금. 청구 버튼 불필요.</li>
<li>관리자 인정 스테이킹: 데일리·매칭은 총금액(실입금+인정) 기준, 만기 원금 반환은 실입금만 (인정금액 소멸).</li>
<li>만기: 남은 배당 + 원금 반환 · 중도해지: (원금 + 누적 배당)의 30% 공제 후 USDT 지급.</li>
</ul>

<h2>4. 수당 환산 고정 단가</h2>
<table><tr><th>기간</th><th>QTA 단가</th><th>1,000 QTA = USDT</th></tr>${pegRows}</table>

<h2>5. 매칭보너스</h2>
${table(['소실적 도달', '요율', '단계 지급액'], [['$1,000', '3%', '$30'], ['$5,000', '4%', '$200'], ['$10,000', '5%', '$500'], ['$50,000', '6%', '$3,000'], ['$100,000', '8%', '$8,000']])}
<ul><li>각 단계 1회만 · 좌우 볼륨 무한대 · <b>평생 한도 = 몸값 × 2 (USD)</b> · 몸값은 진입 시마다 누적.</li></ul>

<h2>6. 스테이킹 회원의 매도·스왑·출금</h2>
${table(['경로', '스테이킹 회원 규칙'], [
    ['현물 호가창 매도', '<b>하루 5만원(≈34.48 USDT)</b>까지 — 일반 회원과 동일 (§6 영구명령)'],
    ['Convert 스왑', `<b>보유 QTA 총량, 언제든, 한도 없음</b> — 가격 = 수당 단가 (현재 ${s.basis.krw_per_qta}원/QTA), 시장가보다 높게는 불가`],
    ['출금', '<b>매주 금요일 10:00~16:00 KST</b>, 하루 1회, 금액 상한 없음, USDT 10 단위, KYC·화이트리스트(24h 쿨다운)'],
    ['수수료', '출금 수수료는 QX+QKEY 보유량 등급별 5.0% ~ 0%'],
  ])}
<p class="warn">2026-09-28~29 보상 스왑이 시장가로 체결되어 초과 지급된 1,204.94 USDT(4건)는 2026-09-30 전액 회수·트레저리 반환 완료.</p>

<h2>7. 최근 14일 일별 추이</h2>
${table(['일자 (KST)', '활성 포지션', '스테이킹 금액', '신규', '배당 발생 QTA', '매칭 QTA', '보상 스왑 USDT'],
    s.series.slice().reverse().map((d: any) => [d.date, d.active_positions, `$${n0(d.active_principal_usd)}`, d.new_positions ? `${d.new_positions}건 $${n0(d.new_principal_usd)}` : '-',
      n0(d.accrued_qta), n0(d.match_qta), n2(d.swap_usdt)]))}
</body></html>`;
  return { html, filename: `QuantaEX_스테이킹정책_${today}.doc` };
}
