import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';
import CoinIcon from '../components/common/CoinIcon';
import {
  DollarSign, ChevronLeft, Plus, Trash2, TrendingUp, TrendingDown,
  Bell, BellOff, Clock, CheckCircle2, X, AlertCircle,
} from 'lucide-react';

interface PriceAlert {
  id: string;
  user_id: string;
  symbol: string;
  quote_coin: string;
  direction: 'above' | 'below';
  target_price: number;
  base_price: number | null;
  is_active: number;
  triggered_at: string | null;
  note: string | null;
  created_at: string;
  current_price?: number;
}

export default function PriceAlertsPage() {
  const { t } = useI18n();
  const { user, markets, tickers } = useStore() as any;

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Create form
  const [symbol, setSymbol] = useState('BTC');
  const [direction, setDirection] = useState<'above' | 'below'>('above');
  const [targetPrice, setTargetPrice] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Unique base coins from USDT markets
  const coinList = Array.from(new Set(
    (markets as any[]).filter((m: any) => m.quote_coin === 'USDT').map((m: any) => m.base_coin)
  )) as string[];

  const currentPrice = (() => {
    const sym = `${symbol}USDT`;
    const tk = tickers[sym];
    if (tk?.last) return tk.last;
    const m = (markets as any[]).find((mk: any) => mk.base_coin === symbol && mk.quote_coin === 'USDT');
    return m?.base_price ?? null;
  })();

  const fetchAlerts = async () => {
    try {
      const res = await api.get('/price-alerts');
      setAlerts(res.data);
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || t('priceAlert.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchAlerts();
    const iv = setInterval(fetchAlerts, 15000); // poll for triggered alerts
    return () => clearInterval(iv);
  }, [user]);

  // Default target = current price
  useEffect(() => {
    if (currentPrice && !targetPrice) {
      setTargetPrice(currentPrice.toFixed(currentPrice > 1 ? 2 : 6));
    }
  }, [symbol, showCreate]);

  const handleCreate = async () => {
    const t_ = Number(targetPrice);
    if (!t_ || t_ <= 0) {
      showToast('warning', t('priceAlert.invalid'), t('priceAlert.invalidTarget'));
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/price-alerts', {
        symbol,
        direction,
        target_price: t_,
        note: note.trim() || undefined,
      });
      showToast('success', t('priceAlert.created'), t('priceAlert.createdDesc'));
      setShowCreate(false);
      setNote('');
      setTargetPrice('');
      fetchAlerts();
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || t('priceAlert.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/price-alerts/${id}`);
      setAlerts(prev => prev.filter(a => a.id !== id));
      showToast('info', t('priceAlert.deleted'), '');
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || t('common.error'));
    }
  };

  const handleToggle = async (id: string) => {
    try {
      const res = await api.post(`/price-alerts/${id}/toggle`);
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, ...res.data } : a));
    } catch (e: any) {
      showToast('error', t('common.error'), e.response?.data?.error || t('common.error'));
    }
  };

  if (!user) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <DollarSign size={48} className="text-exchange-text-third mb-4" />
        <p className="text-exchange-text-secondary mb-4">{t('wallet.loginRequired')}</p>
        <Link to="/login" className="btn-primary px-6 py-2 rounded-lg">{t('nav.login')}</Link>
      </div>
    );
  }

  const activeAlerts = alerts.filter(a => a.is_active === 1);
  const triggeredAlerts = alerts.filter(a => a.is_active === 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Back */}
      <Link to="/profile" className="inline-flex items-center gap-1 text-sm text-exchange-text-third hover:text-exchange-text mb-4">
        <ChevronLeft size={16} /> {t('common.back')}
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center">
            <DollarSign size={20} className="text-purple-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-exchange-text">{t('priceAlert.title')}</h1>
            <p className="text-xs text-exchange-text-secondary">
              {t('priceAlert.active', { count: String(activeAlerts.length) })}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary flex items-center gap-1.5 !py-2 !px-4 text-sm"
        >
          <Plus size={16} /> {t('priceAlert.create')}
        </button>
      </div>

      {/* Info */}
      <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-purple-500/5 border border-purple-400/20 rounded-lg">
        <AlertCircle size={14} className="text-purple-400 mt-0.5 shrink-0" />
        <p className="text-[11px] text-exchange-text-secondary leading-relaxed">
          {t('priceAlert.howItWorks')}
        </p>
      </div>

      {loading ? (
        <div className="py-16 text-center text-exchange-text-third text-sm">{t('common.loading')}</div>
      ) : alerts.length === 0 ? (
        <div className="bg-exchange-card rounded-xl border border-exchange-border py-16 text-center">
          <DollarSign size={40} className="mx-auto text-exchange-text-third mb-3 opacity-40" />
          <p className="text-exchange-text-secondary text-sm mb-1">{t('priceAlert.empty')}</p>
          <p className="text-[11px] text-exchange-text-third">{t('priceAlert.emptyDesc')}</p>
        </div>
      ) : (
        <>
          {/* Active alerts */}
          {activeAlerts.length > 0 && (
            <div className="bg-exchange-card rounded-xl border border-exchange-border overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-exchange-border/50 flex items-center gap-2">
                <Bell size={14} className="text-exchange-yellow" />
                <h2 className="text-sm font-semibold text-exchange-text">{t('priceAlert.armed')}</h2>
                <span className="text-[10px] text-exchange-text-third">({activeAlerts.length})</span>
              </div>
              {activeAlerts.map(a => <AlertRow key={a.id} alert={a} onDelete={handleDelete} onToggle={handleToggle} t={t} />)}
            </div>
          )}

          {/* Triggered alerts */}
          {triggeredAlerts.length > 0 && (
            <div className="bg-exchange-card rounded-xl border border-exchange-border overflow-hidden">
              <div className="px-4 py-3 border-b border-exchange-border/50 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-exchange-buy" />
                <h2 className="text-sm font-semibold text-exchange-text">{t('priceAlert.triggered')}</h2>
                <span className="text-[10px] text-exchange-text-third">({triggeredAlerts.length})</span>
              </div>
              {triggeredAlerts.map(a => <AlertRow key={a.id} alert={a} onDelete={handleDelete} onToggle={handleToggle} t={t} />)}
            </div>
          )}
        </>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-exchange-card rounded-xl border border-exchange-border w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <DollarSign size={18} className="text-purple-400" />
                <h3 className="text-lg font-semibold text-exchange-text">{t('priceAlert.create')}</h3>
              </div>
              <button onClick={() => setShowCreate(false)} className="text-exchange-text-third hover:text-exchange-text">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              {/* Symbol */}
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">{t('priceAlert.symbol')}</label>
                <select
                  value={symbol}
                  onChange={e => setSymbol(e.target.value)}
                  className="input-field text-sm w-full"
                >
                  {coinList.map(c => <option key={c} value={c}>{c} / USDT</option>)}
                </select>
                {currentPrice != null && (
                  <p className="text-[11px] text-exchange-text-third mt-1">
                    {t('priceAlert.currentPrice')}: <span className="text-exchange-text tabular-nums">{currentPrice.toFixed(currentPrice > 1 ? 2 : 6)}</span> USDT
                  </p>
                )}
              </div>

              {/* Direction */}
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">{t('priceAlert.direction')}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDirection('above')}
                    className={`flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border text-sm transition-colors ${
                      direction === 'above'
                        ? 'bg-exchange-buy/10 border-exchange-buy/40 text-exchange-buy'
                        : 'bg-exchange-hover/30 border-exchange-border text-exchange-text-secondary'
                    }`}
                  >
                    <TrendingUp size={15} /> {t('priceAlert.above')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection('below')}
                    className={`flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border text-sm transition-colors ${
                      direction === 'below'
                        ? 'bg-exchange-sell/10 border-exchange-sell/40 text-exchange-sell'
                        : 'bg-exchange-hover/30 border-exchange-border text-exchange-text-secondary'
                    }`}
                  >
                    <TrendingDown size={15} /> {t('priceAlert.below')}
                  </button>
                </div>
              </div>

              {/* Target price */}
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">{t('priceAlert.targetPrice')} (USDT)</label>
                <input
                  type="number"
                  step="any"
                  value={targetPrice}
                  onChange={e => setTargetPrice(e.target.value)}
                  className="input-field text-sm tabular-nums"
                  placeholder="0.00"
                />
              </div>

              {/* Note */}
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">{t('priceAlert.note')}</label>
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  className="input-field text-sm"
                  placeholder={t('priceAlert.notePlaceholder')}
                  maxLength={120}
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm text-exchange-text-secondary border border-exchange-border hover:bg-exchange-hover transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting}
                className="flex-1 btn-primary text-sm !py-2.5 disabled:opacity-50"
              >
                {submitting ? t('wallet.processing') : t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertRow({
  alert, onDelete, onToggle, t,
}: {
  alert: PriceAlert;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  t: (k: string, v?: any) => string;
}) {
  const dirIcon = alert.direction === 'above'
    ? <TrendingUp size={14} className="text-exchange-buy" />
    : <TrendingDown size={14} className="text-exchange-sell" />;
  const dirColor = alert.direction === 'above' ? 'text-exchange-buy' : 'text-exchange-sell';
  const current = alert.current_price;
  const isActive = alert.is_active === 1;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-exchange-border/30 last:border-b-0 hover:bg-exchange-hover/20 transition-colors">
      <CoinIcon symbol={alert.symbol} size={28} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-exchange-text">{alert.symbol}/{alert.quote_coin}</span>
          <span className={`inline-flex items-center gap-1 text-xs ${dirColor}`}>
            {dirIcon}
            {alert.direction === 'above' ? t('priceAlert.above') : t('priceAlert.below')}
            <span className="tabular-nums font-semibold">{alert.target_price}</span>
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {current != null && (
            <span className="text-[11px] text-exchange-text-third tabular-nums">
              {t('priceAlert.currentPrice')}: {current.toFixed(current > 1 ? 2 : 6)}
            </span>
          )}
          {alert.triggered_at && (
            <span className="inline-flex items-center gap-1 text-[11px] text-exchange-buy">
              <Clock size={10} /> {t('priceAlert.triggeredAt')}: {new Date(alert.triggered_at).toLocaleString()}
            </span>
          )}
          {alert.note && (
            <span className="text-[11px] text-exchange-text-secondary truncate">"{alert.note}"</span>
          )}
        </div>
      </div>
      <button
        onClick={() => onToggle(alert.id)}
        className="text-exchange-text-third hover:text-exchange-yellow p-1.5 rounded-md hover:bg-exchange-hover/50"
        title={isActive ? t('priceAlert.disarm') : t('priceAlert.rearm')}
      >
        {isActive ? <Bell size={14} /> : <BellOff size={14} />}
      </button>
      <button
        onClick={() => onDelete(alert.id)}
        className="text-exchange-text-third hover:text-exchange-sell p-1.5 rounded-md hover:bg-exchange-hover/50"
        title={t('common.delete')}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
