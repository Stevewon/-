import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import useStore from '../store/useStore';
import api from '../utils/api';
import DesktopPageLayout from '../components/common/DesktopPageLayout';
import CoinIcon from '../components/common/CoinIcon';
import { showToast } from '../components/common/Toast';
import { formatAmount } from '../utils/format';
import { X, Lock, Loader2, Star, Crown, ShieldCheck, Gift, TrendingUp, Wallet, AlertTriangle, Scale } from 'lucide-react';

// ---------------------------------------------------------------------------
// QTA ADVANCED EARN — STAKE. EARN. GROW.
//
// Users stake QTA (bought on the exchange) into one of four tiers. Each tier
// carries a USD target band; the number of QTA required is computed from the
// LIVE QTA price at stake time (price floats with the market), so the card
// shows both the USD band AND its QTA-quantity conversion.
//
//   PLATINUM 1  $100 - $4,999   180d   0.2%/day  (36%)
//   PLATINUM 2  $100 - $4,999   360d   0.3%/day  (108%)
//   VIP 1       $5,000+         180d   0.3%/day  (54%)
//   VIP 2       $5,000+         360d   0.5%/day  (180%)
// ---------------------------------------------------------------------------

interface Product {
  id: string;
  coin_symbol: string;
  min_usd: number;
  max_usd: number;
  term_days: number;
  daily_rate: number;      // fraction, 0.002 = 0.2%/day
  total_return: number;    // daily_rate * term_days
  unit_usd: number;
  sort_order: number;
}

interface Position {
  id: string;
  product_id: string;
  principal_usd: number;
  principal_qta: number;
  qta_price_at_stake: number;
  daily_rate: number;
  term_days: number;
  accrued_dividend_usd: number;
  accrued_dividend_qta: number;
  can_redeem: boolean;
  matured: boolean;
  term_end_at: string | null;
  created_at: string;
}

const rate = (r: number) => `${(r * 100).toFixed(1)}%`;

// USD target -> required QTA quantity at the given live price.
const usdToQta = (usd: number, price: number) => (price > 0 ? usd / price : 0);

// Compact QTA quantity for card display (e.g. 1.4M, 28.0K).
function fmtQtaCompact(q: number): string {
  if (!isFinite(q) || q <= 0) return '0';
  if (q >= 1_000_000) return `${(q / 1_000_000).toFixed(q >= 10_000_000 ? 0 : 2)}M`;
  if (q >= 1_000) return `${(q / 1_000).toFixed(q >= 100_000 ? 0 : 1)}K`;
  return Math.round(q).toLocaleString();
}

// Tier presentation (icon / accent) keyed by product id, with a name fallback.
function tierMeta(p: Product): { label: string; sub: string; icon: any; vip: boolean; stars: number } {
  const id = p.id.toLowerCase();
  if (id.includes('vip_2') || (p.min_usd >= 5000 && p.term_days >= 360))
    return { label: 'VIP 2', sub: '', icon: Crown, vip: true, stars: 0 };
  if (id.includes('vip_1') || (p.min_usd >= 5000))
    return { label: 'VIP 1', sub: '', icon: Crown, vip: true, stars: 0 };
  if (id.includes('platinum_2') || p.term_days >= 360)
    return { label: 'PLATINUM 2', sub: '', icon: Star, vip: false, stars: 2 };
  return { label: 'PLATINUM 1', sub: '', icon: Star, vip: false, stars: 1 };
}

