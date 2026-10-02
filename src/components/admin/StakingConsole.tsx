// ============================================================================
// Admin staking console (owner 2026-09-30)
//   • StakingTicker      — header strip, always visible on every admin tab
//   • StakingDashTab     — 스테이킹 현황: totals + product mix + per-day table
//                          + staking policy report download
//   • FridayWithdrawTab  — 금요일 출금 대상자, sorted by amount
//   • StakerLedgerPanel  — one member's full cumulative history (Stakers tab)
// Admin console → Korean OK (OWNER_RULES §0 covers member screens only).
// ============================================================================
import { useEffect, useState } from 'react';
import { RefreshCw, Download, PiggyBank } from 'lucide-react';
import api from '../../utils/api';
import { showToast } from '../common/Toast';

const n0 = (n: any) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const n2 = (n: any) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function kst(v: any) {
  if (!v) return '-';
  const s = String(v);
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? s : d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export async function downloadPolicyReport() {
  try {
    const r = await api.get('/admin/staking/policy-report', { responseType: 'blob' });
    const cd = String(r.headers?.['content-disposition'] || '');
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    const name = m ? decodeURIComponent(m[1]) : `QuantaEX_스테이킹정책_${new Date().toISOString().slice(0, 10)}.doc`;
    const url = URL.createObjectURL(new Blob([r.data], { type: 'application/msword' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('success', '다운로드', name);
  } catch (e: any) { showToast('error', '보고서 다운로드 실패', e?.response?.data?.error || e.message); }
}

// ---------------------------------------------------------------------------
// Header ticker — always visible
// ---------------------------------------------------------------------------
export function StakingTicker({ onOpen }: { onOpen?: () => void }) {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/admin/staking/summary', { params: { days: 1 } }).then(r => { if (alive) setS(r.data); }).catch(() => {});
    load();
    const h = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(h); };
  }, []);
  if (!s?.totals) return null;
  const t = s.totals;
  return (
    <button onClick={onOpen} title="스테이킹 현황 열기"
      className="hidden md:inline-flex items-center gap-2 rounded border border-exchange-buy/40 bg-exchange-buy/10 px-2.5 py-1 text-[11px] tabular-nums hover:bg-exchange-buy/20">
      <PiggyBank size={13} className="text-exchange-buy" />
      <span className="text-exchange-text-third">스테이킹</span><b>${n0(t.principal_usd)}</b>
      <span className="text-exchange-text-third">· {t.members}명 · 하루</span><b>${n2(t.daily_usd)}</b>
      <span className="text-exchange-text-third">({n0(t.daily_qta)} QTA)</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 스테이킹 현황 tab
// ---------------------------------------------------------------------------
export function StakingDashTab() {
  const [s, setS] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const r = await api.get('/admin/staking/summary', { params: { days } }); setS(r.data); }
    catch (e: any) { showToast('error', '조회 실패', e?.response?.data?.error || e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [days]);
  const t = s?.totals;
  const series = (s?.series || []).slice().reverse();
  const maxAcc = Math.max(1, ...series.map((d: any) => d.accrued_qta));
  const Kpi = ({ label, value, sub }: any) => (
    <div className="rounded border border-exchange-border px-3 py-2.5">
      <div className="text-[11px] text-exchange-text-third">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {sub ? <div className="text-[11px] text-exchange-text-third tabular-nums">{sub}</div> : null}
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-sm">스테이킹 현황 — 총액 · 하루 배당 · 일별 추이</div>
            <div className="text-[11px] text-exchange-text-third">운영 DB 실시간. 수당 단가 QTA {s?.basis?.krw_per_qta ?? '-'}원 · 테더 {s?.basis?.usdt_krw ?? 1450}원 · 기준일 {s?.kst_today ?? '-'} (KST)</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="px-2.5 py-1.5 rounded bg-exchange-input text-xs inline-flex items-center gap-1"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
            <button onClick={downloadPolicyReport} className="px-3 py-1.5 rounded bg-exchange-yellow text-black text-xs font-semibold inline-flex items-center gap-1"><Download size={13} /> 스테이킹 정책 보고서 (Word)</button>
          </div>
        </div>
        {t && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="스테이킹 총액 (진행 중)" value={`$${n0(t.principal_usd)}`} sub={`실입금 $${n0(t.real_usd)} + 인정 $${n0(t.bonus_usd)}`} />
            <Kpi label="스테이커 / 포지션" value={`${t.members}명 / ${t.positions}개`} sub={`종료 포지션 ${t.redeemed_positions}개`} />
            <Kpi label="하루 배당 (오늘 기준)" value={`$${n2(t.daily_usd)}`} sub={`${n0(t.daily_qta)} QTA ≈ ${n0(t.daily_krw)}원`} />
            <Kpi label="누적 지급 배당" value={`${n0(t.dividends_credited_qta)} QTA`} sub={`$${n2(t.dividends_credited_usd)}`} />
            <Kpi label="누적 지급 매칭" value={`${n0(t.match_claimed_qta)} QTA`} sub={`$${n2(t.match_claimed_usd)} · 미지급 ${n0(t.match_pending_qta)} QTA`} />
            <Kpi label="보상 스왑 (한도 예외)" value={`${n2(t.reward_swap_usdt)} USDT`} sub={`${t.reward_swaps}건 · ${n0(t.reward_swap_qta)} QTA`} />
            <Kpi label="스테이커 USDT 출금 누계" value={`${n2(t.staker_usdt_withdrawn)} USDT`} />
          </div>
        )}
      </div>

      {s?.by_product?.length ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-exchange-text-third border-b border-exchange-border">
              <th className="text-left px-3 py-2">상품</th><th className="text-right px-3 py-2">일 요율</th><th className="text-right px-3 py-2">기간</th>
              <th className="text-right px-3 py-2">포지션</th><th className="text-right px-3 py-2">스테이킹 금액</th><th className="text-right px-3 py-2">하루 배당 USD</th><th className="text-right px-3 py-2">하루 배당 QTA</th>
            </tr></thead>
            <tbody>{s.by_product.map((b: any) => (
              <tr key={b.product_id} className="border-b border-exchange-border/50">
                <td className="px-3 py-2 font-medium">{b.product_id}</td>
                <td className="px-3 py-2 text-right tabular-nums">{(b.daily_rate * 100).toFixed(2)}%</td>
                <td className="px-3 py-2 text-right tabular-nums">{b.term_days}일</td>
                <td className="px-3 py-2 text-right tabular-nums">{b.positions}</td>
                <td className="px-3 py-2 text-right tabular-nums">${n2(b.principal_usd)}</td>
                <td className="px-3 py-2 text-right tabular-nums">${n2(b.daily_usd)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{n0(b.daily_qta)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ) : null}

      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between px-3 pt-3 text-xs">
          <div className="font-semibold">일별 추이 (KST)</div>
          <div className="flex gap-1">{[7, 30, 90].map(d => <button key={d} onClick={() => setDays(d)} className={`px-2 py-1 rounded ${days === d ? 'bg-exchange-yellow/15 text-exchange-yellow font-semibold' : 'bg-exchange-input text-exchange-text-secondary'}`}>{d}일</button>)}</div>
        </div>
        <table className="w-full text-xs mt-2">
          <thead><tr className="text-exchange-text-third border-b border-exchange-border">
            <th className="text-left px-3 py-2">일자</th><th className="text-right px-3 py-2">스테이킹 금액</th><th className="text-right px-3 py-2">포지션</th>
            <th className="text-right px-3 py-2">신규 진입</th><th className="text-left px-3 py-2 w-[28%]">배당 발생 QTA</th><th className="text-right px-3 py-2">배당 USD</th>
            <th className="text-right px-3 py-2">매칭 QTA</th><th className="text-right px-3 py-2">보상 스왑 USDT</th>
          </tr></thead>
          <tbody>{series.map((d: any) => (
            <tr key={d.date} className="border-b border-exchange-border/50">
              <td className="px-3 py-1.5 tabular-nums">{d.date}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">${n0(d.active_principal_usd)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{d.active_positions}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{d.new_positions ? `${d.new_positions}건 · $${n0(d.new_principal_usd)}` : <span className="text-exchange-text-third">-</span>}</td>
              <td className="px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 rounded bg-exchange-buy/70" style={{ width: `${Math.max(2, (d.accrued_qta / maxAcc) * 100)}%` }} />
                  <span className="tabular-nums whitespace-nowrap">{n0(d.accrued_qta)}</span>
                </div>
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">${n2(d.accrued_usd)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{d.match_qta ? n0(d.match_qta) : <span className="text-exchange-text-third">-</span>}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{d.swap_usdt ? n2(d.swap_usdt) : <span className="text-exchange-text-third">-</span>}</td>
            </tr>))}</tbody>
        </table>
        <div className="px-3 py-2 text-[10px] text-exchange-text-third">배당 발생 = 그날 KST 자정에 발생한 1일치(포지션별 개별 계산 합). 매일 자정 후 자동으로 회원 지갑에 입금됩니다.</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 금요일 출금 대상자 tab
// ---------------------------------------------------------------------------
export function FridayWithdrawTab() {
  const [d, setD] = useState<any>(null);
  const [only, setOnly] = useState<'all' | 'ready' | 'blocked' | 'stakers'>('all');
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const r = await api.get('/admin/withdraw-eligible'); setD(r.data); }
    catch (e: any) { showToast('error', '조회 실패', e?.response?.data?.error || e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const rows = (d?.rows || []).filter((r: any) => only === 'all' || (only === 'ready' ? r.ready : only === 'blocked' ? !r.ready : r.is_staker));
  const t = d?.totals;
  const short = t ? t.treasury_usdt < t.usdt_requestable_ready : false;
  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-sm">금요일 출금 대상자 — 신청 가능 금액순</div>
            <div className="text-[11px] text-exchange-text-third">
              창구 {d?.window ? `${kst(d.window.opens_at)} ~ ${kst(d.window.closes_at)}` : '-'} {d?.window?.open_now ? <b className="text-exchange-buy">· 지금 열림</b> : ''}
              {' '}· 출금 가능 = 잔액 − 회사지급분, USDT 10단위 · 하루 1회 · KYC + 화이트리스트(24h 쿨다운)
            </div>
          </div>
          <button onClick={load} className="px-2.5 py-1.5 rounded bg-exchange-input text-xs inline-flex items-center gap-1"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
        </div>
        {t && (
          <div className="flex flex-wrap gap-2 text-xs">
            <div className="rounded border border-exchange-border px-2.5 py-1.5">대상 <b>{t.members}</b>명 · 바로 신청 가능 <b className="text-exchange-buy">{t.ready}</b>명</div>
            <div className="rounded border border-exchange-border px-2.5 py-1.5">신청 가능 USDT 합계 <b>{n0(t.usdt_requestable)}</b> (가능자 <b>{n0(t.usdt_requestable_ready)}</b> · 수수료 후 {n2(t.usdt_net_ready)})</div>
            <div className="rounded border border-exchange-border px-2.5 py-1.5">QTA 배당 출금 가능 <b>{n0(t.qta_requestable)}</b></div>
            <div className={`rounded border px-2.5 py-1.5 ${short ? 'border-exchange-sell/60 bg-exchange-sell/10' : 'border-exchange-border'}`}>트레저리 USDT <b className={short ? 'text-exchange-sell' : ''}>{n2(t.treasury_usdt)}</b></div>
          </div>
        )}
        <div className="flex gap-1 text-xs">
          {([['all', '전체'], ['ready', '바로 가능'], ['blocked', '조건 미충족'], ['stakers', '스테이커만']] as const).map(([k, l]) =>
            <button key={k} onClick={() => setOnly(k)} className={`px-2.5 py-1 rounded ${only === k ? 'bg-exchange-yellow/15 text-exchange-yellow font-semibold' : 'bg-exchange-input text-exchange-text-secondary'}`}>{l}</button>)}
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-exchange-text-third border-b border-exchange-border">
            <th className="text-right px-3 py-2">#</th><th className="text-left px-3 py-2">회원</th><th className="text-right px-3 py-2">신청 가능 USDT</th>
            <th className="text-right px-3 py-2">수수료 후</th><th className="text-right px-3 py-2">USDT 잔액 (회사지급분)</th><th className="text-right px-3 py-2">QTA 출금 가능</th>
            <th className="text-right px-3 py-2">스테이킹</th><th className="text-left px-3 py-2">상태</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={8} className="px-3 py-8 text-center text-exchange-text-third">{loading ? '불러오는 중…' : '대상자가 없습니다'}</td></tr>
              : rows.map((r: any, i: number) => (
                <tr key={r.id} className="border-b border-exchange-border/50">
                  <td className="px-3 py-2 text-right tabular-nums text-exchange-text-third">{i + 1}</td>
                  <td className="px-3 py-2"><div className="font-medium">{r.nickname}{r.kyc_name ? <span className="text-exchange-text-third"> · {r.kyc_name}</span> : null}</div><div className="text-exchange-text-third">{r.email}</div></td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{n0(r.usdt_requestable)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n2(r.usdt_net_after_fee)} <span className="text-exchange-text-third">({(r.usdt_fee_rate * 100).toFixed(1)}%)</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{n2(r.usdt_available)}{r.usdt_company > 0 ? <span className="text-exchange-text-third"> ({n2(r.usdt_company)})</span> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.qta_requestable ? n0(r.qta_requestable) : '-'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.is_staker ? `$${n0(r.staked_usd)}` : '-'}</td>
                  <td className="px-3 py-2">{r.ready
                    ? <span className="px-1.5 py-0.5 rounded bg-exchange-buy/15 text-exchange-buy">신청 가능</span>
                    : r.blockers.map((b: string) => <span key={b} className="mr-1 px-1.5 py-0.5 rounded bg-exchange-sell/15 text-exchange-sell whitespace-nowrap">{b}</span>)}
                    {r.pending_withdrawals > 0 && <span className="ml-1 px-1.5 py-0.5 rounded bg-exchange-yellow/15 text-exchange-yellow">대기 {r.pending_withdrawals}</span>}
                  </td>
                </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One member's cumulative ledger (opened from the Stakers tab)
// ---------------------------------------------------------------------------
export function StakerLedgerPanel({ userId }: { userId: string }) {
  const [d, setD] = useState<any>(null);
  const [sec, setSec] = useState<'daily' | 'positions' | 'credits' | 'matches' | 'converts' | 'withdrawals'>('daily');
  useEffect(() => { api.get(`/admin/stakers/${userId}/ledger`).then(r => setD(r.data)).catch((e) => showToast('error', '내역 조회 실패', e?.response?.data?.error || e.message)); }, [userId]);
  if (!d) return <div className="text-exchange-text-third text-xs">누적 내역 불러오는 중…</div>;
  const t = d.totals;
  const w = (c: string) => d.wallets.find((x: any) => x.coin_symbol === c) || {};
  const Cell = ({ l, v }: any) => <div className="rounded border border-exchange-border px-2 py-1.5"><div className="text-[10px] text-exchange-text-third">{l}</div><div className="font-semibold tabular-nums">{v}</div></div>;
  const tabs: [typeof sec, string][] = [['daily', `일별 배당 (${d.daily.length}일)`], ['positions', `포지션 (${d.positions.length})`], ['credits', `지갑 입금 (${d.credits.length})`], ['matches', `매칭 (${d.matches.length})`], ['converts', `스왑 (${d.converts.length})`], ['withdrawals', `출금 (${d.withdrawals.length})`]];
  const th = 'text-left px-2 py-1', thr = 'text-right px-2 py-1', td = 'px-2 py-1 tabular-nums', tdr = 'px-2 py-1 text-right tabular-nums';
  return (
    <div className="space-y-2 text-[11px]">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-1.5">
        <Cell l="스테이킹 (진행 중)" v={`$${n0(t.principal_usd)}`} />
        <Cell l="하루 배당" v={`$${n2(t.daily_usd)} · ${n0(t.daily_qta_now)} QTA`} />
        <Cell l="누적 배당 발생" v={`${n0(t.accrued_qta)} QTA`} />
        <Cell l="지갑 입금된 배당" v={`${n0(t.credited_dividend_qta)} QTA`} />
        <Cell l="매칭 지급 / 대기" v={`${n0(t.match_claimed_qta)} / ${n0(t.match_pending_qta)}`} />
        <Cell l="스왑" v={`${n0(t.swapped_qta)} QTA → ${n2(t.swapped_usdt)}`} />
        <Cell l="초과분 회수" v={`${n2(t.clawed_back_usdt)} USDT`} />
        <Cell l="출금 USDT / QTA" v={`${n2(t.withdrawn_usdt)} / ${n0(t.withdrawn_qta)}`} />
        <Cell l="현재 QTA" v={`${n0(w('QTA').available)}${Number(w('QTA').locked) ? ` (+${n0(w('QTA').locked)})` : ''}`} />
        <Cell l="현재 USDT" v={`${n2(w('USDT').available)}${Number(w('USDT').locked) ? ` (+${n2(w('USDT').locked)})` : ''}`} />
      </div>
      <div className="flex flex-wrap gap-1">{tabs.map(([k, l]) => <button key={k} onClick={() => setSec(k)} className={`px-2 py-1 rounded ${sec === k ? 'bg-exchange-yellow/15 text-exchange-yellow font-semibold' : 'bg-exchange-input text-exchange-text-secondary'}`}>{l}</button>)}</div>
      <div className="max-h-80 overflow-auto rounded border border-exchange-border/60">
        <table className="w-full">
          {sec === 'daily' && (<>
            <thead><tr className="text-exchange-text-third"><th className={th}>일자 (KST)</th><th className={thr}>포지션</th><th className={thr}>그날 배당 QTA</th><th className={thr}>USD</th><th className={thr}>누적 QTA</th></tr></thead>
            <tbody>{d.daily.map((r: any) => <tr key={r.date} className="border-t border-exchange-border/40"><td className={td}>{r.date}</td><td className={tdr}>{r.positions}</td><td className={tdr}>{n0(r.qta)}</td><td className={tdr}>${n2(r.usd)}</td><td className={tdr}>{n0(r.cumulative_qta)}</td></tr>)}</tbody>
          </>)}
          {sec === 'positions' && (<>
            <thead><tr className="text-exchange-text-third"><th className={th}>시작</th><th className={th}>상품</th><th className={thr}>금액</th><th className={thr}>일 요율</th><th className={thr}>하루</th><th className={thr}>경과</th><th className={thr}>지급 QTA</th><th className={th}>상태</th></tr></thead>
            <tbody>{d.positions.map((p: any) => <tr key={p.id} className="border-t border-exchange-border/40"><td className={td}>{kst(p.created_at)}</td><td className={td}>{p.product_id}{p.granted ? ' (인정)' : ''}</td><td className={tdr}>${n2(p.principal_usd)}{Number(p.bonus_principal_usd) > 0 ? ` (실 ${n0(p.real_principal_usd)})` : ''}</td><td className={tdr}>{(Number(p.daily_rate) * 100).toFixed(2)}%</td><td className={tdr}>${n2(p.daily_usd)} · {n0(p.daily_qta_now)}</td><td className={tdr}>{p.days_accrued}/{p.term_days}일</td><td className={tdr}>{n0(p.paid_dividend_qta)}</td><td className={td}>{p.status}</td></tr>)}</tbody>
          </>)}
          {sec === 'credits' && (<>
            <thead><tr className="text-exchange-text-third"><th className={th}>입금 시각</th><th className={th}>종류</th><th className={thr}>QTA</th><th className={thr}>USD</th><th className={thr}>단가</th></tr></thead>
            <tbody>{d.credits.map((r: any, i: number) => <tr key={i} className="border-t border-exchange-border/40"><td className={td}>{kst(r.created_at)}</td><td className={td}>{r.kind}</td><td className={tdr}>{n0(r.qta_amount)}</td><td className={tdr}>${n2(r.usd_amount)}</td><td className={tdr}>{Number(r.qta_price).toFixed(6)}</td></tr>)}</tbody>
          </>)}
          {sec === 'matches' && (<>
            <thead><tr className="text-exchange-text-third"><th className={th}>시각</th><th className={thr}>소실적</th><th className={thr}>요율</th><th className={thr}>USD</th><th className={thr}>QTA</th><th className={th}>지급</th></tr></thead>
            <tbody>{d.matches.map((r: any, i: number) => <tr key={i} className="border-t border-exchange-border/40"><td className={td}>{kst(r.created_at)}</td><td className={tdr}>${n0(r.matched_usd)}</td><td className={tdr}>{(Number(r.rate) * 100).toFixed(0)}%</td><td className={tdr}>${n2(r.bonus_usd)}</td><td className={tdr}>{n0(r.bonus_qta)}</td><td className={td}>{r.claimed ? '지급' : '대기'}</td></tr>)}</tbody>
          </>)}
          {sec === 'converts' && (<>
            <thead><tr className="text-exchange-text-third"><th className={th}>시각</th><th className={th}>구분</th><th className={thr}>QTA</th><th className={thr}>USDT</th><th className={thr}>단가</th><th className={th}>상태</th></tr></thead>
            <tbody>{d.converts.map((r: any, i: number) => <tr key={i} className="border-t border-exchange-border/40"><td className={td}>{kst(r.filled_at || r.created_at)}</td><td className={td}>{r.source === 'staking_reward' ? '보상(무제한)' : '일반(5만원)'}</td><td className={tdr}>{n0(r.from_amount)}</td><td className={tdr}>{n2(r.to_amount)}</td><td className={tdr}>{Number(r.price).toFixed(6)}</td><td className={td}>{r.status}{r.error ? ` · ${r.error}` : ''}</td></tr>)}
              {d.clawbacks.map((r: any) => <tr key={r.convert_id} className="border-t border-exchange-border/40 text-exchange-sell"><td className={td}>{kst(r.applied_at)}</td><td className={td}>초과분 회수</td><td className={tdr}>{n0(r.from_amount)}</td><td className={tdr}>−{n2(r.taken_usdt)}</td><td className={tdr}>→ {n2(r.fair_usdt)}</td><td className={td}>회수 완료</td></tr>)}
            </tbody>
          </>)}
          {sec === 'withdrawals' && (<>
            <thead><tr className="text-exchange-text-third"><th className={th}>신청 시각</th><th className={th}>구분</th><th className={th}>코인</th><th className={thr}>금액</th><th className={thr}>수수료</th><th className={th}>상태</th><th className={th}>주소</th></tr></thead>
            <tbody>{d.withdrawals.map((r: any, i: number) => <tr key={i} className="border-t border-exchange-border/40"><td className={td}>{kst(r.created_at)}</td><td className={td}>{r.kind === 'dividend' ? '배당 출금' : '지갑 출금'}</td><td className={td}>{r.coin}</td><td className={tdr}>{n2(r.amount)}</td><td className={tdr}>{n2(r.fee)}</td><td className={td}>{r.status}</td><td className={`${td} break-all min-w-[16rem] font-mono select-all`}>{r.address}</td></tr>)}</tbody>
          </>)}
        </table>
      </div>
    </div>
  );
}
