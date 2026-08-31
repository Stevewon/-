import { useEffect, useState, Fragment } from 'react';
import {
  Users, BarChart3, ShieldCheck, ArrowUpFromLine, RefreshCw, Activity,
  DollarSign, TrendingUp, Search, Filter, ChevronLeft, ChevronRight,
  Ban, UserCheck, Crown, KeyRound, X, CheckCircle2, XCircle, Clock,
  Coins, Send, ArrowDownToLine, Megaphone, Wallet, Hash, Bell,
  FileText, Receipt, Server, Database, HardDrive,
  Shield, AlertTriangle, Zap, Plus, Trash2,
  Repeat, ArrowRightLeft, Pause, Play, TrendingDown,
} from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { formatPrice, timeAgo } from '../utils/format';
import { showToast } from '../components/common/Toast';
import CoinIcon from '../components/common/CoinIcon';
import AdminLayout, { type AdminTab } from '../components/layout/AdminLayout';
import BalanceBreakdownModal, { type BalanceBreakdown } from '../components/wallet/BalanceBreakdownModal';

type Tab = AdminTab;

export default function AdminPage() {
  const { user } = useStore();
  const { t } = useI18n();
  const [stats, setStats] = useState<any>({});
  const [trends, setTrends] = useState<any[]>([]);
  const [topMarkets, setTopMarkets] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = async () => {
    try {
      const [s, tr, tm, ac] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/trends?days=14'),
        api.get('/admin/top-markets?limit=5'),
        api.get('/admin/activity?limit=20'),
      ]);
      setStats(s.data);
      setTrends(tr.data);
      setTopMarkets(tm.data);
      setActivity(ac.data);
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed to load stats');
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await loadStats();
    setTimeout(() => setRefreshing(false), 400);
  };

  const [alertChecking, setAlertChecking] = useState(false);
  const runPriceAlertCheck = async () => {
    if (alertChecking) return;
    setAlertChecking(true);
    try {
      const res = await api.post('/admin/run-price-alert-check');
      const { checked = 0, triggered = 0 } = res.data || {};
      showToast(
        triggered > 0 ? 'success' : 'info',
        t('admin.priceAlertCheckDone'),
        t('admin.priceAlertCheckSummary', { checked, triggered }),
      );
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setAlertChecking(false);
    }
  };

  useEffect(() => { loadStats(); }, []);

  if (user?.role !== 'admin') return <div className="p-8 text-center text-exchange-sell">{t('admin.accessDenied')}</div>;

  const badges: Partial<Record<Tab, number>> = {
    kyc: stats.pendingKyc,
    deposits: stats.pendingDeposits,
    withdrawals: stats.pendingWithdrawals,
  };

  return (
    <AdminLayout
      active={tab}
      onChange={(k) => setTab(k)}
      badges={badges}
      onRefresh={refresh}
      refreshing={refreshing}
      onPriceAlertCheck={runPriceAlertCheck}
      alertChecking={alertChecking}
    >
      {tab === 'overview'    && <Overview stats={stats} trends={trends} topMarkets={topMarkets} activity={activity} t={t} onJump={(k: Tab) => setTab(k)} />}
      {tab === 'users'       && <UsersTab t={t} onUpdate={refresh} />}
      {tab === 'kyc'         && <KycTab t={t} onUpdate={refresh} />}
      {tab === 'deposits'    && <DepositsTab t={t} onUpdate={refresh} />}
      {tab === 'withdrawals' && <WithdrawalsTab t={t} onUpdate={refresh} />}
      {tab === 'trades'      && <TradesTab t={t} />}
      {tab === 'coins'       && <CoinsTab t={t} />}
      {tab === 'broadcast'   && <BroadcastTab t={t} />}
      {tab === 'notices'     && <NoticesTab t={t} />}
      {tab === 'fees'        && <FeesTab t={t} />}
      {tab === 'audit'       && <AuditTab t={t} />}
      {tab === 'system'      && <SystemTab t={t} />}
      {tab === 'chainWallets' && <ChainWalletsTab t={t} />}
      {tab === 'chainQueue'   && <ChainQueueTab t={t} />}
      {tab === 'chainHealth'  && <ChainHealthTab t={t} />}
      {tab === 'bridge'       && <BridgeTab t={t} />}
      {tab === 'risk'         && <RiskTab t={t} />}
      {tab === 'futuresMarkets'   && <FuturesMarketsTab t={t} />}
      {tab === 'futuresPositions' && <FuturesPositionsTab t={t} />}
      {tab === 'liquidations'     && <LiquidationsTab t={t} />}
      {tab === 'fundingHistory'   && <FundingHistoryTab t={t} />}
      {tab === 'marginAccounts'   && <MarginAccountsTab t={t} />}
      {tab === 'pqApiKeys'        && <PqApiKeysTab t={t} />}
    </AdminLayout>
  );
}

