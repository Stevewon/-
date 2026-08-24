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
import { X, Lock, Loader2, TrendingUp, Users, AlertTriangle, Wallet, Clock } from 'lucide-react';

// ---------------------------------------------------------------------------
// ⏸️  Earn "Coming soon / 준비중입니다" placeholder.
//
// All Earn features are temporarily disabled (owner directive 2026-08-24).
// The primary heading/body use the i18n keys (English default, Korean via
// ?lang=ko). Because the app currently ships only en + ko locale files (every
// other language falls back to English), we ALSO render the phrase in each
// major language so every visitor sees "in preparation" in their own tongue,
// regardless of the i18n fallback. Restoring Earn = revert EarnPage to its
// original return (kept verbatim in the block comment inside EarnPage()).
// ---------------------------------------------------------------------------
const COMING_SOON_BY_LANG: { label: string; text: string }[] = [
  { label: '한국어',        text: '준비중입니다' },
  { label: 'English',       text: 'Coming soon' },
  { label: '中文 (简体)',    text: '正在准备中' },
  { label: '中文 (繁體)',    text: '正在準備中' },
  { label: '日本語',        text: '準備中です' },
  { label: 'Español',       text: 'Próximamente' },
  { label: 'Português',     text: 'Em breve' },
  { label: 'Français',      text: 'Bientôt disponible' },
  { label: 'Deutsch',       text: 'Demnächst verfügbar' },
  { label: 'Русский',       text: 'Скоро будет' },
  { label: 'Türkçe',        text: 'Çok yakında' },
  { label: 'Tiếng Việt',    text: 'Sắp ra mắt' },
  { label: 'Bahasa Indonesia', text: 'Segera hadir' },
  { label: 'ไทย',           text: 'เร็ว ๆ นี้' },
  { label: 'العربية',       text: 'قريبًا' },
];

