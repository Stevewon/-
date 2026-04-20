import { useEffect, useState } from 'react';
import { Users, BarChart3, ShieldCheck, ArrowUpFromLine, RefreshCw, Activity } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { formatPrice, timeAgo } from '../utils/format';

export default function AdminPage() {
  const { user } = useStore();
  const { t } = useI18n();
  const [stats, setStats] = useState<any>({});
  const [tab, setTab] = useState<'overview' | 'users' | 'kyc' | 'withdrawals'>('overview');
  const [users, setUsers] = useState<any[]>([]);
  const [kycList, setKycList] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);

  useEffect(() => { loadStats(); }, []);
  useEffect(() => {
    if (tab === 'users') loadUsers();
    if (tab === 'kyc') loadKyc();
    if (tab === 'withdrawals') loadWithdrawals();
  }, [tab]);

  const loadStats = async () => { try { const r = await api.get('/admin/stats'); setStats(r.data); } catch (e) {} };
  const loadUsers = async () => { try { const r = await api.get('/admin/users'); setUsers(r.data); } catch (e) {} };
  const loadKyc = async () => { try { const r = await api.get('/admin/kyc/pending'); setKycList(r.data); } catch (e) {} };
  const loadWithdrawals = async () => { try { const r = await api.get('/admin/withdrawals'); setWithdrawals(r.data); } catch (e) {} };

  const handleKyc = async (userId: string, action: 'approve' | 'reject') => {
    await api.post(`/admin/kyc/${userId}/${action}`);
    loadKyc(); loadStats();
  };

  const handleWithdrawal = async (id: string, action: 'approve' | 'reject') => {
    await api.post(`/admin/withdrawals/${id}/${action}`);
    loadWithdrawals(); loadStats();
  };

  if (user?.role !== 'admin') return <div className="p-8 text-center text-exchange-sell">{t('admin.accessDenied')}</div>;

  const statCards = [
    { label: t('admin.totalUsers'), value: stats.users || 0, icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: t('admin.totalTrades'), value: stats.trades || 0, icon: BarChart3, color: 'text-exchange-buy', bg: 'bg-exchange-buy/10' },
    { label: t('admin.pendingKyc'), value: stats.pendingKyc || 0, icon: ShieldCheck, color: 'text-exchange-yellow', bg: 'bg-exchange-yellow/10' },
    { label: t('admin.pendingWithdrawals'), value: stats.pendingWithdrawals || 0, icon: ArrowUpFromLine, color: 'text-exchange-sell', bg: 'bg-exchange-sell/10' },
  ];

  const tabs = [
    { key: 'overview', label: t('admin.overview') },
    { key: 'users', label: t('admin.users') },
    { key: 'kyc', label: `${t('admin.kyc')} (${stats.pendingKyc || 0})` },
    { key: 'withdrawals', label: `${t('admin.withdrawals')} (${stats.pendingWithdrawals || 0})` },
  ] as const;

  const statusLabel = (status: string) => t(`status.${status}` as any) || status;
  const statusColor = (status: string) => {
    if (status === 'approved' || status === 'completed') return 'bg-exchange-buy/15 text-exchange-buy';
    if (status === 'pending') return 'bg-exchange-yellow/15 text-exchange-yellow';
    if (status === 'rejected') return 'bg-exchange-sell/15 text-exchange-sell';
    return 'bg-exchange-input text-exchange-text-third';
  };

  return (
    <div className="max-w-6xl mx-auto p-4 pb-20">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity size={22} className="text-exchange-yellow" />
          <h1 className="text-2xl font-bold">{t('admin.dashboard')}</h1>
        </div>
        <button onClick={() => { loadStats(); }} className="p-2 text-exchange-text-third hover:text-exchange-text rounded-lg hover:bg-exchange-hover/50 transition-colors">
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === key ? 'bg-exchange-yellow text-black' : 'bg-exchange-card text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {statCards.map(({ label, value, icon: Icon, color, bg }) => (
              <div key={label} className="card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
                    <Icon size={16} className={color} />
                  </div>
                  <span className="text-xs text-exchange-text-third">{label}</span>
                </div>
                <div className="text-2xl font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</div>
              </div>
            ))}
          </div>
          <div className="card p-6">
            <h3 className="font-semibold mb-2 text-exchange-text-secondary text-sm">{t('admin.totalVolume')}</h3>
            <div className="text-3xl font-bold text-exchange-yellow tabular-nums">${formatPrice(stats.totalVolume || 0)}</div>
          </div>
        </>
      )}

      {/* Users */}
      {tab === 'users' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-exchange-text-third border-b border-exchange-border">
                <th className="text-left px-4 py-3">{t('admin.email')}</th>
                <th className="text-left px-4 py-3">{t('admin.nickname')}</th>
                <th className="text-left px-4 py-3">{t('admin.role')}</th>
                <th className="text-left px-4 py-3">{t('admin.kycStatus')}</th>
                <th className="text-left px-4 py-3">{t('admin.joined')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30">
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{u.nickname}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${u.role === 'admin' ? 'bg-exchange-yellow/20 text-exchange-yellow' : 'bg-exchange-input text-exchange-text-secondary'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusColor(u.kyc_status)}`}>
                      {statusLabel(u.kyc_status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-exchange-text-third text-xs">{timeAgo(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* KYC */}
      {tab === 'kyc' && (
        <div className="space-y-3">
          {kycList.length === 0 ? (
            <div className="card p-8 text-center text-exchange-text-third">{t('admin.noKyc')}</div>
          ) : kycList.map((k) => (
            <div key={k.id} className="card p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{k.kyc_name}</div>
                <div className="text-xs text-exchange-text-secondary">{k.email} | {k.kyc_phone}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleKyc(k.id, 'approve')} className="btn-buy text-xs !py-1.5 rounded-lg">{t('admin.approve')}</button>
                <button onClick={() => handleKyc(k.id, 'reject')} className="btn-sell text-xs !py-1.5 rounded-lg">{t('admin.reject')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Withdrawals */}
      {tab === 'withdrawals' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-exchange-text-third border-b border-exchange-border">
                <th className="text-left px-4 py-3">{t('admin.nickname')}</th>
                <th className="text-left px-4 py-3">{t('admin.coin')}</th>
                <th className="text-right px-4 py-3">{t('admin.amount')}</th>
                <th className="text-left px-4 py-3">{t('admin.address')}</th>
                <th className="text-left px-4 py-3">{t('admin.status')}</th>
                <th className="text-right px-4 py-3">{t('market.action')}</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((w) => (
                <tr key={w.id} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30">
                  <td className="px-4 py-3">{w.nickname}</td>
                  <td className="px-4 py-3 font-medium">{w.coin_symbol}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatPrice(w.amount)}</td>
                  <td className="px-4 py-3 text-xs text-exchange-text-secondary font-mono">{w.address?.slice(0, 12)}...</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusColor(w.status)}`}>
                      {statusLabel(w.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {w.status === 'pending' && (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => handleWithdrawal(w.id, 'approve')} className="text-xs px-2.5 py-1 rounded-lg bg-exchange-buy/15 text-exchange-buy hover:bg-exchange-buy/25 transition-colors">{t('admin.approve')}</button>
                        <button onClick={() => handleWithdrawal(w.id, 'reject')} className="text-xs px-2.5 py-1 rounded-lg bg-exchange-sell/15 text-exchange-sell hover:bg-exchange-sell/25 transition-colors">{t('admin.reject')}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
