import { useEffect, useState, Fragment } from 'react';
import {
  Users, BarChart3, ShieldCheck, ArrowUpFromLine, RefreshCw, Activity,
  DollarSign, TrendingUp, Search, Filter, ChevronLeft, ChevronRight,
  Ban, UserCheck, Crown, KeyRound, X, CheckCircle2, XCircle, Clock,
  Coins, Send, ArrowDownToLine, Megaphone, Wallet, Hash, Bell,
  FileText, Receipt, Server, Database, HardDrive,
} from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { formatPrice, timeAgo } from '../utils/format';
import { showToast } from '../components/common/Toast';
import CoinIcon from '../components/common/CoinIcon';

type Tab = 'overview' | 'users' | 'kyc' | 'deposits' | 'withdrawals' | 'trades' | 'coins' | 'broadcast' | 'audit' | 'fees' | 'system';

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

  const tabs: { key: Tab; label: string; icon: any; badge?: number }[] = [
    { key: 'overview',   label: t('admin.overview'),    icon: Activity },
    { key: 'users',      label: t('admin.users'),       icon: Users },
    { key: 'kyc',        label: t('admin.kyc'),         icon: ShieldCheck, badge: stats.pendingKyc },
    { key: 'deposits',   label: t('admin.deposits'),    icon: ArrowDownToLine, badge: stats.pendingDeposits },
    { key: 'withdrawals',label: t('admin.withdrawals'), icon: ArrowUpFromLine, badge: stats.pendingWithdrawals },
    { key: 'trades',     label: t('admin.tradesTab'),   icon: BarChart3 },
    { key: 'coins',      label: t('admin.coins'),       icon: Coins },
    { key: 'broadcast',  label: t('admin.broadcast'),   icon: Megaphone },
    { key: 'fees',       label: t('admin.fees'),        icon: Receipt },
    { key: 'audit',      label: t('admin.audit'),       icon: FileText },
    { key: 'system',     label: t('admin.system'),      icon: Server },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-exchange-yellow/10 rounded-xl flex items-center justify-center">
            <Activity size={18} className="text-exchange-yellow" />
          </div>
          <h1 className="text-2xl font-bold">{t('admin.dashboard')}</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={runPriceAlertCheck}
            disabled={alertChecking}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-exchange-text-secondary hover:text-exchange-yellow rounded-lg hover:bg-exchange-hover/50 transition-colors disabled:opacity-50"
            title={t('admin.runPriceAlertCheck')}
          >
            <Bell size={14} className={alertChecking ? 'animate-pulse' : ''} />
            <span className="hidden sm:inline">{t('admin.runPriceAlertCheck')}</span>
          </button>
          <button
            onClick={refresh}
            className="p-2 text-exchange-text-third hover:text-exchange-text rounded-lg hover:bg-exchange-hover/50 transition-colors"
            aria-label="Refresh"
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto scrollbar-thin pb-1">
        {tabs.map(({ key, label, icon: Icon, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === key
                ? 'bg-exchange-yellow text-black'
                : 'bg-exchange-card text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            <Icon size={15} />
            {label}
            {badge && badge > 0 ? (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                tab === key ? 'bg-black/20 text-black' : 'bg-exchange-sell/20 text-exchange-sell'
              }`}>{badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'overview'    && <Overview stats={stats} trends={trends} topMarkets={topMarkets} activity={activity} t={t} />}
      {tab === 'users'       && <UsersTab t={t} onUpdate={refresh} />}
      {tab === 'kyc'         && <KycTab t={t} onUpdate={refresh} />}
      {tab === 'deposits'    && <DepositsTab t={t} onUpdate={refresh} />}
      {tab === 'withdrawals' && <WithdrawalsTab t={t} onUpdate={refresh} />}
      {tab === 'trades'      && <TradesTab t={t} />}
      {tab === 'coins'       && <CoinsTab t={t} />}
      {tab === 'broadcast'   && <BroadcastTab t={t} />}
      {tab === 'fees'        && <FeesTab t={t} />}
      {tab === 'audit'       && <AuditTab t={t} />}
      {tab === 'system'      && <SystemTab t={t} />}
    </div>
  );
}

// ============================================================================
// Overview tab
// ============================================================================
function Overview({ stats, trends, topMarkets, activity, t }: any) {
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

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
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
              <th className="text-left px-3 py-2.5">{t('admin.joined')}</th>
              <th className="text-right px-3 py-2.5">{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-exchange-text-third text-xs">{t('admin.noData')}</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30">
                <td className="px-3 py-2 text-xs">{u.email}</td>
                <td className="px-3 py-2 text-xs">
                  <button onClick={() => openDetail(u.id)} className="hover:text-exchange-yellow hover:underline">{u.nickname}</button>
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

      {detail && <UserDetailModal detail={detail} onClose={() => setDetail(null)} t={t} />}
    </div>
  );
}

function UserDetailModal({ detail, onClose, t }: any) {
  const { user, wallets, recentOrders, logins } = detail;
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

          <div className="border-t border-exchange-border/50 pt-3">
            <h4 className="text-xs font-semibold text-exchange-text-secondary mb-2 flex items-center gap-1.5"><Wallet size={12} /> {t('admin.wallets')} ({wallets?.length || 0})</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              {(wallets || []).slice(0, 12).map((w: any, i: number) => (
                <div key={i} className="flex items-center gap-2 bg-exchange-hover/30 px-2 py-1.5 rounded">
                  <CoinIcon symbol={w.coin_symbol} size={18} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[11px]">{w.coin_symbol}</div>
                    <div className="text-[10px] text-exchange-text-third tabular-nums truncate">{formatPrice(w.available)} / <span className="text-exchange-text-secondary">{formatPrice(w.locked)}L</span></div>
                  </div>
                </div>
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

  return (
    <div>
      <div className="flex items-center gap-1 mb-3 bg-exchange-card rounded-lg border border-exchange-border p-1 w-fit">
        {['pending', 'completed', 'rejected', ''].map(s => (
          <button key={s || 'all'} onClick={() => setStatus(s)} className={`px-3 py-1 text-xs rounded-md ${status === s ? 'bg-exchange-hover text-exchange-yellow' : 'text-exchange-text-secondary'}`}>
            {s === '' ? t('common.all') : s}
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
  const [status, setStatus] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [showManual, setShowManual] = useState(false);

  const load = async () => {
    try {
      const url = status ? `/admin/deposits?status=${status}` : '/admin/deposits';
      const res = await api.get(url);
      setList(res.data);
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || 'Load failed');
    }
  };
  useEffect(() => { load(); }, [status]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1 bg-exchange-card rounded-lg border border-exchange-border p-1 w-fit">
          {['', 'pending', 'completed', 'rejected'].map(s => (
            <button key={s || 'all'} onClick={() => setStatus(s)} className={`px-3 py-1 text-xs rounded-md ${status === s ? 'bg-exchange-hover text-exchange-yellow' : 'text-exchange-text-secondary'}`}>
              {s === '' ? t('common.all') : s}
            </button>
          ))}
        </div>
        <button onClick={() => setShowManual(true)} className="btn-primary text-xs !py-1.5 !px-3 flex items-center gap-1.5">
          <DollarSign size={13} /> {t('admin.manualDeposit')}
        </button>
      </div>

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
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-exchange-text-third text-xs">{t('admin.noData')}</td></tr>
            ) : list.map(d => (
              <tr key={d.id} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30">
                <td className="px-3 py-2 text-xs">{d.nickname}</td>
                <td className="px-3 py-2 text-xs font-medium">{d.coin_symbol}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-exchange-buy">+{formatPrice(d.amount)}</td>
                <td className="px-3 py-2 text-[11px]">{d.network || '-'}</td>
                <td className="px-3 py-2 text-[11px] text-exchange-text-secondary font-mono" title={d.tx_hash}>{(d.tx_hash || '').slice(0, 14)}{d.tx_hash && d.tx_hash.length > 14 ? '...' : ''}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    d.status === 'completed' ? 'bg-exchange-buy/15 text-exchange-buy' :
                    d.status === 'pending'   ? 'bg-exchange-yellow/15 text-exchange-yellow' :
                    'bg-exchange-sell/15 text-exchange-sell'
                  }`}>{d.status}</span>
                </td>
                <td className="px-3 py-2 text-[11px] text-exchange-text-third">{timeAgo(d.created_at, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showManual && <ManualDepositModal onClose={() => setShowManual(false)} onSuccess={() => { setShowManual(false); load(); onUpdate?.(); }} t={t} />}
    </div>
  );
}

function ManualDepositModal({ onClose, onSuccess, t }: any) {
  const [userId, setUserId] = useState('');
  const [coin, setCoin] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [coins, setCoins] = useState<any[]>([]);

  useEffect(() => {
    api.get('/admin/coins').then(r => setCoins(r.data.filter((c: any) => c.is_active))).catch(() => {});
  }, []);

  const submit = async () => {
    if (!userId.trim() || !amount || Number(amount) <= 0) {
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
      });
      showToast('success', t('admin.manualDepositDone'), `+${res.data.amount} ${coin}`);
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
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">User ID</label>
            <input type="text" value={userId} onChange={e => setUserId(e.target.value)} className="input-field text-xs font-mono" placeholder="c12951f6-..." />
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
function CoinsTab({ t }: any) {
  const [list, setList] = useState<any[]>([]);
  const [editing, setEditing] = useState<Record<string, any>>({});

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
                  {beingEdited ? (
                    <div className="flex justify-end gap-1">
                      <button onClick={() => savePrice(c)} className="text-[11px] px-2 py-1 rounded bg-exchange-buy/15 text-exchange-buy">{t('common.save')}</button>
                      <button onClick={() => setEditing(prev => { const n = { ...prev }; delete n[c.symbol]; return n; })} className="text-[11px] px-2 py-1 rounded bg-exchange-hover text-exchange-text-third">{t('common.cancel')}</button>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
    return <div className="p-8 text-center text-exchange-text-third">{loading ? t('common.loading') : '—'}</div>;
  }

  const StatusPill = ({ ok, label }: { ok: boolean; label?: string }) => (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
      ok ? 'bg-exchange-buy/15 text-exchange-buy' : 'bg-exchange-sell/15 text-exchange-sell'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-exchange-buy' : 'bg-exchange-sell'}`} />
      {label || (ok ? 'OK' : 'FAIL')}
    </span>
  );

  return (
    <div className="space-y-4">
      {/* Top status banner */}
      <div className={`rounded-xl border p-4 flex items-center justify-between ${
        health.status === 'ok'
          ? 'bg-exchange-buy/5 border-exchange-buy/30'
          : 'bg-exchange-sell/5 border-exchange-sell/30'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            health.status === 'ok' ? 'bg-exchange-buy/15' : 'bg-exchange-sell/15'
          }`}>
            <Server size={20} className={health.status === 'ok' ? 'text-exchange-buy' : 'text-exchange-sell'} />
          </div>
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide">
              {health.status === 'ok' ? t('admin.systemHealthy') : t('admin.systemDegraded')}
            </div>
            <div className="text-[11px] text-exchange-text-third">
              {t('admin.checkedAt')}: {timeAgo(health.checked_at)}
            </div>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 text-exchange-text-third hover:text-exchange-text rounded-lg hover:bg-exchange-hover/50 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* DB + Backup row */}
      <div className="grid md:grid-cols-3 gap-3">
        <div className="bg-exchange-card border border-exchange-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database size={14} className="text-exchange-yellow" />
            <span className="text-xs font-semibold">{t('admin.database')}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-exchange-text-third">{t('admin.dbPing')}</span>
            <StatusPill ok={!!health.db?.ok} />
          </div>
          {typeof health.db?.latency_ms === 'number' && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-exchange-text-third">{t('admin.dbLatency')}</span>
              <span className="text-xs font-mono tabular-nums">{health.db.latency_ms} ms</span>
            </div>
          )}
        </div>

        <div className="bg-exchange-card border border-exchange-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive size={14} className="text-exchange-yellow" />
            <span className="text-xs font-semibold">{t('admin.lastBackup')}</span>
          </div>
          <div className="text-sm font-mono tabular-nums">
            {health.last_backup_at ? timeAgo(health.last_backup_at) : '—'}
          </div>
          <div className="text-[10px] text-exchange-text-third mt-1">
            {t('admin.backupHint')}
          </div>
        </div>

        <div className="bg-exchange-card border border-exchange-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={14} className="text-exchange-yellow" />
            <span className="text-xs font-semibold">{t('admin.last24h')}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              { k: 'orders', label: t('admin.tradesOrders') },
              { k: 'trades', label: t('admin.tradesTab') },
              { k: 'new_users', label: t('admin.newUsers') },
            ].map((m) => (
              <div key={m.k} className="text-center">
                <div className="text-base font-bold tabular-nums">
                  {Number(health.last24h?.[m.k] || 0).toLocaleString()}
                </div>
                <div className="text-[9px] text-exchange-text-third truncate">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Migrations / table presence */}
      <div className="bg-exchange-card border border-exchange-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={14} className="text-exchange-yellow" />
          <span className="text-xs font-semibold">{t('admin.migrations')}</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-2 text-xs">
          {Object.entries(health.tables || {}).map(([name, v]: [string, any]) => (
            <div key={name} className="flex items-center justify-between bg-exchange-input/40 rounded-lg px-3 py-2">
              <code className="text-exchange-text-secondary">{name}</code>
              <div className="flex items-center gap-2">
                {v.ok && <span className="text-[10px] text-exchange-text-third tabular-nums">{Number(v.rows).toLocaleString()} rows</span>}
                <StatusPill ok={!!v.ok} label={v.ok ? 'OK' : 'MISSING'} />
              </div>
            </div>
          ))}
          {Object.entries(health.orders_columns || {}).map(([col, ok]: [string, any]) => (
            <div key={col} className="flex items-center justify-between bg-exchange-input/40 rounded-lg px-3 py-2">
              <code className="text-exchange-text-secondary">orders.{col}</code>
              <StatusPill ok={!!ok} label={ok ? 'OK' : 'MIGRATE'} />
            </div>
          ))}
        </div>
      </div>

      {/* Audit + Fee summary cards */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-exchange-card border border-exchange-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-exchange-yellow" />
              <span className="text-xs font-semibold">{t('admin.auditSummary')}</span>
            </div>
            <span className="text-[10px] text-exchange-text-third">{t('admin.last7d')}</span>
          </div>
          {auditStats?.error ? (
            <div className="text-xs text-exchange-sell">{auditStats.error}</div>
          ) : auditStats ? (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center">
                  <div className="text-base font-bold tabular-nums">{Number(auditStats.last24h || 0).toLocaleString()}</div>
                  <div className="text-[9px] text-exchange-text-third">{t('admin.last24h')}</div>
                </div>
                <div className="text-center">
                  <div className="text-base font-bold tabular-nums">{Number(auditStats.last7d || 0).toLocaleString()}</div>
                  <div className="text-[9px] text-exchange-text-third">{t('admin.last7d')}</div>
                </div>
                <div className="text-center">
                  <div className="text-base font-bold tabular-nums">{Number(auditStats.total || 0).toLocaleString()}</div>
                  <div className="text-[9px] text-exchange-text-third">{t('admin.total')}</div>
                </div>
              </div>
              <div className="space-y-1">
                {(auditStats.byAction || []).slice(0, 5).map((a: any) => (
                  <div key={a.action} className="flex justify-between text-[11px]">
                    <code className="text-exchange-text-secondary">{a.action}</code>
                    <span className="font-mono tabular-nums text-exchange-text">{Number(a.n).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="text-xs text-exchange-text-third">—</div>}
        </div>

        <div className="bg-exchange-card border border-exchange-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Receipt size={14} className="text-exchange-yellow" />
              <span className="text-xs font-semibold">{t('admin.feeRevenue')}</span>
            </div>
            <span className="text-[10px] text-exchange-text-third">USD</span>
          </div>
          {feeStats?.error ? (
            <div className="text-xs text-exchange-sell">{feeStats.error}</div>
          ) : feeStats ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="text-center">
                  <div className="text-base font-bold tabular-nums text-exchange-buy">
                    ${Number(feeStats.last24h?.usd || 0).toFixed(2)}
                  </div>
                  <div className="text-[9px] text-exchange-text-third">{t('admin.last24h')}</div>
                </div>
                <div className="text-center">
                  <div className="text-base font-bold tabular-nums text-exchange-buy">
                    ${Number(feeStats.last7d?.usd || 0).toFixed(2)}
                  </div>
                  <div className="text-[9px] text-exchange-text-third">{t('admin.last7d')}</div>
                </div>
              </div>
              <div className="space-y-1">
                {(feeStats.byCoin || []).slice(0, 5).map((c: any) => (
                  <div key={c.coin} className="flex justify-between text-[11px]">
                    <span className="text-exchange-text-secondary">{c.coin}</span>
                    <span className="font-mono tabular-nums text-exchange-text">
                      ${Number(c.total_usd || 0).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="text-xs text-exchange-text-third">—</div>}
        </div>
      </div>
    </div>
  );
}