function EarnComingSoon() {
  const { t } = useI18n();
  return (
    <DesktopPageLayout>
      <div className="min-h-[52vh] flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-exchange-yellow/10 border border-exchange-yellow/30">
            <Clock size={38} className="text-exchange-yellow" />
          </div>
          <h1 className="text-[26px] font-bold text-exchange-text leading-tight">
            {t('earn.comingSoonTitle')}
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-exchange-text-secondary">
            {t('earn.comingSoonBody')}
          </p>

          {/* Multilingual "in preparation" so every visitor sees their own
              language even though non-en/ko locales fall back to English. */}
          <div className="mt-8 border-t border-exchange-border pt-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-left sm:grid-cols-3">
              {COMING_SOON_BY_LANG.map((l) => (
                <div key={l.label} className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide text-exchange-text-third truncate">
                    {l.label}
                  </div>
                  <div className="text-[13px] font-medium text-exchange-text truncate">
                    {l.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DesktopPageLayout>
  );
}

// ---------------------------------------------------------------------------
// QTA Staking (tier plan): stake USDT in $100 increments, earn QTA dividends
// daily. 90-day min lock, 30% early-exit penalty, referral match (10%/5%),
// dividend withdrawal in 100-QTA units with a 5% fee.
// ---------------------------------------------------------------------------

interface Product {
  id: string;
  min_usd: number;
  max_usd: number;
  term_days: number;
  daily_rate: number;      // fraction, 0.002 = 0.2%/day
  total_return: number;    // daily_rate * term_days, e.g. 0.36
  unit_usd: number;
}

interface Position {
  id: string;
  product_id: string;
  principal_usd: number;
  daily_rate: number;
  term_days: number;
  accrued_dividend_usd: number;
  accrued_dividend_qta: number;
  can_redeem: boolean;
  matured: boolean;
  lock_end_at: string | null;
  term_end_at: string | null;
  created_at: string;
}

const rate = (r: number) => `${(r * 100).toFixed(1)}%`;
const months = (d: number) => Math.round(d / 30);

// ==========================================================================
// ⏸️  EARN TEMPORARILY DISABLED (owner directive 2026-08-24)
// All Earn features are turned off and replaced with a localized
// "Coming soon / 준비중입니다" placeholder shown in each visitor's language.
//
// The full original Earn implementation (data loading, claim/redeem, staking
// products grid, dividend summary, subscribe/withdraw modals) is preserved
// verbatim and un-rendered in EarnLegacyUI() below — nothing calls it, so it
// is effectively disabled but kept intact for easy restoration.
// To restore Earn: rename EarnLegacyUI back to EarnPage (and delete this
// wrapper + EarnComingSoon).
// ==========================================================================
export default function EarnPage() {
  return <EarnComingSoon />;
}

// ---------------------------------------------------------------------------
// ⏸️  ORIGINAL EARN UI — DISABLED (kept verbatim, never rendered).
// Restore by moving this body back into EarnPage() (see note above).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function EarnLegacyUI() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user, wallets, fetchWallets } = useStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [qtaPrice, setQtaPrice] = useState(0.01);
  const [loading, setLoading] = useState(true);
  const [subscribeTarget, setSubscribeTarget] = useState<Product | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const usdtBalance = wallets.find((w) => w.coin_symbol === 'USDT')?.available || 0;
  const qtaBalance = wallets.find((w) => w.coin_symbol === 'QTA')?.available || 0;

  const loadProducts = useCallback(async () => {
    try {
      const res = await api.get('/earn/products');
      setProducts(res.data.products || []);
      setQtaPrice(res.data.qta_price || 0.01);
    } catch { /* public */ }
    finally { setLoading(false); }
  }, []);

  const loadPositions = useCallback(async () => {
    if (!user) { setPositions([]); return; }
    try {
      const res = await api.get('/earn/positions');
      setPositions(res.data.positions || []);
      if (res.data.qta_price) setQtaPrice(res.data.qta_price);
    } catch { /* not logged in */ }
  }, [user]);

  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { loadPositions(); if (user) fetchWallets(); }, [user, loadPositions]);

  const refreshAll = async () => {
    await Promise.all([loadPositions(), fetchWallets(), loadProducts()]);
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
        const netQtaNote = res.data.already_paid_qta_value_usd > 0
          ? ` − ${formatAmount(res.data.already_paid_qta_value_usd)} (${t('earn.paidQtaOffset')})`
          : '';
        showToast('success', t('earn.redeemed'),
          `${t('earn.returned')}: ${formatAmount(res.data.returned_usdt)} USDT (${t('earn.penalty')} ${formatAmount(res.data.penalty_usdt)}${netQtaNote})`);
      } else {
        showToast('success', t('earn.redeemed'),
          `${formatAmount(res.data.returned_usdt)} USDT + ${formatAmount(res.data.dividend_qta)} QTA`);
      }
      await refreshAll();
    } catch (err: any) {
      showToast('error', t('earn.redeemFailed'), err.response?.data?.error || '');
    } finally { setBusy(false); }
  };

  const totalDividendQta = positions.reduce((s, p) => s + (p.accrued_dividend_qta || 0), 0);

  return (
    <DesktopPageLayout>
      {/* Hero */}
      <div className="rounded-2xl mb-6 overflow-hidden p-5"
        style={{ background: 'linear-gradient(120deg, #2b2410 0%, #14171A 60%)', border: '1px solid rgba(240,185,11,0.3)' }}>
        <div className="flex items-center gap-3 mb-1">
          <CoinIcon symbol="QTA" size={40} />
          <div>
            <div className="text-[19px] font-bold text-exchange-text">{t('earn.qtaStaking')}</div>
            <div className="text-[12px] text-exchange-text-secondary">{t('earn.heroSub')}</div>
          </div>
        </div>
        <div className="flex gap-6 mt-4 text-[13px]">
          <div>
            <div className="text-exchange-text-third">{t('earn.maxReturn')}</div>
            <div className="text-[20px] font-bold text-exchange-buy leading-tight">180%</div>
          </div>
          <div>
            <div className="text-exchange-text-third">{t('earn.payoutIn')}</div>
            <div className="text-[16px] font-bold text-exchange-yellow leading-tight mt-1">QTA</div>
          </div>
          <div>
            <div className="text-exchange-text-third">{t('earn.qtaPrice')}</div>
            <div className="text-[16px] font-bold text-exchange-text leading-tight mt-1 tabular-nums">${qtaPrice.toFixed(4)}</div>
          </div>
        </div>
      </div>

      {/* My dividend summary + withdraw */}
      {user && (
        <div className="bg-exchange-card border border-exchange-border rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] text-exchange-text-third">{t('earn.claimableDividend')}</div>
              <div className="text-[22px] font-bold text-exchange-buy tabular-nums">
                {formatAmount(totalDividendQta + 0)} <span className="text-[13px] text-exchange-text-third">QTA {t('earn.accruing')}</span>
              </div>
              <div className="text-[12px] text-exchange-text-secondary mt-1">
                {t('earn.qtaBalance')}: {formatAmount(qtaBalance)} QTA
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
                  <CoinIcon symbol="USDT" size={26} />
                  <span className="text-[14px] font-bold text-exchange-text tabular-nums">
                    ${formatAmount(p.principal_usd)}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-exchange-yellow/15 text-exchange-yellow">
                    {months(p.term_days)}{t('earn.mo')} · {rate(p.daily_rate)}/{t('earn.day')}
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
                    <div className="text-[10px] text-exchange-text-third tabular-nums">
                      ≈ ${formatAmount(p.accrued_dividend_usd)}
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

      {/* Tier products */}
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={18} className="text-exchange-yellow" />
        <h2 className="text-[18px] font-bold text-exchange-text">{t('earn.stakingPlans')}</h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-exchange-text-third"><Loader2 size={26} className="animate-spin" /></div>
      ) : (
        <div className="space-y-3 mb-6">
          {products.map((p) => (
            <div key={p.id} className="bg-exchange-card border border-exchange-border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[15px] font-bold text-exchange-text tabular-nums">
                  ${formatAmount(p.min_usd)}{p.max_usd > p.min_usd ? ` ~ $${formatAmount(p.max_usd)}` : ''}
                </div>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-exchange-yellow/15 text-exchange-yellow font-medium">
                  {months(p.term_days)}{t('earn.months')}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <div className="flex gap-6">
                  <div>
                    <div className="text-[10px] text-exchange-text-third">{t('earn.dailyRate')}</div>
                    <div className="text-[17px] font-bold text-exchange-text tabular-nums">{rate(p.daily_rate)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-exchange-text-third">{t('earn.totalReturn')}</div>
                    <div className="text-[17px] font-bold text-exchange-buy tabular-nums">
                      {(p.total_return * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => user ? setSubscribeTarget(p) : navigate('/login')}
                  className="rounded-full bg-exchange-yellow text-black text-[13px] font-bold hover:bg-exchange-yellow/90 transition-colors shrink-0"
                  style={{ padding: '10px 20px' }}
                >
                  {t('earn.stakeNow')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Referral match info */}
      <div className="bg-exchange-card/60 border border-exchange-border rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Users size={16} className="text-exchange-yellow" />
          <span className="text-[14px] font-bold text-exchange-text">{t('earn.referralMatch')}</span>
        </div>
        <div className="flex gap-6 text-[13px]">
          <div><span className="text-exchange-text-third">{t('earn.level1')}: </span><span className="text-exchange-buy font-bold">10%</span></div>
          <div><span className="text-exchange-text-third">{t('earn.level2')}: </span><span className="text-exchange-buy font-bold">5%</span></div>
        </div>
        <p className="text-[11px] text-exchange-text-third mt-2">{t('earn.referralNote')}</p>
      </div>

      {/* Rules note */}
      <div className="text-[11px] text-exchange-text-third space-y-1 mb-8 leading-relaxed">
        <p>• {t('earn.ruleStake')}</p>
        <p>• {t('earn.ruleDividend')}</p>
        <p>• {t('earn.ruleLock')}</p>
        <p>• {t('earn.ruleWithdraw')}</p>
      </div>

      {subscribeTarget && (
        <SubscribeModal
          product={subscribeTarget}
          usdtBalance={usdtBalance}
          qtaPrice={qtaPrice}
          onClose={() => setSubscribeTarget(null)}
          onDone={async () => { setSubscribeTarget(null); await refreshAll(); }}
        />
      )}

      {withdrawOpen && (
        <WithdrawDividendModal
          qtaBalance={qtaBalance}
          onClose={() => setWithdrawOpen(false)}
          onDone={async () => { setWithdrawOpen(false); await refreshAll(); }}
        />
      )}
    </DesktopPageLayout>
  );
}

// ---------------------------------------------------------------------------
// Subscribe (stake USDT) modal
// ---------------------------------------------------------------------------
function SubscribeModal({ product, usdtBalance, qtaPrice, onClose, onDone }: {
  product: Product; usdtBalance: number; qtaPrice: number;
  onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(String(product.min_usd));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onEsc); };
  }, [onClose]);

  const num = parseFloat(amount) || 0;
  const in100 = num % 100 === 0;
  const inBand = num >= product.min_usd && num <= product.max_usd;
  const enough = num <= usdtBalance;
  const valid = num > 0 && in100 && inBand && enough;

  const totalDividendUsd = num * product.total_return;
  const totalDividendQta = totalDividendUsd / qtaPrice;
  const dailyQta = (num * product.daily_rate) / qtaPrice;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.post('/earn/subscribe', { product_id: product.id, amount_usd: num });
      showToast('success', t('earn.staked'), `$${formatAmount(num)} USDT`);
      onDone();
    } catch (err: any) {
      showToast('error', t('earn.stakeFailed'), err.response?.data?.error || '');
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-exchange-card border-t sm:border border-exchange-border rounded-t-2xl sm:rounded-2xl animate-sheet-up">
        <div className="flex justify-center pt-3 sm:hidden"><div className="w-10 h-1 rounded-full bg-exchange-border" /></div>
        <div className="flex items-center justify-between px-5 py-4 border-b border-exchange-border">
          <div className="text-[15px] font-bold text-exchange-text">
            {t('earn.stakeNow')} · {months(product.term_days)}{t('earn.months')} · {rate(product.daily_rate)}/{t('earn.day')}
          </div>
          <button onClick={onClose} className="text-exchange-text-third hover:text-exchange-text"><X size={20} /></button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div>
            <div className="flex justify-between text-[12px] mb-1.5">
              <span className="text-exchange-text-third">{t('earn.stakeAmount')} (USDT)</span>
              <span className="text-exchange-text-secondary">{t('earn.available')}: {formatAmount(usdtBalance)}</span>
            </div>
            <input
              type="number" value={amount} step="100"
              onChange={(e) => setAmount(e.target.value)}
              className="input-field text-right tabular-nums"
              placeholder={`$${product.min_usd}`}
            />
            <div className="flex gap-2 mt-2">
              {[product.min_usd, product.min_usd + 500, product.max_usd].filter((v, i, a) => a.indexOf(v) === i && v <= product.max_usd).map((v) => (
                <button key={v} onClick={() => setAmount(String(v))}
                  className="flex-1 text-[12px] py-1.5 rounded-lg bg-exchange-input text-exchange-text-secondary hover:text-exchange-yellow">
                  ${formatAmount(v)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-exchange-text-third mt-1.5">
              {t('earn.rangeHint', { min: `$${formatAmount(product.min_usd)}`, max: `$${formatAmount(product.max_usd)}` })} · {t('earn.unit100')}
            </p>
          </div>

          <div className="rounded-xl bg-exchange-input p-4 space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-exchange-text-third">{t('earn.estDailyDividend')}</span>
              <span className="text-exchange-buy font-medium tabular-nums">+{formatAmount(dailyQta)} QTA</span>
            </div>
            <div className="flex justify-between">
              <span className="text-exchange-text-third">{t('earn.estTotalDividend')} ({months(product.term_days)}{t('earn.mo')})</span>
              <span className="text-exchange-buy font-medium tabular-nums">+{formatAmount(totalDividendQta)} QTA</span>
            </div>
            <div className="flex justify-between border-t border-exchange-border pt-2">
              <span className="text-exchange-text-third">{t('earn.totalReturn')}</span>
              <span className="text-exchange-text font-bold tabular-nums">{(product.total_return * 100).toFixed(0)}% (≈ ${formatAmount(totalDividendUsd)})</span>
            </div>
          </div>

          <div className="rounded-xl bg-exchange-yellow/10 border border-exchange-yellow/30 p-3 text-[11px] text-exchange-text-secondary flex items-start gap-2">
            <Lock size={13} className="text-exchange-yellow mt-0.5 shrink-0" />
            <span>{t('earn.lockWarn', { months: months(product.term_days) })}</span>
          </div>

          <button
            onClick={submit}
            disabled={!valid || busy}
            className="w-full py-3.5 rounded-full bg-exchange-yellow text-black font-bold text-[15px] hover:bg-exchange-yellow/90 transition-colors disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin inline" />
              : !in100 ? t('earn.mustBe100')
              : !inBand ? t('earn.outOfRange')
              : !enough ? t('earn.insufficient')
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
function WithdrawDividendModal({ qtaBalance, onClose, onDone }: {
  qtaBalance: number; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState('100');
  const [address, setAddress] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onEsc); };
  }, [onClose]);

  const num = parseFloat(amount) || 0;
  const in100 = num % 100 === 0 && num > 0;
  const enough = num <= qtaBalance;
  const addrOk = /^0x[0-9a-fA-F]{40}$/.test(address);
  const fee = num * 0.05;
  const net = num - fee;
  const valid = in100 && enough && addrOk && ack;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const res = await api.post('/earn/withdraw-dividend', { amount_qta: num, address });
      showToast('success', t('earn.withdrawRequested'),
        `${formatAmount(res.data.net_qta)} QTA (${t('earn.afterFee')})`);
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
          {/* 5% fee banner — mandatory */}
          <div className="rounded-xl bg-exchange-sell/10 border-2 border-exchange-sell/40 p-3.5">
            <div className="flex items-center gap-2 text-exchange-sell font-bold text-[13px] mb-1">
              <AlertTriangle size={15} /> {t('earn.feeTitle')}
            </div>
            <p className="text-[12px] text-exchange-text-secondary">{t('earn.feeWarn')}</p>
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

          {/* Fee breakdown */}
          <div className="rounded-xl bg-exchange-input p-4 space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-exchange-text-third">{t('earn.requested')}</span>
              <span className="text-exchange-text tabular-nums">{formatAmount(num)} QTA</span>
            </div>
            <div className="flex justify-between">
              <span className="text-exchange-text-third">{t('earn.fee5')}</span>
              <span className="text-exchange-sell tabular-nums">− {formatAmount(fee)} QTA</span>
            </div>
            <div className="flex justify-between border-t border-exchange-border pt-2">
              <span className="text-exchange-text font-bold">{t('earn.youReceive')}</span>
              <span className="text-exchange-buy font-bold tabular-nums">{formatAmount(net)} QTA</span>
            </div>
          </div>

          <div>
            <label className="text-[12px] text-exchange-text-secondary mb-1.5 block">{t('earn.qtaAddress')}</label>
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
            disabled={!valid || busy}
            className="w-full py-3.5 rounded-full bg-exchange-yellow text-black font-bold text-[15px] hover:bg-exchange-yellow/90 transition-colors disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin inline" />
              : !in100 ? t('earn.unit100qta')
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
