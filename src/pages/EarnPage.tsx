import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import useStore from '../store/useStore';
import api from '../utils/api';
import DesktopPageLayout from '../components/common/DesktopPageLayout';
import CoinIcon from '../components/common/CoinIcon';
import { showToast } from '../components/common/Toast';
import { formatAmount } from '../utils/format';
import {
  Search, Ticket, LayoutGrid, ChevronRight, PieChart,
  Zap, Link2, Gem, Sparkles, SlidersHorizontal, X, Lock, Loader2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Earn / Staking page — Bybit-style. Products & positions come from the live
// /api/earn backend. Users can Subscribe (stake) and Redeem (unstake).
// QTA staking products are seeded server-side (migration 0043).
// ---------------------------------------------------------------------------

type Filter = 'all' | 'flexible' | 'fixed';

interface Product {
  id: string;
  coin_symbol: string;
  kind: 'flexible' | 'fixed';
  apr: number;             // fraction 0.12 = 12%
  lock_days: number;
  min_amount: number;
  max_amount: number | null;
  coin_name?: string | null;
  price_usd?: number | null;
}

interface Position {
  id: string;
  product_id: string;
  coin_symbol: string;
  kind: string;
  apr: number;
  principal: number;
  accrued_interest: number;
  lock_days: number;
  unlock_at: string | null;
  unlocked?: boolean;
  created_at: string;
}

const CATEGORIES = [
  { key: 'easy', icon: Zap },
  { key: 'onchain', icon: Link2 },
  { key: 'rwa', icon: Gem },
  { key: 'advanced', icon: Sparkles },
];

const pct = (apr: number) => `${(apr * 100).toFixed(2)}%`;

export default function EarnPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user, wallets, fetchWallets } = useStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [subscribeTarget, setSubscribeTarget] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);

  const loadProducts = useCallback(async () => {
    try {
      const res = await api.get('/earn/products');
      setProducts(res.data.products || []);
    } catch {
      /* products endpoint is public; ignore transient errors */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPositions = useCallback(async () => {
    if (!user) { setPositions([]); return; }
    try {
      const res = await api.get('/earn/positions');
      setPositions(res.data.positions || []);
    } catch {
      /* not logged in / transient */
    }
  }, [user]);

  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { loadPositions(); if (user) fetchWallets(); }, [user, loadPositions]);

  const filtered = useMemo(() => products.filter((p) => {
    if (search && !p.coin_symbol.toUpperCase().includes(search.toUpperCase())) return false;
    if (filter === 'flexible') return p.kind === 'flexible';
    if (filter === 'fixed') return p.kind === 'fixed';
    return true;
  }), [products, search, filter]);

  // Group products by coin for the card list.
  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const arr = map.get(p.coin_symbol) || [];
      arr.push(p);
      map.set(p.coin_symbol, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const totalEarnUsd = useMemo(() => positions.reduce((s, p) => {
    const prod = products.find((x) => x.id === p.product_id);
    const price = prod?.price_usd || 0;
    return s + (p.principal + p.accrued_interest) * price;
  }, 0), [positions, products]);

  const handleRedeem = async (p: Position) => {
    if (p.unlock_at && !p.unlocked) {
      showToast('error', t('earn.locked'), t('earn.stillLocked'));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post('/earn/redeem', { position_id: p.id });
      showToast('success', t('earn.redeemed'),
        `+${formatAmount(res.data.credited)} ${p.coin_symbol}`);
      await Promise.all([loadPositions(), fetchWallets(), loadProducts()]);
    } catch (err: any) {
      showToast('error', t('earn.redeemFailed'), err.response?.data?.error || '');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DesktopPageLayout>
      {/* Search bar + header icons */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-exchange-text-third" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('earn.searchPlaceholder')}
            className="input-field pl-10 h-11 w-full rounded-full text-[14px]"
          />
        </div>
        <button className="text-exchange-text-secondary hover:text-exchange-text p-1"><Ticket size={22} /></button>
        <button className="text-exchange-text-secondary hover:text-exchange-text p-1"><LayoutGrid size={22} /></button>
      </div>

      {/* Total Earn Asset row */}
      <div className="flex items-center gap-2 text-[13px] mb-4">
        <span className="text-exchange-text-third">{t('earn.totalEarnAsset')}</span>
        <span className="text-exchange-text font-medium tabular-nums">
          {totalEarnUsd.toFixed(2)} USD
        </span>
      </div>

      {/* Headline QTA banner */}
      <div
        className="flex items-center justify-between rounded-2xl mb-6 overflow-hidden"
        style={{
          padding: '18px 20px',
          background: 'linear-gradient(100deg, #2b2410 0%, #14171A 100%)',
          border: '1px solid rgba(240,185,11,0.25)',
        }}
      >
        <div className="flex items-center gap-4">
          <div className="rounded-full flex items-center justify-center shrink-0"
               style={{ width: 44, height: 44 }}>
            <CoinIcon symbol="QTA" size={44} />
          </div>
          <div>
            <div className="text-[17px] font-bold text-exchange-text">{t('earn.qtaStaking')}</div>
            <div className="text-[12px] text-exchange-text-secondary">{t('earn.qtaStakingSub')}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-exchange-text-third">APR</div>
          <div className="text-[20px] font-bold text-exchange-buy leading-none">
            {pct(Math.max(...products.filter(p => p.coin_symbol === 'QTA').map(p => p.apr), 0.15))}
          </div>
        </div>
      </div>

      {/* Category circles */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {CATEGORIES.map(({ key, icon: Icon }) => (
          <div key={key} className="flex flex-col items-center gap-2.5">
            <div className="rounded-full flex items-center justify-center bg-exchange-card border border-exchange-border"
                 style={{ width: 52, height: 52 }}>
              <Icon size={22} className="text-exchange-text" />
            </div>
            <span className="text-[12px] text-exchange-text-secondary text-center leading-tight">
              {t(`earn.cat.${key}`)}
            </span>
          </div>
        ))}
      </div>

      {/* ---------------- My Positions ---------------- */}
      {user && positions.length > 0 && (
        <div className="mb-6">
          <h2 className="text-[16px] font-bold text-exchange-text mb-3">{t('earn.myPositions')}</h2>
          <div className="space-y-3">
            {positions.map((p) => (
              <div key={p.id} className="bg-exchange-card border border-exchange-border rounded-2xl" style={{ padding: 16 }}>
                <div className="flex items-center gap-2.5 mb-3">
                  <CoinIcon symbol={p.coin_symbol} size={28} />
                  <span className="text-[15px] font-bold text-exchange-text">{p.coin_symbol}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    p.kind === 'fixed' ? 'bg-exchange-yellow/15 text-exchange-yellow' : 'bg-exchange-buy/15 text-exchange-buy'
                  }`}>
                    {p.kind === 'fixed' ? `${p.lock_days}${t('earn.days')}` : t('earn.flexible')}
                  </span>
                  <span className="text-[13px] font-bold text-exchange-buy tabular-nums ml-auto">{pct(p.apr)} APR</span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-[11px] text-exchange-text-third">{t('earn.principal')}</div>
                    <div className="text-[14px] font-medium text-exchange-text tabular-nums">
                      {formatAmount(p.principal)} {p.coin_symbol}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-exchange-text-third">{t('earn.earned')}</div>
                    <div className="text-[14px] font-medium text-exchange-buy tabular-nums">
                      +{formatAmount(p.accrued_interest)} {p.coin_symbol}
                    </div>
                  </div>
                </div>
                {p.unlock_at && !p.unlocked ? (
                  <div className="flex items-center gap-1.5 text-[12px] text-exchange-text-third">
                    <Lock size={13} />
                    {t('earn.unlocksOn')} {new Date(p.unlock_at).toLocaleDateString()}
                  </div>
                ) : (
                  <button
                    onClick={() => handleRedeem(p)}
                    disabled={busy}
                    className="w-full py-2.5 rounded-full border border-exchange-border text-exchange-text text-[13px] font-bold hover:border-exchange-yellow/50 hover:text-exchange-yellow transition-colors disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin inline" /> : t('earn.redeem')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- Explore Products ---------------- */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[18px] font-bold text-exchange-text">{t('earn.exploreProducts')}</h2>
        <SlidersHorizontal size={18} className="text-exchange-text-secondary" />
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-4">
        {([
          { key: 'all' as Filter, label: t('earn.all') },
          { key: 'flexible' as Filter, label: t('earn.flexible') },
          { key: 'fixed' as Filter, label: t('earn.fixed') },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              filter === key ? 'bg-exchange-hover text-exchange-text' : 'text-exchange-text-third'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Product cards grouped by coin */}
      {loading ? (
        <div className="flex justify-center py-16 text-exchange-text-third">
          <Loader2 size={26} className="animate-spin" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 text-exchange-text-third text-sm">{t('earn.noProducts')}</div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([coin, list]) => (
            <div key={coin} className="bg-exchange-card border border-exchange-border rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
                <CoinIcon symbol={coin} size={30} />
                <span className="text-[15px] font-bold text-exchange-text">{coin}</span>
                <span className="text-[12px] text-exchange-text-third">{list[0].coin_name || ''}</span>
              </div>
              <div className="divide-y divide-exchange-border">
                {list.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="text-[11px] text-exchange-text-third mb-0.5">
                        {p.kind === 'fixed' ? `${t('earn.fixed')} · ${p.lock_days}${t('earn.days')}` : t('earn.flexible')}
                      </div>
                      <div className="text-[13px] text-exchange-text-secondary">
                        {t('earn.min')} {formatAmount(p.min_amount)} {coin}
                      </div>
                    </div>
                    <div className="text-right mr-3">
                      <div className="text-[10px] text-exchange-text-third">APR</div>
                      <div className="text-[17px] font-bold text-exchange-buy tabular-nums leading-none">{pct(p.apr)}</div>
                    </div>
                    <button
                      onClick={() => user ? setSubscribeTarget(p) : navigate('/login')}
                      className="rounded-full bg-exchange-yellow text-black text-[13px] font-bold hover:bg-exchange-yellow/90 transition-colors shrink-0"
                      style={{ padding: '9px 16px' }}
                    >
                      {t('earn.subscribe')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Subscribe modal */}
      {subscribeTarget && (
        <SubscribeModal
          product={subscribeTarget}
          available={wallets.find((w) => w.coin_symbol === subscribeTarget.coin_symbol)?.available || 0}
          onClose={() => setSubscribeTarget(null)}
          onDone={async () => {
            setSubscribeTarget(null);
            await Promise.all([loadPositions(), fetchWallets(), loadProducts()]);
          }}
        />
      )}
    </DesktopPageLayout>
  );
}

// ---------------------------------------------------------------------------
// Subscribe modal (Bybit-style bottom sheet)
// ---------------------------------------------------------------------------
function SubscribeModal({ product, available, onClose, onDone }: {
  product: Product;
  available: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onEsc); };
  }, [onClose]);

  const num = parseFloat(amount) || 0;
  const estDaily = num * product.apr / 365;
  const estYear = num * product.apr;
  const valid = num >= product.min_amount && num <= available &&
    (product.max_amount == null || num <= product.max_amount);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.post('/earn/subscribe', { product_id: product.id, amount: num });
      showToast('success', t('earn.subscribed'), `${formatAmount(num)} ${product.coin_symbol}`);
      onDone();
    } catch (err: any) {
      showToast('error', t('earn.subscribeFailed'), err.response?.data?.error || '');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-exchange-card border-t sm:border border-exchange-border rounded-t-2xl sm:rounded-2xl animate-sheet-up">
        <div className="flex justify-center pt-3 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-exchange-border" />
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-b border-exchange-border">
          <div className="flex items-center gap-2.5">
            <CoinIcon symbol={product.coin_symbol} size={28} />
            <div>
              <div className="text-[15px] font-bold text-exchange-text">{product.coin_symbol} {t('earn.subscribe')}</div>
              <div className="text-[11px] text-exchange-text-third">
                {product.kind === 'fixed' ? `${t('earn.fixed')} · ${product.lock_days}${t('earn.days')}` : t('earn.flexible')} · {pct(product.apr)} APR
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-exchange-text-third hover:text-exchange-text"><X size={20} /></button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div>
            <div className="flex justify-between text-[12px] mb-1.5">
              <span className="text-exchange-text-third">{t('earn.amount')}</span>
              <span className="text-exchange-text-secondary">
                {t('earn.available')}: {formatAmount(available)} {product.coin_symbol}
              </span>
            </div>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`${t('earn.min')} ${formatAmount(product.min_amount)}`}
                className="input-field pr-16 text-right tabular-nums"
                step="any"
              />
              <button
                onClick={() => setAmount(String(available))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-exchange-yellow"
              >
                {t('earn.max')}
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-exchange-input p-4 space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-exchange-text-third">{t('earn.estDaily')}</span>
              <span className="text-exchange-buy font-medium tabular-nums">+{formatAmount(estDaily)} {product.coin_symbol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-exchange-text-third">{t('earn.estYearly')}</span>
              <span className="text-exchange-buy font-medium tabular-nums">+{formatAmount(estYear)} {product.coin_symbol}</span>
            </div>
            {product.kind === 'fixed' && (
              <div className="flex justify-between">
                <span className="text-exchange-text-third">{t('earn.lockPeriod')}</span>
                <span className="text-exchange-text tabular-nums">{product.lock_days} {t('earn.days')}</span>
              </div>
            )}
          </div>

          {product.kind === 'fixed' && (
            <p className="text-[11px] text-exchange-yellow flex items-start gap-1.5">
              <Lock size={12} className="mt-0.5 shrink-0" />
              {t('earn.fixedNote', { days: product.lock_days })}
            </p>
          )}

          <button
            onClick={submit}
            disabled={!valid || busy}
            className="w-full py-3.5 rounded-full bg-exchange-yellow text-black font-bold text-[15px] hover:bg-exchange-yellow/90 transition-colors disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin inline" />
              : num > 0 && num > available ? t('earn.insufficient')
              : num > 0 && num < product.min_amount ? `${t('earn.min')} ${formatAmount(product.min_amount)} ${product.coin_symbol}`
              : t('earn.confirmSubscribe')}
          </button>
          <p className="text-[11px] text-exchange-text-third text-center flex items-center justify-center gap-1">
            <ChevronRight size={11} /> {t('earn.interestNote')}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
