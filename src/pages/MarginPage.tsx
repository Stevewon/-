/**
 * Sprint 4 Phase H1-B — User Margin page.
 * ----------------------------------------------------------------------------
 * Wires the authenticated margin endpoints from Phase H1-A:
 *   GET  /api/margin/accounts  -> per-asset balances + margin level
 *   GET  /api/margin/loans     -> active loan ledger
 *   POST /api/margin/borrow    -> borrow (TOTP required when risk_force_2fa=on)
 *   POST /api/margin/repay     -> repay loan (full or partial)
 *
 * The "Force 2FA" admin policy from Phase F is auto-detected via the
 * GET /api/risk/state endpoint when the user is logged in. If the user is
 * an admin we already see the marker; otherwise we just always show the
 * 2FA input field but only require it when the borrow API returns 403
 * with code TOTP_REQUIRED.
 */

import { useEffect, useMemo, useState } from 'react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';
import {
  Wallet, ShieldAlert, AlertTriangle, RefreshCw, Plus, Minus,
} from 'lucide-react';

interface MarginAccount {
  id: string;
  asset: string;
  balance: string;
  borrowed: string;
  interest_accrued: string;
  margin_level: string;
  status: 'active' | 'margin_call' | 'liquidating';
  created_at: string;
  updated_at: string;
}

interface MarginLoan {
  id: string;
  asset: string;
  principal: string;
  interest_rate_bps: number;
  accrued_interest: string;
  status: string;
  borrowed_at: string;
  repaid_at: string | null;
}

const ASSETS = ['USDT', 'USDC', 'BTC', 'ETH', 'QTA'];