// ============================================================================
// Overview tab
// ============================================================================
function Overview({ stats, trends, topMarkets, activity, t, onJump }: any) {
  // Sprint 5 Phase A1 — "Action queue" banner: surfaces every operator
  // task that is currently waiting on a human (KYC review, manual coin
  // deposits, withdrawal approvals). Hidden when nothing is pending.
  const pendingItems = [
    {
      key: 'kyc' as const,
      count: Number(stats.pendingKyc || 0),
      label: t('admin.pendingKyc'),
      icon: ShieldCheck,
      color: 'text-exchange-yellow',
      ring: 'ring-exchange-yellow/40',
      bg: 'bg-exchange-yellow/10',
    },
    {
      key: 'deposits' as const,
      count: Number(stats.pendingDeposits || 0),
      label: t('admin.pendingDeposits'),
      icon: ArrowDownToLine,
      color: 'text-exchange-buy',
      ring: 'ring-exchange-buy/40',
      bg: 'bg-exchange-buy/10',
    },
    {
      key: 'withdrawals' as const,
      count: Number(stats.pendingWithdrawals || 0),
      label: t('admin.pendingWithdrawals'),
      icon: ArrowUpFromLine,
      color: 'text-exchange-sell',
      ring: 'ring-exchange-sell/40',
      bg: 'bg-exchange-sell/10',
    },
  ];
  const totalPending = pendingItems.reduce((s, it) => s + it.count, 0);

  const cards = [
    { label: t('admin.totalUsers'),     value: stats.users,              sub: `+${stats.newUsers24h||0} ${t('admin.last24h')}`, icon: Users,           color: 'text-blue-400',           bg: 'bg-blue-400/10' },
    { label: t('admin.trades24h'),      value: stats.trades24h,          sub: `${stats.trades||0} ${t('admin.total')}`,        icon: BarChart3,       color: 'text-exchange-buy',       bg: 'bg-exchange-buy/10' },
    { label: t('admin.volume24h'),      value: `$${formatPrice(stats.volume24h||0)}`, sub: `$${formatPrice(stats.totalVolume||0)} ${t('admin.total')}`, icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-500/10', isString: true },
    { label: t('admin.feeRevenue24h'),  value: `$${formatPrice(stats.feeRevenue24h||0)}`, sub: `$${formatPrice(stats.feeRevenue||0)} ${t('admin.total')}`, icon: DollarSign, color: 'text-exchange-yellow', bg: 'bg-exchange-yellow/10', isString: true },
    { label: t('admin.pendingKyc'),     value: stats.pendingKyc,         sub: `${stats.approvedKyc||0} ${t('admin.approved')}`, icon: ShieldCheck,     color: 'text-exchange-yellow',    bg: 'bg-exchange-yellow/10' },
    { label: t('admin.pendingWithdrawals'), value: stats.pendingWithdrawals, sub: '', icon: ArrowUpFromLine, color: 'text-exchange-sell', bg: 'bg-exchange-sell/10' },
    { label: t('admin.pendingDeposits'),    value: stats.pendingDeposits,    sub: '', icon: ArrowDownToLine, color: 'text-exchange-buy',  bg: 'bg-exchange-buy/10' },
    { label: t('admin.openOrders'),     value: stats.openOrders,          sub: `${stats.orders||0} ${t('admin.total')}`, icon: Hash, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  ];

  return (
    <>
      {/* ─── Action queue banner (Sprint 5 Phase A1) ─────────────────── */}
      {totalPending > 0 && (
        <div className="card p-3 sm:p-4 mb-4 border border-exchange-yellow/30 bg-exchange-yellow/5">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="w-7 h-7 rounded-lg bg-exchange-yellow/15 flex items-center justify-center shrink-0">
              <Clock size={14} className="text-exchange-yellow" />
            </div>
            <span className="text-sm font-semibold text-exchange-yellow">
              {t('admin.actionQueueTitle', { n: totalPending })}
            </span>
            <span className="text-[11px] text-exchange-text-third hidden sm:inline">
              · {t('admin.actionQueueHint')}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {pendingItems.map(({ key, count, label, icon: Icon, color, ring, bg }) => (
              <button
                key={key}
                disabled={count === 0}
                onClick={() => count > 0 && onJump?.(key)}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border border-exchange-border ${
                  count > 0
                    ? `bg-exchange-card hover:${bg} hover:ring-2 hover:${ring} transition-all cursor-pointer`
                    : 'bg-exchange-card/40 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                  <Icon size={15} className={color} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[10px] text-exchange-text-third truncate">{label}</div>
                  <div className={`text-lg font-bold tabular-nums ${count > 0 ? color : 'text-exchange-text-third'}`}>
                    {count}
                  </div>
                </div>
                {count > 0 && (
                  <span className="text-[10px] text-exchange-text-secondary whitespace-nowrap">
                    {t('admin.actionQueueGo')} →
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {cards.map(({ label, value, sub, icon: Icon, color, bg, isString }, i) => (
          <div key={i} className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon size={14} className={color} />
              </div>
              <span className="text-[11px] text-exchange-text-third">{label}</span>
            </div>
            <div className="text-xl font-bold tabular-nums truncate">
              {isString ? value : (typeof value === 'number' ? value.toLocaleString() : (value || 0))}
            </div>
            {sub && <div className="text-[10px] text-exchange-text-third mt-0.5 truncate">{sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* Trends chart */}
        <div className="card p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">{t('admin.trends14d')}</h3>
            <span className="text-[10px] text-exchange-text-third">{t('admin.signupsTradesVolume')}</span>
          </div>
          <TrendsChart data={trends} />
        </div>

        {/* Top markets */}
        <div className="card p-4">
          <h3 className="font-semibold text-sm mb-3">{t('admin.topMarkets24h')}</h3>
          {topMarkets.length === 0 ? (
            <p className="text-xs text-exchange-text-third py-8 text-center">{t('admin.noData')}</p>
          ) : (
            <div className="space-y-2.5">
              {topMarkets.map((m: any, i: number) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-exchange-text-third tabular-nums w-4">{i + 1}</span>
                  <CoinIcon symbol={m.base_coin} size={22} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">{m.base_coin}/{m.quote_coin}</div>
                    <div className="text-[10px] text-exchange-text-third">{m.trade_count} {t('admin.trades')}</div>
                  </div>
                  <div className="text-xs font-semibold tabular-nums">${formatPrice(m.volume)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activity feed */}
      <div className="card p-4">
        <h3 className="font-semibold text-sm mb-3">{t('admin.recentActivity')}</h3>
        {activity.length === 0 ? (
          <p className="text-xs text-exchange-text-third py-6 text-center">{t('admin.noData')}</p>
        ) : (
          <div className="space-y-0 max-h-96 overflow-y-auto">
            {activity.map((a: any, i: number) => (
              <ActivityRow key={i} event={a} t={t} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function TrendsChart({ data }: { data: any[] }) {
  if (!data || data.length === 0) {
    return <p className="text-xs text-exchange-text-third py-8 text-center">No data yet</p>;
  }
  const maxTrades = Math.max(1, ...data.map(d => d.trades));
  const maxUsers = Math.max(1, ...data.map(d => d.users));
  const maxVolume = Math.max(1, ...data.map(d => d.volume));

  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d, i) => {
        const tH = (d.trades / maxTrades) * 100;
        const uH = (d.users / maxUsers) * 100;
        const vH = (d.volume / maxVolume) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group" title={`${d.day}: ${d.users} users, ${d.trades} trades, $${formatPrice(d.volume)}`}>
            <div className="relative w-full flex gap-0.5 h-full items-end">
              <div className="flex-1 bg-blue-400/40 rounded-t group-hover:bg-blue-400/60" style={{ height: `${uH}%`, minHeight: d.users > 0 ? '2px' : '0' }} />
              <div className="flex-1 bg-exchange-buy/50 rounded-t group-hover:bg-exchange-buy/70" style={{ height: `${tH}%`, minHeight: d.trades > 0 ? '2px' : '0' }} />
              <div className="flex-1 bg-purple-400/50 rounded-t group-hover:bg-purple-400/70" style={{ height: `${vH}%`, minHeight: d.volume > 0 ? '2px' : '0' }} />
            </div>
            <div className="text-[9px] text-exchange-text-third tabular-nums">{d.day.slice(5)}</div>
          </div>
        );
      })}
      <div className="flex flex-col text-[9px] gap-1 pl-2">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-400/60 rounded-sm" />Users</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-exchange-buy/60 rounded-sm" />Trades</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-400/60 rounded-sm" />Volume</span>
      </div>
    </div>
  );
}

function ActivityRow({ event, t }: any) {
  const icons: Record<string, any> = {
    signup: { icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/10', label: t('admin.evt_signup') },
    kyc_pending:  { icon: Clock,         color: 'text-exchange-yellow', bg: 'bg-exchange-yellow/10', label: t('admin.evt_kyc_pending') },
    kyc_approved: { icon: CheckCircle2,  color: 'text-exchange-buy',    bg: 'bg-exchange-buy/10',    label: t('admin.evt_kyc_approved') },
    kyc_rejected: { icon: XCircle,       color: 'text-exchange-sell',   bg: 'bg-exchange-sell/10',   label: t('admin.evt_kyc_rejected') },
    withdraw_pending:   { icon: ArrowUpFromLine,  color: 'text-exchange-yellow', bg: 'bg-exchange-yellow/10', label: t('admin.evt_withdraw_pending') },
    withdraw_completed: { icon: CheckCircle2,     color: 'text-exchange-buy',    bg: 'bg-exchange-buy/10',    label: t('admin.evt_withdraw_completed') },
    withdraw_rejected:  { icon: XCircle,          color: 'text-exchange-sell',   bg: 'bg-exchange-sell/10',   label: t('admin.evt_withdraw_rejected') },
    deposit_pending:    { icon: ArrowDownToLine,  color: 'text-exchange-yellow', bg: 'bg-exchange-yellow/10', label: t('admin.evt_deposit_pending') },
    deposit_completed:  { icon: CheckCircle2,     color: 'text-exchange-buy',    bg: 'bg-exchange-buy/10',    label: t('admin.evt_deposit_completed') },
    deposit_rejected:   { icon: XCircle,          color: 'text-exchange-sell',   bg: 'bg-exchange-sell/10',   label: t('admin.evt_deposit_rejected') },
  };
  const meta = icons[event.type] || { icon: Activity, color: 'text-exchange-text-third', bg: 'bg-exchange-hover/50', label: event.type };
  const Icon = meta.icon;

  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-exchange-border/30 last:border-b-0">
      <div className={`w-7 h-7 ${meta.bg} rounded-lg flex items-center justify-center shrink-0`}>
        <Icon size={13} className={meta.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-exchange-text">
          <span className="font-medium">{event.actor}</span>{' '}
          <span className="text-exchange-text-secondary">{meta.label}</span>
          {event.detail && <span className="text-exchange-text-third"> — {event.detail}</span>}
        </div>
      </div>
      <span className="text-[10px] text-exchange-text-third whitespace-nowrap">{timeAgo(event.ts, t)}</span>
    </div>
  );
}

// ============================================================================
// Users tab
// ============================================================================
// ---------------------------------------------------------------------------
// Downline force-purge panel: enter a ROOT nickname, preview the full referral
// tree (all descendants, root excluded), then hard-delete every descendant +
// their associated data. Deleted nicknames/emails are freed for re-signup.
// ---------------------------------------------------------------------------
function DownlinePurgePanel({ t, onUpdate }: any) {
  const [nickname, setNickname] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [purging, setPurging] = useState(false);

  const doPreview = async () => {
    const nk = nickname.trim();
    if (!nk) return;
    setLoading(true);
    setPreview(null);
    try {
      const res = await api.get(`/admin/downline/${encodeURIComponent(nk)}/preview`);
      setPreview(res.data);
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const doPurge = async () => {
    if (!preview) return;
    const nk = preview.root?.nickname;
    const count = preview.count;
    if (count === 0) {
      showToast('info', t('common.error'), 'No downline to purge');
      return;
    }
    const msg =
      `⚠️ ${nk} 산하 ${count}명을 영구 삭제합니다.\n` +
      `- 대상 계정 + 연관 데이터(주문/지갑/추천기록 등) 전부 삭제\n` +
      `- 닉네임/이메일은 재가입 가능하게 해제됨\n` +
      `- ${nk} 본인은 삭제되지 않음\n` +
      `- 되돌릴 수 없습니다.\n\n계속하려면 삭제 인원수(${count})를 입력하세요:`;
    const typed = window.prompt(msg, '');
    if (typed === null) return;
    if (Number(typed) !== count) {
      showToast('error', t('common.error'), `입력값(${typed})이 인원수(${count})와 다릅니다`);
      return;
    }
    setPurging(true);
    try {
      const res = await api.post(`/admin/downline/${encodeURIComponent(nk)}/purge`, { confirm_count: count });
      showToast('success', t('common.save'), `${res.data.deleted_users}명 강제탈퇴 완료 (재가입 가능)`);
      setPreview(null);
      setNickname('');
      onUpdate?.();
    } catch (e: any) {
      const d = e.response?.data;
      showToast('error', t('common.error'), d?.error || 'Purge failed');
      if (d?.live_count != null) setPreview((p: any) => p ? { ...p, count: d.live_count } : p);
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="mb-4 border border-exchange-sell/40 rounded-lg p-3 bg-exchange-sell/5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-exchange-sell">⚠ 산하 강제탈퇴 (Downline force-purge)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') doPreview(); }}
          placeholder="루트 닉네임 (예: sally1992)"
          className="input-field text-xs h-8 min-w-[220px]"
        />
        <button onClick={doPreview} disabled={loading || !nickname.trim()} className="text-xs !py-1.5 !px-3 rounded bg-exchange-hover text-exchange-text disabled:opacity-50">
          {loading ? '조회중…' : '미리보기'}
        </button>
        {preview && preview.count > 0 && (
          <button onClick={doPurge} disabled={purging} className="text-xs !py-1.5 !px-3 rounded bg-exchange-sell text-white font-semibold disabled:opacity-50">
            {purging ? '삭제중…' : `${preview.count}명 강제탈퇴`}
          </button>
        )}
      </div>

      {preview && (
        <div className="mt-3 text-xs">
          <div className="text-exchange-text-second mb-1">
            루트: <span className="text-exchange-text font-semibold">{preview.root?.nickname}</span> (본인 유지) ·
            산하 대상 <span className="text-exchange-sell font-semibold">{preview.count}</span>명
          </div>
          {preview.count > 0 && (
            <div className="max-h-56 overflow-y-auto border border-exchange-border rounded">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-exchange-card">
                  <tr className="text-exchange-text-third text-left">
                    <th className="px-2 py-1">#</th>
                    <th className="px-2 py-1">Lv</th>
                    <th className="px-2 py-1">Nickname</th>
                    <th className="px-2 py-1">Email</th>
                    <th className="px-2 py-1">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.targets.map((u: any, i: number) => (
                    <tr key={u.id} className="border-t border-exchange-border/40">
                      <td className="px-2 py-1 text-exchange-text-third">{i + 1}</td>
                      <td className="px-2 py-1">L{u.level}</td>
                      <td className="px-2 py-1 text-exchange-text">{u.nickname}</td>
                      <td className="px-2 py-1 text-exchange-text-second">{u.email}</td>
                      <td className="px-2 py-1">{u.is_active ? '1' : '0'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UsersTab({ t, onUpdate }: any) {
  const [q, setQ] = useState('');
  const [kyc, setKyc] = useState('');
  const [active, setActive] = useState('');
  const [role, setRole] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<any>(null);
  const limit = 20;

  const load = async () => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(page * limit),
    });
    if (q) params.set('q', q);
    if (kyc) params.set('kyc', kyc);
    if (active) params.set('active', active);
    if (role) params.set('role', role);
    try {
      const res = await api.get(`/admin/users?${params.toString()}`);
      setUsers(res.data.rows);
      setTotal(res.data.total);
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Load failed');
    }
  };

  useEffect(() => { load(); }, [page, kyc, active, role]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0); load();
  };

  const openDetail = async (id: string) => {
    try {
      const res = await api.get(`/admin/users/${id}`);
      setDetail(res.data);
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Load failed');
    }
  };

  const toggleActive = async (u: any) => {
    if (!confirm(u.is_active ? t('admin.confirmDeactivate') : t('admin.confirmActivate'))) return;
    try {
      await api.post(`/admin/users/${u.id}/toggle-active`);
      showToast('success', t('common.save'), u.is_active ? t('admin.deactivated') : t('admin.activated'));
      load(); onUpdate?.();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Update failed');
    }
  };

  const changeRole = async (u: any) => {
    const newRole = u.role === 'admin' ? 'user' : 'admin';
    if (!confirm(`${t('admin.confirmRoleChange')} (${u.role} → ${newRole})`)) return;
    try {
      await api.post(`/admin/users/${u.id}/role`, { role: newRole });
      showToast('success', t('common.save'), `${t('admin.role')} → ${newRole}`);
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Update failed');
    }
  };

  const reset2fa = async (u: any) => {
    if (!confirm(t('admin.confirm2faReset'))) return;
    try {
      await api.post(`/admin/users/${u.id}/reset-2fa`);
      showToast('success', t('common.save'), t('admin.twoFaReset'));
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Reset failed');
    }
  };

  const deleteUser = async (u: any) => {
    const answer = prompt(
      `⚠️ 회원 영구 삭제\n\n` +
      `- ${u.nickname} (${u.email}) 계정과 연관 데이터(주문/지갑/추천기록 등)를 전부 삭제합니다.\n` +
      `- 하위 추천 회원은 삭제되지 않고 추천관계만 끊깁니다.\n` +
      `- 닉네임/이메일이 풀려 재가입 가능해집니다.\n` +
      `- 되돌릴 수 없습니다.\n\n` +
      `계속하려면 닉네임 "${u.nickname}" 을(를) 그대로 입력하세요:`
    );
    if (answer === null) return;
    if (answer.trim() !== u.nickname) {
      showToast('error', t('common.error'), '닉네임이 일치하지 않아 취소되었습니다.');
      return;
    }
    try {
      const res = await api.delete(`/admin/users/${u.id}`);
      showToast('success', t('common.save'), `${res.data?.deleted_user?.nickname ?? u.nickname} 삭제 완료 (재가입 가능)`);
      load(); onUpdate?.();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Delete failed');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      {/* Downline force-purge tool */}
      <DownlinePurgePanel t={t} onUpdate={() => { load(); onUpdate?.(); }} />

      {/* Filters */}
      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-exchange-text-third" />
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t('admin.searchUsers')}
            className="input-field pl-9 text-xs h-8"
          />
        </div>
        <select value={kyc} onChange={e => { setKyc(e.target.value); setPage(0); }} className="input-field text-xs h-8 !py-0 !px-2">
          <option value="">KYC: {t('common.all')}</option>
          <option value="none">none</option>
          <option value="pending">pending</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
        </select>
        <select value={active} onChange={e => { setActive(e.target.value); setPage(0); }} className="input-field text-xs h-8 !py-0 !px-2">
          <option value="">{t('admin.active')}: {t('common.all')}</option>
          <option value="1">Active</option>
          <option value="0">Banned</option>
        </select>
        <select value={role} onChange={e => { setRole(e.target.value); setPage(0); }} className="input-field text-xs h-8 !py-0 !px-2">
          <option value="">{t('admin.role')}: {t('common.all')}</option>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit" className="btn-primary text-xs !py-1.5 !px-3">{t('common.search')}</button>
      </form>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-exchange-text-third border-b border-exchange-border">
              <th className="text-left px-3 py-2.5">{t('admin.email')}</th>
              <th className="text-left px-3 py-2.5">{t('admin.nickname')}</th>
              <th className="text-left px-3 py-2.5">{t('admin.role')}</th>
              <th className="text-left px-3 py-2.5">KYC</th>
              <th className="text-center px-3 py-2.5">2FA</th>
              <th className="text-center px-3 py-2.5">{t('admin.active')}</th>
              <th className="text-right px-3 py-2.5">{t('fee.holding')}</th>
              <th className="text-left px-3 py-2.5">{t('admin.joined')}</th>
              <th className="text-right px-3 py-2.5">{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-exchange-text-third text-xs">{t('admin.noData')}</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30">
                <td className="px-3 py-2 text-xs">{u.email}</td>
                <td className="px-3 py-2 text-xs">
                  <button onClick={() => openDetail(u.id)} className="inline-flex items-center gap-1 hover:text-exchange-yellow hover:underline">
                    <span>{u.nickname}</span>
                  </button>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${u.role === 'admin' ? 'bg-exchange-yellow/20 text-exchange-yellow' : 'bg-exchange-input text-exchange-text-secondary'}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    u.kyc_status === 'approved' ? 'bg-exchange-buy/15 text-exchange-buy' :
                    u.kyc_status === 'pending'  ? 'bg-exchange-yellow/15 text-exchange-yellow' :
                    u.kyc_status === 'rejected' ? 'bg-exchange-sell/15 text-exchange-sell' :
                    'bg-exchange-input text-exchange-text-third'
                  }`}>{u.kyc_status}</span>
                </td>
                <td className="px-3 py-2 text-center text-[11px]">
                  {u.two_factor_enabled ? '✅' : '—'}
                </td>
                <td className="px-3 py-2 text-center text-[11px]">
                  {u.is_active ? <span className="text-exchange-buy">●</span> : <span className="text-exchange-sell">●</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <FeeTierCell holding={Number(u.qx_balance || 0)} />
                </td>
                <td className="px-3 py-2 text-[11px] text-exchange-text-third">{timeAgo(u.created_at, t)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-0.5">
                    <button onClick={() => toggleActive(u)} className="p-1 hover:bg-exchange-hover/50 rounded" title={u.is_active ? t('admin.deactivate') : t('admin.activate')}>
                      {u.is_active ? <Ban size={13} className="text-exchange-sell" /> : <UserCheck size={13} className="text-exchange-buy" />}
                    </button>
                    <button onClick={() => changeRole(u)} className="p-1 hover:bg-exchange-hover/50 rounded" title={t('admin.changeRole')}>
                      <Crown size={13} className={u.role === 'admin' ? 'text-exchange-yellow' : 'text-exchange-text-third'} />
                    </button>
                    {u.two_factor_enabled ? (
                      <button onClick={() => reset2fa(u)} className="p-1 hover:bg-exchange-hover/50 rounded" title={t('admin.reset2fa')}>
                        <KeyRound size={13} className="text-blue-400" />
                      </button>
                    ) : null}
                    {u.role !== 'admin' ? (
                      <button onClick={() => deleteUser(u)} className="p-1 hover:bg-exchange-sell/15 rounded" title="회원 삭제 (강제탈퇴)">
                        <Trash2 size={13} className="text-exchange-sell" />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-xs text-exchange-text-third">
        <span>{t('admin.showingUsers', { from: String(page * limit + 1), to: String(Math.min((page + 1) * limit, total)), total: String(total) })}</span>
        <div className="flex items-center gap-1">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="p-1 disabled:opacity-30 hover:text-exchange-text"><ChevronLeft size={14} /></button>
          <span className="tabular-nums px-2">{page + 1} / {totalPages}</span>
          <button disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)} className="p-1 disabled:opacity-30 hover:text-exchange-text"><ChevronRight size={14} /></button>
        </div>
      </div>

      {detail && <UserDetailModal detail={detail} onClose={() => { setDetail(null); load(); }} t={t} />}
    </div>
  );
}

// ============================================================================
// Fee-tier helpers (owner rule 2026-08-28): trading & withdrawal fee are
// decided SOLELY by the member's combined QX + QKEY holding on the exchange.
// The old ROYAL/DIAMOND/GOLD/SILVER / shareholder exemption system is REMOVED.
// ============================================================================
const HOLDING_FEE_ROWS = [
  { name: 'BASIC',    min: 0,         trade: 0.0010, wd: 0.050 },
  { name: 'BRONZE',   min: 10_000,    trade: 0.0009, wd: 0.045 },
  { name: 'SILVER',   min: 50_000,    trade: 0.0008, wd: 0.040 },
  { name: 'GOLD',     min: 100_000,   trade: 0.0007, wd: 0.035 },
  { name: 'PLATINUM', min: 500_000,   trade: 0.0006, wd: 0.030 },
  { name: 'FREE',     min: 1_000_000, trade: 0.0000, wd: 0.000 },
];
function feeRowFor(holding: number) {
  const h = Number.isFinite(holding) ? Math.max(0, holding) : 0;
  let m = HOLDING_FEE_ROWS[0];
  for (const r of HOLDING_FEE_ROWS) if (h >= r.min) m = r;
  return m;
}
const fmtHold = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(n % 1_000 ? 1 : 0)}K`
  : Math.round(n).toLocaleString();
const pctFee = (r: number) => `${(r * 100).toFixed(2)}%`;

// Compact roster cell: shows holding + resolved fee-tier name.
function FeeTierCell({ holding }: { holding: number }) {
  const row = feeRowFor(holding);
  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <span className="font-mono tabular-nums text-[11px] text-exchange-text-secondary">
        {fmtHold(holding)}
      </span>
      <span className={`text-[9px] px-1 py-0.5 rounded ${
        row.name === 'FREE' ? 'bg-exchange-buy/20 text-exchange-buy'
        : row.name === 'BASIC' ? 'bg-exchange-input text-exchange-text-third'
        : 'bg-exchange-yellow/20 text-exchange-yellow'}`}>
        {row.name}
      </span>
    </div>
  );
}

// Detail-modal panel: full fee schedule with the member's current tier marked.
function FeeTierInfoPanel({ holding, t }: any) {
  const cur = feeRowFor(holding);
  return (
    <div className="border-t border-exchange-border/50 pt-3">
      <h4 className="text-xs font-semibold text-exchange-text-secondary mb-2 flex items-center gap-1.5">
        <Coins size={12} className="text-exchange-yellow" /> {t('admin.feeTierTitle')}
      </h4>
      <div className="flex flex-wrap items-center gap-2 mb-2.5 text-[10px]">
        <span className="px-2 py-0.5 rounded bg-exchange-input text-exchange-text-secondary tabular-nums">
          {t('fee.holding')}: {fmtHold(holding)}
        </span>
        <span className={`px-2 py-0.5 rounded ${cur.name === 'FREE' ? 'bg-exchange-buy/20 text-exchange-buy' : 'bg-exchange-yellow/20 text-exchange-yellow'}`}>
          {cur.name} · {t('fee.trade')} {cur.trade === 0 ? t('fee.free') : pctFee(cur.trade)} / {t('fee.withdraw')} {cur.wd === 0 ? t('fee.free') : pctFee(cur.wd)}
        </span>
      </div>
      <div className="rounded-lg border border-exchange-border overflow-hidden text-[10px]">
        <div className="grid grid-cols-3 gap-1 px-2 py-1.5 bg-exchange-hover/30 text-exchange-text-third font-semibold">
          <span>QX+QKEY</span>
          <span className="text-right">{t('fee.trade')}</span>
          <span className="text-right">{t('fee.withdraw')}</span>
        </div>
        {HOLDING_FEE_ROWS.map((r) => (
          <div key={r.name} className={`grid grid-cols-3 gap-1 px-2 py-1 tabular-nums ${
            r.name === cur.name ? 'bg-exchange-yellow/10 text-exchange-yellow font-semibold' : 'text-exchange-text-secondary'}`}>
            <span>{r.min === 0 ? `< ${fmtHold(10_000)}` : `≥ ${fmtHold(r.min)}`}</span>
            <span className="text-right font-mono">{r.trade === 0 ? t('fee.free') : pctFee(r.trade)}</span>
            <span className="text-right font-mono">{r.wd === 0 ? t('fee.free') : pctFee(r.wd)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserDetailModal({ detail, onClose, t }: any) {
  const { wallets, recentOrders, logins } = detail;
  const [user, setUser] = useState<any>(detail.user);
  const [bdCoin, setBdCoin] = useState<string | null>(null);
  const loadAdminBreakdown = async (coin: string): Promise<BalanceBreakdown> => {
    const r = await api.get(`/admin/users/${user.id}/balance/${coin}`);
    return r.data.breakdown as BalanceBreakdown;
  };
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-exchange-card rounded-xl border border-exchange-border w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-exchange-border sticky top-0 bg-exchange-card z-10">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-exchange-yellow" />
            <h3 className="font-semibold">{user.nickname}</h3>
            <span className="text-xs text-exchange-text-third">{user.email}</span>
          </div>
          <button onClick={onClose} className="text-exchange-text-third hover:text-exchange-text"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div><div className="text-exchange-text-third">{t('admin.role')}</div><div className="font-medium">{user.role}</div></div>
            <div><div className="text-exchange-text-third">KYC</div><div className="font-medium">{user.kyc_status}</div></div>
            <div><div className="text-exchange-text-third">2FA</div><div className="font-medium">{user.two_factor_enabled ? 'ON' : 'OFF'}</div></div>
            <div><div className="text-exchange-text-third">{t('admin.active')}</div><div className="font-medium">{user.is_active ? 'Yes' : 'No'}</div></div>
            <div><div className="text-exchange-text-third">{t('admin.joined')}</div><div className="font-mono text-[11px]">{user.created_at}</div></div>
            {user.kyc_submitted_at && <div><div className="text-exchange-text-third">KYC submitted</div><div className="font-mono text-[11px]">{user.kyc_submitted_at}</div></div>}
            {user.kyc_reviewed_at && <div><div className="text-exchange-text-third">KYC reviewed</div><div className="font-mono text-[11px]">{user.kyc_reviewed_at}</div></div>}
          </div>

          {(user.kyc_name || user.kyc_phone) && (
            <div className="border-t border-exchange-border/50 pt-3">
              <h4 className="text-xs font-semibold text-exchange-text-secondary mb-2">KYC</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                {user.kyc_name && <div><div className="text-exchange-text-third">Name</div><div>{user.kyc_name}</div></div>}
                {user.kyc_phone && <div><div className="text-exchange-text-third">Phone</div><div>{user.kyc_phone}</div></div>}
                {user.kyc_id_number && <div><div className="text-exchange-text-third">ID</div><div className="font-mono text-[11px]">{user.kyc_id_number}</div></div>}
                {user.kyc_address && <div className="md:col-span-3"><div className="text-exchange-text-third">Address</div><div>{user.kyc_address}</div></div>}
              </div>
            </div>
          )}

          <FeeTierInfoPanel holding={Number(user.qx_balance || 0)} t={t} />

          <div className="border-t border-exchange-border/50 pt-3">
            <h4 className="text-xs font-semibold text-exchange-text-secondary mb-2 flex items-center gap-1.5"><Wallet size={12} /> {t('admin.wallets')} ({wallets?.length || 0}) <span className="text-[10px] text-exchange-text-third font-normal">· {t('wallet.balanceDetail')}</span></h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              {(wallets || []).slice(0, 12).map((w: any, i: number) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setBdCoin(w.coin_symbol)}
                  title={t('wallet.balanceDetail')}
                  className="flex items-center gap-2 bg-exchange-hover/30 px-2 py-1.5 rounded text-left hover:bg-exchange-hover hover:ring-1 hover:ring-exchange-yellow/40 transition-colors"
                >
                  <CoinIcon symbol={w.coin_symbol} size={18} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[11px] flex items-center gap-1">{w.coin_symbol} <Receipt size={9} className="text-exchange-text-third" /></div>
                    <div className="text-[10px] text-exchange-text-third tabular-nums truncate">{formatPrice(w.available)} / <span className="text-exchange-text-secondary">{formatPrice(w.locked)}L</span></div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-exchange-border/50 pt-3">
            <h4 className="text-xs font-semibold text-exchange-text-secondary mb-2">{t('admin.recentOrders')} ({recentOrders?.length || 0})</h4>
            {recentOrders?.length === 0 ? <p className="text-xs text-exchange-text-third">—</p> : (
              <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                {recentOrders?.slice(0, 10).map((o: any) => (
                  <div key={o.id} className="flex items-center gap-2 py-1 border-b border-exchange-border/30">
                    <span className={`w-10 text-[10px] ${o.side === 'buy' ? 'text-exchange-buy' : 'text-exchange-sell'}`}>{o.side}</span>
                    <span className="w-20 text-[11px]">{o.base_coin}/{o.quote_coin}</span>
                    <span className="tabular-nums text-[11px]">{formatPrice(o.price)}</span>
                    <span className="flex-1 text-exchange-text-third text-[10px]">×{formatPrice(o.amount)}</span>
                    <span className="text-[10px] text-exchange-text-third">{o.status}</span>
                    <span className="text-[10px] text-exchange-text-third">{timeAgo(o.created_at, t)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-exchange-border/50 pt-3">
            <h4 className="text-xs font-semibold text-exchange-text-secondary mb-2">{t('admin.recentLogins')} ({logins?.length || 0})</h4>
            {logins?.length === 0 ? <p className="text-xs text-exchange-text-third">—</p> : (
              <div className="max-h-32 overflow-y-auto text-xs space-y-1">
                {logins?.map((l: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] py-1 border-b border-exchange-border/30">
                    <span className={l.status === 'success' ? 'text-exchange-buy' : 'text-exchange-sell'}>●</span>
                    <span className="font-mono">{l.ip_address || '-'}</span>
                    <span className="flex-1 text-exchange-text-third truncate">{l.device || l.user_agent}</span>
                    <span className="text-exchange-text-third">{timeAgo(l.created_at, t)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <BalanceBreakdownModal
        open={bdCoin !== null}
        onClose={() => setBdCoin(null)}
        coin={bdCoin || 'QX'}
        load={loadAdminBreakdown}
        subtitle={user.email}
      />
    </div>
  );
}

// ============================================================================
// KYC tab
// ============================================================================
function KycTab({ t, onUpdate }: any) {
  const [list, setList] = useState<any[]>([]);
  const load = async () => {
    try {
      const res = await api.get('/admin/kyc/pending');
      setList(res.data);
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Load failed');
    }
  };
  useEffect(() => { load(); }, []);

  const handle = async (id: string, action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? prompt(t('admin.rejectReason') + ' (optional)') : undefined;
    try {
      await api.post(`/admin/kyc/${id}/${action}`, reason ? { reason } : {});
      showToast('success', t('common.save'), action === 'approve' ? t('admin.kycApproved') : t('admin.kycRejected'));
      load(); onUpdate?.();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    }
  };

  return (
    <div className="space-y-2">
      {list.length === 0 ? (
        <div className="card p-8 text-center text-exchange-text-third text-sm">{t('admin.noKyc')}</div>
      ) : list.map(k => (
        <div key={k.id} className="card p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="font-medium">{k.kyc_name || k.nickname}</div>
              <div className="text-xs text-exchange-text-secondary mt-0.5">{k.email} · {k.kyc_phone || '-'}</div>
              {k.kyc_address && <div className="text-xs text-exchange-text-third mt-1">{k.kyc_address}</div>}
              {k.kyc_id_number && <div className="text-[11px] text-exchange-text-third mt-1 font-mono">ID: {k.kyc_id_number}</div>}
              <div className="text-[10px] text-exchange-text-third mt-1">{t('admin.submittedAt')}: {k.kyc_submitted_at || k.created_at}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handle(k.id, 'approve')} className="btn-buy text-xs !py-1.5 !px-3 rounded-lg">{t('admin.approve')}</button>
              <button onClick={() => handle(k.id, 'reject')} className="btn-sell text-xs !py-1.5 !px-3 rounded-lg">{t('admin.reject')}</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Withdrawals tab
// ============================================================================
function WithdrawalsTab({ t, onUpdate }: any) {
  const [status, setStatus] = useState('pending');
  const [list, setList] = useState<any[]>([]);

  const load = async () => {
    try {
      const url = status ? `/admin/withdrawals?status=${status}` : '/admin/withdrawals';
      const res = await api.get(url);
      setList(res.data);
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Load failed');
    }
  };
  useEffect(() => { load(); }, [status]);

  const handle = async (id: string, action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? prompt(t('admin.rejectReason') + ' (optional)') : undefined;
    try {
      await api.post(`/admin/withdrawals/${id}/${action}`, reason ? { reason } : {});
      showToast('success', t('common.save'), action === 'approve' ? t('admin.withdrawApproved') : t('admin.withdrawRejected'));
      load(); onUpdate?.();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    }
  };

  // Sprint 5 Phase A1 — show pending count as a yellow badge so the
  // operator can tell at a glance how many withdrawals are awaiting
  // approval, even when filtered to another status.
  const pendingCount = status === 'pending' ? list.length : null;

  return (
    <div>
      <div className="flex items-center gap-1 mb-3 bg-exchange-card rounded-lg border border-exchange-border p-1 w-fit">
        {['pending', 'completed', 'rejected', ''].map(s => (
          <button key={s || 'all'} onClick={() => setStatus(s)} className={`px-3 py-1 text-xs rounded-md flex items-center gap-1.5 ${status === s ? 'bg-exchange-hover text-exchange-yellow' : 'text-exchange-text-secondary'}`}>
            {s === '' ? t('common.all') : s}
            {s === 'pending' && pendingCount !== null && pendingCount > 0 && (
              <span className="bg-exchange-yellow text-black text-[9px] font-bold rounded px-1.5 py-0.5 tabular-nums">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-exchange-text-third border-b border-exchange-border">
              <th className="text-left px-3 py-2.5">{t('admin.nickname')}</th>
              <th className="text-left px-3 py-2.5">{t('admin.coin')}</th>
              <th className="text-right px-3 py-2.5">{t('admin.amount')}</th>
              <th className="text-right px-3 py-2.5">{t('wallet.fee')}</th>
              <th className="text-left px-3 py-2.5">{t('admin.network')}</th>
              <th className="text-left px-3 py-2.5">{t('admin.address')}</th>
              <th className="text-left px-3 py-2.5">{t('admin.status')}</th>
              <th className="text-left px-3 py-2.5">{t('trade.time')}</th>
              <th className="text-right px-3 py-2.5">{t('market.action')}</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-exchange-text-third text-xs">{t('admin.noData')}</td></tr>
            ) : list.map(w => (
              <tr key={w.id} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30">
                <td className="px-3 py-2 text-xs">{w.nickname}</td>
                <td className="px-3 py-2 text-xs font-medium">{w.coin_symbol}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums">{formatPrice(w.amount)}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-exchange-text-third">{formatPrice(w.fee || 0)}</td>
                <td className="px-3 py-2 text-[11px]">{w.network || '-'}</td>
                <td className="px-3 py-2 text-[11px] text-exchange-text-secondary font-mono" title={w.address}>{(w.address || '').slice(0, 14)}...</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    w.status === 'completed' ? 'bg-exchange-buy/15 text-exchange-buy' :
                    w.status === 'pending'   ? 'bg-exchange-yellow/15 text-exchange-yellow' :
                    'bg-exchange-sell/15 text-exchange-sell'
                  }`}>{w.status}</span>
                </td>
                <td className="px-3 py-2 text-[11px] text-exchange-text-third">{timeAgo(w.created_at, t)}</td>
                <td className="px-3 py-2 text-right">
                  {w.status === 'pending' && (
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => handle(w.id, 'approve')} className="text-[11px] px-2 py-1 rounded bg-exchange-buy/15 text-exchange-buy hover:bg-exchange-buy/25">{t('admin.approve')}</button>
                      <button onClick={() => handle(w.id, 'reject')} className="text-[11px] px-2 py-1 rounded bg-exchange-sell/15 text-exchange-sell hover:bg-exchange-sell/25">{t('admin.reject')}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Deposits tab (admin view + manual credit)
// ============================================================================
function DepositsTab({ t, onUpdate }: any) {
  // Sprint 5 Phase A1 — default to "pending" so the operator immediately
  // sees the manual-deposit work queue when entering this tab. Tab order
  // is also reshuffled to put pending first.
  // Default to the on-chain approval queue: after the 2026-08-29 owner rule,
  // confirmed on-chain USDT deposits wait here for an admin to approve before
  // the user's balance is credited (and they can buy QTA).
  const [status, setStatus] = useState('onchain');
  const [list, setList] = useState<any[]>([]);
  const [showManual, setShowManual] = useState(false);
  // Manual (voucher / 인증코드) deposits view — separate live ledger with totals.
  const [manualTotals, setManualTotals] = useState<any[]>([]);
  const [manualQ, setManualQ] = useState('');
  const isManual = status === 'manual';
  const isOnchain = status === 'onchain';
  // On-chain approval queue state.
  const [onchainStatus, setOnchainStatus] = useState('awaiting_approval');
  const [awaitingCount, setAwaitingCount] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      if (isOnchain) {
        // On-chain deposit approval queue.
        const res = await api.get(`/admin/ext-deposits?status=${onchainStatus}`);
        setList(res.data.rows || []);
        setAwaitingCount(Number(res.data.awaiting_count || 0));
        setManualTotals([]);
      } else if (isManual) {
        // Dedicated MANUAL ledger: rows + per-coin running totals (live).
        const url = `/admin/deposits/manual${manualQ.trim() ? `?q=${encodeURIComponent(manualQ.trim())}` : ''}`;
        const res = await api.get(url);
        setList(res.data.rows || []);
        setManualTotals(res.data.totals || []);
      } else {
        const url = status ? `/admin/deposits?status=${status}` : '/admin/deposits';
        const res = await api.get(url);
        setList(res.data);
        setManualTotals([]);
      }
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Load failed');
    }
  };
  useEffect(() => { load(); }, [status, onchainStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Approve an on-chain deposit → credits the user's balance.
  const approveOnchain = async (d: any) => {
    if (!window.confirm(`${d.email || d.nickname || d.user_id}\n+${d.amount} ${d.coin_symbol} 입금을 승인하시겠습니까?\n승인 시 사용자 잔고에 반영되어 매수가 가능해집니다.`)) return;
    setBusyId(d.id);
    try {
      await api.post(`/admin/ext-deposits/${d.id}/approve`);
      showToast('success', '승인 완료', `+${d.amount} ${d.coin_symbol} 가 사용자 잔고에 반영되었습니다.`);
      load(); onUpdate?.();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Approve failed');
    } finally { setBusyId(null); }
  };

  // Reject an on-chain deposit → no credit.
  const rejectOnchain = async (d: any) => {
    const reason = window.prompt('거부 사유를 입력하세요 (선택)', '') ?? null;
    if (reason === null) return; // cancelled
    setBusyId(d.id);
    try {
      await api.post(`/admin/ext-deposits/${d.id}/reject`, { reason });
      showToast('success', '거부 완료', '해당 입금을 거부했습니다 (잔고 미반영).');
      load(); onUpdate?.();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Reject failed');
    } finally { setBusyId(null); }
  };

  // Delete (reverse) a MANUAL deposit → debits the credited balance back.
  const deleteManual = async (d: any) => {
    if (!window.confirm(
      `${d.email || d.nickname || d.user_id}\n${d.coin_symbol} +${formatPrice(d.amount)} 수동입금을 삭제하시겠습니까?\n\n삭제 시 해당 금액이 회원 지갑에서 차감(회수)됩니다.\n※ 이미 사용(스테이킹/출금/거래)된 잔액이면 삭제할 수 없습니다.`
    )) return;
    setBusyId(d.id);
    try {
      const res = await api.delete(`/admin/deposits/manual/${d.id}`);
      showToast('success', '삭제 완료', res.data?.message || `-${d.amount} ${d.coin_symbol} 회수 완료`);
      load(); onUpdate?.();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || '삭제 실패');
    } finally { setBusyId(null); }
  };

  // Live refresh: while the MANUAL ledger is open, poll every 8s so newly
  // credited vouchers appear in real time without a manual reload.
  useEffect(() => {
    if (!isManual) return;
    const id = setInterval(() => { load(); }, 8000);
    return () => clearInterval(id);
  }, [isManual, manualQ]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingCount = status === 'pending' ? list.length : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1 bg-exchange-card rounded-lg border border-exchange-border p-1 w-fit flex-wrap">
          {['onchain', 'pending', 'completed', 'rejected', '', 'manual'].map(s => (
            <button key={s || 'all'} onClick={() => setStatus(s)} className={`px-3 py-1 text-xs rounded-md flex items-center gap-1.5 ${status === s ? 'bg-exchange-hover text-exchange-yellow' : 'text-exchange-text-secondary'}`}>
              {s === '' ? t('common.all') : s === 'manual' ? t('admin.manualLedger') : s === 'onchain' ? '온체인 승인' : s}
              {s === 'pending' && pendingCount !== null && pendingCount > 0 && (
                <span className="bg-exchange-yellow text-black text-[9px] font-bold rounded px-1.5 py-0.5 tabular-nums">
                  {pendingCount}
                </span>
              )}
              {s === 'onchain' && awaitingCount > 0 && (
                <span className="bg-exchange-sell text-white text-[9px] font-bold rounded px-1.5 py-0.5 tabular-nums">
                  {awaitingCount}
                </span>
              )}
              {s === 'manual' && <span className="w-1.5 h-1.5 rounded-full bg-exchange-buy animate-pulse" title="LIVE" />}
            </button>
          ))}
        </div>
        <button onClick={() => setShowManual(true)} className="btn-primary text-xs !py-1.5 !px-3 flex items-center gap-1.5">
          <DollarSign size={13} /> {t('admin.manualDeposit')}
        </button>
      </div>

      {/* MANUAL ledger: per-coin running totals + search (live, auto-refresh). */}
      {isManual && (
        <div className="mb-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {manualTotals.length === 0 ? (
              <div className="text-xs text-exchange-text-third px-1 py-2">{t('admin.noData')}</div>
            ) : manualTotals.map((tt: any) => (
              <div key={tt.coin} className="bg-exchange-card border border-exchange-border rounded-xl px-4 py-2.5">
                <div className="text-[10px] text-exchange-text-third">{tt.coin} · {tt.count}{t('admin.manualCountSuffix')}</div>
                <div className="text-[15px] font-extrabold text-exchange-buy tabular-nums">+{formatPrice(tt.total)}</div>
              </div>
            ))}
          </div>
          <input
            value={manualQ}
            onChange={(e) => setManualQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            onBlur={() => load()}
            placeholder={t('admin.manualSearchPlaceholder')}
            className="input-field text-xs max-w-xs"
          />
        </div>
      )}

      {/* ── ON-CHAIN approval queue ─────────────────────────────────────── */}
      {isOnchain && (
        <div>
          <div className="mb-3 rounded-lg border border-exchange-border bg-exchange-card px-4 py-3 text-[11px] text-exchange-text-secondary leading-relaxed">
            사용자의 온체인 USDT 입금은 <b className="text-exchange-yellow">자동으로 잔고에 반영되지 않습니다.</b> 메인지갑에 실제 입금된 것을 확인하신 뒤 <b className="text-exchange-buy">승인</b>을 누르셔야 사용자 잔고에 반영되어 매수가 가능합니다. (회사·관리자 계정은 자동 반영 예외)
          </div>
          <div className="flex items-center gap-1 mb-3 bg-exchange-card rounded-lg border border-exchange-border p-1 w-fit flex-wrap">
            {[
              ['awaiting_approval', '승인 대기'],
              ['credited', '승인됨'],
              ['rejected', '거부됨'],
              ['confirming', '컨펌 중'],
              ['all', '전체'],
            ].map(([s, label]) => (
              <button key={s} onClick={() => setOnchainStatus(s)} className={`px-3 py-1 text-xs rounded-md ${onchainStatus === s ? 'bg-exchange-hover text-exchange-yellow' : 'text-exchange-text-secondary'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-exchange-text-third border-b border-exchange-border">
                  <th className="text-left px-3 py-2.5">회원</th>
                  <th className="text-left px-3 py-2.5">{t('admin.coin')}</th>
                  <th className="text-right px-3 py-2.5">{t('admin.amount')}</th>
                  <th className="text-left px-3 py-2.5">{t('admin.network')}</th>
                  <th className="text-left px-3 py-2.5">Tx</th>
                  <th className="text-center px-3 py-2.5">컨펌</th>
                  <th className="text-left px-3 py-2.5">{t('admin.status')}</th>
                  <th className="text-left px-3 py-2.5">{t('trade.time')}</th>
                  <th className="text-right px-3 py-2.5">처리</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-exchange-text-third text-xs">{t('admin.noData')}</td></tr>
                ) : list.map(d => (
                  <tr key={d.id} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30">
                    <td className="px-3 py-2 text-xs">
                      <div>{d.nickname || '-'}</div>
                      <div className="text-[10px] text-exchange-text-third">{d.email}</div>
                    </td>
                    <td className="px-3 py-2 text-xs font-medium">{d.coin_symbol}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-exchange-buy">+{formatPrice(d.amount)}</td>
                    <td className="px-3 py-2 text-[11px] uppercase">{d.network || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-exchange-text-secondary font-mono" title={d.tx_hash}>
                      {(d.tx_hash || '').slice(0, 12)}{d.tx_hash && d.tx_hash.length > 12 ? '…' : ''}
                    </td>
                    <td className="px-3 py-2 text-center text-[11px] tabular-nums">{d.confirmations}/{d.required_confs}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        d.status === 'credited' ? 'bg-exchange-buy/15 text-exchange-buy' :
                        d.status === 'awaiting_approval' ? 'bg-exchange-sell/15 text-exchange-sell' :
                        d.status === 'rejected' ? 'bg-exchange-text-third/15 text-exchange-text-third' :
                        'bg-exchange-yellow/15 text-exchange-yellow'
                      }`}>
                        {d.status === 'awaiting_approval' ? '승인 대기' : d.status === 'credited' ? '승인됨' : d.status === 'rejected' ? '거부됨' : d.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-exchange-text-third">{timeAgo(d.created_at, t)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {d.status === 'awaiting_approval' ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            disabled={busyId === d.id}
                            onClick={() => approveOnchain(d)}
                            className="text-[11px] px-2.5 py-1 rounded-md bg-exchange-buy/15 text-exchange-buy hover:bg-exchange-buy/25 disabled:opacity-50"
                          >{t('admin.approve')}</button>
                          <button
                            disabled={busyId === d.id}
                            onClick={() => rejectOnchain(d)}
                            className="text-[11px] px-2.5 py-1 rounded-md bg-exchange-sell/15 text-exchange-sell hover:bg-exchange-sell/25 disabled:opacity-50"
                          >{t('admin.reject')}</button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-exchange-text-third">
                          {d.rejected_reason ? d.rejected_reason : (d.approved_at ? '처리됨' : '-')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isOnchain && (
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-exchange-text-third border-b border-exchange-border">
              <th className="text-left px-3 py-2.5">{t('admin.nickname')}</th>
              <th className="text-left px-3 py-2.5">{t('admin.coin')}</th>
              <th className="text-right px-3 py-2.5">{t('admin.amount')}</th>
              <th className="text-left px-3 py-2.5">{t('admin.network')}</th>
              <th className="text-left px-3 py-2.5">Tx</th>
              <th className="text-left px-3 py-2.5">{t('admin.status')}</th>
              <th className="text-left px-3 py-2.5">{t('trade.time')}</th>
              {isManual && <th className="text-right px-3 py-2.5">처리</th>}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={isManual ? 8 : 7} className="px-3 py-8 text-center text-exchange-text-third text-xs">{t('admin.noData')}</td></tr>
            ) : list.map(d => (
              <tr key={d.id} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30">
                <td className="px-3 py-2 text-xs">{d.nickname}</td>
                <td className="px-3 py-2 text-xs font-medium">{d.coin_symbol}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-exchange-buy">+{formatPrice(d.amount)}</td>
                <td className="px-3 py-2 text-[11px]">{d.network || '-'}</td>
                <td className="px-3 py-2 text-[11px] text-exchange-text-secondary font-mono" title={d.tx_hash}>
                  {(d.tx_hash || '').slice(0, 14)}{d.tx_hash && d.tx_hash.length > 14 ? '...' : ''}
                  {isManual && d.memo ? <div className="text-[10px] text-exchange-text-third font-sans mt-0.5">📝 {d.memo}</div> : null}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    d.status === 'completed' ? 'bg-exchange-buy/15 text-exchange-buy' :
                    d.status === 'pending'   ? 'bg-exchange-yellow/15 text-exchange-yellow' :
                    'bg-exchange-sell/15 text-exchange-sell'
                  }`}>{d.status}</span>
                </td>
                <td className="px-3 py-2 text-[11px] text-exchange-text-third">{timeAgo(d.created_at, t)}</td>
                {isManual && (
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      disabled={busyId === d.id}
                      onClick={() => deleteManual(d)}
                      title="수동입금 삭제(회수)"
                      className="text-[11px] px-2.5 py-1 rounded-md bg-exchange-sell/15 text-exchange-sell hover:bg-exchange-sell/25 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <Trash2 size={12} /> 삭제
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {showManual && <ManualDepositModal onClose={() => setShowManual(false)} onSuccess={() => { setShowManual(false); load(); onUpdate?.(); }} t={t} />}
    </div>
  );
}

function ManualDepositModal({ onClose, onSuccess, t }: any) {
  const [userId, setUserId] = useState('');
  const [coin, setCoin] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [referrerCode, setReferrerCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [coins, setCoins] = useState<any[]>([]);
  // false = company-issued (NOT externally withdrawable, boss's default);
  // true  = real user-owned funds the user CAN withdraw externally.
  const [withdrawable, setWithdrawable] = useState(false);

  // --- User search / autocomplete state ---
  const [search, setSearch] = useState('');            // text typed into the box
  const [results, setResults] = useState<any[]>([]);   // matched users
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null); // chosen user object

  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  useEffect(() => {
    api.get('/admin/coins').then(r => setCoins(r.data.filter((c: any) => c.is_active))).catch(() => {});
  }, []);

  // Debounced search by nickname / email against GET /admin/users?q=
  useEffect(() => {
    const term = search.trim();
    // A raw UUID pasted directly is used as-is (no lookup needed).
    if (UUID_RE.test(term)) {
      setUserId(term);
      setSelectedUser(null);
      setResults([]);
      setShowDropdown(false);
      return;
    }
    // Typing changed away from the selected user -> clear the locked selection.
    if (selectedUser) { setSelectedUser(null); setUserId(''); }
    if (term.length < 2) { setResults([]); setShowDropdown(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/admin/users?q=${encodeURIComponent(term)}&limit=8`);
        if (cancelled) return;
        setResults(res.data.rows || []);
        setShowDropdown(true);
      } catch {
        if (!cancelled) { setResults([]); setShowDropdown(false); }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickUser = (u: any) => {
    setSelectedUser(u);
    setUserId(u.id);
    setSearch(u.nickname || u.email || u.id);
    setShowDropdown(false);
    setResults([]);
  };

  const clearUser = () => {
    setSelectedUser(null);
    setUserId('');
    setSearch('');
    setResults([]);
    setShowDropdown(false);
  };

  const submit = async () => {
    if (!userId.trim() || !UUID_RE.test(userId.trim()) || !amount || Number(amount) <= 0) {
      showToast('warning', t('common.error'), t('admin.manualDepositInvalid'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/admin/deposits/manual', {
        user_id: userId.trim(),
        coin_symbol: coin,
        amount: Number(amount),
        note: note.trim() || undefined,
        withdrawable: withdrawable === true,
        referrer_code: referrerCode.trim() || undefined,
      });
      const pl = res.data?.placement;
      let extra = '';
      if (pl?.referrer) {
        extra = pl.already_placed
          ? ` · 추천인 ${pl.referrer.nickname || pl.referrer.email} (기존 연결 유지)`
          : ` · 추천인 ${pl.referrer.nickname || pl.referrer.email} 연결됨 (좌/우는 추천인이 선택)`;
      }
      showToast('success', t('admin.manualDepositDone'), `+${res.data.amount} ${coin}${extra}`);
      onSuccess();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-exchange-card rounded-xl border border-exchange-border w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2"><DollarSign size={18} className="text-exchange-yellow" />{t('admin.manualDeposit')}</h3>
          <button onClick={onClose} className="text-exchange-text-third hover:text-exchange-text"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div className="relative">
            <label className="text-xs text-exchange-text-third mb-1 block">{t('admin.manualDepositRecipient')}</label>
            {selectedUser ? (
              // Locked-in selected user chip
              <div className="input-field text-sm flex items-center justify-between gap-2 !py-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{selectedUser.nickname || '—'}</div>
                  <div className="truncate text-[11px] text-exchange-text-third">{selectedUser.email} · <span className="font-mono">{String(selectedUser.id).slice(0, 8)}…</span></div>
                </div>
                <button type="button" onClick={clearUser} className="text-exchange-text-third hover:text-exchange-text shrink-0"><X size={16} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-exchange-text-third pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onFocus={() => { if (results.length) setShowDropdown(true); }}
                  className="input-field text-sm !pl-9"
                  placeholder={t('admin.manualDepositSearchPh')}
                  autoComplete="off"
                />
                {searching && <RefreshCw size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-exchange-text-third animate-spin" />}
              </div>
            )}
            {showDropdown && !selectedUser && (
              <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-exchange-card border border-exchange-border rounded-lg shadow-lg">
                {results.length === 0 ? (
                  <div className="px-3 py-2.5 text-xs text-exchange-text-third">{t('admin.manualDepositNoResults')}</div>
                ) : results.map((u: any) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => pickUser(u)}
                    className="w-full text-left px-3 py-2 hover:bg-exchange-hover flex items-center justify-between gap-2 border-b border-exchange-border/50 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{u.nickname || '—'}</div>
                      <div className="truncate text-[11px] text-exchange-text-third">{u.email}</div>
                    </div>
                    <span className="font-mono text-[10px] text-exchange-text-third shrink-0">{String(u.id).slice(0, 8)}…</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">{t('admin.coin')}</label>
            <select value={coin} onChange={e => setCoin(e.target.value)} className="input-field text-sm">
              {coins.map(c => <option key={c.symbol} value={c.symbol}>{c.symbol} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">{t('admin.amount')}</label>
            <input type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} className="input-field text-sm tabular-nums" placeholder="0.00" />
          </div>
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">Note</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} className="input-field text-sm" placeholder={t('admin.manualDepositNote')} maxLength={120} />
          </div>
          {/* Referral code (윗 직대 연결) — leg는 추천인이 본인 계정에서 선택 */}
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">추천코드 (선택)</label>
            <input
              type="text"
              value={referrerCode}
              onChange={e => setReferrerCode(e.target.value.toUpperCase())}
              className="input-field text-sm font-mono"
              placeholder="추천인 코드 (비우면 연결 안 함)"
              maxLength={32}
              autoComplete="off"
            />
            <div className="text-[11px] text-exchange-text-third mt-1">
              추천코드를 넣으면 해당 회원(윗 직대) 밑으로 연결됩니다. 좌/우 배치는 추천인이 본인 계정에서 직접 선택합니다.
            </div>
          </div>
          {/* Withdrawable toggle: company-issued (default) vs real user-owned */}
          <div className="rounded-lg border border-exchange-border p-3">
            <button
              type="button"
              onClick={() => setWithdrawable(w => !w)}
              className="w-full flex items-center justify-between gap-3"
            >
              <div className="min-w-0 text-left">
                <div className="text-sm font-medium">{t('admin.manualDepositWithdrawable')}</div>
                <div className="text-[11px] text-exchange-text-third mt-0.5">
                  {withdrawable ? t('admin.manualDepositWithdrawableOn') : t('admin.manualDepositWithdrawableOff')}
                </div>
              </div>
              <span
                className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${withdrawable ? 'bg-exchange-buy' : 'bg-exchange-border'}`}
                role="switch"
                aria-checked={withdrawable}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${withdrawable ? 'translate-x-6' : 'translate-x-1'}`} />
              </span>
            </button>
            {withdrawable && (
              <div className="mt-2 flex items-start gap-1.5 text-[11px] text-exchange-yellow">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span>{t('admin.manualDepositWithdrawableWarn')}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg text-sm text-exchange-text-secondary border border-exchange-border hover:bg-exchange-hover">{t('common.cancel')}</button>
          <button onClick={submit} disabled={submitting} className="flex-1 btn-primary text-sm !py-2.5 disabled:opacity-50">{submitting ? '...' : t('common.confirm')}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Trades tab
// ============================================================================
function TradesTab({ t }: any) {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    api.get('/admin/trades?limit=100').then(r => setList(r.data)).catch(() => {});
  }, []);

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-exchange-text-third border-b border-exchange-border">
            <th className="text-left px-3 py-2.5">{t('admin.market')}</th>
            <th className="text-left px-3 py-2.5">{t('admin.buyer')}</th>
            <th className="text-left px-3 py-2.5">{t('admin.seller')}</th>
            <th className="text-right px-3 py-2.5">{t('trade.price')}</th>
            <th className="text-right px-3 py-2.5">{t('trade.amount')}</th>
            <th className="text-right px-3 py-2.5">{t('orderHistory.totalAmount')}</th>
            <th className="text-right px-3 py-2.5">{t('trade.fee')}</th>
            <th className="text-left px-3 py-2.5">{t('trade.time')}</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr><td colSpan={8} className="px-3 py-8 text-center text-exchange-text-third text-xs">{t('admin.noData')}</td></tr>
          ) : list.map(tr => (
            <tr key={tr.id} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30">
              <td className="px-3 py-2 text-xs font-medium">{tr.base_coin}/{tr.quote_coin}</td>
              <td className="px-3 py-2 text-xs text-exchange-buy">{tr.buyer_nickname}</td>
              <td className="px-3 py-2 text-xs text-exchange-sell">{tr.seller_nickname}</td>
              <td className="px-3 py-2 text-right text-xs tabular-nums">{formatPrice(tr.price)}</td>
              <td className="px-3 py-2 text-right text-xs tabular-nums">{formatPrice(tr.amount)}</td>
              <td className="px-3 py-2 text-right text-xs tabular-nums">{formatPrice(tr.total)}</td>
              <td className="px-3 py-2 text-right text-xs tabular-nums text-exchange-text-third">{formatPrice((tr.buyer_fee||0) + (tr.seller_fee||0))}</td>
              <td className="px-3 py-2 text-[11px] text-exchange-text-third">{timeAgo(tr.created_at, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Coins tab
// ============================================================================
// Our own steerable coins — price policy is available for these only.
const STEERABLE_COINS = new Set(['QTA', 'QX', 'QKEY']);

function CoinsTab({ t }: any) {
  const [list, setList] = useState<any[]>([]);
  const [editing, setEditing] = useState<Record<string, any>>({});
  const [policyOpen, setPolicyOpen] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await api.get('/admin/coins');
      setList(res.data);
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Load failed');
    }
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (c: any) => {
    try {
      await api.put(`/admin/coins/${c.symbol}`, { is_active: !c.is_active });
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    }
  };

  const savePrice = async (c: any) => {
    const v = editing[c.symbol];
    if (v == null || v === '' || Number(v) <= 0) return;
    try {
      await api.put(`/admin/coins/${c.symbol}`, { price_usd: Number(v) });
      showToast('success', t('common.save'), `${c.symbol} price updated`);
      setEditing(prev => { const n = { ...prev }; delete n[c.symbol]; return n; });
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    }
  };

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-exchange-text-third border-b border-exchange-border">
            <th className="text-left px-3 py-2.5">{t('admin.symbol')}</th>
            <th className="text-left px-3 py-2.5">{t('admin.coinName')}</th>
            <th className="text-right px-3 py-2.5">{t('admin.priceUsd')}</th>
            <th className="text-right px-3 py-2.5">24h %</th>
            <th className="text-right px-3 py-2.5">Sort</th>
            <th className="text-center px-3 py-2.5">{t('admin.active')}</th>
            <th className="text-right px-3 py-2.5">{t('admin.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map(c => {
            const beingEdited = c.symbol in editing;
            return (
              <tr key={c.symbol} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CoinIcon symbol={c.symbol} size={20} />
                    <span className="text-xs font-medium">{c.symbol}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-exchange-text-secondary">{c.name}</td>
                <td className="px-3 py-2 text-right">
                  {beingEdited ? (
                    <input
                      type="number" step="any" value={editing[c.symbol]}
                      onChange={e => setEditing({ ...editing, [c.symbol]: e.target.value })}
                      className="input-field !py-0.5 text-xs tabular-nums text-right w-28 inline-block"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => setEditing({ ...editing, [c.symbol]: String(c.price_usd) })}
                      className="text-xs tabular-nums hover:text-exchange-yellow"
                    >
                      ${formatPrice(c.price_usd)}
                    </button>
                  )}
                </td>
                <td className={`px-3 py-2 text-right text-xs tabular-nums ${c.change_24h >= 0 ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                  {c.change_24h >= 0 ? '+' : ''}{(c.change_24h || 0).toFixed(2)}%
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-exchange-text-third">{c.sort_order}</td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => toggleActive(c)} className={`w-9 h-5 rounded-full transition-colors ${c.is_active ? 'bg-exchange-yellow' : 'bg-exchange-hover'}`}>
                    <span className={`block w-3.5 h-3.5 bg-white rounded-full transition-transform ${c.is_active ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end items-center gap-1">
                    {beingEdited ? (
                      <>
                        <button onClick={() => savePrice(c)} className="text-[11px] px-2 py-1 rounded bg-exchange-buy/15 text-exchange-buy">{t('common.save')}</button>
                        <button onClick={() => setEditing(prev => { const n = { ...prev }; delete n[c.symbol]; return n; })} className="text-[11px] px-2 py-1 rounded bg-exchange-hover text-exchange-text-third">{t('common.cancel')}</button>
                      </>
                    ) : null}
                    {STEERABLE_COINS.has(c.symbol) && (
                      <button
                        onClick={() => setPolicyOpen(policyOpen === c.symbol ? null : c.symbol)}
                        className={`text-[11px] px-2 py-1 rounded border ${
                          c.price_mode && c.price_mode !== 'market'
                            ? 'bg-exchange-yellow/20 text-exchange-yellow border-exchange-yellow/40'
                            : 'bg-exchange-hover text-exchange-text-secondary border-exchange-border'
                        }`}
                        title="Steer this coin's price"
                      >
                        시세조율{c.price_mode && c.price_mode !== 'market' ? ` · ${c.price_mode}` : ''}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {/* Expandable price-policy editor rows for our own coins */}
          {list.filter(c => STEERABLE_COINS.has(c.symbol) && policyOpen === c.symbol).map(c => (
            <tr key={`${c.symbol}-policy`} className="bg-exchange-bg/40">
              <td colSpan={7} className="px-3 py-3">
                <PricePolicyEditor coin={c} t={t} onSaved={() => { load(); }} onClose={() => setPolicyOpen(null)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Price policy editor — 4 modes to steer our own coins (QTA/QX/QKEY)
// ============================================================================
function PricePolicyEditor({ coin, t, onSaved, onClose }: any) {
  const [mode, setMode] = useState<string>(coin.price_mode && coin.price_mode !== 'market' ? coin.price_mode : 'peg');
  const [target, setTarget] = useState<string>(String(coin.price_target ?? coin.price_usd ?? ''));
  const [durationH, setDurationH] = useState<string>('24');
  const [center, setCenter] = useState<string>(String(coin.price_center ?? coin.price_usd ?? ''));
  const [bandPct, setBandPct] = useState<string>(String(coin.price_band_pct ?? 3));
  const [bias, setBias] = useState<string>(String(coin.price_bias ?? 0));
  const [saving, setSaving] = useState(false);

  const save = async (overrideMode?: string) => {
    const m = overrideMode || mode;
    const payload: any = { mode: m };
    if (m === 'peg' || m === 'jump' || m === 'target') payload.target = Number(target);
    if (m === 'target') payload.duration_h = Number(durationH);
    if (m === 'managed') {
      payload.center = Number(center);
      payload.band_pct = Number(bandPct);
      payload.bias = Number(bias);
    }
    setSaving(true);
    try {
      await api.put(`/admin/coins/${coin.symbol}/price-policy`, payload);
      showToast('success', t('common.save'), `${coin.symbol} 시세 정책: ${m}`);
      onSaved();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const MODES = [
    { id: 'peg', label: '📌 고정 페그', desc: '정확히 목표가에 고정' },
    { id: 'target', label: '📈 목표가 이동', desc: '지정 기간 동안 목표가까지 서서히 이동' },
    { id: 'managed', label: '🎚️ 변동폭+편향', desc: '중심가 ±변동폭 안에서 랜덤워크 + 상승/하락 편향' },
    { id: 'market', label: '🎲 자율(시장)', desc: '조율 해제 — 자유 랜덤워크' },
  ];

  return (
    <div className="rounded-lg border border-exchange-border bg-exchange-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-exchange-yellow">{coin.symbol} 시세 조율</div>
        <button onClick={onClose} className="text-[11px] px-2 py-1 rounded bg-exchange-hover text-exchange-text-third">{t('common.cancel')}</button>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`text-left px-3 py-2 rounded border text-xs transition-colors ${
              mode === m.id
                ? 'bg-exchange-yellow/15 border-exchange-yellow/50 text-exchange-text'
                : 'bg-exchange-hover/40 border-exchange-border text-exchange-text-secondary hover:border-exchange-yellow/30'
            }`}
          >
            <div className="font-medium">{m.label}</div>
            <div className="text-[10px] text-exchange-text-third mt-0.5 leading-tight">{m.desc}</div>
          </button>
        ))}
      </div>

      {/* Mode-specific inputs */}
      {(mode === 'peg') && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <div className="text-exchange-text-third mb-1">고정 가격 ($)</div>
            <input type="number" step="any" value={target} onChange={e => setTarget(e.target.value)} className="input-field !py-1 text-xs w-40" />
          </label>
          <button disabled={saving} onClick={() => save('peg')} className="text-xs px-3 py-1.5 rounded bg-exchange-buy/20 text-exchange-buy font-medium">적용 (고정)</button>
          <button disabled={saving} onClick={() => save('jump')} className="text-xs px-3 py-1.5 rounded bg-exchange-yellow/20 text-exchange-yellow font-medium">⚡ 즉시 점프</button>
        </div>
      )}

      {(mode === 'target') && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <div className="text-exchange-text-third mb-1">목표 가격 ($)</div>
            <input type="number" step="any" value={target} onChange={e => setTarget(e.target.value)} className="input-field !py-1 text-xs w-40" />
          </label>
          <label className="text-xs">
            <div className="text-exchange-text-third mb-1">이동 기간 (시간)</div>
            <input type="number" step="any" value={durationH} onChange={e => setDurationH(e.target.value)} className="input-field !py-1 text-xs w-32" />
          </label>
          <button disabled={saving} onClick={() => save('target')} className="text-xs px-3 py-1.5 rounded bg-exchange-buy/20 text-exchange-buy font-medium">적용 (이동 시작)</button>
          <div className="text-[10px] text-exchange-text-third">현재 ${coin.price_usd} → ${target || '?'} · {durationH}시간</div>
        </div>
      )}

      {(mode === 'managed') && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <div className="text-exchange-text-third mb-1">중심 가격 ($)</div>
            <input type="number" step="any" value={center} onChange={e => setCenter(e.target.value)} className="input-field !py-1 text-xs w-36" />
          </label>
          <label className="text-xs">
            <div className="text-exchange-text-third mb-1">변동폭 (±%)</div>
            <input type="number" step="any" value={bandPct} onChange={e => setBandPct(e.target.value)} className="input-field !py-1 text-xs w-28" />
          </label>
          <label className="text-xs">
            <div className="text-exchange-text-third mb-1">편향 (-1 하락 ~ +1 상승)</div>
            <div className="flex items-center gap-2">
              <input type="range" min="-1" max="1" step="0.1" value={bias} onChange={e => setBias(e.target.value)} className="w-32" />
              <span className="tabular-nums text-xs w-8">{Number(bias).toFixed(1)}</span>
            </div>
          </label>
          <button disabled={saving} onClick={() => save('managed')} className="text-xs px-3 py-1.5 rounded bg-exchange-buy/20 text-exchange-buy font-medium">적용 (관리형)</button>
        </div>
      )}

      {(mode === 'market') && (
        <div className="flex items-center gap-3">
          <div className="text-xs text-exchange-text-secondary">조율을 해제하고 자유 랜덤워크로 되돌립니다.</div>
          <button disabled={saving} onClick={() => save('market')} className="text-xs px-3 py-1.5 rounded bg-exchange-hover text-exchange-text font-medium">조율 해제</button>
        </div>
      )}

      <div className="text-[10px] text-exchange-text-third border-t border-exchange-border pt-2">
        현재 정책: <span className="text-exchange-text-secondary">{coin.price_mode || 'market'}</span>
        {coin.price_target ? ` · target $${coin.price_target}` : ''}
        {coin.price_mode === 'managed' && coin.price_center ? ` · center $${coin.price_center} ±${coin.price_band_pct}% bias ${coin.price_bias}` : ''}
      </div>
    </div>
  );
}

// ============================================================================
// Broadcast tab
// ============================================================================
function BroadcastTab({ t }: any) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState('all');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ sent: number; total: number } | null>(null);

  const send = async () => {
    if (!title.trim()) {
      showToast('warning', t('common.error'), t('admin.broadcastTitleRequired'));
      return;
    }
    if (!confirm(t('admin.broadcastConfirm', { target }))) return;
    setSubmitting(true);
    try {
      const res = await api.post('/admin/broadcast', {
        title: title.trim(),
        message: message.trim() || undefined,
        target,
      });
      setLastResult(res.data);
      showToast('success', t('admin.broadcastSent'), `${res.data.sent} / ${res.data.total}`);
      setTitle('');
      setMessage('');
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Megaphone size={18} className="text-exchange-yellow" />
          <h3 className="font-semibold">{t('admin.broadcastTitle')}</h3>
        </div>
        <p className="text-xs text-exchange-text-third mb-4">{t('admin.broadcastDesc')}</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">{t('admin.broadcastTo')}</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { val: 'all',          label: t('admin.target_all') },
                { val: 'kyc_approved', label: t('admin.target_kyc') },
                { val: 'admins',       label: t('admin.target_admins') },
              ].map(o => (
                <button
                  key={o.val}
                  onClick={() => setTarget(o.val)}
                  className={`px-3 py-2 rounded-lg text-xs border transition-colors ${
                    target === o.val
                      ? 'bg-exchange-yellow/10 border-exchange-yellow/40 text-exchange-yellow'
                      : 'border-exchange-border text-exchange-text-secondary hover:text-exchange-text'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">{t('admin.broadcastTitleField')}</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} className="input-field text-sm" maxLength={120} placeholder="e.g. Scheduled Maintenance" />
          </div>
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">{t('admin.broadcastMessage')}</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} className="input-field text-sm min-h-[90px]" maxLength={500} placeholder="Optional details…" />
            <p className="text-[10px] text-exchange-text-third mt-1">{message.length} / 500</p>
          </div>
          <button onClick={send} disabled={submitting || !title} className="btn-primary w-full !py-2.5 text-sm disabled:opacity-50 flex items-center justify-center gap-1.5">
            <Send size={14} />
            {submitting ? '...' : t('admin.broadcastSend')}
          </button>
          {lastResult && (
            <div className="text-xs text-exchange-text-secondary bg-exchange-hover/30 px-3 py-2 rounded">
              {t('admin.broadcastLast', { sent: String(lastResult.sent), total: String(lastResult.total) })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Notices tab — DB-managed notice board CRUD (Sprint 6 Phase A)
// ----------------------------------------------------------------------------
// Replaces the hard-coded NOTICES_KO/NOTICES_EN arrays in NoticePage.tsx with
// /api/notices reads + /api/admin/notices writes. Soft-delete only — rows
// are flipped to published=0, never physically deleted, for audit purposes.
// ============================================================================
function NoticesTab({ t }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const blank = {
    type: 'notice',
    title_ko: '', title_en: '',
    content_ko: '', content_en: '',
    pinned: 0, published: 1,
  };
  const [draft, setDraft] = useState<any>(blank);
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/notices' + (includeDeleted ? '?include_deleted=true' : ''));
      setRows(res.data?.notices || []);
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [includeDeleted]);

  const startEdit = (row?: any) => {
    if (row) {
      setEditingId(row.id);
      setDraft({
        type: row.type,
        title_ko: row.title_ko, title_en: row.title_en,
        content_ko: row.content_ko, content_en: row.content_en,
        pinned: row.pinned, published: row.published,
      });
    } else {
      setEditingId('new');
      setDraft(blank);
    }
  };

  const cancelEdit = () => { setEditingId(null); setDraft(blank); };

  const save = async () => {
    // Client-side validation mirrors the server limits.
    if (!draft.title_ko.trim() || !draft.title_en.trim()) {
      return showToast('error', t('common.error'), 'Title (ko + en) required');
    }
    if (!draft.content_ko.trim() || !draft.content_en.trim()) {
      return showToast('error', t('common.error'), 'Content (ko + en) required');
    }
    try {
      if (editingId === 'new') {
        await api.post('/admin/notices', draft);
        showToast('success', t('common.success'), 'Notice created');
      } else {
        await api.put(`/admin/notices/${editingId}`, draft);
        showToast('success', t('common.success'), 'Notice updated');
      }
      setEditingId(null);
      setDraft(blank);
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Save failed');
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this notice? (soft delete — can be undone via SQL)')) return;
    try {
      await api.delete(`/admin/notices/${id}`);
      showToast('success', t('common.success'), 'Deleted');
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Delete failed');
    }
  };

  const typeBadgeClass = (typ: string) => {
    switch (typ) {
      case 'event': return 'bg-exchange-yellow/10 text-exchange-yellow';
      case 'listing': return 'bg-exchange-buy/10 text-exchange-buy';
      case 'maintenance': return 'bg-exchange-sell/10 text-exchange-sell';
      default: return 'bg-blue-400/10 text-blue-400';
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold">{t('admin.notices') || 'Notices'}</h2>
          <label className="flex items-center gap-1.5 text-xs text-exchange-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => setIncludeDeleted(e.target.checked)}
              className="rounded"
            />
            {t('admin.showDeleted') || 'Show deleted'}
          </label>
        </div>
        <button
          onClick={() => startEdit()}
          className="px-3 py-1.5 rounded-lg bg-exchange-yellow text-black text-sm font-semibold hover:opacity-90"
        >
          + {t('admin.newNotice') || 'New notice'}
        </button>
      </div>

      {/* Editor */}
      {editingId !== null && (
        <div className="card p-4 space-y-3 border-exchange-yellow/40">
          <div className="text-sm font-semibold">
            {editingId === 'new' ? (t('admin.newNotice') || 'New notice') : `Edit #${editingId}`}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-exchange-text-secondary">
              Type
              <select
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                className="w-full mt-1 px-2 py-1.5 rounded bg-exchange-card border border-exchange-border text-sm"
              >
                <option value="notice">notice</option>
                <option value="event">event</option>
                <option value="maintenance">maintenance</option>
                <option value="listing">listing</option>
              </select>
            </label>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={!!draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked ? 1 : 0 })} className="rounded" />
                Pinned
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={draft.published !== 0} onChange={(e) => setDraft({ ...draft, published: e.target.checked ? 1 : 0 })} className="rounded" />
                Published
              </label>
            </div>
            <label className="text-xs text-exchange-text-secondary sm:col-span-2">
              Title (Korean)
              <input
                type="text" maxLength={200}
                value={draft.title_ko}
                onChange={(e) => setDraft({ ...draft, title_ko: e.target.value })}
                className="w-full mt-1 px-2 py-1.5 rounded bg-exchange-card border border-exchange-border text-sm"
              />
            </label>
            <label className="text-xs text-exchange-text-secondary sm:col-span-2">
              Title (English)
              <input
                type="text" maxLength={200}
                value={draft.title_en}
                onChange={(e) => setDraft({ ...draft, title_en: e.target.value })}
                className="w-full mt-1 px-2 py-1.5 rounded bg-exchange-card border border-exchange-border text-sm"
              />
            </label>
            <label className="text-xs text-exchange-text-secondary sm:col-span-2">
              Content (Korean) — supports newlines
              <textarea
                rows={6} maxLength={20000}
                value={draft.content_ko}
                onChange={(e) => setDraft({ ...draft, content_ko: e.target.value })}
                className="w-full mt-1 px-2 py-1.5 rounded bg-exchange-card border border-exchange-border text-sm font-mono"
              />
            </label>
            <label className="text-xs text-exchange-text-secondary sm:col-span-2">
              Content (English) — supports newlines
              <textarea
                rows={6} maxLength={20000}
                value={draft.content_en}
                onChange={(e) => setDraft({ ...draft, content_en: e.target.value })}
                className="w-full mt-1 px-2 py-1.5 rounded bg-exchange-card border border-exchange-border text-sm font-mono"
              />
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={cancelEdit} className="px-3 py-1.5 rounded-lg bg-exchange-hover text-sm">
              {t('common.cancel') || 'Cancel'}
            </button>
            <button onClick={save} className="px-3 py-1.5 rounded-lg bg-exchange-yellow text-black text-sm font-semibold">
              {t('common.save') || 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="p-8 text-center text-exchange-text-third">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-exchange-text-third">No notices</div>
      ) : (
        <div className="card divide-y divide-exchange-border/40 overflow-hidden">
          {rows.map((r) => (
            <div key={r.id} className={`p-4 flex items-start justify-between gap-3 ${r.published === 0 ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] text-exchange-text-third">#{r.id}</span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${typeBadgeClass(r.type)}`}>
                    {r.type}
                  </span>
                  {r.pinned === 1 && <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-exchange-yellow/10 text-exchange-yellow">📌 pinned</span>}
                  {r.published === 0 && <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-exchange-sell/10 text-exchange-sell">deleted</span>}
                  <span className="text-[10px] text-exchange-text-third">{(r.created_at || '').slice(0, 10)}</span>
                </div>
                <div className="text-sm font-medium truncate">{r.title_ko}</div>
                <div className="text-xs text-exchange-text-third truncate">{r.title_en}</div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => startEdit(r)} className="px-2 py-1 rounded bg-exchange-hover text-xs">Edit</button>
                {r.published === 1 && (
                  <button onClick={() => remove(r.id)} className="px-2 py-1 rounded bg-exchange-sell/10 text-exchange-sell text-xs">Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Fees tab (Sprint 3+ #4 — VIP fee revenue dashboard)
// ============================================================================
function FeesTab({ t }: any) {
  const [stats, setStats] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [available, setAvailable] = useState(true);
  const [filter, setFilter] = useState({ user_id: '', coin: '', role: '' });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        api.get('/admin/fee-stats'),
        api.get('/admin/fee-ledger?limit=200'),
      ]);
      setStats(s.data);
      setLedger(Array.isArray(l.data) ? l.data : []);
      setAvailable(true);
    } catch (e: any) {
      if (e.response?.status === 503) setAvailable(false);
      else showToast('error', t('common.error'), e.response?.data?.error || 'Failed to load fees');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const applyFilter = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filter.user_id) params.set('user_id', filter.user_id);
      if (filter.coin)    params.set('coin', filter.coin);
      if (filter.role)    params.set('role', filter.role);
      const res = await api.get(`/admin/fee-ledger?${params.toString()}`);
      setLedger(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  if (!available) {
    return (
      <div className="card p-8 text-center">
        <Receipt className="mx-auto mb-3 text-exchange-text-third" size={32} />
        <div className="text-sm text-exchange-text-third mb-2">{t('admin.feeLedgerUnavailable')}</div>
        <div className="text-[11px] text-exchange-text-third font-mono">
          npx wrangler d1 execute quantaex-production --remote --file=./migrations/0011_sprint3_fee_tiers.sql
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-[11px] text-exchange-text-third mb-1">{t('admin.feeRevenue24h')}</div>
          <div className="text-xl font-bold tabular-nums">${formatPrice(stats?.last24h?.usd || 0)}</div>
          <div className="text-[10px] text-exchange-text-third mt-0.5">{stats?.last24h?.entries || 0} {t('admin.entries')}</div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] text-exchange-text-third mb-1">{t('admin.feeRevenue7d')}</div>
          <div className="text-xl font-bold tabular-nums">${formatPrice(stats?.last7d?.usd || 0)}</div>
          <div className="text-[10px] text-exchange-text-third mt-0.5">{stats?.last7d?.entries || 0} {t('admin.entries')}</div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] text-exchange-text-third mb-1">{t('admin.topFeeCoin')}</div>
          <div className="text-xl font-bold">{stats?.byCoin?.[0]?.coin || '—'}</div>
          <div className="text-[10px] text-exchange-text-third mt-0.5 tabular-nums">
            ${formatPrice(stats?.byCoin?.[0]?.total_usd || 0)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] text-exchange-text-third mb-1">{t('admin.tierDistribution')}</div>
          <div className="text-xl font-bold tabular-nums">{stats?.byTier?.length || 0}</div>
          <div className="text-[10px] text-exchange-text-third mt-0.5">{t('admin.activeTiers')}</div>
        </div>
      </div>

      {/* Breakdown tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="text-sm font-semibold mb-3">{t('admin.feesByCoin')}</div>
          {(stats?.byCoin || []).length === 0 ? (
            <div className="text-xs text-exchange-text-third text-center py-4">{t('admin.noData')}</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="text-exchange-text-third border-b border-exchange-border">
                <th className="text-left py-1.5">{t('admin.coin')}</th>
                <th className="text-right">{t('admin.amount')}</th>
                <th className="text-right">USD</th>
                <th className="text-right">{t('admin.entries')}</th>
              </tr></thead>
              <tbody>
                {stats.byCoin.map((r: any) => (
                  <tr key={r.coin} className="border-b border-exchange-border/50">
                    <td className="py-1.5 font-medium">{r.coin}</td>
                    <td className="text-right tabular-nums">{formatPrice(r.total_amount)}</td>
                    <td className="text-right tabular-nums text-exchange-yellow">${formatPrice(r.total_usd || 0)}</td>
                    <td className="text-right tabular-nums text-exchange-text-third">{r.entries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card p-4">
          <div className="text-sm font-semibold mb-3">{t('admin.feesByTier')}</div>
          {(stats?.byTier || []).length === 0 ? (
            <div className="text-xs text-exchange-text-third text-center py-4">{t('admin.noData')}</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="text-exchange-text-third border-b border-exchange-border">
                <th className="text-left py-1.5">{t('trade.feeTier')}</th>
                <th className="text-right">{t('admin.entries')}</th>
                <th className="text-right">USD</th>
              </tr></thead>
              <tbody>
                {stats.byTier.map((r: any) => (
                  <tr key={r.tier} className="border-b border-exchange-border/50">
                    <td className="py-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-exchange-yellow/10 text-exchange-yellow font-semibold">VIP{r.tier}</span>
                    </td>
                    <td className="text-right tabular-nums">{r.entries}</td>
                    <td className="text-right tabular-nums text-exchange-yellow">${formatPrice(r.usd || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Ledger table with filters */}
      <div className="card">
        <div className="p-3 border-b border-exchange-border flex flex-wrap gap-2 items-center">
          <span className="text-sm font-semibold mr-2">{t('admin.feeLedger')}</span>
          <input
            placeholder={t('admin.userIdFilter')}
            value={filter.user_id}
            onChange={(e) => setFilter({ ...filter, user_id: e.target.value })}
            className="input-field text-xs py-1 px-2 w-40"
          />
          <input
            placeholder={t('admin.coinFilter')}
            value={filter.coin}
            onChange={(e) => setFilter({ ...filter, coin: e.target.value.toUpperCase() })}
            className="input-field text-xs py-1 px-2 w-24"
          />
          <select
            value={filter.role}
            onChange={(e) => setFilter({ ...filter, role: e.target.value })}
            className="input-field text-xs py-1 px-2"
          >
            <option value="">{t('admin.roleAny')}</option>
            <option value="buyer">{t('admin.buyer')}</option>
            <option value="seller">{t('admin.seller')}</option>
          </select>
          <button onClick={applyFilter} className="btn-primary text-xs px-3 py-1" disabled={loading}>
            {loading ? '...' : t('admin.apply')}
          </button>
          <span className="ml-auto text-[11px] text-exchange-text-third">{ledger.length} {t('admin.rows')}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-exchange-text-third border-b border-exchange-border">
                <th className="text-left px-3 py-2">{t('trade.time')}</th>
                <th className="text-left px-3 py-2">{t('admin.user')}</th>
                <th className="text-left px-3 py-2">{t('admin.market')}</th>
                <th className="text-left px-3 py-2">{t('admin.role')}</th>
                <th className="text-left px-3 py-2">{t('admin.coin')}</th>
                <th className="text-right px-3 py-2">{t('admin.amount')}</th>
                <th className="text-right px-3 py-2">USD</th>
                <th className="text-right px-3 py-2">{t('trade.feeTier')}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-exchange-text-third">{t('admin.noData')}</td></tr>
              ) : ledger.map((r: any) => (
                <tr key={r.id} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30">
                  <td className="px-3 py-1.5 text-[11px] text-exchange-text-third">{timeAgo(r.created_at, t)}</td>
                  <td className="px-3 py-1.5 truncate max-w-[180px]" title={r.user_email}>{r.user_email || r.user_id?.slice(0,8)}</td>
                  <td className="px-3 py-1.5">{r.base_coin}/{r.quote_coin}</td>
                  <td className="px-3 py-1.5">
                    <span className={r.role === 'buyer' ? 'text-exchange-buy' : 'text-exchange-sell'}>{r.role}</span>
                  </td>
                  <td className="px-3 py-1.5 font-medium">{r.coin}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatPrice(r.amount)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-exchange-yellow">${formatPrice(r.usd_equivalent || 0)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <span className="px-1.5 py-0.5 rounded bg-exchange-yellow/10 text-exchange-yellow text-[10px] font-semibold">VIP{r.tier}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Audit-log tab (Sprint 3 — S3-2 admin surface)
// ============================================================================
function AuditTab({ t }: any) {
  const [logs, setLogs] = useState<any[]>([]);
  const [available, setAvailable] = useState(true);
  const [filter, setFilter] = useState({ admin_id: '', action: '', target_type: '', target_id: '' });
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      Object.entries(filter).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res = await api.get(`/admin/audit-logs?${params.toString()}`);
      setLogs(Array.isArray(res.data) ? res.data : []);
      setAvailable(true);
    } catch (e: any) {
      if (e.response?.status === 503) setAvailable(false);
      else showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (!available) {
    return (
      <div className="card p-8 text-center">
        <FileText className="mx-auto mb-3 text-exchange-text-third" size={32} />
        <div className="text-sm text-exchange-text-third mb-2">{t('admin.auditLogUnavailable')}</div>
        <div className="text-[11px] text-exchange-text-third font-mono">
          npx wrangler d1 execute quantaex-production --remote --file=./migrations/0009_sprint3_audit_log.sql
        </div>
      </div>
    );
  }

  const actionColor = (action: string) => {
    if (action.includes('reject') || action.includes('delete') || action.includes('deactivate') || action.includes('disable')) return 'text-exchange-sell';
    if (action.includes('approve') || action.includes('activate') || action.includes('enable') || action.includes('credit')) return 'text-exchange-buy';
    return 'text-exchange-yellow';
  };

  return (
    <div className="card">
      <div className="p-3 border-b border-exchange-border flex flex-wrap gap-2 items-center">
        <span className="text-sm font-semibold mr-2">{t('admin.auditLog')}</span>
        <input
          placeholder={t('admin.adminIdFilter')}
          value={filter.admin_id}
          onChange={(e) => setFilter({ ...filter, admin_id: e.target.value })}
          className="input-field text-xs py-1 px-2 w-40"
        />
        <select
          value={filter.action}
          onChange={(e) => setFilter({ ...filter, action: e.target.value })}
          className="input-field text-xs py-1 px-2"
        >
          <option value="">{t('admin.actionAny')}</option>
          <option value="user.toggle_active">user.toggle_active</option>
          <option value="user.change_role">user.change_role</option>
          <option value="user.reset_2fa">user.reset_2fa</option>
          <option value="kyc.approve">kyc.approve</option>
          <option value="kyc.reject">kyc.reject</option>
          <option value="withdrawal.approve">withdrawal.approve</option>
          <option value="withdrawal.reject">withdrawal.reject</option>
          <option value="deposit.manual">deposit.manual</option>
          <option value="coin.update">coin.update</option>
          <option value="broadcast.send">broadcast.send</option>
        </select>
        <input
          placeholder={t('admin.targetType')}
          value={filter.target_type}
          onChange={(e) => setFilter({ ...filter, target_type: e.target.value })}
          className="input-field text-xs py-1 px-2 w-28"
        />
        <input
          placeholder={t('admin.targetId')}
          value={filter.target_id}
          onChange={(e) => setFilter({ ...filter, target_id: e.target.value })}
          className="input-field text-xs py-1 px-2 w-40"
        />
        <button onClick={load} className="btn-primary text-xs px-3 py-1" disabled={loading}>
          {loading ? '...' : t('admin.apply')}
        </button>
        <span className="ml-auto text-[11px] text-exchange-text-third">{logs.length} {t('admin.rows')}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-exchange-text-third border-b border-exchange-border">
              <th className="text-left px-3 py-2">{t('trade.time')}</th>
              <th className="text-left px-3 py-2">{t('admin.admin')}</th>
              <th className="text-left px-3 py-2">{t('admin.action')}</th>
              <th className="text-left px-3 py-2">{t('admin.target')}</th>
              <th className="text-left px-3 py-2">IP</th>
              <th className="text-left px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-exchange-text-third">{t('admin.noData')}</td></tr>
            ) : logs.map((r: any) => (
              <Fragment key={r.id}>
                <tr className="border-b border-exchange-border/50 hover:bg-exchange-hover/30 cursor-pointer"
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  <td className="px-3 py-1.5 text-[11px] text-exchange-text-third">{timeAgo(r.created_at, t)}</td>
                  <td className="px-3 py-1.5 truncate max-w-[180px]" title={r.admin_email}>
                    {r.admin_email || r.admin_id?.slice(0, 8)}
                  </td>
                  <td className={`px-3 py-1.5 font-medium font-mono ${actionColor(r.action || '')}`}>{r.action}</td>
                  <td className="px-3 py-1.5 text-exchange-text-secondary">
                    {r.target_type && <span className="text-exchange-text-third">{r.target_type}</span>}
                    {r.target_id && <span className="font-mono text-[10px] ml-1">{r.target_id.slice(0, 12)}</span>}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-exchange-text-third">{r.ip_address || '—'}</td>
                  <td className="px-3 py-1.5 text-exchange-text-third text-[10px]">
                    {r.payload && Object.keys(r.payload).length > 0 ? (expanded === r.id ? '▼' : '▶') : ''}
                  </td>
                </tr>
                {expanded === r.id && r.payload && (
                  <tr className="bg-exchange-input/30">
                    <td colSpan={6} className="px-3 py-2">
                      <pre className="text-[10px] font-mono text-exchange-text-secondary overflow-x-auto">
                        {JSON.stringify(r.payload, null, 2)}
                      </pre>
                      {r.user_agent && (
                        <div className="text-[10px] text-exchange-text-third mt-1 break-all">
                          <span className="font-semibold">UA:</span> {r.user_agent}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ============================================================================
// System tab — DB/health/migrations status, last backup, audit summary cards
// ============================================================================
function SystemTab({ t }: any) {
  const [health, setHealth] = useState<any>(null);
  const [auditStats, setAuditStats] = useState<any>(null);
  const [feeStats, setFeeStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // --- Email deliverability test (login OTP / verification path) ----------
  const currentUser = useStore((s: any) => s.user);
  const [mailTo, setMailTo] = useState<string>('');
  const [mailSending, setMailSending] = useState(false);
  const [mailResult, setMailResult] = useState<any>(null);
  useEffect(() => {
    if (currentUser?.email && !mailTo) setMailTo(currentUser.email);
  }, [currentUser]);
  const sendMailTest = async () => {
    if (mailSending) return;
    const to = (mailTo || '').trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      showToast('error', t('common.error'), '올바른 이메일 주소를 입력하세요');
      return;
    }
    setMailSending(true);
    setMailResult(null);
    try {
      const res = await api.post('/admin/mail-test', { to });
      setMailResult(res.data);
      if (res.data?.sent) {
        showToast('success', '메일 발송 성공', `provider: ${res.data.provider} · ${to} 수신함/스팸함 확인`);
      } else {
        showToast('error', '메일 발송 실패', res.data?.error || '알 수 없는 오류');
      }
    } catch (e: any) {
      const data = e?.response?.data;
      setMailResult(data || { ok: false, error: e?.message || 'request failed' });
      showToast('error', '메일 발송 실패', data?.error || e?.message || '요청 실패');
    } finally {
      setMailSending(false);
    }
  };

  // --- Company-only TWAP split-sell (분할 매도) ----------------------------
  const [twapList, setTwapList] = useState<any[]>([]);
  const [twapForm, setTwapForm] = useState<any>({
    market_symbol: 'QTA-USDT',
    order_type: 'limit',
    limit_price: '',
    total_amount: '',
    slice_count: '10',
    interval_min: '30', // minutes between slices (converted to seconds on submit)
    note: '',
  });
  const [twapSubmitting, setTwapSubmitting] = useState(false);

  const loadTwap = async () => {
    try {
      const res = await api.get('/admin/twap');
      setTwapList(res.data?.orders || []);
    } catch { /* ignore */ }
  };

  const createTwap = async () => {
    if (twapSubmitting) return;
    const total = Number(twapForm.total_amount);
    const slices = Math.floor(Number(twapForm.slice_count));
    const intervalSec = Math.floor(Number(twapForm.interval_min) * 60);
    if (!twapForm.market_symbol) { showToast('error', '입력 오류', '마켓을 입력하세요 (예: QTA-USDT)'); return; }
    if (!isFinite(total) || total <= 0) { showToast('error', '입력 오류', '총 매도 수량이 올바르지 않습니다'); return; }
    if (!Number.isInteger(slices) || slices < 1) { showToast('error', '입력 오류', '분할 횟수는 1 이상이어야 합니다'); return; }
    if (!isFinite(intervalSec) || intervalSec < 60) { showToast('error', '입력 오류', '분할 간격은 최소 1분 이상이어야 합니다'); return; }
    if (twapForm.order_type === 'limit') {
      const p = Number(twapForm.limit_price);
      if (!isFinite(p) || p <= 0) { showToast('error', '입력 오류', '지정가 주문은 최저가를 입력해야 합니다'); return; }
    }
    setTwapSubmitting(true);
    try {
      const body: any = {
        market_symbol: twapForm.market_symbol,
        order_type: twapForm.order_type,
        total_amount: total,
        slice_count: slices,
        interval_sec: intervalSec,
        note: twapForm.note || undefined,
      };
      if (twapForm.order_type === 'limit') body.limit_price = Number(twapForm.limit_price);
      const res = await api.post('/admin/twap', body);
      if (res.data?.ok) {
        showToast('success', 'TWAP 생성 완료', `${slices}회 분할 매도가 예약되었습니다`);
        setTwapForm({ ...twapForm, total_amount: '', note: '' });
        loadTwap();
      } else {
        showToast('error', 'TWAP 생성 실패', res.data?.error || '알 수 없는 오류');
      }
    } catch (e: any) {
      showToast('error', 'TWAP 생성 실패', e?.response?.data?.error || e?.message || '요청 실패');
    } finally {
      setTwapSubmitting(false);
    }
  };

  const cancelTwap = async (id: string) => {
    if (!confirm('이 TWAP 분할 매도를 중지하시겠습니까? (진행된 슬라이스는 되돌릴 수 없습니다)')) return;
    try {
      const res = await api.post(`/admin/twap/${id}/cancel`, {});
      if (res.data?.ok) { showToast('success', '중지됨', 'TWAP 분할 매도를 중지했습니다'); loadTwap(); }
      else showToast('error', '중지 실패', res.data?.error || '오류');
    } catch (e: any) {
      showToast('error', '중지 실패', e?.response?.data?.error || e?.message || '요청 실패');
    }
  };

  // --- Admin-granted staking with BONUS principal (인정 원금) ---------------
  const [stkProducts, setStkProducts] = useState<any[]>([]);
  const [stkGrants, setStkGrants] = useState<any[]>([]);
  const [stkUserQuery, setStkUserQuery] = useState('');
  const [stkUserResults, setStkUserResults] = useState<any[]>([]);
  const [stkUser, setStkUser] = useState<any>(null); // {id,email,nickname}
  const [stkForm, setStkForm] = useState<any>({ product_id: '', real_usd: '', bonus_usd: '', referrer_code: '', leg: '' });
  const [stkSubmitting, setStkSubmitting] = useState(false);

  // --- Duplicate-position cleanup tool (중복 포지션 정리) --------------------
  const [dupQuery, setDupQuery] = useState('');            // email/nickname/id/code
  const [dupUser, setDupUser] = useState<any>(null);        // resolved user
  const [dupPositions, setDupPositions] = useState<any[]>([]);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupDeleting, setDupDeleting] = useState<string>(''); // position id being deleted

  const loadDupPositions = async () => {
    const q = dupQuery.trim();
    if (!q) { showToast('warning', '입력 필요', '회원 이메일/닉네임/추천코드를 입력하세요'); return; }
    setDupLoading(true);
    try {
      const res = await api.get('/admin/staking-positions', { params: { q } });
      if (res.data?.ok) {
        setDupUser(res.data.user);
        setDupPositions(res.data.positions || []);
        if (!res.data.positions?.length) showToast('info', '조회 완료', '해당 회원의 스테이킹 포지션이 없습니다');
      } else {
        showToast('error', '조회 실패', res.data?.error || '조회 실패');
        setDupUser(null); setDupPositions([]);
      }
    } catch (e: any) {
      showToast('error', '조회 실패', e?.response?.data?.error || e?.message || '조회 실패');
      setDupUser(null); setDupPositions([]);
    } finally {
      setDupLoading(false);
    }
  };

  const deletePosition = async (posId: string) => {
    if (!window.confirm('이 스테이킹 포지션을 삭제하시겠습니까?\n삭제 후 바이너리 볼륨이 자동 재계산됩니다. (되돌릴 수 없음)')) return;
    setDupDeleting(posId);
    try {
      const res = await api.post('/admin/staking-positions/delete', { position_id: posId });
      if (res.data?.ok) {
        showToast('success', '삭제 완료', `포지션 삭제 + 볼륨 재계산 완료`);
        // reload the list so counts/duplicate flags refresh
        await loadDupPositions();
        loadStaking();
      } else {
        showToast('error', '삭제 실패', res.data?.error || '삭제 실패');
      }
    } catch (e: any) {
      showToast('error', '삭제 실패', e?.response?.data?.error || e?.message || '삭제 실패');
    } finally {
      setDupDeleting('');
    }
  };

  const loadStaking = async () => {
    try {
      const [p, g] = await Promise.all([
        api.get('/earn/products').then((r) => r.data?.products || []).catch(() => []),
        api.get('/admin/staking-grants').then((r) => r.data?.grants || []).catch(() => []),
      ]);
      setStkProducts(p);
      setStkGrants(g);
      if (!stkForm.product_id && p.length) setStkForm((f: any) => ({ ...f, product_id: p[0].id }));
    } catch { /* ignore */ }
  };

  // Debounced user search (nickname / email) for the grant form.
  useEffect(() => {
    const term = stkUserQuery.trim();
    if (!term || stkUser) { setStkUserResults([]); return; }
    const h = setTimeout(async () => {
      try {
        const res = await api.get(`/admin/users?q=${encodeURIComponent(term)}&limit=8`);
        const rows = res.data?.rows || res.data?.users || res.data || [];
        setStkUserResults(Array.isArray(rows) ? rows : []);
      } catch { setStkUserResults([]); }
    }, 300);
    return () => clearTimeout(h);
  }, [stkUserQuery, stkUser]);

  const createStakingGrant = async () => {
    if (stkSubmitting) return;
    if (!stkUser?.id) { showToast('error', '입력 오류', '회원을 검색해서 선택하세요'); return; }
    if (!stkForm.product_id) { showToast('error', '입력 오류', '스테이킹 상품을 선택하세요'); return; }
    const real = Number(stkForm.real_usd);
    const bonus = Number(stkForm.bonus_usd || 0);
    if (!isFinite(real) || real <= 0) { showToast('error', '입력 오류', '실원금은 0보다 커야 합니다'); return; }
    if (!isFinite(bonus) || bonus < 0) { showToast('error', '입력 오류', '인정보너스가 올바르지 않습니다'); return; }
    const refCode = String(stkForm.referrer_code || '').trim();
    if (stkForm.leg && !refCode) { showToast('error', '입력 오류', '좌/우 배치를 선택하려면 추천코드를 먼저 입력하세요'); return; }
    setStkSubmitting(true);
    try {
      const res = await api.post('/admin/staking-grant', {
        user_id: stkUser.id, product_id: stkForm.product_id,
        real_usd: real, bonus_usd: bonus,
        referrer_code: refCode || undefined,
        leg: stkForm.leg || undefined,
      });
      if (res.data?.ok) {
        const pl = res.data?.placement;
        let extra = '';
        if (pl?.referrer) {
          const legTxt = pl.leg === 'L' ? '좌(L)' : pl.leg === 'R' ? '우(R)' : (pl.already_placed ? '기존배치' : '미배치');
          extra = ` · 추천인 ${pl.referrer.nickname || pl.referrer.email} / ${legTxt}`;
        }
        showToast('success', '스테이킹 개설 완료', `적용 원금 $${(real + bonus).toLocaleString('en-US')} (실 $${real.toLocaleString('en-US')} + 보너스 $${bonus.toLocaleString('en-US')})${extra}`);
        setStkForm((f: any) => ({ ...f, real_usd: '', bonus_usd: '', referrer_code: '', leg: '' }));
        setStkUser(null); setStkUserQuery('');
        loadStaking();
      } else {
        showToast('error', '개설 실패', res.data?.error || '알 수 없는 오류');
      }
    } catch (e: any) {
      showToast('error', '개설 실패', e?.response?.data?.error || e?.message || '요청 실패');
    } finally {
      setStkSubmitting(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [h, a, f] = await Promise.all([
        api.get('/admin/system-health').then((r) => r.data).catch((e) => ({ error: e?.response?.data?.error || 'fail' })),
        api.get('/admin/audit-stats').then((r) => r.data).catch(() => null),
        api.get('/admin/fee-stats').then((r) => r.data).catch(() => null),
      ]);
      setHealth(h);
      setAuditStats(a);
      setFeeStats(f);
      loadTwap();
      loadStaking();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000); // auto-refresh 30s
    return () => clearInterval(id);
  }, []);

  if (!health) {
    return <div className="p-12 text-center text-exchange-text-third">{loading ? t('common.loading') : '—'}</div>;
  }

  const StatusPill = ({ ok, label, size = 'sm' }: { ok: boolean; label?: string; size?: 'sm' | 'md' }) => (
    <span className={`inline-flex items-center gap-1.5 font-semibold rounded-full ${
      size === 'md' ? 'text-xs px-2.5 py-1' : 'text-[11px] px-2 py-0.5'
    } ${
      ok ? 'bg-exchange-buy/15 text-exchange-buy' : 'bg-exchange-sell/15 text-exchange-sell'
    }`}>
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-exchange-buy animate-pulse' : 'bg-exchange-sell'}`} />
      {label || (ok ? 'OK' : 'FAIL')}
    </span>
  );

  // Total OK/total checks (across tables + orders_columns) for the banner subtitle
  const tableOkCount = Object.values(health.tables || {}).filter((v: any) => v?.ok).length;
  const tableTotal = Object.keys(health.tables || {}).length;
  const colOkCount = Object.values(health.orders_columns || {}).filter(Boolean).length;
  const colTotal = Object.keys(health.orders_columns || {}).length;
  const checksOk = tableOkCount + colOkCount;
  const checksTotal = tableTotal + colTotal;

  return (
    <div className="space-y-6">
      {/* === Email deliverability test === */}
      <div className="rounded-2xl border border-exchange-border bg-exchange-card/60 p-5 lg:p-6">
        <div className="flex items-center gap-2 mb-1">
          <Bell size={18} className="text-exchange-accent" />
          <h3 className="text-lg font-bold">이메일 발송 테스트</h3>
        </div>
        <p className="text-sm text-exchange-text-secondary mb-4">
          로그인 코드·인증 메일과 <b>완전히 동일한 발송 경로</b>로 실제 테스트 메일을 보냅니다.
          결과에 실제 사용된 provider와 실패 시 원인이 그대로 표시됩니다.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            type="email"
            value={mailTo}
            onChange={(e) => setMailTo(e.target.value)}
            placeholder="받는사람@example.com"
            className="flex-1 px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent"
          />
          <button
            onClick={sendMailTest}
            disabled={mailSending}
            style={{ backgroundColor: '#F0B90B', color: '#000000' }}
            className="px-4 py-2 rounded-lg font-semibold text-sm hover:brightness-110 disabled:opacity-60 whitespace-nowrap"
          >
            {mailSending ? '보내는 중…' : '테스트 메일 보내기'}
          </button>
        </div>

        {mailResult && (
          <div className={`mt-4 rounded-xl border p-4 text-sm ${
            mailResult.sent
              ? 'border-exchange-buy/40 bg-exchange-buy/10'
              : 'border-exchange-sell/40 bg-exchange-sell/10'
          }`}>
            <div className="font-semibold mb-2">
              {mailResult.sent ? '✅ 발송 성공' : '❌ 발송 실패'}
              {mailResult.provider ? ` · provider: ${mailResult.provider}` : ''}
            </div>
            <div className="space-y-1 text-exchange-text-secondary">
              {mailResult.to && <div>받는사람: <span className="text-exchange-text">{mailResult.to}</span></div>}
              {mailResult.config && (
                <div>
                  RESEND_API_KEY 설정됨:{' '}
                  <span className={mailResult.config.resend_api_key ? 'text-exchange-buy' : 'text-exchange-sell'}>
                    {mailResult.config.resend_api_key ? '예' : '아니오'}
                  </span>
                  {' · '}발신주소(MAIL_FROM): <span className="text-exchange-text">{mailResult.config.mail_from}</span>
                  {mailResult.config.mail_dev_noop && (
                    <span className="text-exchange-sell"> · ⚠️ MAIL_DEV_NOOP=1 (발송 비활성)</span>
                  )}
                </div>
              )}
              {mailResult.error && (
                <div className="text-exchange-sell break-all">실패 원인: {mailResult.error}</div>
              )}
              {mailResult.hint && <div className="text-exchange-text-third">{mailResult.hint}</div>}
              {mailResult.sent && (
                <div className="text-exchange-text-third">
                  * provider가 수락했다는 의미입니다. 받은편지함과 <b>스팸함</b>을 꼭 확인하세요.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* === Company TWAP split-sell (분할 매도) === */}
      <div className="rounded-2xl border border-exchange-border bg-exchange-card/60 p-5 lg:p-6">
        <div className="flex items-center gap-2 mb-1">
          <TrendingDown size={18} className="text-exchange-accent" />
          <h3 className="text-lg font-bold">회사 보유분 TWAP 분할 매도</h3>
        </div>
        <p className="text-sm text-exchange-text-secondary mb-4">
          회사(관리자) 보유 물량을 <b>여러 번에 걸쳐 잘게 나눠 자동 매도</b>합니다.
          한 번에 대량 매도해서 가격이 급락하는 것을 방지합니다 (TWAP 방식).
          <br />
          <span className="text-exchange-text-third">
            총 수량을 분할 횟수로 나눠, 설정한 간격마다 자동으로 한 조각씩 매도합니다.
            지정가를 넣으면 그 가격 밑으로는 팔지 않습니다.
          </span>
        </p>

        {/* Create form */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-exchange-text-third">마켓</span>
            <input
              type="text"
              value={twapForm.market_symbol}
              onChange={(e) => setTwapForm({ ...twapForm, market_symbol: e.target.value.toUpperCase() })}
              placeholder="QTA-USDT"
              className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-exchange-text-third">주문 방식</span>
            <select
              value={twapForm.order_type}
              onChange={(e) => setTwapForm({ ...twapForm, order_type: e.target.value })}
              className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent"
            >
              <option value="limit">지정가 (최저가 지정)</option>
              <option value="market">시장가</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-exchange-text-third">
              최저가 (지정가일 때){twapForm.order_type === 'market' ? ' · 시장가는 불필요' : ''}
            </span>
            <input
              type="number"
              value={twapForm.limit_price}
              disabled={twapForm.order_type === 'market'}
              onChange={(e) => setTwapForm({ ...twapForm, limit_price: e.target.value })}
              placeholder="예: 0.85"
              className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent disabled:opacity-40"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-exchange-text-third">총 매도 수량</span>
            <input
              type="number"
              value={twapForm.total_amount}
              onChange={(e) => setTwapForm({ ...twapForm, total_amount: e.target.value })}
              placeholder="예: 100000"
              className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-exchange-text-third">분할 횟수</span>
            <input
              type="number"
              value={twapForm.slice_count}
              onChange={(e) => setTwapForm({ ...twapForm, slice_count: e.target.value })}
              placeholder="예: 10"
              className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-exchange-text-third">분할 간격 (분)</span>
            <input
              type="number"
              value={twapForm.interval_min}
              onChange={(e) => setTwapForm({ ...twapForm, interval_min: e.target.value })}
              placeholder="예: 30"
              className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent"
            />
          </label>
        </div>

        {/* Summary preview */}
        {(() => {
          const total = Number(twapForm.total_amount);
          const slices = Math.floor(Number(twapForm.slice_count));
          const intMin = Number(twapForm.interval_min);
          if (isFinite(total) && total > 0 && slices >= 1 && isFinite(intMin) && intMin > 0) {
            const per = total / slices;
            const totalMin = (slices - 1) * intMin;
            const hrs = Math.floor(totalMin / 60);
            const mins = Math.round(totalMin % 60);
            return (
              <div className="mb-4 text-xs text-exchange-text-secondary bg-exchange-bg/50 border border-exchange-border rounded-lg px-3 py-2">
                예상: 한 번에 <b className="text-exchange-text">{per.toLocaleString('en-US', { maximumFractionDigits: 4 })}</b> 씩,
                {' '}<b className="text-exchange-text">{intMin}</b>분 간격으로 총 <b className="text-exchange-text">{slices}</b>회
                {' '}→ 완료까지 약 <b className="text-exchange-text">{hrs > 0 ? `${hrs}시간 ` : ''}{mins}분</b> 소요
              </div>
            );
          }
          return null;
        })()}

        <button
          onClick={createTwap}
          disabled={twapSubmitting}
          style={{ backgroundColor: twapSubmitting ? '#8a6d0a' : '#F0B90B', color: '#000000' }}
          className="mt-1 w-full px-4 py-3 rounded-xl font-bold text-base hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg"
        >
          <TrendingDown size={18} />
          {twapSubmitting ? '생성 중…' : '분할 매도 시작'}
        </button>

        {/* Active/history list */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">진행 중 / 이력</span>
            <button
              onClick={loadTwap}
              className="px-2.5 py-1 text-xs text-exchange-text-secondary hover:text-exchange-text bg-exchange-card/60 rounded-lg flex items-center gap-1.5"
            >
              <RefreshCw size={13} /> 새로고침
            </button>
          </div>
          {twapList.length === 0 ? (
            <div className="text-sm text-exchange-text-third py-4 text-center">등록된 TWAP 분할 매도가 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {twapList.map((tw: any) => {
                const statusColor =
                  tw.status === 'active' ? 'text-exchange-buy' :
                  tw.status === 'completed' ? 'text-exchange-text-secondary' :
                  tw.status === 'paused' ? 'text-exchange-yellow' : 'text-exchange-sell';
                const statusLabel =
                  tw.status === 'active' ? '진행 중' :
                  tw.status === 'completed' ? '완료' :
                  tw.status === 'paused' ? '일시중지(잔고부족)' :
                  tw.status === 'cancelled' ? '중지됨' : tw.status;
                return (
                  <div key={tw.id} className="rounded-xl border border-exchange-border bg-exchange-bg/40 p-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold">{tw.market_symbol}</span>
                        <span className="text-exchange-text-third">·</span>
                        <span className="text-exchange-text-secondary">
                          {tw.order_type === 'limit' ? `지정가 ≥ ${Number(tw.limit_price).toLocaleString('en-US', { maximumFractionDigits: 6 })}` : '시장가'}
                        </span>
                        <span className={`text-xs font-semibold ${statusColor}`}>· {statusLabel}</span>
                      </div>
                      {(tw.status === 'active' || tw.status === 'paused') && (
                        <button
                          onClick={() => cancelTwap(tw.id)}
                          className="px-2.5 py-1 text-xs rounded-lg bg-exchange-sell/15 text-exchange-sell hover:bg-exchange-sell/25"
                        >
                          중지
                        </button>
                      )}
                    </div>
                    {/* Progress bar */}
                    <div className="mt-2">
                      <div className="h-2 rounded-full bg-exchange-border overflow-hidden">
                        <div
                          className="h-full bg-exchange-accent transition-all"
                          style={{ width: `${Math.min(100, tw.progress_pct || 0)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1.5 text-xs text-exchange-text-secondary">
                        <span>
                          매도 {Number(tw.sold_amount || 0).toLocaleString('en-US', { maximumFractionDigits: 4 })}
                          {' / '}
                          {Number(tw.total_amount || 0).toLocaleString('en-US', { maximumFractionDigits: 4 })}
                          {' '}({(tw.progress_pct || 0).toFixed(1)}%)
                        </span>
                        <span>
                          {tw.slices_done}/{tw.slice_count}회
                          {' · '}{Math.round(Number(tw.interval_sec) / 60)}분 간격
                        </span>
                      </div>
                      {tw.last_error && (
                        <div className="mt-1 text-xs text-exchange-sell break-all">최근 오류: {tw.last_error}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* === Admin-granted staking with BONUS principal (인정 원금) === */}
      <div className="rounded-2xl border border-exchange-border bg-exchange-card/60 p-5 lg:p-6">
        <div className="flex items-center gap-2 mb-1">
          <Coins size={18} className="text-exchange-accent" />
          <h3 className="text-lg font-bold">스테이킹 개설 (인정 보너스 원금)</h3>
        </div>
        <p className="text-sm text-exchange-text-secondary mb-4">
          관리자가 회원 대신 스테이킹을 열어줍니다. <b>실원금 + 인정보너스</b>를 입력하면:
          <br />
          <span className="text-exchange-text-third">
            • 데일리 배당 · 매칭보너스는 <b className="text-exchange-text">실+보너스 합계(예: $2,000)</b> 기준으로 지급됩니다.<br />
            • 만기 원금 반환은 <b className="text-exchange-text">실원금(예: $1,000)만</b> 돌려주고, 보너스는 소멸됩니다.<br />
            • 중도 해지 시 <b className="text-exchange-text">합계($2,000) + 이자 전체의 30% 페널티</b>를 제한 후 지급됩니다.
          </span>
        </p>

        {/* User picker */}
        <div className="mb-3">
          <span className="text-xs text-exchange-text-third">회원 검색 (닉네임 / 이메일)</span>
          {stkUser ? (
            <div className="mt-1 flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-accent/40">
              <span className="text-sm">
                <b>{stkUser.nickname || '(닉네임 없음)'}</b>
                <span className="text-exchange-text-third"> · {stkUser.email}</span>
              </span>
              <button
                onClick={() => { setStkUser(null); setStkUserQuery(''); }}
                className="text-xs text-exchange-sell hover:underline"
              >변경</button>
            </div>
          ) : (
            <div className="relative mt-1">
              <input
                type="text"
                value={stkUserQuery}
                onChange={(e) => setStkUserQuery(e.target.value)}
                placeholder="닉네임 또는 이메일 입력"
                className="w-full px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent"
              />
              {stkUserResults.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-exchange-border bg-exchange-card shadow-lg max-h-56 overflow-auto">
                  {stkUserResults.map((u: any) => (
                    <button
                      key={u.id}
                      onClick={() => { setStkUser(u); setStkUserResults([]); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-exchange-hover/60 border-b border-exchange-border/40 last:border-0"
                    >
                      <b>{u.nickname || '(닉네임 없음)'}</b>
                      <span className="text-exchange-text-third"> · {u.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Form */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-exchange-text-third">스테이킹 상품(티어)</span>
            <select
              value={stkForm.product_id}
              onChange={(e) => setStkForm({ ...stkForm, product_id: e.target.value })}
              className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent"
            >
              {stkProducts.length === 0 && <option value="">(상품 없음)</option>}
              {stkProducts.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.id} · {p.term_days}일 · 일{(Number(p.daily_rate) * 100).toFixed(2)}% (${p.min_usd}~${p.max_usd ?? '∞'})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-exchange-text-third">실원금 (USDT · 만기에 반환)</span>
            <input
              type="number"
              value={stkForm.real_usd}
              onChange={(e) => setStkForm({ ...stkForm, real_usd: e.target.value })}
              placeholder="예: 1000"
              className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-exchange-text-third">인정보너스 (USDT · 반환 안 함)</span>
            <input
              type="number"
              value={stkForm.bonus_usd}
              onChange={(e) => setStkForm({ ...stkForm, bonus_usd: e.target.value })}
              placeholder="예: 1000"
              className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent"
            />
          </label>
        </div>

        {/* Referral placement (추천인 + 좌/우 배치) */}
        <div className="mt-3 rounded-lg border border-exchange-border bg-exchange-bg/40 p-3">
          <div className="text-xs text-exchange-text-secondary mb-2">
            <b className="text-exchange-text">추천인 배치 (선택)</b> — 추천코드를 넣으면 그 회원(윗 직대) 밑으로 연결되고,
            좌/우를 선택하면 바이너리 배치까지 됩니다. (윗 직대 화면에 “누가 나를 추천으로 얼마 스테이킹”이 보입니다.)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-exchange-text-third">추천코드 (추천인)</span>
              <input
                type="text"
                value={stkForm.referrer_code}
                onChange={(e) => setStkForm({ ...stkForm, referrer_code: e.target.value.toUpperCase() })}
                placeholder="예: 4ZS6QW49 (비우면 배치 안 함)"
                className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm font-mono focus:outline-none focus:border-exchange-accent"
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-exchange-text-third">좌/우 배치 (추천인 기준)</span>
              <div className="flex gap-2">
                {[
                  { v: '', label: '미선택' },
                  { v: 'L', label: '좌 (L)' },
                  { v: 'R', label: '우 (R)' },
                ].map((opt) => (
                  <button
                    key={opt.v || 'none'}
                    type="button"
                    onClick={() => setStkForm({ ...stkForm, leg: opt.v })}
                    style={stkForm.leg === opt.v ? { backgroundColor: '#F0B90B', color: '#000' } : {}}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border ${
                      stkForm.leg === opt.v
                        ? 'border-transparent'
                        : 'border-exchange-border bg-exchange-bg text-exchange-text-secondary hover:text-exchange-text'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {stkForm.leg && !String(stkForm.referrer_code || '').trim() && (
            <div className="mt-2 text-xs text-exchange-sell">⚠️ 좌/우 배치를 하려면 추천코드를 먼저 입력하세요.</div>
          )}
        </div>

        {/* Summary */}
        {(() => {
          const real = Number(stkForm.real_usd);
          const bonus = Number(stkForm.bonus_usd || 0);
          if (isFinite(real) && real > 0) {
            const total = real + (isFinite(bonus) ? bonus : 0);
            return (
              <div className="mt-3 text-xs text-exchange-text-secondary bg-exchange-bg/50 border border-exchange-border rounded-lg px-3 py-2">
                적용 원금(배당·매칭 기준): <b className="text-exchange-text">${total.toLocaleString('en-US')}</b>
                {' · '}만기 반환: <b className="text-exchange-buy">${real.toLocaleString('en-US')}</b>
                {' · '}보너스(소멸): <b className="text-exchange-yellow">${(isFinite(bonus) ? bonus : 0).toLocaleString('en-US')}</b>
              </div>
            );
          }
          return null;
        })()}

        <button
          onClick={createStakingGrant}
          disabled={stkSubmitting}
          style={{ backgroundColor: stkSubmitting ? '#0a8f5b' : '#0ECB81', color: '#ffffff' }}
          className="mt-4 w-full px-4 py-3 rounded-xl font-bold text-base hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg border border-white/10"
        >
          <Coins size={18} />
          {stkSubmitting ? '개설 중…' : '스테이킹 개설 완료'}
        </button>

        {/* Granted list */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">개설 이력 (관리자 개설분)</span>
            <button
              onClick={loadStaking}
              className="px-2.5 py-1 text-xs text-exchange-text-secondary hover:text-exchange-text bg-exchange-card/60 rounded-lg flex items-center gap-1.5"
            >
              <RefreshCw size={13} /> 새로고침
            </button>
          </div>
          {stkGrants.length === 0 ? (
            <div className="text-sm text-exchange-text-third py-4 text-center">관리자가 개설한 스테이킹이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {stkGrants.map((g: any) => {
                const real = Number(g.real_principal_usd ?? g.principal_usd ?? 0);
                const bonus = Number(g.bonus_principal_usd ?? 0);
                const total = Number(g.principal_usd ?? 0);
                const statusColor = g.status === 'active' ? 'text-exchange-buy' : 'text-exchange-text-secondary';
                return (
                  <div key={g.id} className="rounded-xl border border-exchange-border bg-exchange-bg/40 p-3 text-sm">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span>
                        <b>{g.nickname || '(닉네임 없음)'}</b>
                        <span className="text-exchange-text-third"> · {g.email}</span>
                      </span>
                      <span className={`text-xs font-semibold ${statusColor}`}>{g.status}</span>
                    </div>
                    <div className="mt-1.5 text-xs text-exchange-text-secondary flex flex-wrap gap-x-4 gap-y-1">
                      <span>적용원금 <b className="text-exchange-text">${total.toLocaleString('en-US')}</b></span>
                      <span>실원금 <b className="text-exchange-buy">${real.toLocaleString('en-US')}</b></span>
                      <span>보너스 <b className="text-exchange-yellow">${bonus.toLocaleString('en-US')}</b></span>
                      <span>기간 {g.term_days}일</span>
                      <span>만기 {g.term_end_at ? String(g.term_end_at).slice(0, 10) : '—'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* === 중복 포지션 정리 (Duplicate cleanup) ============================ */}
        <div className="mt-6 rounded-xl border border-exchange-sell/40 bg-exchange-sell/5 p-4">
          <div className="text-sm font-bold text-exchange-sell mb-1">중복 포지션 정리</div>
          <div className="text-xs text-exchange-text-third mb-3">
            회원을 조회해 스테이킹 포지션을 모두 보고, 중복 건을 삭제합니다. 삭제하면 바이너리 볼륨이 자동 재계산됩니다.
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={dupQuery}
              onChange={(e) => setDupQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadDupPositions(); }}
              placeholder="회원 이메일 / 닉네임 / 추천코드 / user_id"
              className="flex-1 px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm focus:outline-none focus:border-exchange-accent"
            />
            <button
              type="button"
              onClick={loadDupPositions}
              disabled={dupLoading}
              style={{ backgroundColor: '#F0B90B', color: '#000' }}
              className="px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-60 whitespace-nowrap"
            >
              {dupLoading ? '조회 중…' : '조회'}
            </button>
          </div>

          {dupUser && (
            <div className="mt-3">
              <div className="text-xs text-exchange-text-secondary mb-2">
                <b className="text-exchange-text">{dupUser.nickname || '(닉네임 없음)'}</b>
                <span className="text-exchange-text-third"> · {dupUser.email}</span>
                <span className="text-exchange-text-third"> · 포지션 {dupPositions.length}건</span>
              </div>
              {dupPositions.length === 0 ? (
                <div className="text-sm text-exchange-text-third py-3 text-center">스테이킹 포지션이 없습니다.</div>
              ) : (
                <div className="space-y-2">
                  {dupPositions.map((p: any) => (
                    <div
                      key={p.id}
                      className={`rounded-xl border p-3 text-sm ${
                        p.is_duplicate ? 'border-exchange-sell/50 bg-exchange-sell/10' : 'border-exchange-border bg-exchange-bg/40'
                      }`}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            p.is_admin ? 'bg-exchange-yellow/20 text-exchange-yellow' : 'bg-exchange-buy/20 text-exchange-buy'
                          }`}>
                            {p.is_admin ? '관리자 개설' : '사용자 스테이킹'}
                          </span>
                          {p.is_duplicate && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-exchange-sell/20 text-exchange-sell">중복</span>
                          )}
                          <span className="text-exchange-text-third text-[11px] font-mono">{String(p.id).slice(0, 8)}…</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => deletePosition(p.id)}
                          disabled={dupDeleting === p.id}
                          style={{ backgroundColor: '#F6465D', color: '#fff' }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-60"
                        >
                          {dupDeleting === p.id ? '삭제 중…' : '삭제'}
                        </button>
                      </div>
                      <div className="mt-1.5 text-xs text-exchange-text-secondary flex flex-wrap gap-x-4 gap-y-1">
                        <span>상품 <b className="text-exchange-text">{p.product_id}</b></span>
                        <span>적용원금 <b className="text-exchange-text">${Number(p.principal_usd || 0).toLocaleString('en-US')}</b></span>
                        <span>QTA <b className="text-exchange-text">{Number(p.principal_qta || 0).toLocaleString('en-US')}</b></span>
                        <span>상태 {p.status}</span>
                        <span>개설일 {p.created_at ? String(p.created_at).slice(0, 10) : '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* === Hero status banner (PC-optimised, large) === */}
      <div className={`rounded-2xl border-2 p-6 lg:p-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 ${
        health.status === 'ok'
          ? 'bg-gradient-to-br from-exchange-buy/10 to-exchange-buy/5 border-exchange-buy/40'
          : 'bg-gradient-to-br from-exchange-sell/10 to-exchange-sell/5 border-exchange-sell/40'
      }`}>
        <div className="flex items-center gap-5">
          <div className={`w-16 h-16 lg:w-20 lg:h-20 rounded-2xl flex items-center justify-center ${
            health.status === 'ok' ? 'bg-exchange-buy/20' : 'bg-exchange-sell/20'
          }`}>
            <Server size={36} className={health.status === 'ok' ? 'text-exchange-buy' : 'text-exchange-sell'} />
          </div>
          <div>
            <div className="text-2xl lg:text-3xl font-bold tracking-tight">
              {health.status === 'ok' ? t('admin.systemHealthy') : t('admin.systemDegraded')}
            </div>
            <div className="text-sm text-exchange-text-secondary mt-1">
              {checksOk}/{checksTotal} checks · {t('admin.checkedAt')} {timeAgo(health.checked_at)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill ok={health.status === 'ok'} size="md" />
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2 text-xs font-medium text-exchange-text-secondary hover:text-exchange-text bg-exchange-card/60 hover:bg-exchange-hover/60 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* === Top KPI row: 3 large cards === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Database */}
        <div className="bg-exchange-card border border-exchange-border rounded-xl p-6 hover:border-exchange-yellow/30 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-exchange-yellow/10 flex items-center justify-center">
                <Database size={18} className="text-exchange-yellow" />
              </div>
              <span className="text-sm font-semibold">{t('admin.database')}</span>
            </div>
            <StatusPill ok={!!health.db?.ok} />
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-exchange-text-third uppercase tracking-wide">{t('admin.dbLatency')}</span>
              <span className="text-2xl font-bold font-mono tabular-nums">
                {typeof health.db?.latency_ms === 'number' ? `${health.db.latency_ms}` : '—'}
                <span className="text-sm text-exchange-text-third ml-1">ms</span>
              </span>
            </div>
          </div>
        </div>

        {/* Last Backup */}
        <div className="bg-exchange-card border border-exchange-border rounded-xl p-6 hover:border-exchange-yellow/30 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-exchange-yellow/10 flex items-center justify-center">
                <HardDrive size={18} className="text-exchange-yellow" />
              </div>
              <span className="text-sm font-semibold">{t('admin.lastBackup')}</span>
            </div>
            <StatusPill ok={!!health.last_backup_at} label={health.last_backup_at ? 'OK' : '—'} />
          </div>
          <div className="text-xl font-bold font-mono tabular-nums">
            {health.last_backup_at ? timeAgo(health.last_backup_at) : '—'}
          </div>
          <div className="text-[11px] text-exchange-text-third mt-2">
            {t('admin.backupHint')}
          </div>
        </div>

        {/* 24h Activity */}
        <div className="bg-exchange-card border border-exchange-border rounded-xl p-6 hover:border-exchange-yellow/30 transition-colors">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-lg bg-exchange-yellow/10 flex items-center justify-center">
              <Activity size={18} className="text-exchange-yellow" />
            </div>
            <span className="text-sm font-semibold">{t('admin.last24h')}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { k: 'orders', label: t('admin.tradesOrders') },
              { k: 'trades', label: t('admin.tradesTab') },
              { k: 'new_users', label: t('admin.newUsers') },
            ].map((m) => (
              <div key={m.k}>
                <div className="text-xl font-bold font-mono tabular-nums">
                  {Number(health.last24h?.[m.k] || 0).toLocaleString()}
                </div>
                <div className="text-[10px] text-exchange-text-third truncate uppercase tracking-wide mt-0.5">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* === Schema / Migrations table — wider for PC === */}
      <div className="bg-exchange-card border border-exchange-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-exchange-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-exchange-yellow/10 flex items-center justify-center">
              <FileText size={16} className="text-exchange-yellow" />
            </div>
            <span className="text-sm font-semibold">{t('admin.migrations')}</span>
          </div>
          <span className="text-xs text-exchange-text-third tabular-nums">
            {checksOk} / {checksTotal} OK
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-exchange-input/30 text-[10px] uppercase tracking-wider text-exchange-text-third">
            <tr>
              <th className="text-left px-6 py-2 font-semibold">Object</th>
              <th className="text-left px-4 py-2 font-semibold">Type</th>
              <th className="text-right px-4 py-2 font-semibold">Rows</th>
              <th className="text-right px-6 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-exchange-border/50">
            {Object.entries(health.tables || {}).map(([name, v]: [string, any]) => (
              <tr key={name} className="hover:bg-exchange-hover/20 transition-colors">
                <td className="px-6 py-2.5"><code className="text-exchange-text">{name}</code></td>
                <td className="px-4 py-2.5 text-exchange-text-third">table</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-exchange-text-secondary">
                  {v.ok ? Number(v.rows).toLocaleString() : '—'}
                </td>
                <td className="px-6 py-2.5 text-right">
                  <StatusPill ok={!!v.ok} label={v.ok ? 'OK' : 'MISSING'} />
                </td>
              </tr>
            ))}
            {Object.entries(health.orders_columns || {}).map(([col, ok]: [string, any]) => (
              <tr key={col} className="hover:bg-exchange-hover/20 transition-colors">
                <td className="px-6 py-2.5"><code className="text-exchange-text">orders.{col}</code></td>
                <td className="px-4 py-2.5 text-exchange-text-third">column</td>
                <td className="px-4 py-2.5 text-right text-exchange-text-third">—</td>
                <td className="px-6 py-2.5 text-right">
                  <StatusPill ok={!!ok} label={ok ? 'OK' : 'MIGRATE'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* === Audit + Fee summary cards (2-col) === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-exchange-card border border-exchange-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-exchange-yellow/10 flex items-center justify-center">
                <FileText size={18} className="text-exchange-yellow" />
              </div>
              <span className="text-sm font-semibold">{t('admin.auditSummary')}</span>
            </div>
          </div>
          {auditStats?.error ? (
            <div className="text-xs text-exchange-sell">{auditStats.error}</div>
          ) : auditStats ? (
            <>
              <div className="grid grid-cols-3 gap-3 mb-5 pb-5 border-b border-exchange-border/50">
                <div>
                  <div className="text-2xl font-bold font-mono tabular-nums">{Number(auditStats.last24h || 0).toLocaleString()}</div>
                  <div className="text-[10px] text-exchange-text-third uppercase tracking-wide mt-0.5">{t('admin.last24h')}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold font-mono tabular-nums">{Number(auditStats.last7d || 0).toLocaleString()}</div>
                  <div className="text-[10px] text-exchange-text-third uppercase tracking-wide mt-0.5">{t('admin.last7d')}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold font-mono tabular-nums">{Number(auditStats.total || 0).toLocaleString()}</div>
                  <div className="text-[10px] text-exchange-text-third uppercase tracking-wide mt-0.5">{t('admin.total')}</div>
                </div>
              </div>
              <div className="space-y-2">
                {(auditStats.byAction || []).slice(0, 5).map((a: any) => {
                  const max = Math.max(...(auditStats.byAction || []).map((x: any) => Number(x.n) || 0), 1);
                  const pct = (Number(a.n) / max) * 100;
                  return (
                    <div key={a.action}>
                      <div className="flex justify-between text-xs mb-1">
                        <code className="text-exchange-text-secondary">{a.action}</code>
                        <span className="font-mono tabular-nums text-exchange-text">{Number(a.n).toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 bg-exchange-input/40 rounded-full overflow-hidden">
                        <div className="h-full bg-exchange-yellow/60" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {(auditStats.byAction || []).length === 0 && (
                  <div className="text-xs text-exchange-text-third text-center py-4">—</div>
                )}
              </div>
            </>
          ) : <div className="text-xs text-exchange-text-third">—</div>}
        </div>

        <div className="bg-exchange-card border border-exchange-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-exchange-yellow/10 flex items-center justify-center">
                <Receipt size={18} className="text-exchange-yellow" />
              </div>
              <span className="text-sm font-semibold">{t('admin.feeRevenue')}</span>
            </div>
            <span className="text-[10px] text-exchange-text-third uppercase tracking-wide">USD</span>
          </div>
          {feeStats?.error ? (
            <div className="text-xs text-exchange-sell">{feeStats.error}</div>
          ) : feeStats ? (
            <>
              <div className="grid grid-cols-2 gap-3 mb-5 pb-5 border-b border-exchange-border/50">
                <div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-exchange-buy">
                    ${Number(feeStats.last24h?.usd || 0).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-exchange-text-third uppercase tracking-wide mt-0.5">{t('admin.last24h')}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-exchange-buy">
                    ${Number(feeStats.last7d?.usd || 0).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-exchange-text-third uppercase tracking-wide mt-0.5">{t('admin.last7d')}</div>
                </div>
              </div>
              <div className="space-y-2">
                {(feeStats.byCoin || []).slice(0, 5).map((c: any) => {
                  const max = Math.max(...(feeStats.byCoin || []).map((x: any) => Number(x.total_usd) || 0), 1);
                  const pct = (Number(c.total_usd || 0) / max) * 100;
                  return (
                    <div key={c.coin}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-exchange-text-secondary">{c.coin}</span>
                        <span className="font-mono tabular-nums text-exchange-text">
                          ${Number(c.total_usd || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-exchange-input/40 rounded-full overflow-hidden">
                        <div className="h-full bg-exchange-buy/60" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {(feeStats.byCoin || []).length === 0 && (
                  <div className="text-xs text-exchange-text-third text-center py-4">—</div>
                )}
              </div>
            </>
          ) : <div className="text-xs text-exchange-text-third">—</div>}
        </div>
      </div>

      {/* === Maintenance: 몸값(바이너리 실적) 재계산 === */}
      <BinaryRecomputeCard t={t} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// BinaryRecomputeCard — ADMIN maintenance action. Wipes ALL binary volume and
// rebuilds 몸값(self_usd)/좌·우 실적 FROM STAKING SUBSCRIPTIONS ONLY (owner rule
// 2026-08-28). Deposits / USDT->QTA buys no longer count. Requires a typed
// confirmation ("재계산") to avoid an accidental reset. Calls
// POST /admin/binary/recompute and shows the returned report.
// ---------------------------------------------------------------------------
function BinaryRecomputeCard({ t }: any) {
  const [confirm, setConfirm] = useState('');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<any>(null);
  const CONFIRM_WORD = '재계산';

  const run = async () => {
    if (confirm.trim() !== CONFIRM_WORD) {
      showToast(t('admin.binaryRecomputeConfirmHint') || `"${CONFIRM_WORD}" 를 정확히 입력하세요.`, 'error');
      return;
    }
    setRunning(true);
    setReport(null);
    try {
      const res = await api.post('/admin/binary/recompute');
      const data = res.data || {};
      setReport(data);
      if (data.ok) {
        showToast(t('admin.binaryRecomputeDone') || '몸값 재계산 완료', 'success');
        setConfirm('');
      } else {
        showToast(data.error || 'fail', 'error');
      }
    } catch (e: any) {
      showToast(e?.response?.data?.error || String(e?.message || e), 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-exchange-card border border-exchange-sell/30 rounded-xl p-6">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-9 h-9 rounded-lg bg-exchange-sell/10 flex items-center justify-center">
          <RefreshCw size={18} className="text-exchange-sell" />
        </div>
        <span className="text-sm font-semibold">{t('admin.binaryRecomputeTitle') || '몸값(바이너리 실적) 재계산'}</span>
      </div>
      <p className="text-xs text-exchange-text-secondary leading-relaxed mb-4">
        {t('admin.binaryRecomputeDesc') ||
          '모든 바이너리 실적(몸값·좌·우·매칭)을 초기화하고, 스테이킹 신청 내역만으로 다시 계산합니다. 입금·QTA 매수분은 더 이상 몸값에 포함되지 않으며, 각 다리는 몸값의 2배까지만 인정됩니다. 이미 지급된 매칭보너스 이력도 재산정됩니다.'}
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={`"${CONFIRM_WORD}" 입력`}
          disabled={running}
          className="flex-1 bg-exchange-input border border-exchange-border rounded-lg px-3 py-2 text-sm outline-none focus:border-exchange-sell/60 disabled:opacity-50"
        />
        <button
          onClick={run}
          disabled={running || confirm.trim() !== CONFIRM_WORD}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-exchange-sell text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
          {running ? (t('common.loading') || '처리 중…') : (t('admin.binaryRecomputeRun') || '재계산 실행')}
        </button>
      </div>

      {report && (
        <div className={`mt-2 rounded-lg border p-3 text-xs font-mono ${
          report.ok ? 'border-exchange-buy/30 bg-exchange-buy/5' : 'border-exchange-sell/30 bg-exchange-sell/5'
        }`}>
          {report.ok ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-exchange-text-third">users_reset</span><span className="text-right tabular-nums">{report.users_reset}</span>
              <span className="text-exchange-text-third">self_seeded (몸값 seed)</span><span className="text-right tabular-nums">{report.self_seeded}</span>
              <span className="text-exchange-text-third">positions_rolled</span><span className="text-right tabular-nums">{report.positions_rolled}</span>
              <span className="text-exchange-text-third">bonuses_cleared</span><span className="text-right tabular-nums">{report.bonuses_cleared}</span>
              <span className="text-exchange-text-third">qta_price</span><span className="text-right tabular-nums">{report.qta_price}</span>
            </div>
          ) : (
            <span className="text-exchange-sell">{report.error || 'fail'}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Sprint 4 Phase C — QTA Chain Admin tabs (Phase B backend already deployed)
// ============================================================================

function ChainWalletsTab({ t }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  // Debounce search input (400ms)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 400);
    return () => clearTimeout(id);
  }, [q]);

  const load = async (query: string) => {
    setLoading(true);
    try {
      const url = query
        ? `/chain/qta/admin/wallets?q=${encodeURIComponent(query)}`
        : '/chain/qta/admin/wallets';
      const r = await api.get(url);
      setData(r.data || null);
    } catch (e: any) {
      if (e.response?.status !== 401) {
        showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(debouncedQ);
    const id = setInterval(() => load(debouncedQ), 30_000);
    return () => clearInterval(id);
  }, [debouncedQ]);

  if (!data) {
    return <div className="p-12 text-center text-exchange-text-third">{loading ? t('common.loading') : '—'}</div>;
  }

  const hw = data.hot_wallet || {};
  const dep = data.deposits || {};
  const wd = data.withdrawals || {};

  return (
    <div className="space-y-6">
      {/* Hero — hot wallet snapshot */}
      <div className="rounded-2xl border-2 border-exchange-yellow/30 bg-gradient-to-br from-exchange-yellow/10 to-exchange-yellow/5 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Wallet size={22} className="text-exchange-yellow" />
          <div>
            <div className="text-lg font-bold">{t('admin.chainWallets')}</div>
            <div className="text-xs text-exchange-text-third uppercase tracking-wider mt-0.5">
              {data.network} · {hw.signature_scheme}
            </div>
          </div>
          <button
            onClick={() => load(debouncedQ)}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-exchange-border hover:bg-exchange-hover/40"
          >
            <RefreshCw size={12} className={`inline mr-1 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card label={t('admin.chainHotWallet')} value={hw.address || '—'} mono />
          <Card label={t('admin.chainHotBalance')} value={`${hw.balance || '0'} QTA`} />
          <Card label={t('admin.chainSigScheme')} value={hw.signature_scheme || '—'} pill />
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label={t('admin.chainAddressesActive')} value={String(data.addresses_active ?? 0)} />
        <Card label={t('admin.chainDepositsCredited')} value={String(dep.credited ?? 0)} />
        <Card label={t('admin.chainDepositsConfirming')} value={String(dep.confirming ?? 0)} />
        <Card label={t('admin.chainWithdrawalsPending')} value={String(wd.pending ?? 0)} />
        <Card label={t('admin.chainWithdrawalsBroadcasting')} value={String(wd.broadcasting ?? 0)} />
        <Card label={t('admin.chainWithdrawalsConfirmed')} value={String(wd.confirmed ?? 0)} />
        <Card label={t('admin.chainWithdrawalsFailed')} value={String(wd.failed ?? 0)} />
        <Card label={t('admin.chainValidators')} value={String(hw.validators_online ?? 0)} />
      </div>

      {/* Search box */}
      <div className="rounded-xl border border-exchange-border bg-exchange-card p-5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-exchange-text-third" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('admin.chainSearchPlaceholder')}
            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg bg-exchange-bg border border-exchange-border focus:border-exchange-yellow/60 outline-none"
          />
        </div>

        {debouncedQ && (
          <div className="mt-4">
            <div className="text-xs text-exchange-text-third uppercase tracking-wider mb-2">
              {t('admin.chainSearchResults')} ({(data.users || []).length})
            </div>
            {(data.users || []).length === 0 ? (
              <div className="text-xs text-exchange-text-third py-6 text-center">
                {t('admin.chainSearchEmpty')}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-exchange-border">
                <table className="w-full text-sm">
                  <thead className="bg-exchange-hover/40 text-[11px] uppercase tracking-wider text-exchange-text-third">
                    <tr>
                      <th className="text-left px-3 py-2">{t('admin.user')}</th>
                      <th className="text-left px-3 py-2">{t('admin.toAddress')}</th>
                      <th className="text-center px-3 py-2">{t('admin.network')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.users || []).map((u: any) => (
                      <tr key={u.id} className="border-t border-exchange-border">
                        <td className="px-3 py-2 truncate max-w-[200px]">{u.email || u.user_id}</td>
                        <td className="px-3 py-2 font-mono text-xs truncate max-w-[260px]">{u.address}</td>
                        <td className="px-3 py-2 text-center text-[11px] text-exchange-text-third">{u.network}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cold wallet note */}
      <div className="rounded-xl border border-exchange-border p-5 bg-exchange-card">
        <div className="text-sm font-semibold mb-2">{t('admin.chainColdNote')}</div>
        <div className="text-xs text-exchange-text-third leading-relaxed">
          {t('admin.chainColdNoteDesc')}
        </div>
      </div>
    </div>
  );
}

function ChainQueueTab({ t }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('pending');

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/chain/qta/admin/withdrawals?status=${encodeURIComponent(status)}`);
      setItems(r.data?.withdrawals || []);
    } catch (e: any) {
      if (e.response?.status !== 401) {
        showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
      }
      setItems([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [status]);

  const approve = async (id: string) => {
    setBusy(id);
    try {
      const r = await api.post(`/chain/qta/admin/withdrawals/${id}/approve`);
      showToast('success', t('admin.chainApproved'), r.data?.tx_hash || '');
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setBusy(null);
    }
  };
  const reject = async (id: string) => {
    const reason = prompt(t('admin.chainRejectReason') || 'Reason?') || '';
    if (!reason) return;
    setBusy(id);
    try {
      await api.post(`/chain/qta/admin/withdrawals/${id}/reject`, { reason });
      showToast('success', t('admin.chainRejected'), '');
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const STATUS_TABS: Array<{ key: string; label: string }> = [
    { key: 'pending', label: t('admin.chainQueuePending') },
    { key: 'broadcasting', label: t('admin.chainQueueBroadcasting') },
    { key: 'confirmed', label: t('admin.chainQueueConfirmed') },
    { key: 'failed', label: t('admin.chainQueueFailed') },
    { key: 'rejected', label: t('admin.chainQueueRejected') },
  ];

  return (
    <div className="space-y-4">
      {/* Status tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-exchange-border bg-exchange-card p-1.5">
        {STATUS_TABS.map((s) => (
          <button
            key={s.key}
            onClick={() => setStatus(s.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              status === s.key
                ? 'bg-exchange-yellow/20 text-exchange-yellow'
                : 'text-exchange-text-secondary hover:bg-exchange-hover/40'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-exchange-text-secondary">
          {t('admin.chainPendingCount', { n: items.length })}
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-lg border border-exchange-border hover:bg-exchange-hover/40"
        >
          <RefreshCw size={12} className={`inline mr-1 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>

      <div className="rounded-xl border border-exchange-border bg-exchange-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-exchange-hover/40 text-[11px] uppercase tracking-wider text-exchange-text-third">
            <tr>
              <th className="text-left px-4 py-2.5">{t('admin.user')}</th>
              <th className="text-left px-4 py-2.5">{t('admin.toAddress')}</th>
              <th className="text-right px-4 py-2.5">{t('admin.amount')}</th>
              <th className="text-left px-4 py-2.5">{t('admin.chainTxHash')}</th>
              <th className="text-center px-4 py-2.5">{t('admin.network')}</th>
              {status === 'pending' && (
                <th className="text-center px-4 py-2.5">{t('admin.actions')}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={status === 'pending' ? 6 : 5}
                  className="text-center py-12 text-exchange-text-third"
                >
                  {loading ? t('common.loading') : t('admin.chainNoQueue')}
                </td>
              </tr>
            )}
            {items.map((w) => (
              <tr key={w.id} className="border-t border-exchange-border">
                <td className="px-4 py-3 truncate max-w-[200px]">{w.email || w.user_id}</td>
                <td className="px-4 py-3 font-mono text-xs truncate max-w-[220px]">{w.to_address}</td>
                <td className="px-4 py-3 text-right font-semibold">{w.amount} QTA</td>
                <td className="px-4 py-3 font-mono text-[10px] truncate max-w-[180px] text-exchange-text-third">
                  {w.tx_hash || '—'}
                </td>
                <td className="px-4 py-3 text-center text-[11px] text-exchange-text-third">{w.network}</td>
                {status === 'pending' && (
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => approve(w.id)}
                      disabled={busy === w.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-exchange-buy/20 text-exchange-buy hover:bg-exchange-buy/30 disabled:opacity-50 mr-2"
                    >
                      <CheckCircle2 size={12} className="inline mr-1" />
                      {t('admin.approve')}
                    </button>
                    <button
                      onClick={() => reject(w.id)}
                      disabled={busy === w.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-exchange-sell/20 text-exchange-sell hover:bg-exchange-sell/30 disabled:opacity-50"
                    >
                      <XCircle size={12} className="inline mr-1" />
                      {t('admin.reject')}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChainHealthTab({ t }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/chain/qta/admin/health');
      setData(r.data || null);
    } catch (e: any) {
      if (e.response?.status !== 401) {
        showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  if (!data) {
    return <div className="p-12 text-center text-exchange-text-third">{loading ? t('common.loading') : '—'}</div>;
  }

  const state = data.state || {};
  const stats = data.stats_24h || {};
  const status: string = data.status || 'unknown';
  const tickSec: number | null = data.tick_age_sec ?? null;

  const STATUS_LABEL: Record<string, string> = {
    ok: t('admin.chainStatusOk'),
    stale: t('admin.chainStatusStale'),
    error: t('admin.chainStatusError'),
    idle: t('admin.chainStatusIdle'),
    unknown: t('admin.chainStatusUnknown'),
  };

  const isHealthy = status === 'ok';

  return (
    <div className="space-y-6">
      {/* Health hero */}
      <div className={`rounded-2xl border-2 p-6 flex items-center gap-5 ${
        isHealthy
          ? 'bg-gradient-to-br from-exchange-buy/10 to-exchange-buy/5 border-exchange-buy/40'
          : 'bg-gradient-to-br from-exchange-sell/10 to-exchange-sell/5 border-exchange-sell/40'
      }`}>
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
          isHealthy ? 'bg-exchange-buy/20 text-exchange-buy' : 'bg-exchange-sell/20 text-exchange-sell'
        }`}>
          <Activity size={26} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="text-xl font-bold">
              {isHealthy ? t('admin.chainOnline') : t('admin.chainStale')}
            </div>
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold ${
              isHealthy
                ? 'bg-exchange-buy/20 text-exchange-buy'
                : 'bg-exchange-sell/20 text-exchange-sell'
            }`}>
              {STATUS_LABEL[status] || status}
            </span>
          </div>
          <div className="text-xs text-exchange-text-third mt-1">
            {data.network} · {t('admin.chainLastTick')} {tickSec === null ? '—' : `${tickSec}s`} {t('admin.ago')}
          </div>
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-lg border border-exchange-border hover:bg-exchange-hover/40"
        >
          <RefreshCw size={12} className={`inline mr-1 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Chain state cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label={t('admin.chainHead')} value={state.head_block?.toLocaleString?.() || '0'} />
        <Card label={t('admin.chainScanned')} value={state.last_scanned_block?.toLocaleString?.() || '0'} />
        <Card label={t('admin.chainValidators')} value={String(state.validators_online ?? 0)} />
        <Card label={t('admin.chainBlockTime')} value={`${state.block_time_ms || 2000} ms`} />
        <Card label={t('admin.chainConfs')} value={String(state.required_confs ?? 12)} />
        <Card label={t('admin.chainSigScheme')} value={state.signature_scheme || '—'} pill />
        <Card label={t('admin.chainNetwork')} value={state.network || data.network || '—'} pill />
        <Card label={t('admin.chainHotBalance')} value={`${state.hot_wallet_balance || '0'} QTA`} />
      </div>

      {/* 24h stats */}
      <div>
        <div className="text-xs text-exchange-text-third uppercase tracking-wider mb-2">24h</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card
            label={t('admin.chain24hCredited')}
            value={`${stats.deposits_credited ?? 0}  ·  ${(stats.deposits_credited_amount ?? 0).toLocaleString?.() || 0} QTA`}
          />
          <Card
            label={t('admin.chain24hBroadcast')}
            value={`${stats.withdrawals_broadcast ?? 0}  ·  ${(stats.withdrawals_broadcast_amount ?? 0).toLocaleString?.() || 0} QTA`}
          />
          <Card
            label={t('admin.chain24hFailed')}
            value={String(stats.withdrawals_failed ?? 0)}
          />
        </div>
      </div>

      {state.last_error && (
        <div className="rounded-xl border border-exchange-sell/40 bg-exchange-sell/10 p-4">
          <div className="text-xs font-semibold text-exchange-sell mb-1">{t('admin.chainLastError')}</div>
          <div className="text-xs font-mono break-all">{state.last_error}</div>
        </div>
      )}
    </div>
  );
}

function RiskTab({ t }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cbReason, setCbReason] = useState('');
  const [ipInput, setIpInput] = useState('');
  const [ipReason, setIpReason] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/risk/state');
      setData(r.data || null);
    } catch (e: any) {
      if (e.response?.status !== 401) {
        showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const toggleCb = async (enabled: boolean) => {
    setBusy('cb');
    try {
      await api.post('/risk/circuit-breaker', { enabled, reason: cbReason });
      showToast(
        'success',
        enabled ? t('admin.riskCircuitBreakerOn') : t('admin.riskCircuitBreakerOff'),
        ''
      );
      setCbReason('');
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const toggle2fa = async (enabled: boolean) => {
    setBusy('2fa');
    try {
      await api.post('/risk/force-2fa', { enabled });
      showToast(
        'success',
        enabled ? t('admin.riskForce2faOn') : t('admin.riskForce2faOff'),
        ''
      );
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const addIp = async () => {
    const ip = ipInput.trim();
    if (!ip) return;
    if (!/^[0-9a-fA-F:.\/]+$/.test(ip) || ip.length > 64) {
      showToast('error', t('common.error'), t('admin.riskInvalidIp'));
      return;
    }
    setBusy('ipAdd');
    try {
      await api.post('/risk/ip-block', { ip, reason: ipReason });
      showToast('success', t('admin.riskIpAdded'), ip);
      setIpInput('');
      setIpReason('');
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const removeIp = async (ip: string) => {
    setBusy(`ipRm:${ip}`);
    try {
      await api.post('/risk/ip-unblock', { ip });
      showToast('success', t('admin.riskIpRemoved'), ip);
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return <div className="p-12 text-center text-exchange-text-third">{loading ? t('common.loading') : '—'}</div>;
  }

  const cbEnabled = !!data.circuit_breaker?.enabled;
  const f2faEnabled = !!data.force_2fa?.enabled;
  const blocklist: string[] = data.ip_blocklist || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-exchange-sell" />
          <div className="text-base font-bold">{t('admin.riskTitle')}</div>
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-lg border border-exchange-border hover:bg-exchange-hover/40"
        >
          <RefreshCw size={12} className={`inline mr-1 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Circuit breaker */}
      <div className={`rounded-2xl border-2 p-5 ${
        cbEnabled
          ? 'border-exchange-sell/40 bg-gradient-to-br from-exchange-sell/10 to-exchange-sell/5'
          : 'border-exchange-border bg-exchange-card'
      }`}>
        <div className="flex items-start gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
            cbEnabled ? 'bg-exchange-sell/20 text-exchange-sell' : 'bg-exchange-hover/40 text-exchange-text-secondary'
          }`}>
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-bold">{t('admin.riskCircuitBreaker')}</div>
              <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold ${
                cbEnabled
                  ? 'bg-exchange-sell/20 text-exchange-sell'
                  : 'bg-exchange-buy/20 text-exchange-buy'
              }`}>
                {cbEnabled ? t('admin.riskEnabled') : t('admin.riskDisabled')}
              </span>
            </div>
            <div className="text-xs text-exchange-text-third mt-1 leading-relaxed">
              {t('admin.riskCircuitBreakerDesc')}
            </div>
            {cbEnabled && data.circuit_breaker?.reason && (
              <div className="mt-2 text-xs font-mono text-exchange-sell break-all">
                {data.circuit_breaker.reason}
              </div>
            )}
            {!cbEnabled && (
              <input
                value={cbReason}
                onChange={(e) => setCbReason(e.target.value)}
                placeholder={t('admin.riskReason')}
                className="mt-3 w-full px-3 py-2 text-xs rounded-lg bg-exchange-bg border border-exchange-border focus:border-exchange-yellow/60 outline-none"
              />
            )}
          </div>
          <button
            onClick={() => toggleCb(!cbEnabled)}
            disabled={busy === 'cb'}
            className={`px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 ${
              cbEnabled
                ? 'bg-exchange-buy/20 text-exchange-buy hover:bg-exchange-buy/30'
                : 'bg-exchange-sell/20 text-exchange-sell hover:bg-exchange-sell/30'
            }`}
          >
            <Zap size={12} className="inline mr-1" />
            {cbEnabled ? t('admin.riskDisabled') : t('admin.riskEnabled')}
          </button>
        </div>
      </div>

      {/* Force 2FA */}
      <div className={`rounded-2xl border-2 p-5 ${
        f2faEnabled
          ? 'border-exchange-yellow/40 bg-gradient-to-br from-exchange-yellow/10 to-exchange-yellow/5'
          : 'border-exchange-border bg-exchange-card'
      }`}>
        <div className="flex items-start gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
            f2faEnabled ? 'bg-exchange-yellow/20 text-exchange-yellow' : 'bg-exchange-hover/40 text-exchange-text-secondary'
          }`}>
            <KeyRound size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-bold">{t('admin.riskForce2fa')}</div>
              <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold ${
                f2faEnabled
                  ? 'bg-exchange-yellow/20 text-exchange-yellow'
                  : 'bg-exchange-hover/40 text-exchange-text-third'
              }`}>
                {f2faEnabled ? t('admin.riskEnabled') : t('admin.riskDisabled')}
              </span>
            </div>
            <div className="text-xs text-exchange-text-third mt-1 leading-relaxed">
              {t('admin.riskForce2faDesc')}
            </div>
          </div>
          <button
            onClick={() => toggle2fa(!f2faEnabled)}
            disabled={busy === '2fa'}
            className={`px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 ${
              f2faEnabled
                ? 'bg-exchange-hover/40 text-exchange-text-secondary hover:bg-exchange-hover/60'
                : 'bg-exchange-yellow/20 text-exchange-yellow hover:bg-exchange-yellow/30'
            }`}
          >
            {f2faEnabled ? t('admin.riskDisabled') : t('admin.riskEnabled')}
          </button>
        </div>
      </div>

      {/* IP blocklist */}
      <div className="rounded-2xl border-2 border-exchange-border bg-exchange-card p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-exchange-hover/40 text-exchange-text-secondary">
            <Ban size={20} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold">{t('admin.riskIpBlocklist')}</div>
            <div className="text-xs text-exchange-text-third mt-0.5 leading-relaxed">
              {t('admin.riskIpBlocklistDesc')}
            </div>
          </div>
        </div>

        {/* Add form */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            value={ipInput}
            onChange={(e) => setIpInput(e.target.value)}
            placeholder={t('admin.riskIpPlaceholder')}
            className="flex-1 px-3 py-2 text-xs font-mono rounded-lg bg-exchange-bg border border-exchange-border focus:border-exchange-yellow/60 outline-none"
          />
          <input
            value={ipReason}
            onChange={(e) => setIpReason(e.target.value)}
            placeholder={t('admin.riskReason')}
            className="flex-1 px-3 py-2 text-xs rounded-lg bg-exchange-bg border border-exchange-border focus:border-exchange-yellow/60 outline-none"
          />
          <button
            onClick={addIp}
            disabled={busy === 'ipAdd' || !ipInput.trim()}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-exchange-sell/20 text-exchange-sell hover:bg-exchange-sell/30 disabled:opacity-50 whitespace-nowrap"
          >
            <Plus size={12} className="inline mr-1" />
            {t('admin.riskAddIp')}
          </button>
        </div>

        {/* Blocklist table */}
        {blocklist.length === 0 ? (
          <div className="text-xs text-exchange-text-third py-6 text-center border border-dashed border-exchange-border rounded-lg">
            {t('admin.riskNoBlocklist')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-exchange-border">
            <table className="w-full text-sm">
              <thead className="bg-exchange-hover/40 text-[11px] uppercase tracking-wider text-exchange-text-third">
                <tr>
                  <th className="text-left px-3 py-2">IP / CIDR</th>
                  <th className="text-right px-3 py-2 w-32">{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {blocklist.map((ip) => (
                  <tr key={ip} className="border-t border-exchange-border">
                    <td className="px-3 py-2 font-mono text-xs">{ip}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => removeIp(ip)}
                        disabled={busy === `ipRm:${ip}`}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-exchange-hover/40 hover:bg-exchange-sell/20 hover:text-exchange-sell disabled:opacity-50"
                      >
                        <Trash2 size={11} className="inline mr-1" />
                        {t('admin.riskRemove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BridgeTab — Sprint 4 Phase G — QTA <-> ETH bridge admin
// ---------------------------------------------------------------------------
function BridgeTab({ t }: any) {
  const [data, setData] = useState<any>(null);
  const [pubState, setPubState] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [direction, setDirection] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (direction) params.set('direction', direction);
      const [r1, r2] = await Promise.all([
        api.get(`/bridge/admin/transfers?${params.toString()}`),
        api.get('/bridge/state'),
      ]);
      setData(r1.data || null);
      setPubState(r2.data?.state || null);
    } catch (e: any) {
      if (e.response?.status !== 401) {
        showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [status, direction]);

  const advance = async (id: string) => {
    setBusy(id);
    try {
      const r = await api.post(`/bridge/admin/transfers/${id}/advance`);
      showToast('success', t('admin.bridgeAdvanced'), r.data?.transfer?.status || '');
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const fail = async (id: string) => {
    const reason = prompt(t('admin.bridgeFailReason') || 'Reason?') || '';
    if (!reason) return;
    setBusy(id);
    try {
      await api.post(`/bridge/admin/transfers/${id}/fail`, { reason });
      showToast('success', t('admin.bridgeFailed'), '');
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const togglePause = async (paused: boolean) => {
    setBusy('pause');
    try {
      await api.post('/bridge/admin/pause', { paused });
      showToast(
        'success',
        paused ? t('admin.bridgePaused') : t('admin.bridgeResumed'),
        ''
      );
      load();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  if (!data || !pubState) {
    return <div className="p-12 text-center text-exchange-text-third">{loading ? t('common.loading') : '—'}</div>;
  }

  const agg = data.aggregate || {};
  const br = data.bridge || {};
  const paused = !!pubState.paused;
  const transfers = data.transfers || [];

  const DIRECTIONS: Array<{ key: string; label: string }> = [
    { key: '',           label: t('admin.bridgeAll') },
    { key: 'qta_to_eth', label: t('admin.bridgeQtaToEth') },
    { key: 'eth_to_qta', label: t('admin.bridgeEthToQta') },
  ];
  const STATUSES: Array<{ key: string; label: string }> = [
    { key: '',             label: t('admin.bridgeAll') },
    { key: 'pending_lock', label: 'pending_lock' },
    { key: 'locked',       label: 'locked' },
    { key: 'minting',      label: 'minting' },
    { key: 'minted',       label: 'minted' },
    { key: 'pending_burn', label: 'pending_burn' },
    { key: 'burned',       label: 'burned' },
    { key: 'releasing',    label: 'releasing' },
    { key: 'released',     label: 'released' },
    { key: 'failed',       label: 'failed' },
  ];

  return (
    <div className="space-y-6">
      {/* Hero — bridge status */}
      <div className={`rounded-2xl border-2 p-6 flex items-center gap-5 ${
        paused
          ? 'bg-gradient-to-br from-exchange-sell/10 to-exchange-sell/5 border-exchange-sell/40'
          : 'bg-gradient-to-br from-exchange-yellow/10 to-exchange-yellow/5 border-exchange-yellow/30'
      }`}>
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
          paused ? 'bg-exchange-sell/20 text-exchange-sell' : 'bg-exchange-yellow/20 text-exchange-yellow'
        }`}>
          <ArrowRightLeft size={26} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="text-xl font-bold">{t('admin.bridge')}</div>
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold ${
              paused
                ? 'bg-exchange-sell/20 text-exchange-sell'
                : 'bg-exchange-buy/20 text-exchange-buy'
            }`}>
              {paused ? t('admin.bridgePausedLabel') : t('admin.bridgeActiveLabel')}
            </span>
          </div>
          <div className="text-xs text-exchange-text-third mt-1">
            {data.network} · {pubState.integration_phase} · fee {br.fee_bps ?? 30} bps
          </div>
        </div>
        <button
          onClick={() => togglePause(!paused)}
          disabled={busy === 'pause'}
          className={`px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 ${
            paused
              ? 'bg-exchange-buy/20 text-exchange-buy hover:bg-exchange-buy/30'
              : 'bg-exchange-sell/20 text-exchange-sell hover:bg-exchange-sell/30'
          }`}
        >
          {paused
            ? <><Play size={12} className="inline mr-1" />{t('admin.bridgeResume')}</>
            : <><Pause size={12} className="inline mr-1" />{t('admin.bridgePause')}</>
          }
        </button>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-lg border border-exchange-border hover:bg-exchange-hover/40"
        >
          <RefreshCw size={12} className={`inline mr-1 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label={t('admin.bridgeTotalLocked')}  value={`${br.total_locked || '0'} QTA`} />
        <Card label={t('admin.bridgeTotalMinted')}  value={`${br.total_minted || '0'} qQTA`} />
        <Card label={t('admin.bridgeTransfers')}    value={String(agg.total ?? 0)} />
        <Card label={t('admin.bridgePending')}      value={String(agg.pending ?? 0)} />
        <Card label={t('admin.bridgeInFlight')}     value={String(agg.in_flight ?? 0)} />
        <Card label={t('admin.bridgeBroadcasting')} value={String(agg.broadcasting ?? 0)} />
        <Card label={t('admin.bridgeCompleted')}    value={String(agg.completed ?? 0)} />
        <Card label={t('admin.bridgeFailedKpi')}    value={String(agg.failed ?? 0)} />
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-exchange-border bg-exchange-card p-3 flex flex-wrap items-center gap-3">
        <div className="text-[11px] uppercase tracking-wider text-exchange-text-third">
          {t('admin.bridgeDirection')}
        </div>
        <div className="flex flex-wrap gap-1">
          {DIRECTIONS.map((d) => (
            <button
              key={d.key || 'all-d'}
              onClick={() => setDirection(d.key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                direction === d.key
                  ? 'bg-exchange-yellow/20 text-exchange-yellow'
                  : 'text-exchange-text-secondary hover:bg-exchange-hover/40'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="text-[11px] uppercase tracking-wider text-exchange-text-third ml-2">
          {t('admin.chainStatus')}
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-2 py-1 text-[11px] rounded-lg bg-exchange-bg border border-exchange-border outline-none"
        >
          {STATUSES.map((s) => (
            <option key={s.key || 'all'} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Transfers table */}
      <div className="rounded-xl border border-exchange-border bg-exchange-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-exchange-hover/40 text-[11px] uppercase tracking-wider text-exchange-text-third">
            <tr>
              <th className="text-left px-3 py-2.5">{t('admin.user')}</th>
              <th className="text-center px-3 py-2.5">{t('admin.bridgeDirection')}</th>
              <th className="text-right px-3 py-2.5">{t('admin.amount')}</th>
              <th className="text-left px-3 py-2.5">QTA → / ← ETH</th>
              <th className="text-center px-3 py-2.5">{t('admin.chainStatus')}</th>
              <th className="text-center px-3 py-2.5">{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {transfers.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-exchange-text-third">
                  {loading ? t('common.loading') : t('admin.bridgeNoTransfers')}
                </td>
              </tr>
            )}
            {transfers.map((tr: any) => {
              const dirArrow = tr.direction === 'qta_to_eth' ? '→ ETH' : '← QTA';
              const isTerminal = tr.status === 'minted' || tr.status === 'released' ||
                                 tr.status === 'failed' || tr.status === 'cancelled';
              return (
                <tr key={tr.id} className="border-t border-exchange-border">
                  <td className="px-3 py-2 truncate max-w-[180px]">{tr.email || tr.user_id}</td>
                  <td className="px-3 py-2 text-center text-[11px] font-semibold text-exchange-text-secondary">
                    {dirArrow}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{tr.amount}</td>
                  <td className="px-3 py-2 font-mono text-[10px] truncate max-w-[260px] text-exchange-text-third">
                    {tr.direction === 'qta_to_eth' ? (tr.eth_address || '—') : (tr.qta_address || '—')}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      tr.status === 'minted' || tr.status === 'released'
                        ? 'bg-exchange-buy/20 text-exchange-buy'
                        : tr.status === 'failed'
                        ? 'bg-exchange-sell/20 text-exchange-sell'
                        : 'bg-exchange-yellow/15 text-exchange-yellow'
                    }`}>
                      {tr.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {!isTerminal && (
                      <>
                        <button
                          onClick={() => advance(tr.id)}
                          disabled={busy === tr.id}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-exchange-buy/20 text-exchange-buy hover:bg-exchange-buy/30 disabled:opacity-50 mr-1.5"
                        >
                          {t('admin.bridgeAdvance')}
                        </button>
                        <button
                          onClick={() => fail(tr.id)}
                          disabled={busy === tr.id}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-exchange-sell/20 text-exchange-sell hover:bg-exchange-sell/30 disabled:opacity-50"
                        >
                          {t('admin.bridgeMarkFail')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Sprint 4 Phase H1 — Futures + Margin admin tabs
// ============================================================================

function FuturesMarketsTab({ t }: any) {
  const [contracts, setContracts] = useState<any[]>([]);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ symbol: '', base_asset: '', quote_asset: 'USDT', max_leverage: 100, maintenance_margin_bps: 50, initial_margin_bps: 100 });

  async function load() {
    try {
      const [r1, r2] = await Promise.all([
        api.get('/futures/contracts'),
        api.get('/futures/state'),
      ]);
      setContracts(r1?.data?.contracts || []);
      setPaused(!!r2?.data?.state?.paused);
    } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, []);

  async function togglePause() {
    try {
      await api.post('/futures/admin/pause', { paused: !paused });
      showToast('success', !paused ? t('admin.futuresPaused') : t('admin.futuresActive'));
      load();
    } catch (e: any) { showToast('error', e?.response?.data?.error || 'Failed'); }
  }

  async function upsert() {
    if (!form.symbol) { showToast('error', 'symbol'); return; }
    try {
      await api.post('/futures/admin/contracts', form);
      showToast('success', 'OK');
      setShowAdd(false);
      load();
    } catch (e: any) { showToast('error', e?.response?.data?.error || 'Failed'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{t('admin.futuresMarkets')}</h2>
        <div className="flex gap-2">
          <button onClick={togglePause} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${paused ? 'bg-exchange-sell/20 text-exchange-sell' : 'bg-exchange-buy/20 text-exchange-buy'}`}>
            {paused ? t('admin.futuresPaused') : t('admin.futuresActive')}
          </button>
          <button onClick={() => setShowAdd(s => !s)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-exchange-yellow/15 text-exchange-yellow">
            {t('admin.upsertContract')}
          </button>
        </div>
      </div>
      {showAdd && (
        <div className="rounded-xl border border-exchange-border bg-exchange-card p-4 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <input value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value.toUpperCase() })} placeholder={t('admin.contractSymbol')} className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm" />
            <input value={form.base_asset} onChange={e => setForm({ ...form, base_asset: e.target.value.toUpperCase() })} placeholder={t('admin.baseAsset')} className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm" />
            <input value={form.quote_asset} onChange={e => setForm({ ...form, quote_asset: e.target.value.toUpperCase() })} placeholder={t('admin.quoteAsset')} className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm" />
            <input type="number" value={form.max_leverage} onChange={e => setForm({ ...form, max_leverage: +e.target.value })} placeholder={t('admin.maxLeverage')} className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm" />
            <input type="number" value={form.maintenance_margin_bps} onChange={e => setForm({ ...form, maintenance_margin_bps: +e.target.value })} placeholder={t('admin.maintenanceMargin') + ' (bps)'} className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm" />
            <input type="number" value={form.initial_margin_bps} onChange={e => setForm({ ...form, initial_margin_bps: +e.target.value })} placeholder={t('admin.initialMargin') + ' (bps)'} className="px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm" />
          </div>
          <button onClick={upsert} className="px-4 py-2 rounded-lg text-sm font-semibold bg-exchange-buy text-white">{t('admin.upsertContract')}</button>
        </div>
      )}
      <div className="rounded-xl border border-exchange-border bg-exchange-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-exchange-text-third">
            <tr>
              <th className="text-left px-4 py-2">{t('admin.contractSymbol')}</th>
              <th className="text-left px-4 py-2">{t('admin.baseAsset')}</th>
              <th className="text-left px-4 py-2">{t('admin.quoteAsset')}</th>
              <th className="text-right px-4 py-2">{t('admin.maxLeverage')}</th>
              <th className="text-right px-4 py-2">{t('admin.maintenanceMargin')}</th>
              <th className="text-right px-4 py-2">{t('admin.initialMargin')}</th>
              <th className="text-right px-4 py-2">{t('admin.fundingInterval')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center py-8 text-exchange-text-third">…</td></tr>}
            {!loading && contracts.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-exchange-text-third">—</td></tr>}
            {contracts.map((c: any) => (
              <tr key={c.symbol} className="border-t border-exchange-border">
                <td className="px-4 py-2 font-mono">{c.symbol}</td>
                <td className="px-4 py-2">{c.base_asset}</td>
                <td className="px-4 py-2">{c.quote_asset}</td>
                <td className="px-4 py-2 text-right">{c.max_leverage}x</td>
                <td className="px-4 py-2 text-right">{(c.maintenance_margin_bps / 100).toFixed(2)}%</td>
                <td className="px-4 py-2 text-right">{(c.initial_margin_bps / 100).toFixed(2)}%</td>
                <td className="px-4 py-2 text-right">{Math.floor(c.funding_interval_sec / 3600)}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FuturesPositionsTab({ t }: any) {
  const [positions, setPositions] = useState<any[]>([]);
  const [atRisk, setAtRisk] = useState<any[]>([]);
  const [tab, setTab] = useState<'open' | 'risk' | 'closed' | 'liquidated'>('open');
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      if (tab === 'risk') {
        const r = await api.get('/futures/admin/at-risk');
        setAtRisk(r?.data?.positions || []);
      } else {
        const r = await api.get('/futures/admin/positions', { params: { status: tab } });
        setPositions(r?.data?.positions || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { setLoading(true); load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, [tab]);

  async function forceLiquidate(id: string) {
    const mark = window.prompt(t('admin.forceLiquidatePrompt'));
    if (!mark) return;
    try {
      await api.post(`/futures/admin/positions/${id}/liquidate`, { mark_price: mark });
      showToast('success', 'OK');
      load();
    } catch (e: any) { showToast('error', e?.response?.data?.error || 'Failed'); }
  }

  const rows = tab === 'risk' ? atRisk : positions;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{t('admin.futuresPositions')}</h2>
        <div className="flex gap-2">
          {(['open', 'risk', 'closed', 'liquidated'] as const).map(s => (
            <button key={s} onClick={() => setTab(s)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab === s ? 'bg-exchange-yellow/15 text-exchange-yellow' : 'bg-exchange-card text-exchange-text-second'}`}>
              {s === 'risk' ? t('admin.atRisk') : s}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-exchange-border bg-exchange-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-exchange-text-third">
            <tr>
              <th className="text-left px-3 py-2">{t('admin.user')}</th>
              <th className="text-left px-3 py-2">{t('admin.contractSymbol')}</th>
              <th className="text-left px-3 py-2">Side</th>
              <th className="text-right px-3 py-2">{t('admin.amount')}</th>
              <th className="text-right px-3 py-2">{t('admin.entryPrice')}</th>
              <th className="text-right px-3 py-2">{t('admin.markPrice')}</th>
              <th className="text-right px-3 py-2">{t('admin.leverage')}</th>
              <th className="text-right px-3 py-2">{t('admin.liquidationPrice')}</th>
              <th className="text-right px-3 py-2">{t('admin.unrealizedPnl')}</th>
              <th className="text-right px-3 py-2">{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="text-center py-8 text-exchange-text-third">…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={10} className="text-center py-8 text-exchange-text-third">—</td></tr>}
            {rows.map((p: any) => (
              <tr key={p.id} className="border-t border-exchange-border">
                <td className="px-3 py-2 font-mono text-[11px]">{p.email || p.user_id}</td>
                <td className="px-3 py-2">{p.symbol}</td>
                <td className={`px-3 py-2 font-semibold ${p.side === 'long' ? 'text-exchange-buy' : 'text-exchange-sell'}`}>{p.side}</td>
                <td className="px-3 py-2 text-right font-mono">{p.size}</td>
                <td className="px-3 py-2 text-right font-mono">{p.entry_price}</td>
                <td className="px-3 py-2 text-right font-mono">{p.mark_price}</td>
                <td className="px-3 py-2 text-right">{p.leverage}x</td>
                <td className="px-3 py-2 text-right font-mono text-exchange-sell">{p.liquidation_price || '—'}</td>
                <td className={`px-3 py-2 text-right font-mono ${Number(p.unrealized_pnl) >= 0 ? 'text-exchange-buy' : 'text-exchange-sell'}`}>{p.unrealized_pnl}</td>
                <td className="px-3 py-2 text-right">
                  {(p.status === 'open' || tab === 'risk') && (
                    <button onClick={() => forceLiquidate(p.id)} className="px-2 py-1 rounded-md text-[10px] font-semibold bg-exchange-sell/20 text-exchange-sell">{t('admin.forceLiquidate')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LiquidationsTab({ t }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const r = await api.get('/admin/liquidations').catch(() => null);
      // Fallback: query by joining via DB endpoint not exposed; use a thin proxy.
      if (r?.data?.rows) setRows(r.data.rows);
      else {
        // Use direct query to liquidations via futures admin (not exposed) — leave as no-op.
        setRows([]);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{t('admin.liquidations')}</h2>
        <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-exchange-card text-exchange-text-second">↻</button>
      </div>
      <div className="rounded-xl border border-exchange-border bg-exchange-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-exchange-text-third">
            <tr>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">{t('admin.user')}</th>
              <th className="text-left px-3 py-2">{t('admin.contractSymbol')}</th>
              <th className="text-right px-3 py-2">{t('admin.amount')}</th>
              <th className="text-right px-3 py-2">{t('admin.liquidationPrice')}</th>
              <th className="text-right px-3 py-2">{t('admin.fee')}</th>
              <th className="text-left px-3 py-2">{t('admin.liquidationReason')}</th>
              <th className="text-right px-3 py-2">{t('admin.paidAt')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-8 text-exchange-text-third">…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-exchange-text-third">—</td></tr>}
            {rows.map((r: any) => (
              <tr key={r.id} className="border-t border-exchange-border">
                <td className="px-3 py-2">{r.type}</td>
                <td className="px-3 py-2 font-mono text-[11px]">{r.user_id}</td>
                <td className="px-3 py-2">{r.symbol}</td>
                <td className="px-3 py-2 text-right font-mono">{r.size}</td>
                <td className="px-3 py-2 text-right font-mono">{r.liquidation_price}</td>
                <td className="px-3 py-2 text-right font-mono">{r.fee}</td>
                <td className="px-3 py-2">{r.reason}</td>
                <td className="px-3 py-2 text-right text-exchange-text-third">{r.liquidated_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FundingHistoryTab({ t }: any) {
  const [symbol, setSymbol] = useState('BTC-PERP');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const r = await api.get('/futures/funding-rates', { params: { symbol, limit: 100 } });
      setRows(r?.data?.history || []);
    } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { setLoading(true); load(); }, [symbol]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{t('admin.fundingHistory')}</h2>
        <select value={symbol} onChange={e => setSymbol(e.target.value)} className="px-3 py-1.5 rounded-lg bg-exchange-card border border-exchange-border text-xs">
          <option value="BTC-PERP">BTC-PERP</option>
          <option value="ETH-PERP">ETH-PERP</option>
          <option value="QTA-PERP">QTA-PERP</option>
        </select>
      </div>
      <div className="rounded-xl border border-exchange-border bg-exchange-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-exchange-text-third">
            <tr>
              <th className="text-left px-3 py-2">{t('admin.contractSymbol')}</th>
              <th className="text-right px-3 py-2">{t('admin.fundingRate')}</th>
              <th className="text-right px-3 py-2">{t('admin.markPrice')}</th>
              <th className="text-right px-3 py-2">{t('admin.indexPrice')}</th>
              <th className="text-right px-3 py-2">{t('admin.paidAt')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="text-center py-8 text-exchange-text-third">…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-exchange-text-third">—</td></tr>}
            {rows.map((r: any) => {
              const rate = Number(r.funding_rate);
              const pct = isFinite(rate) ? (rate * 100).toFixed(4) : '—';
              return (
                <tr key={r.id} className="border-t border-exchange-border">
                  <td className="px-3 py-2 font-mono">{r.symbol}</td>
                  <td className={`px-3 py-2 text-right font-mono ${rate >= 0 ? 'text-exchange-buy' : 'text-exchange-sell'}`}>{pct}%</td>
                  <td className="px-3 py-2 text-right font-mono">{r.mark_price}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.index_price}</td>
                  <td className="px-3 py-2 text-right text-exchange-text-third">{r.paid_at}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MarginAccountsTab({ t }: any) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<'all' | 'risk'>('all');
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const url = filter === 'risk' ? '/margin/admin/at-risk' : '/margin/admin/accounts';
      const r = await api.get(url);
      setAccounts(r?.data?.accounts || []);
      const m = await api.get('/admin/system-markers').catch(() => null);
      if (m?.data?.markers) {
        const p = m.data.markers.find((x: any) => x.key === 'margin_paused');
        if (p) setPaused(p.value === 'on');
      }
    } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { setLoading(true); load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [filter]);

  async function togglePause() {
    try {
      await api.post('/margin/admin/pause', { paused: !paused });
      showToast('success', !paused ? t('admin.marginPaused') : t('admin.marginActive'));
      setPaused(!paused);
    } catch (e: any) { showToast('error', e?.response?.data?.error || 'Failed'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{t('admin.marginAccounts')}</h2>
        <div className="flex gap-2">
          <button onClick={togglePause} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${paused ? 'bg-exchange-sell/20 text-exchange-sell' : 'bg-exchange-buy/20 text-exchange-buy'}`}>
            {paused ? t('admin.marginPaused') : t('admin.marginActive')}
          </button>
          <button onClick={() => setFilter(filter === 'all' ? 'risk' : 'all')} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-exchange-card text-exchange-text-second">
            {filter === 'risk' ? t('admin.atRisk') : 'all'}
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-exchange-border bg-exchange-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-exchange-text-third">
            <tr>
              <th className="text-left px-3 py-2">{t('admin.user')}</th>
              <th className="text-left px-3 py-2">{t('margin.asset')}</th>
              <th className="text-right px-3 py-2">Balance</th>
              <th className="text-right px-3 py-2">{t('admin.borrowed')}</th>
              <th className="text-right px-3 py-2">{t('admin.interestAccrued')}</th>
              <th className="text-right px-3 py-2">{t('admin.marginLevel')}</th>
              <th className="text-left px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center py-8 text-exchange-text-third">…</td></tr>}
            {!loading && accounts.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-exchange-text-third">—</td></tr>}
            {accounts.map((a: any) => {
              const lvl = Number(a.margin_level);
              const lvlColor = lvl > 1.5 ? 'text-exchange-buy' : lvl > 1.2 ? 'text-exchange-yellow' : 'text-exchange-sell';
              return (
                <tr key={a.id} className="border-t border-exchange-border">
                  <td className="px-3 py-2 font-mono text-[11px]">{a.email || a.user_id}</td>
                  <td className="px-3 py-2">{a.asset}</td>
                  <td className="px-3 py-2 text-right font-mono">{a.balance}</td>
                  <td className="px-3 py-2 text-right font-mono">{a.borrowed}</td>
                  <td className="px-3 py-2 text-right font-mono">{a.interest_accrued}</td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${lvlColor}`}>{a.margin_level}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      a.status === 'active' ? 'bg-exchange-buy/15 text-exchange-buy' :
                      a.status === 'margin_call' ? 'bg-exchange-yellow/15 text-exchange-yellow' :
                      'bg-exchange-sell/15 text-exchange-sell'
                    }`}>
                      {a.status === 'active' ? t('admin.statusActive') :
                       a.status === 'margin_call' ? t('admin.statusMarginCall') :
                       t('admin.statusLiquidating')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Sprint 4 Phase H2-B — Admin: PQ API key observability tab
// Backed by GET /api/admin/api-keys/stats. Read-only in this phase; flipping
// pq_api_keys_required / pq_api_keys_wasm_ready will land in a follow-up
// sprint together with the WASM Dilithium2 verifier.
// ============================================================================
function PqApiKeysTab({ t }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/api-keys/stats');
      setData(res.data);
    } catch (e: any) {
      showToast('error', t('admin.pqApiKeys'), e?.response?.data?.error || 'Failed');
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const dist = data?.distribution || { 'hmac-sha256': 0, 'dilithium2': 0, 'hybrid': 0 };
  const totalKeys = (dist['hmac-sha256'] || 0) + (dist['dilithium2'] || 0) + (dist['hybrid'] || 0);
  const pct = (n: number) => (totalKeys > 0 ? Math.round((n / totalKeys) * 100) : 0);
  const m = data?.markers || { enabled: false, required: false, wasm_ready: false, integration_phase: 'phase-s5-2-live' };
  const audit = data?.pq_audit_24h || { total: 0, by_outcome: [] };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-exchange-text">{t('admin.pqApiKeys')}</h2>
          <p className="text-xs text-exchange-text-third mt-0.5">{t('admin.pqApiKeysDesc')}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded-lg bg-exchange-hover hover:bg-exchange-hover/70 text-exchange-text-secondary disabled:opacity-50"
        >
          {loading ? '...' : t('admin.refresh')}
        </button>
      </div>

      {/* Marker / phase summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label={t('admin.pqIntegrationPhase')} value={m.integration_phase || 'phase-s5-2-live'} pill />
        <Card label={t('admin.pqEnabled')} value={m.enabled ? 'on' : 'off'} pill />
        <Card label={t('admin.pqRequired')} value={m.required ? 'on' : 'off'} pill />
        <Card label={t('admin.pqWasmReady')} value={m.wasm_ready ? 'on' : 'off'} pill />
      </div>

      {/* Algorithm distribution */}
      <div className="rounded-xl border border-exchange-border bg-exchange-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-exchange-text">{t('admin.pqDistribution')}</h3>
          <span className="text-[11px] text-exchange-text-third">
            {t('admin.pqDistTotal')}: <span className="text-exchange-text font-semibold">{totalKeys}</span>
          </span>
        </div>
        <div className="space-y-3">
          {(['hmac-sha256', 'dilithium2', 'hybrid'] as const).map((alg) => {
            const n = dist[alg] || 0;
            const p = pct(n);
            const colorBar =
              alg === 'hmac-sha256' ? 'bg-exchange-text-third' :
              alg === 'dilithium2'  ? 'bg-purple-500' :
                                      'bg-amber-500';
            const colorTxt =
              alg === 'hmac-sha256' ? 'text-exchange-text-secondary' :
              alg === 'dilithium2'  ? 'text-purple-400' :
                                      'text-amber-400';
            return (
              <div key={alg}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className={`font-semibold ${colorTxt}`}>{t(`apikey.alg_${alg.replace('-', '_')}`)}</span>
                  <span className="text-exchange-text-third">
                    <span className="text-exchange-text font-semibold">{n}</span> ({p}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-exchange-hover overflow-hidden">
                  <div className={`h-full ${colorBar}`} style={{ width: `${p}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PQ audit (last 24h) */}
      <div className="rounded-xl border border-exchange-border bg-exchange-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-exchange-text">{t('admin.pqAudit24h')}</h3>
          <span className="text-[11px] text-exchange-text-third">
            {t('admin.pqAuditTotal')}: <span className="text-exchange-text font-semibold">{audit.total || 0}</span>
          </span>
        </div>
        {(audit.by_outcome || []).length === 0 ? (
          <p className="text-xs text-exchange-text-third">{t('admin.pqAuditEmpty')}</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-exchange-text-third border-b border-exchange-border">
                <th className="py-1.5 font-medium">{t('admin.pqAuditOutcome')}</th>
                <th className="py-1.5 font-medium text-right">{t('admin.pqAuditCount')}</th>
              </tr>
            </thead>
            <tbody>
              {audit.by_outcome.map((row: any) => (
                <tr key={row.outcome} className="border-b border-exchange-border/50">
                  <td className="py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      row.outcome === 'ok'                ? 'bg-exchange-buy/10 text-exchange-buy' :
                      row.outcome === 'wasm_unavailable'  ? 'bg-exchange-yellow/10 text-exchange-yellow' :
                      row.outcome === 'expired'           ? 'bg-amber-500/10 text-amber-400' :
                      row.outcome === 'replay'            ? 'bg-exchange-sell/10 text-exchange-sell' :
                                                            'bg-exchange-sell/10 text-exchange-sell'
                    }`}>
                      {row.outcome}
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-mono">{row.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Stub-phase notice */}
      <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
        <p className="text-xs text-purple-300 leading-relaxed">
          <span className="font-semibold">{t('admin.pqStubTitle')}</span> {t('admin.pqStubBody')}
        </p>
      </div>

      {/* Sprint 5 Phase I1 — External Trading API gate */}
      <ExternalTradingApiCard t={t} />
    </div>
  );
}

// ===========================================================================
// External Trading API card — Sprint 5 Phase I1
// ---------------------------------------------------------------------------
// Standalone subcomponent so its 30s polling cycle is independent of the
// PQ stats poll above. Renders four marker tiles, three nonce activity
// counters, and an on/off toggle button. The toggle hits
// POST /admin/external-trading-api/toggle which writes to system_markers
// and audit-logs the change.
// ===========================================================================
function ExternalTradingApiCard({ t }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  // Sprint 5 Phase D3-α: auto-refresh toggle + last-refresh timestamp.
  // Default ON (preserves prior behaviour); operators can pause polling
  // while inspecting a frozen value.
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/external-trading-api/stats');
      setData(res.data);
      setLastRefresh(Date.now());
    } catch (e: any) {
      showToast('error', t('admin.extTradingApi'), e?.response?.data?.error || 'Failed');
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  const toggle = async () => {
    if (!data) return;
    const next = !data.enabled;
    if (next && !confirm(t('admin.extTradingApiConfirmEnable'))) return;
    setToggling(true);
    try {
      const res = await api.post('/admin/external-trading-api/toggle', { enabled: next });
      showToast(
        'success',
        t('admin.extTradingApi'),
        res.data?.enabled ? t('admin.extTradingApiNowOn') : t('admin.extTradingApiNowOff'),
      );
      await load();
    } catch (e: any) {
      showToast('error', t('admin.extTradingApi'), e?.response?.data?.error || 'Failed');
    }
    setToggling(false);
  };

  const enabled = !!data?.enabled;
  const phase = data?.integration_phase || 'phase-i1-stub';
  const skew = data?.max_skew_sec ?? 60;
  const nonces = data?.nonces || { total: 0, last24h: 0, last1h: 0 };

  return (
    <div className="rounded-xl border border-exchange-border bg-exchange-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-exchange-text">{t('admin.extTradingApi')}</h3>
          <p className="text-[11px] text-exchange-text-third mt-0.5">
            {t('admin.extTradingApiDesc')}
          </p>
          <p className="text-[10px] text-exchange-text-third mt-1">
            {t('admin.extTradingApiLastRefresh')}:{' '}
            <span className="font-mono">
              {lastRefresh ? new Date(lastRefresh).toLocaleTimeString() : '—'}
            </span>
            {autoRefresh && <span className="ml-1 text-exchange-buy">● 30s</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`px-2 py-1 text-[10px] font-semibold rounded-md transition-colors ${
              autoRefresh
                ? 'bg-exchange-buy/15 text-exchange-buy hover:bg-exchange-buy/25'
                : 'bg-exchange-border/40 text-exchange-text-third hover:bg-exchange-border/60'
            }`}
            title={t('admin.extTradingApiAutoRefreshHint')}
          >
            {autoRefresh
              ? t('admin.extTradingApiAutoRefreshOn')
              : t('admin.extTradingApiAutoRefreshOff')}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-2 py-1 text-[10px] font-semibold rounded-md bg-exchange-border/40 hover:bg-exchange-border/60 text-exchange-text-third disabled:opacity-50"
            title={t('admin.extTradingApiRefreshNow')}
          >
            {loading ? '…' : '↻'}
          </button>
          <button
            onClick={toggle}
            disabled={loading || toggling || !data}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 ${
              enabled
                ? 'bg-exchange-sell/15 hover:bg-exchange-sell/25 text-exchange-sell'
                : 'bg-exchange-buy/15 hover:bg-exchange-buy/25 text-exchange-buy'
            }`}
          >
            {toggling ? '...' : enabled ? t('admin.extTradingApiTurnOff') : t('admin.extTradingApiTurnOn')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label={t('admin.extTradingApiState')} value={enabled ? 'on' : 'off'} pill />
        <Card label={t('admin.extTradingApiPhase')} value={phase} pill />
        <Card label={t('admin.extTradingApiSkew')} value={`${skew}s`} mono />
        <Card label={t('admin.extTradingApiNonceTotal')} value={String(nonces.total ?? 0)} mono />
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <Card label={t('admin.extTradingApiNonce24h')} value={String(nonces.last24h ?? 0)} mono />
        <Card label={t('admin.extTradingApiNonce1h')} value={String(nonces.last1h ?? 0)} mono />
      </div>

      {!enabled && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-[11px] text-amber-300 leading-relaxed">
            {t('admin.extTradingApiOffNotice')}
          </p>
        </div>
      )}

      {phase === 'phase-c1-beta' && (
        <div className="mt-3 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
          <p className="text-[11px] text-purple-300 leading-relaxed">
            <span className="font-semibold">{t('admin.extTradingApiBetaTitle')}:</span>{' '}
            {t('admin.extTradingApiBetaBody')}
          </p>
        </div>
      )}
    </div>
  );
}

// Small reusable card for chain tabs
function Card({ label, value, mono, pill }: { label: string; value: string; mono?: boolean; pill?: boolean }) {
  return (
    <div className="rounded-xl border border-exchange-border bg-exchange-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-exchange-text-third">{label}</div>
      <div className={`mt-1.5 font-bold ${mono ? 'font-mono text-xs break-all' : 'text-base'} ${
        pill ? 'inline-block px-2 py-0.5 rounded-full bg-exchange-yellow/15 text-exchange-yellow text-xs' : ''
      }`}>
        {value}
      </div>
    </div>
  );
}
