import { useEffect, useState, Fragment } from 'react';
import {
  Users, BarChart3, ShieldCheck, ArrowUpFromLine, RefreshCw, Activity,
  DollarSign, TrendingUp, Search, Filter, ChevronLeft, ChevronRight,
  Ban, UserCheck, Crown, KeyRound, X, CheckCircle2, XCircle, Clock,
  Coins, Send, ArrowDownToLine, Megaphone, Wallet, Hash, Bell,
  FileText, Receipt, Server, Database, HardDrive,
  Shield, AlertTriangle, Zap, Plus, Trash2,
  Repeat, ArrowRightLeft, Pause, Play,
} from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { formatPrice, timeAgo } from '../utils/format';
import { showToast } from '../components/common/Toast';
import CoinIcon from '../components/common/CoinIcon';
import AdminLayout, { type AdminTab } from '../components/layout/AdminLayout';

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

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/external-trading-api/stats');
      setData(res.data);
    } catch (e: any) {
      showToast('error', t('admin.extTradingApi'), e?.response?.data?.error || 'Failed');
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

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
        </div>
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