export default function MarginPage() {
  const { t } = useI18n();
  const { user } = useStore();

  const [accounts, setAccounts] = useState<MarginAccount[]>([]);
  const [loans, setLoans] = useState<MarginLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [force2fa, setForce2fa] = useState(false);

  // Borrow form
  const [borrowAsset, setBorrowAsset] = useState('USDT');
  const [borrowAmount, setBorrowAmount] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loadAll() {
    if (!user) {
      setAccounts([]);
      setLoans([]);
      setLoading(false);
      return;
    }
    try {
      const [a, l] = await Promise.all([
        api.get('/margin/accounts'),
        api.get('/margin/loans', { params: { status: 'active' } }),
      ]);
      setAccounts(a?.data?.accounts || []);
      setLoans(l?.data?.loans || []);
    } catch {
      /* ignore */
    }
    // Best-effort policy probe — endpoint requires admin so it 401s for users.
    try {
      const r = await api.get('/risk/state');
      setForce2fa(!!r?.data?.force_2fa?.enabled);
    } catch {
      /* not admin — leave force2fa as detected by borrow attempt */
    }
    // Margin pause — we don't have a public state endpoint, leave to API errors
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 15_000);
    return () => clearInterval(id);
  }, [user]);

  async function handleBorrow() {
    if (!user) { showToast('error', 'Login required'); return; }
    const amt = Number(borrowAmount);
    if (!isFinite(amt) || amt <= 0) {
      showToast('error', 'amount required');
      return;
    }
    setSubmitting(true);
    try {
      const body: any = { asset: borrowAsset, amount: borrowAmount };
      if (totpCode) body.totp_code = totpCode;
      await api.post('/margin/borrow', body);
      showToast('success', 'OK');
      setBorrowAmount('');
      setTotpCode('');
      loadAll();
    } catch (err: any) {
      const status = err?.response?.status;
      const code = err?.response?.data?.code;
      const msg = err?.response?.data?.error || 'Failed';
      if (status === 503) {
        setPaused(true);
        showToast('error', t('admin.marginPaused') || 'Paused');
      } else if (code === 'TOTP_REQUIRED' || code === 'TOTP_NOT_SET') {
        setForce2fa(true);
        showToast('error', t('margin.totpRequired') || msg);
      } else {
        showToast('error', msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRepay(loan: MarginLoan) {
    const amt = window.prompt(
      `${t('margin.repay') || 'Repay'} ${loan.asset} (principal ${loan.principal})`,
      loan.principal
    );
    if (!amt) return;
    try {
      await api.post('/margin/repay', { loan_id: loan.id, amount: amt });
      showToast('success', 'OK');
      loadAll();
    } catch (err: any) {
      showToast('error', err?.response?.data?.error || 'Failed');
    }
  }

  const totalBorrowed = useMemo(
    () => accounts.reduce((s, a) => s + Number(a.borrowed || 0), 0),
    [accounts]
  );
  const lowestLevel = useMemo(() => {
    if (!accounts.length) return null;
    const lvls = accounts
      .map((a) => Number(a.margin_level))
      .filter((v) => isFinite(v) && v > 0);
    return lvls.length ? Math.min(...lvls) : null;
  }, [accounts]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wallet className="w-6 h-6 text-exchange-yellow" />
          <h1 className="text-xl font-bold">{t('margin.title') || 'Margin'}</h1>
        </div>
        <button
          onClick={loadAll}
          className="p-2 rounded-lg bg-exchange-card border border-exchange-border text-exchange-text-second hover:text-exchange-text"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {paused && (
        <div className="rounded-xl border border-exchange-sell/40 bg-exchange-sell/10 p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-exchange-sell" />
          <span className="text-sm text-exchange-sell">
            {t('admin.marginPaused') || 'Margin trading is paused'}
          </span>
        </div>
      )}

      {force2fa && (
        <div className="rounded-xl border border-exchange-yellow/40 bg-exchange-yellow/10 p-3 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-exchange-yellow" />
          <span className="text-sm text-exchange-yellow">
            {t('margin.totpRequired') || 'Admin policy requires 2FA on margin borrow.'}
          </span>
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label={t('margin.myAccounts') || 'Accounts'} value={String(accounts.length)} />
        <KPI label={t('admin.borrowed') || 'Borrowed'} value={totalBorrowed.toFixed(4)} />
        <KPI label={t('margin.myLoans') || 'Active loans'} value={String(loans.length)} />
        <KPI
          label={t('admin.marginLevel') || 'Lowest level'}
          value={lowestLevel === null ? '—' : lowestLevel.toFixed(2)}
          tone={
            lowestLevel === null
              ? 'neutral'
              : lowestLevel > 1.5
              ? 'good'
              : lowestLevel > 1.2
              ? 'warn'
              : 'bad'
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Borrow form */}
        <div className="lg:col-span-1 rounded-xl border border-exchange-border bg-exchange-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-exchange-buy" />
            <h2 className="text-sm font-bold">{t('margin.borrow') || 'Borrow'}</h2>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-exchange-text-third">
              {t('margin.asset') || 'Asset'}
            </label>
            <select
              value={borrowAsset}
              onChange={(e) => setBorrowAsset(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm font-mono"
            >
              {ASSETS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-exchange-text-third">
              {t('margin.amount') || 'Amount'}
            </label>
            <input
              type="number"
              step="any"
              value={borrowAmount}
              onChange={(e) => setBorrowAmount(e.target.value)}
              placeholder="0.00"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm font-mono"
            />
          </div>
          {force2fa && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-exchange-text-third">
                {t('margin.totp') || '2FA code'}
              </label>
              <input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                maxLength={6}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm font-mono tracking-widest text-center"
              />
            </div>
          )}
          <button
            disabled={submitting}
            onClick={handleBorrow}
            className="w-full py-2.5 rounded-lg text-sm font-bold bg-exchange-buy text-white disabled:opacity-50"
          >
            {submitting ? '…' : t('margin.borrow') || 'Borrow'}
          </button>
        </div>

        {/* Accounts table */}
        <div className="lg:col-span-2 rounded-xl border border-exchange-border bg-exchange-card overflow-x-auto">
          <div className="px-5 pt-4 flex items-center justify-between">
            <h2 className="text-sm font-bold">{t('margin.myAccounts') || 'My margin accounts'}</h2>
            <span className="text-[11px] text-exchange-text-third">{accounts.length}</span>
          </div>
          <table className="w-full text-xs mt-3">
            <thead className="text-[10px] uppercase tracking-wider text-exchange-text-third">
              <tr>
                <th className="text-left px-4 py-2">{t('margin.asset') || 'Asset'}</th>
                <th className="text-right px-4 py-2">Balance</th>
                <th className="text-right px-4 py-2">{t('admin.borrowed') || 'Borrowed'}</th>
                <th className="text-right px-4 py-2">{t('admin.interestAccrued') || 'Interest'}</th>
                <th className="text-right px-4 py-2">{t('admin.marginLevel') || 'Level'}</th>
                <th className="text-left px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="text-center py-8 text-exchange-text-third">…</td></tr>
              )}
              {!loading && accounts.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-exchange-text-third">
                    {t('margin.noAccounts') || 'No margin accounts.'}
                  </td>
                </tr>
              )}
              {accounts.map((a) => {
                const lvl = Number(a.margin_level);
                const lvlColor =
                  !isFinite(lvl) || lvl <= 0
                    ? 'text-exchange-text-third'
                    : lvl > 1.5
                    ? 'text-exchange-buy'
                    : lvl > 1.2
                    ? 'text-exchange-yellow'
                    : 'text-exchange-sell';
                return (
                  <tr key={a.id} className="border-t border-exchange-border">
                    <td className="px-4 py-2 font-mono">{a.asset}</td>
                    <td className="px-4 py-2 text-right font-mono">{a.balance}</td>
                    <td className="px-4 py-2 text-right font-mono">{a.borrowed}</td>
                    <td className="px-4 py-2 text-right font-mono">{a.interest_accrued}</td>
                    <td className={`px-4 py-2 text-right font-mono font-bold ${lvlColor}`}>
                      {a.margin_level}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        a.status === 'active'
                          ? 'bg-exchange-buy/15 text-exchange-buy'
                          : a.status === 'margin_call'
                          ? 'bg-exchange-yellow/15 text-exchange-yellow'
                          : 'bg-exchange-sell/15 text-exchange-sell'
                      }`}>
                        {a.status === 'active'
                          ? t('admin.statusActive') || 'Active'
                          : a.status === 'margin_call'
                          ? t('admin.statusMarginCall') || 'Margin call'
                          : t('admin.statusLiquidating') || 'Liquidating'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active loans */}
      <div className="rounded-xl border border-exchange-border bg-exchange-card overflow-x-auto">
        <div className="px-5 pt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Minus className="w-4 h-4 text-exchange-sell" />
            <h2 className="text-sm font-bold">{t('margin.myLoans') || 'My loans'}</h2>
          </div>
          <span className="text-[11px] text-exchange-text-third">{loans.length}</span>
        </div>
        <table className="w-full text-xs mt-3">
          <thead className="text-[10px] uppercase tracking-wider text-exchange-text-third">
            <tr>
              <th className="text-left px-4 py-2">{t('margin.asset') || 'Asset'}</th>
              <th className="text-right px-4 py-2">{t('margin.principal') || 'Principal'}</th>
              <th className="text-right px-4 py-2">{t('margin.interestRate') || 'Rate'}</th>
              <th className="text-right px-4 py-2">{t('admin.interestAccrued') || 'Accrued'}</th>
              <th className="text-left px-4 py-2">{t('margin.borrowedAt') || 'Borrowed'}</th>
              <th className="text-right px-4 py-2">{t('admin.actions') || 'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {!loading && loans.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-exchange-text-third">
                  {t('margin.noLoans') || 'No loans yet.'}
                </td>
              </tr>
            )}
            {loans.map((l) => (
              <tr key={l.id} className="border-t border-exchange-border">
                <td className="px-4 py-2 font-mono">{l.asset}</td>
                <td className="px-4 py-2 text-right font-mono">{l.principal}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {(l.interest_rate_bps / 100).toFixed(2)}%
                </td>
                <td className="px-4 py-2 text-right font-mono">{l.accrued_interest}</td>
                <td className="px-4 py-2 text-exchange-text-third">{l.borrowed_at}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleRepay(l)}
                    className="px-2 py-1 rounded-md text-[10px] font-semibold bg-exchange-yellow/15 text-exchange-yellow"
                  >
                    {t('margin.repay') || 'Repay'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KPI({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const color =
    tone === 'good' ? 'text-exchange-buy' :
    tone === 'warn' ? 'text-exchange-yellow' :
    tone === 'bad' ? 'text-exchange-sell' :
    'text-exchange-text';
  return (
    <div className="rounded-xl border border-exchange-border bg-exchange-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-exchange-text-third">{label}</div>
      <div className={`mt-1 text-base font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}