export default function EarnPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user, wallets, fetchWallets } = useStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [qtaPrice, setQtaPrice] = useState(0.00357142857);
  const [usdtPrice, setUsdtPrice] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [subscribeTarget, setSubscribeTarget] = useState<Product | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const qtaBalance = wallets.find((w) => w.coin_symbol === 'QTA')?.available || 0;

  const loadProducts = useCallback(async () => {
    try {
      const res = await api.get('/earn/products');
      setProducts(res.data.products || []);
      if (res.data.qta_price) setQtaPrice(res.data.qta_price);
    } catch { /* public */ }
    finally { setLoading(false); }
  }, []);

  // Live USDT price (usually $1.00) — read from the public market coins list
  // so QTA→USDT withdrawal conversion uses the moment's real peg.
  const loadUsdtPrice = useCallback(async () => {
    try {
      const res = await api.get('/market/coins');
      const list = Array.isArray(res.data) ? res.data : (res.data?.coins || []);
      const u = list.find((x: any) => x.symbol === 'USDT');
      const q = list.find((x: any) => x.symbol === 'QTA');
      if (u && Number(u.price_usd) > 0) setUsdtPrice(Number(u.price_usd));
      if (q && Number(q.price_usd) > 0) setQtaPrice(Number(q.price_usd));
    } catch { /* keep defaults */ }
  }, []);

  const loadPositions = useCallback(async () => {
    if (!user) { setPositions([]); return; }
    try {
      const res = await api.get('/earn/positions');
      setPositions(res.data.positions || []);
      if (res.data.qta_price) setQtaPrice(res.data.qta_price);
    } catch { /* not logged in */ }
  }, [user]);

  useEffect(() => { loadProducts(); loadUsdtPrice(); }, [loadProducts, loadUsdtPrice]);
  useEffect(() => { loadPositions(); if (user) fetchWallets(); }, [user, loadPositions]);

  const refreshAll = async () => {
    await Promise.all([loadPositions(), fetchWallets(), loadProducts(), loadUsdtPrice()]);
  };

  const handleClaim = async (p: Position) => {
    setBusy(true);
    try {
      const res = await api.post('/earn/claim', { position_id: p.id });
      showToast('success', t('earn.claimed'), `+${formatAmount(res.data.credited_qta)} QTA`);
      await refreshAll();
    } catch (err: any) {
      showToast('error', t('earn.claimFailed'), err.response?.data?.error || '');
    } finally { setBusy(false); }
  };

  const handleRedeem = async (p: Position) => {
    const early = !p.can_redeem;
    const msg = early ? t('earn.confirmEarlyExit') : t('earn.confirmRedeem');
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const res = await api.post('/earn/redeem', { position_id: p.id });
      if (res.data.early) {
        showToast('success', t('earn.redeemed'),
          `${t('earn.returned')}: ${formatAmount(res.data.returned_qta)} QTA (${t('earn.penalty')} ${formatAmount(res.data.penalty_qta)} QTA)`);
      } else {
        showToast('success', t('earn.redeemed'),
          `${formatAmount(res.data.returned_qta)} QTA + ${formatAmount(res.data.dividend_qta)} QTA`);
      }
      await refreshAll();
    } catch (err: any) {
      showToast('error', t('earn.redeemFailed'), err.response?.data?.error || '');
    } finally { setBusy(false); }
  };

  const totalDividendQta = positions.reduce((s, p) => s + (p.accrued_dividend_qta || 0), 0);

  return (
    <DesktopPageLayout>
      {/* ADVANCED EARN hero (matches owner card design) */}
      <div
        className="rounded-2xl mb-5 overflow-hidden p-5"
        style={{ background: 'linear-gradient(120deg,#0b1220 0%,#101826 55%,#1a1305 100%)', border: '1px solid rgba(240,185,11,0.28)' }}
      >
        <div className="flex items-center gap-3">
          <CoinIcon symbol="QTA" size={40} />
          <div className="min-w-0">
            <div className="text-[20px] font-extrabold tracking-wide text-exchange-text leading-none">
              {t('earn.advancedEarn')}
            </div>
            <div className="text-[11px] font-semibold tracking-[0.25em] text-exchange-yellow mt-1">
              {t('earn.stakeEarnGrow')}
            </div>
          </div>
        </div>

        {/* Feature strip */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          <Feature icon={Lock} title={t('earn.featLockTitle')} body={t('earn.featLockBody')} />
          <Feature icon={Gift} title={t('earn.featRewardTitle')} body={t('earn.featRewardBody')} />
          <Feature icon={ShieldCheck} title={t('earn.featPriceTitle')} body={t('earn.featPriceBody')} />
        </div>

        {/* QTA live price */}
        <div className="flex items-center gap-4 mt-4 text-[12px]">
          <div>
            <div className="text-exchange-text-third">{t('earn.qtaPrice')}</div>
            <div className="text-[15px] font-bold text-exchange-text tabular-nums leading-tight mt-0.5">
              ${qtaPrice.toFixed(5)}
            </div>
          </div>
          {user && (
            <div>
              <div className="text-exchange-text-third">{t('earn.qtaBalance')}</div>
              <div className="text-[15px] font-bold text-exchange-yellow tabular-nums leading-tight mt-0.5">
                {formatAmount(qtaBalance)} QTA
              </div>
            </div>
          )}
        </div>
      </div>

      {/* My dividend summary + withdraw */}
      {user && (
        <div className="bg-exchange-card border border-exchange-border rounded-2xl p-4 mb-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] text-exchange-text-third">{t('earn.claimableDividend')}</div>
              <div className="text-[22px] font-bold text-exchange-buy tabular-nums">
                {formatAmount(totalDividendQta)} <span className="text-[13px] text-exchange-text-third">QTA {t('earn.accruing')}</span>
              </div>
            </div>
            <button
              onClick={() => setWithdrawOpen(true)}
              className="rounded-full bg-exchange-yellow text-black text-[13px] font-bold hover:bg-exchange-yellow/90 transition-colors flex items-center gap-1.5"
              style={{ padding: '10px 16px' }}
            >
              <Wallet size={15} /> {t('earn.withdrawDividend')}
            </button>
          </div>
        </div>
      )}

      {/* My Positions */}
      {user && positions.length > 0 && (
        <div className="mb-6">
          <h2 className="text-[16px] font-bold text-exchange-text mb-3">{t('earn.myPositions')}</h2>
          <div className="space-y-3">
            {positions.map((p) => (
              <div key={p.id} className="bg-exchange-card border border-exchange-border rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CoinIcon symbol="QTA" size={24} />
                  <span className="text-[14px] font-bold text-exchange-text tabular-nums">
                    {formatAmount(p.principal_qta)} QTA
                  </span>
                  <span className="text-[10px] text-exchange-text-third tabular-nums">
                    ≈ ${formatAmount(p.principal_usd)}
                  </span>
                  <span className="text-[13px] font-bold text-exchange-buy tabular-nums ml-auto">
                    +{(p.daily_rate * p.term_days * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-[11px] text-exchange-text-third">{t('earn.accruedDividend')}</div>
                    <div className="text-[15px] font-bold text-exchange-buy tabular-nums">
                      +{formatAmount(p.accrued_dividend_qta)} QTA
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-exchange-text-third">{t('earn.status')}</div>
                    <div className="text-[13px] text-exchange-text">
                      {p.matured ? t('earn.matured')
                        : `${t('earn.maturesOn')} ${p.term_end_at ? new Date(p.term_end_at).toLocaleDateString() : ''}`}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleClaim(p)}
                    disabled={busy || p.accrued_dividend_qta <= 0}
                    className="flex-1 py-2.5 rounded-full border border-exchange-border text-exchange-text text-[13px] font-bold hover:border-exchange-buy/50 hover:text-exchange-buy transition-colors disabled:opacity-40"
                  >
                    {t('earn.claimDividend')}
                  </button>
                  <button
                    onClick={() => handleRedeem(p)}
                    disabled={busy}
                    className={`flex-1 py-2.5 rounded-full text-[13px] font-bold transition-colors disabled:opacity-40 ${
                      p.can_redeem
                        ? 'border border-exchange-border text-exchange-text hover:border-exchange-yellow/50 hover:text-exchange-yellow'
                        : 'border border-exchange-sell/40 text-exchange-sell hover:bg-exchange-sell/10'
                    }`}
                  >
                    {p.can_redeem ? t('earn.redeem') : t('earn.earlyExit')}
                  </button>
                </div>
                {!p.can_redeem && (
                  <p className="text-[10px] text-exchange-sell mt-2 flex items-center gap-1">
                    <AlertTriangle size={11} /> {t('earn.earlyExitWarn')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tier cards (image design) */}
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={18} className="text-exchange-yellow" />
        <h2 className="text-[18px] font-bold text-exchange-text">{t('earn.stakingPlans')}</h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-exchange-text-third"><Loader2 size={26} className="animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-6">
          {products.map((p) => (
            <TierCard
              key={p.id}
              product={p}
              price={qtaPrice}
              onStake={() => (user ? setSubscribeTarget(p) : navigate('/login'))}
            />
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          BINARY LEFT/RIGHT MATCHING BONUS — rate table
          (replaces the retired 1대/2대 Referral Match panel)
         ══════════════════════════════════════════════════════════════ */}
      <div className="bg-exchange-card/60 border border-exchange-border rounded-2xl overflow-hidden mb-4">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <div className="w-8 h-8 rounded-lg bg-exchange-yellow/15 flex items-center justify-center">
            <Scale size={16} className="text-exchange-yellow" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-exchange-text">{t('earn.matchTitle')}</div>
            <div className="text-[11px] text-exchange-text-third">{t('earn.matchSubtitle')}</div>
          </div>
        </div>

        {/* Intro / how-it-works */}
        <p className="px-4 pb-3 text-[11px] text-exchange-text-secondary leading-relaxed">
          {t('earn.matchIntro')}
        </p>

        {/* Rate table */}
        <div className="px-4 pb-4">
          <div className="rounded-xl border border-exchange-border/70 overflow-hidden">
            {/* header row */}
            <div className="grid grid-cols-2 bg-exchange-bg/60 text-[11px] font-bold text-exchange-text-third uppercase tracking-wider">
              <div className="px-3 py-2 border-r border-exchange-border/70">{t('earn.matchColAmount')}</div>
              <div className="px-3 py-2 text-right">{t('earn.matchColRate')}</div>
            </div>
            {[
              { band: '$100 ~ $999', rate: '2%' },
              { band: '$1,000 ~ $4,999', rate: '3%' },
              { band: '$5,000 ~ $9,999', rate: '4%' },
              { band: '$10,000 ~ $49,999', rate: '5%' },
              { band: '$50,000 ~ $99,999', rate: '6%' },
              { band: '$100,000 ~', rate: '7%' },
            ].map((row, i) => (
              <div
                key={row.band}
                className={`grid grid-cols-2 text-[13px] ${
                  i % 2 === 0 ? 'bg-transparent' : 'bg-exchange-bg/30'
                } border-t border-exchange-border/50`}
              >
                <div className="px-3 py-2.5 tabular-nums text-exchange-text border-r border-exchange-border/50">
                  {row.band}
                </div>
                <div className="px-3 py-2.5 text-right tabular-nums font-bold text-exchange-buy">
                  {row.rate}
                </div>
              </div>
            ))}
          </div>

          {/* format / rules note */}
          <ul className="mt-3 space-y-1 text-[11px] text-exchange-text-third leading-relaxed">
            <li>• {t('earn.matchNote1')}</li>
            <li>• {t('earn.matchNote2')}</li>
            <li>• {t('earn.matchNote3')}</li>
            <li>• {t('earn.matchNote4')}</li>
          </ul>
        </div>
      </div>

      {/* Rules note */}
      <div className="text-[11px] text-exchange-text-third space-y-1 mb-8 leading-relaxed">
        <p>• {t('earn.ruleStakeQta')}</p>
        <p>• {t('earn.ruleDividend')}</p>
        <p>• {t('earn.ruleLock')}</p>
        <p>• {t('earn.ruleWithdraw')}</p>
      </div>

      {subscribeTarget && (
        <SubscribeModal
          product={subscribeTarget}
          qtaBalance={qtaBalance}
          qtaPrice={qtaPrice}
          onClose={() => setSubscribeTarget(null)}
          onDone={async () => { setSubscribeTarget(null); await refreshAll(); }}
        />
      )}

      {withdrawOpen && (
        <WithdrawDividendModal
          qtaBalance={qtaBalance}
          qtaPrice={qtaPrice}
          usdtPrice={usdtPrice}
          onClose={() => setWithdrawOpen(false)}
          onDone={async () => { setWithdrawOpen(false); await refreshAll(); }}
        />
      )}
    </DesktopPageLayout>
  );
}

// ---------------------------------------------------------------------------
// Hero feature chip
// ---------------------------------------------------------------------------
function Feature({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <div className="rounded-xl bg-black/25 border border-exchange-border/60 p-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={13} className="text-exchange-yellow shrink-0" />
        <span className="text-[11px] font-bold text-exchange-text truncate">{title}</span>
      </div>
      <p className="text-[10px] text-exchange-text-third leading-snug">{body}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier card (PLATINUM / VIP) — image design
// ---------------------------------------------------------------------------
function TierCard({ product, price, onStake }: { product: Product; price: number; onStake: () => void }) {
  const { t } = useI18n();
  const meta = tierMeta(product);
  const Icon = meta.icon;

  const bandLabel = product.max_usd >= 1_000_000
    ? `$${product.min_usd.toLocaleString('en-US')}+`
    : `$${product.min_usd.toLocaleString('en-US')} ~ $${product.max_usd.toLocaleString('en-US')}`;

  const minQta = usdToQta(product.min_usd, price);
  const maxQta = usdToQta(product.max_usd, price);
  const qtaBand = product.max_usd >= 1_000_000
    ? `${fmtQtaCompact(minQta)}+ QTA`
    : `${fmtQtaCompact(minQta)} ~ ${fmtQtaCompact(maxQta)} QTA`;

  return (
    <div
      className={`relative rounded-2xl p-4 border overflow-hidden ${
        meta.vip
          ? 'border-exchange-yellow/50'
          : 'border-exchange-border'
      }`}
      style={{
        background: meta.vip
          ? 'linear-gradient(160deg,#1c1503 0%,#14171A 60%)'
          : 'linear-gradient(160deg,#0d1526 0%,#14171A 60%)',
      }}
    >
      {/* Tier header */}
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={16} className={meta.vip ? 'text-exchange-yellow' : 'text-slate-300'} />
        <span className={`text-[14px] font-extrabold tracking-wide ${meta.vip ? 'text-exchange-yellow' : 'text-exchange-text'}`}>
          {meta.label}
        </span>
        {meta.stars > 0 && (
          <span className="flex ml-0.5">
            {Array.from({ length: meta.stars }).map((_, i) => (
              <Star key={i} size={10} className="text-slate-300 fill-slate-300" />
            ))}
          </span>
        )}
      </div>

      {/* USD band + QTA conversion */}
      <div className="text-[15px] font-bold text-exchange-text tabular-nums leading-tight">{bandLabel}</div>
      <div className="text-[11px] text-exchange-yellow/90 tabular-nums mb-3">{qtaBand}</div>

      {/* term + daily */}
      <div className="flex items-center justify-between rounded-xl bg-black/25 border border-exchange-border/50 px-3 py-2 mb-3">
        <div>
          <div className="text-[9px] text-exchange-text-third uppercase">{t('earn.days')}</div>
          <div className="text-[14px] font-bold text-exchange-text tabular-nums leading-tight">{product.term_days}</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-exchange-text-third uppercase">{t('earn.daily')}</div>
          <div className="text-[14px] font-bold text-exchange-buy tabular-nums leading-tight">{rate(product.daily_rate)}</div>
        </div>
      </div>

      <button
        onClick={onStake}
        className={`w-full py-2.5 rounded-full text-[13px] font-bold transition-colors ${
          meta.vip
            ? 'bg-exchange-yellow text-black hover:bg-exchange-yellow/90'
            : 'bg-exchange-yellow/90 text-black hover:bg-exchange-yellow'
        }`}
      >
        {t('earn.stakeNow')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscribe (stake QTA) modal — user picks a USD target within the tier band;
// the required QTA quantity is derived from the live price.
// ---------------------------------------------------------------------------
function SubscribeModal({ product, qtaBalance, qtaPrice, onClose, onDone }: {
  product: Product; qtaBalance: number; qtaPrice: number;
  onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [usd, setUsd] = useState(String(product.min_usd));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onEsc); };
  }, [onClose]);

  const targetUsd = parseFloat(usd) || 0;
  const requiredQta = usdToQta(targetUsd, qtaPrice);
  const inBand = targetUsd >= product.min_usd && targetUsd <= product.max_usd;
  const enough = requiredQta <= qtaBalance;
  const valid = targetUsd > 0 && inBand && enough;

  const totalDividendUsd = targetUsd * product.total_return;
  const totalDividendQta = totalDividendUsd / qtaPrice;
  const dailyQta = (targetUsd * product.daily_rate) / qtaPrice;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const res = await api.post('/earn/subscribe', { product_id: product.id, amount_usd: targetUsd });
      showToast('success', t('earn.staked'), `${formatAmount(res.data.staked_qta)} QTA`);
      onDone();
    } catch (err: any) {
      showToast('error', t('earn.stakeFailed'), err.response?.data?.error || '');
    } finally { setBusy(false); }
  };

  const maxUsdForBalance = qtaBalance * qtaPrice;
  // Fixed quick-add increments requested by the owner: $100 / $1,000 / $5,000.
  // Only show the increments that fit inside this tier's USD band; tapping a
  // chip ADDS its value to the current target (accumulates), clamped to max.
  const quickIncrements = [100, 1000, 5000].filter((v) => v <= product.max_usd);
  const addUsd = (inc: number) => {
    const next = Math.min(product.max_usd, (parseFloat(usd) || 0) + inc);
    setUsd(String(next));
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-exchange-card border-t sm:border border-exchange-border rounded-t-2xl sm:rounded-2xl animate-sheet-up">
        <div className="flex justify-center pt-3 sm:hidden"><div className="w-10 h-1 rounded-full bg-exchange-border" /></div>
        <div className="flex items-center justify-between px-5 py-4 border-b border-exchange-border">
          <div className="text-[15px] font-bold text-exchange-text">
            {t('earn.stakeNow')} · {product.term_days}{t('earn.day')} · {rate(product.daily_rate)}
          </div>
          <button onClick={onClose} className="text-exchange-text-third hover:text-exchange-text"><X size={20} /></button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div>
            <div className="flex justify-between text-[12px] mb-1.5">
              <span className="text-exchange-text-third">{t('earn.targetAmount')} (USD)</span>
              <span className="text-exchange-text-secondary">{t('earn.qtaBalance')}: {formatAmount(qtaBalance)} QTA</span>
            </div>
            <input
              type="number" value={usd} step="100"
              onChange={(e) => setUsd(e.target.value)}
              className="input-field text-right tabular-nums"
              placeholder={`$${product.min_usd}`}
            />
            <div className="flex gap-2 mt-2">
              {quickIncrements.map((v) => (
                <button key={v} onClick={() => addUsd(v)}
                  className="flex-1 text-[12px] py-1.5 rounded-lg bg-exchange-input text-exchange-text-secondary hover:text-exchange-yellow font-semibold tabular-nums">
                  +${v.toLocaleString('en-US')}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-exchange-text-third mt-1.5">
              {t('earn.rangeHint', {
                min: `$${product.min_usd.toLocaleString('en-US')}`,
                max: product.max_usd >= 1_000_000 ? '∞' : `$${product.max_usd.toLocaleString('en-US')}`,
              })}
            </p>
          </div>

          {/* Required QTA (live conversion) */}
          <div className="rounded-xl bg-exchange-yellow/10 border border-exchange-yellow/30 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-exchange-text-secondary">{t('earn.requiredQta')}</span>
              <span className="text-[18px] font-extrabold text-exchange-yellow tabular-nums">
                {formatAmount(requiredQta)} QTA
              </span>
            </div>
            <div className="text-[10px] text-exchange-text-third mt-1 text-right">
              @ ${qtaPrice.toFixed(5)} / QTA · ≈ ${targetUsd.toLocaleString('en-US')}
            </div>
          </div>

          <div className="rounded-xl bg-exchange-input p-4 space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-exchange-text-third">{t('earn.estDailyDividend')}</span>
              <span className="text-exchange-buy font-medium tabular-nums">+{formatAmount(dailyQta)} QTA</span>
            </div>
            <div className="flex justify-between">
              <span className="text-exchange-text-third">{t('earn.estTotalDividend')}</span>
              <span className="text-exchange-buy font-medium tabular-nums">+{formatAmount(totalDividendQta)} QTA</span>
            </div>
            <div className="flex justify-between border-t border-exchange-border pt-2">
              <span className="text-exchange-text-third">{t('earn.totalReturn')}</span>
              <span className="text-exchange-text font-bold tabular-nums">{(product.total_return * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div className="rounded-xl bg-exchange-yellow/10 border border-exchange-yellow/30 p-3 text-[11px] text-exchange-text-secondary flex items-start gap-2">
            <Lock size={13} className="text-exchange-yellow mt-0.5 shrink-0" />
            <span>{t('earn.lockWarnDays', { days: product.term_days })}</span>
          </div>

          <button
            onClick={submit}
            disabled={!valid || busy}
            className="w-full py-3.5 rounded-full bg-exchange-yellow text-black font-bold text-[15px] hover:bg-exchange-yellow/90 transition-colors disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin inline" />
              : !inBand ? t('earn.outOfRange')
              : !enough ? t('earn.insufficientQtaMax', { max: formatAmount(maxUsdForBalance) })
              : t('earn.confirmStake')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Withdraw dividend (QTA) modal — 100-QTA units, 5% fee
// ---------------------------------------------------------------------------
function WithdrawDividendModal({ qtaBalance, qtaPrice, usdtPrice, onClose, onDone }: {
  qtaBalance: number; qtaPrice: number; usdtPrice: number; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState('100');
  const [address, setAddress] = useState('');
  const [payoutCoin, setPayoutCoin] = useState<'QTA' | 'USDT'>('QTA');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onEsc); };
  }, [onClose]);

  // ★ Boss's minimum-withdrawal rule (2026-08-26): $50 USD equivalent, valued
  //   at the QTA live price. Below $50 -> blocked with a warning popup.
  const MIN_WITHDRAW_USD = 50;
  const num = parseFloat(amount) || 0;
  const in100 = num % 100 === 0 && num > 0;
  const enough = num <= qtaBalance;
  const addrOk = /^0x[0-9a-fA-F]{40}$/.test(address);
  const requestUsd = num * qtaPrice;
  const belowMinUsd = num > 0 && qtaPrice > 0 && requestUsd < MIN_WITHDRAW_USD;
  const feeQta = num * 0.05;
  const netQta = num - feeQta;
  const valid = in100 && enough && addrOk && ack && !belowMinUsd;

  // Live conversion of the net QTA into the chosen payout coin.
  const uPrice = usdtPrice > 0 ? usdtPrice : 1;
  const netUsdt = (netQta * qtaPrice) / uPrice;
  const receiveAmount = payoutCoin === 'USDT' ? netUsdt : netQta;

  const submit = async () => {
    // ★ Hard warning popup for sub-$50 attempts (boss rule).
    if (belowMinUsd) {
      showToast('error', t('earn.minWarnTitle'), t('earn.minWarnBody', { usd: MIN_WITHDRAW_USD }));
      return;
    }
    if (!valid) return;
    setBusy(true);
    try {
      const res = await api.post('/earn/withdraw-dividend',
        { amount_qta: num, address, payout_coin: payoutCoin });
      showToast('success', t('earn.withdrawRequested'),
        `${formatAmount(res.data.payout_amount)} ${res.data.payout_coin} (${t('earn.afterFee')})`);
      onDone();
    } catch (err: any) {
      showToast('error', t('earn.withdrawFailed'), err.response?.data?.error || '');
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-exchange-card border-t sm:border border-exchange-border rounded-t-2xl sm:rounded-2xl animate-sheet-up">
        <div className="flex justify-center pt-3 sm:hidden"><div className="w-10 h-1 rounded-full bg-exchange-border" /></div>
        <div className="flex items-center justify-between px-5 py-4 border-b border-exchange-border">
          <div className="flex items-center gap-2 text-[15px] font-bold text-exchange-text">
            <CoinIcon symbol="QTA" size={24} /> {t('earn.withdrawDividend')}
          </div>
          <button onClick={onClose} className="text-exchange-text-third hover:text-exchange-text"><X size={20} /></button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div className="rounded-xl bg-exchange-sell/10 border-2 border-exchange-sell/40 p-3.5">
            <div className="flex items-center gap-2 text-exchange-sell font-bold text-[13px] mb-1">
              <AlertTriangle size={15} /> {t('earn.feeTitle')}
            </div>
            <p className="text-[12px] text-exchange-text-secondary">{t('earn.feeWarn')}</p>
            <p className="text-[12px] text-exchange-text-secondary mt-1">{t('earn.minNotice')}</p>
          </div>

          <div>
            <div className="flex justify-between text-[12px] mb-1.5">
              <span className="text-exchange-text-third">{t('earn.amount')} (QTA)</span>
              <span className="text-exchange-text-secondary">{t('earn.available')}: {formatAmount(qtaBalance)} QTA</span>
            </div>
            <input
              type="number" value={amount} step="100"
              onChange={(e) => setAmount(e.target.value)}
              className="input-field text-right tabular-nums"
              placeholder="100"
            />
            <p className="text-[11px] text-exchange-text-third mt-1.5">{t('earn.unit100qta')}</p>
          </div>

          {/* Payout coin choice — receive as QTA or USDT at live prices */}
          <div>
            <div className="text-[12px] text-exchange-text-third mb-1.5">{t('earn.payoutCoin')}</div>
            <div className="grid grid-cols-2 gap-2">
              {(['QTA', 'USDT'] as const).map((coin) => (
                <button
                  key={coin}
                  type="button"
                  onClick={() => setPayoutCoin(coin)}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-colors ${
                    payoutCoin === coin
                      ? 'border-exchange-yellow bg-exchange-yellow/10 text-exchange-text'
                      : 'border-exchange-border bg-exchange-input text-exchange-text-secondary hover:border-exchange-text-third'
                  }`}
                >
                  <CoinIcon symbol={coin} size={20} />
                  <span className="font-bold text-[14px]">{coin}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-exchange-text-third mt-1.5">
              {payoutCoin === 'USDT'
                ? `${t('earn.payoutUsdtNote')} · 1 QTA ≈ $${qtaPrice.toFixed(5)}`
                : t('earn.payoutQtaNote')}
            </p>
          </div>

          <div className="rounded-xl bg-exchange-input p-4 space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-exchange-text-third">{t('earn.requested')}</span>
              <span className="text-exchange-text tabular-nums">{formatAmount(num)} QTA</span>
            </div>
            <div className="flex justify-between">
              <span className="text-exchange-text-third">{t('earn.fee5')}</span>
              <span className="text-exchange-sell tabular-nums">− {formatAmount(feeQta)} QTA</span>
            </div>
            {payoutCoin === 'USDT' && (
              <div className="flex justify-between">
                <span className="text-exchange-text-third">{t('earn.convertRate')}</span>
                <span className="text-exchange-text-secondary tabular-nums">
                  {formatAmount(netQta)} QTA → USDT
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-exchange-border pt-2">
              <span className="text-exchange-text font-bold">{t('earn.youReceive')}</span>
              <span className="text-exchange-buy font-bold tabular-nums">
                {payoutCoin === 'USDT'
                  ? `${formatAmount(receiveAmount)} USDT`
                  : `${formatAmount(receiveAmount)} QTA`}
              </span>
            </div>
          </div>

          <div>
            <label className="text-[12px] text-exchange-text-secondary mb-1.5 block">
              {payoutCoin === 'USDT' ? t('earn.usdtAddress') : t('earn.qtaAddress')}
            </label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="input-field font-mono text-[13px]"
              placeholder="0x..."
            />
            {address && !addrOk && (
              <p className="text-[11px] text-exchange-sell mt-1">{t('earn.invalidQtaAddr')}</p>
            )}
          </div>

          <label className="flex items-start gap-2 text-[12px] text-exchange-text-secondary cursor-pointer">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-exchange-yellow" />
            <span>{t('earn.feeAck')}</span>
          </label>

          <button
            onClick={submit}
            disabled={(!valid && !belowMinUsd) || busy}
            className="w-full py-3.5 rounded-full bg-exchange-yellow text-black font-bold text-[15px] hover:bg-exchange-yellow/90 transition-colors disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin inline" />
              : !in100 ? t('earn.unit100qta')
              : belowMinUsd ? t('earn.belowMinUsd', { usd: MIN_WITHDRAW_USD })
              : !enough ? t('earn.insufficient')
              : !addrOk ? t('earn.enterQtaAddr')
              : !ack ? t('earn.mustAck')
              : t('earn.confirmWithdraw')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
