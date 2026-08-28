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
import { X, Lock, Loader2, Star, Crown, ShieldCheck, Gift, TrendingUp, Wallet, AlertTriangle, Scale, HelpCircle, Users } from 'lucide-react';

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

interface PositionsSummary {
  totalPrincipalUsd: number;
  totalDividendUsd: number;
  totalDividendQta: number;
}

interface BinaryMember { id: string; nickname: string; joined_at: string; staked_usd?: number; }
interface BinaryTree {
  volume: {
    self_usd: number;
    left_usd: number;
    right_usd: number;
    total_usd: number;
    matched_usd: number;
    /** @deprecated park/pending retired 2026-08-28 — always 0, kept for BC. */
    pending_left_usd?: number;
    pending_right_usd?: number;
    cap_usd: number;
  };
  left_members: BinaryMember[];
  right_members: BinaryMember[];
  unplaced_members: BinaryMember[];
}

const rate = (r: number) => `${(r * 100).toFixed(1)}%`;

// USD money formatter for volume display.
const fmtUsd = (n: number) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  const [summary, setSummary] = useState<PositionsSummary | null>(null);
  const [qtaPrice, setQtaPrice] = useState(0.00357142857);
  const [usdtPrice, setUsdtPrice] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [subscribeTarget, setSubscribeTarget] = useState<Product | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Binary team volume + placement (sponsor picks each new downline's leg once)
  const [binary, setBinary] = useState<BinaryTree | null>(null);
  const [assignBusy, setAssignBusy] = useState<string | null>(null);

  const qtaBalance = wallets.find((w) => w.coin_symbol === 'QTA')?.available || 0;

  const loadBinary = useCallback(async () => {
    if (!user) { setBinary(null); return; }
    try {
      const res = await api.get('/earn/binary/tree');
      setBinary(res.data as BinaryTree);
    } catch { /* not logged in / no binary data */ }
  }, [user]);

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
    if (!user) { setPositions([]); setSummary(null); return; }
    try {
      const res = await api.get('/earn/positions');
      setPositions(res.data.positions || []);
      setSummary(res.data.summary || null);
      if (res.data.qta_price) setQtaPrice(res.data.qta_price);
    } catch { /* not logged in */ }
  }, [user]);

  useEffect(() => { loadProducts(); loadUsdtPrice(); }, [loadProducts, loadUsdtPrice]);
  useEffect(() => { loadPositions(); loadBinary(); if (user) fetchWallets(); }, [user, loadPositions, loadBinary]);

  const refreshAll = async () => {
    await Promise.all([loadPositions(), fetchWallets(), loadProducts(), loadUsdtPrice(), loadBinary()]);
  };

  // Sponsor assigns an unplaced downline member to their Left/Right leg (ONCE).
  const handleAssignLeg = async (memberId: string, leg: 'L' | 'R') => {
    const legName = leg === 'L' ? t('earn.binaryLegLeft') : t('earn.binaryLegRight');
    if (!window.confirm(t('earn.binaryAssignConfirm').replace('{leg}', legName))) return;
    setAssignBusy(memberId);
    try {
      await api.post('/earn/binary/assign-leg', { member_id: memberId, leg });
      await loadBinary();
    } catch (e: any) {
      alert(e?.response?.data?.message || t('earn.binaryAssignFailed'));
    } finally {
      setAssignBusy(null);
    }
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

      {/* Binary Team — 좌우 볼륨 총액 + 신규 하부 좌/우 배치(1회) */}
      {user && binary && (
        <div className="mb-6">
          <h2 className="text-[16px] font-bold text-exchange-text mb-3">{t('earn.binaryTeamVolume')}</h2>

          {/* Left / Right volume totals */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-exchange-card border border-exchange-border rounded-2xl p-4">
              <div className="text-[12px] text-exchange-text-third">{t('earn.binaryLeftVolume')}</div>
              <div className="text-[20px] font-bold text-exchange-buy tabular-nums mt-1">
                {fmtUsd(binary.volume.left_usd)}
              </div>
              <div className="text-[10px] text-exchange-text-third mt-1">{t('earn.binaryLineCap')} {fmtUsd(binary.volume.cap_usd)}</div>
            </div>
            <div className="bg-exchange-card border border-exchange-border rounded-2xl p-4">
              <div className="text-[12px] text-exchange-text-third">{t('earn.binaryRightVolume')}</div>
              <div className="text-[20px] font-bold text-exchange-sell tabular-nums mt-1">
                {fmtUsd(binary.volume.right_usd)}
              </div>
              <div className="text-[10px] text-exchange-text-third mt-1">{t('earn.binaryLineCap')} {fmtUsd(binary.volume.cap_usd)}</div>
            </div>
          </div>

          {/* Total + self value + cap */}
          <div className="bg-exchange-card border border-exchange-border rounded-2xl p-4 mb-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] text-exchange-text-third">{t('earn.binaryTotalVolume')}</div>
                <div className="text-[22px] font-bold text-exchange-yellow tabular-nums">
                  {fmtUsd(binary.volume.total_usd)}
                </div>
              </div>
              <div className="text-right text-[12px] text-exchange-text-third leading-relaxed">
                <div>{t('earn.binarySelfValue')} <span className="text-exchange-text font-semibold">{fmtUsd(binary.volume.self_usd)}</span></div>
                <div>{t('earn.binaryLineCap2x')} <span className="text-exchange-text font-semibold">{fmtUsd(binary.volume.cap_usd)}</span></div>
                <div>{t('earn.binaryMatched')} <span className="text-exchange-text font-semibold">{fmtUsd(binary.volume.matched_usd)}</span></div>
              </div>
            </div>
          </div>

          {/* Unplaced downline — sponsor picks Left or Right (one-time) */}
          {binary.unplaced_members.length > 0 && (
            <div className="bg-exchange-card border border-exchange-yellow/40 rounded-2xl p-4 mb-3">
              <div className="text-[13px] font-bold text-exchange-yellow mb-1">{t('earn.binaryUnplacedTitle')}</div>
              <div className="text-[11px] text-exchange-text-third mb-3">
                {t('earn.binaryUnplacedHint')}
              </div>
              <div className="space-y-2">
                {binary.unplaced_members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 bg-exchange-bg border border-exchange-border rounded-xl px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-exchange-text truncate">{m.nickname}</div>
                      <div className="text-[10px] text-exchange-text-third">{new Date(m.joined_at).toLocaleDateString()}</div>
                      <div className="text-[11px] font-bold text-exchange-yellow tabular-nums">
                        {t('earn.binaryMemberStaked')}: {fmtUsd(m.staked_usd || 0)}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        disabled={assignBusy === m.id}
                        onClick={() => handleAssignLeg(m.id, 'L')}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-exchange-buy/15 text-exchange-buy border border-exchange-buy/40 disabled:opacity-50"
                      >{t('earn.binaryPlaceLeft')}</button>
                      <button
                        disabled={assignBusy === m.id}
                        onClick={() => handleAssignLeg(m.id, 'R')}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-exchange-sell/15 text-exchange-sell border border-exchange-sell/40 disabled:opacity-50"
                      >{t('earn.binaryPlaceRight')}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Placed members summary */}
          {(binary.left_members.length > 0 || binary.right_members.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-exchange-card border border-exchange-border rounded-2xl p-3">
                <div className="text-[11px] text-exchange-buy font-bold mb-1">{t('earn.binaryLeftLine')} ({binary.left_members.length})</div>
                <div className="space-y-1">
                  {binary.left_members.map((m) => (
                    <div key={m.id} className="text-[12px] text-exchange-text truncate">{m.nickname}</div>
                  ))}
                </div>
              </div>
              <div className="bg-exchange-card border border-exchange-border rounded-2xl p-3">
                <div className="text-[11px] text-exchange-sell font-bold mb-1">{t('earn.binaryRightLine')} ({binary.right_members.length})</div>
                <div className="space-y-1">
                  {binary.right_members.map((m) => (
                    <div key={m.id} className="text-[12px] text-exchange-text truncate">{m.nickname}</div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* My Positions */}
      {user && positions.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[16px] font-bold text-exchange-text">{t('earn.myPositions')}</h2>
            <span className="text-[11px] font-semibold text-exchange-text-third">
              {t('earn.entryCount').replace('{n}', String(positions.length))}
            </span>
          </div>

          {/* 총 합산 진입금액 (Total combined entry) — sum of every separate stake on this account */}
          {(() => {
            const totalPrincipalUsd = summary
              ? Number(summary.totalPrincipalUsd || 0)
              : positions.reduce((s, p) => s + (Number(p.principal_usd) || 0), 0);
            const totalPrincipalQta = positions.reduce((s, p) => s + (Number(p.principal_qta) || 0), 0);
            const totalDivUsd = summary
              ? Number(summary.totalDividendUsd || 0)
              : positions.reduce((s, p) => s + (Number(p.accrued_dividend_usd) || 0), 0);
            const totalDivQta = summary
              ? Number(summary.totalDividendQta || 0)
              : positions.reduce((s, p) => s + (Number(p.accrued_dividend_qta) || 0), 0);
            return (
              <div
                className="rounded-2xl mb-3 p-4"
                style={{ background: 'linear-gradient(120deg,#101826 0%,#1a1305 100%)', border: '1px solid rgba(240,185,11,0.35)' }}
              >
                <div className="text-[11px] font-semibold tracking-wide text-exchange-yellow mb-2">
                  {t('earn.totalCombined')}
                </div>
                <div className="flex items-end justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-[22px] font-extrabold text-exchange-text tabular-nums leading-none">
                      ${formatAmount(totalPrincipalUsd)}
                    </div>
                    <div className="text-[11px] text-exchange-text-third tabular-nums mt-1">
                      ≈ {formatAmount(totalPrincipalQta)} QTA
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-exchange-text-third">{t('earn.accruedDividend')}</div>
                    <div className="text-[15px] font-bold text-exchange-buy tabular-nums">
                      +{formatAmount(totalDivQta)} QTA
                    </div>
                    <div className="text-[10px] text-exchange-text-third tabular-nums">
                      ≈ ${formatAmount(totalDivUsd)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="space-y-3">
            {positions.map((p, idx) => (
              <div key={p.id} className="bg-exchange-card border border-exchange-border rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-exchange-yellow bg-exchange-yellow/10 border border-exchange-yellow/30 rounded-full px-2 py-0.5">
                    {t('earn.entryNo').replace('{n}', String(idx + 1))}
                  </span>
                  <span className="text-[13px] font-bold text-exchange-buy tabular-nums ml-auto">
                    +{(p.daily_rate * p.term_days * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <CoinIcon symbol="QTA" size={24} />
                  <span className="text-[14px] font-bold text-exchange-text tabular-nums">
                    {formatAmount(p.principal_qta)} QTA
                  </span>
                  <span className="text-[10px] text-exchange-text-third tabular-nums">
                    ≈ ${formatAmount(p.principal_usd)}
                  </span>
                </div>
                {/* Per-position RATE & PERIOD — each separate stake keeps its own rate/term */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-exchange-bg/40 rounded-lg px-3 py-2">
                    <div className="text-[11px] text-exchange-text-third">{t('earn.dailyRate')}</div>
                    <div className="text-[14px] font-bold text-exchange-text tabular-nums">
                      {rate(p.daily_rate)} <span className="text-[10px] font-normal text-exchange-text-third">/ {t('earn.perDay')}</span>
                    </div>
                  </div>
                  <div className="bg-exchange-bg/40 rounded-lg px-3 py-2">
                    <div className="text-[11px] text-exchange-text-third">{t('earn.period')}</div>
                    <div className="text-[14px] font-bold text-exchange-text tabular-nums">
                      {p.term_days} <span className="text-[10px] font-normal text-exchange-text-third">{t('earn.days')}</span>
                    </div>
                  </div>
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
          COMMUNITY BONUS banner (replaces the retired 1대/2대 panel).
          The "?" button top-right opens the matching-bonus rate table.
         ══════════════════════════════════════════════════════════════ */}
      <div className="relative mb-6 rounded-2xl overflow-hidden border border-exchange-yellow/40
                      bg-[radial-gradient(120%_140%_at_15%_0%,#12305a_0%,#0a1526_55%,#060b16_100%)]
                      shadow-[0_0_40px_-12px_rgba(234,179,8,0.35)]">
        {/* subtle glowing network dots */}
        <div className="pointer-events-none absolute inset-0 opacity-40
                        bg-[radial-gradient(circle_at_80%_20%,rgba(56,189,248,0.18),transparent_40%),radial-gradient(circle_at_25%_80%,rgba(234,179,8,0.14),transparent_45%)]" />

        {/* ? help button */}
        <button
          onClick={() => setRateModalOpen(true)}
          aria-label={t('earn.matchTitle')}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center
                     bg-black/30 border border-exchange-yellow/60 text-exchange-yellow
                     hover:bg-exchange-yellow hover:text-black transition-colors"
        >
          <HelpCircle size={18} />
        </button>

        <div className="relative flex flex-col md:flex-row">
          {/* LEFT — Community Bonus headline */}
          <div className="flex-1 px-5 py-5 md:py-6 md:border-r md:border-white/10">
            <h3 className="text-[20px] md:text-[22px] font-extrabold tracking-wide
                           bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-300 bg-clip-text text-transparent">
              COMMUNITY BONUS
            </h3>
            <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-white/90">
              GROW TOGETHER, EARN TOGETHER!
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-slate-300 whitespace-pre-line">
              {t('earn.communityDesc')}
            </p>
            {/* Q coin emblem */}
            <div className="mt-4 flex items-center gap-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-[22px] font-black
                              bg-gradient-to-br from-amber-300 to-yellow-600 text-black
                              shadow-[0_0_22px_-2px_rgba(234,179,8,0.7)] ring-2 ring-amber-200/40">
                Q
              </div>
              <div className="flex-1 h-px bg-gradient-to-r from-amber-400/60 via-sky-400/40 to-transparent" />
            </div>
          </div>

          {/* RIGHT — 1:1 matching diagram */}
          <div className="flex-1 px-5 py-5 md:py-6">
            <div className="text-[13px] font-bold text-amber-200">
              {t('earn.communityMatchTitle')}
            </div>
            <div className="text-[10.5px] text-slate-400 mt-0.5 mb-4">
              {t('earn.communityMatchSub')}
            </div>

            <div className="flex items-center justify-center gap-2">
              {/* LEFT SALES card */}
              <div className="flex-1 rounded-xl border border-sky-400/50 bg-sky-500/5
                              shadow-[inset_0_0_18px_-6px_rgba(56,189,248,0.6)] px-2 py-3 text-center">
                <div className="text-[10px] font-bold text-sky-300 tracking-wide">LEFT SALES</div>
                <Users size={22} className="mx-auto my-1.5 text-sky-300" />
                <div className="text-[11px] font-semibold text-slate-200">{t('earn.communityLeftKo')}</div>
                <div className="text-[9.5px] text-slate-400">(Large Volume)</div>
              </div>

              {/* 1:1 MATCHING circle */}
              <div className="shrink-0 w-16 h-16 rounded-full flex flex-col items-center justify-center
                              border-2 border-amber-400 bg-black/40
                              shadow-[0_0_20px_-4px_rgba(234,179,8,0.8)]">
                <span className="text-[15px] font-black text-amber-300 leading-none">1:1</span>
                <span className="text-[7px] font-bold text-amber-200 tracking-widest mt-0.5">MATCHING</span>
              </div>

              {/* RIGHT SALES card */}
              <div className="flex-1 rounded-xl border border-lime-400/50 bg-lime-500/5
                              shadow-[inset_0_0_18px_-6px_rgba(163,230,53,0.6)] px-2 py-3 text-center">
                <div className="text-[10px] font-bold text-lime-300 tracking-wide">RIGHT SALES</div>
                <Users size={22} className="mx-auto my-1.5 text-lime-300" />
                <div className="text-[11px] font-semibold text-slate-200">{t('earn.communityRightKo')}</div>
                <div className="text-[9.5px] text-slate-400">(Small Volume)</div>
              </div>
            </div>

            <button
              onClick={() => setRateModalOpen(true)}
              className="mt-4 w-full text-[11px] font-semibold py-2 rounded-lg
                         border border-exchange-yellow/50 text-exchange-yellow
                         hover:bg-exchange-yellow hover:text-black transition-colors"
            >
              {t('earn.communityRateBtn')}
            </button>
          </div>
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

      {rateModalOpen && <MatchRateModal onClose={() => setRateModalOpen(false)} />}
    </DesktopPageLayout>
  );
}

// ---------------------------------------------------------------------------
// Matching-bonus rate table modal (opened by the "?" on the Community Bonus
// banner). Shows the 6-tier bonus rate table + how-it-works guidance.
// ---------------------------------------------------------------------------
function MatchRateModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  // Owner rule (2026-08-29): REACH-BASED. Reaching a tier TARGET pays
  // TARGET × rate, once. e.g. 소실적 $1,000 도달 → $1,000×3% = $30.
  const rows = [
    { band: '$1,000',       rate: '3%', payout: '$30' },
    { band: '$5,000',       rate: '4%', payout: '$200' },
    { band: '$10,000',      rate: '5%', payout: '$500' },
    { band: '$50,000',      rate: '6%', payout: '$3,000' },
    { band: '$100,000+',    rate: '8%', payout: '$8,000' },
  ];
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-exchange-card border-t sm:border border-exchange-border rounded-t-2xl sm:rounded-2xl animate-sheet-up max-h-[88vh] overflow-y-auto">
        <div className="flex justify-center pt-3 sm:hidden"><div className="w-10 h-1 rounded-full bg-exchange-border" /></div>
        <div className="flex items-center justify-between px-5 py-4 border-b border-exchange-border sticky top-0 bg-exchange-card z-10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-exchange-yellow/15 flex items-center justify-center">
              <Scale size={15} className="text-exchange-yellow" />
            </div>
            <div>
              <div className="text-[15px] font-bold text-exchange-text">{t('earn.matchTitle')}</div>
              <div className="text-[11px] text-exchange-text-third">{t('earn.matchSubtitle')}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-exchange-text-third hover:text-exchange-text"><X size={20} /></button>
        </div>

        <div className="px-5 py-5">
          {/* how-it-works intro */}
          <p className="text-[12px] text-exchange-text-secondary leading-relaxed mb-4">
            {t('earn.matchIntro')}
          </p>

          {/* rate table (REACH-BASED: 구간 / 요율 / 도달 지급액) */}
          <div className="rounded-xl border border-exchange-border/70 overflow-hidden">
            <div className="grid grid-cols-[1.5fr_0.8fr_1fr] bg-exchange-bg/60 text-[10px] font-bold text-exchange-text-third uppercase tracking-wider">
              <div className="px-2.5 py-2 border-r border-exchange-border/70">{t('earn.matchColAmount')}</div>
              <div className="px-2.5 py-2 text-right border-r border-exchange-border/70">{t('earn.matchColRate')}</div>
              <div className="px-2.5 py-2 text-right">{t('earn.matchColPayout')}</div>
            </div>
            {rows.map((row, i) => (
              <div
                key={row.band}
                className={`grid grid-cols-[1.5fr_0.8fr_1fr] text-[12px] ${
                  i % 2 === 0 ? 'bg-transparent' : 'bg-exchange-bg/30'
                } border-t border-exchange-border/50`}
              >
                <div className="px-2.5 py-2.5 tabular-nums text-exchange-text border-r border-exchange-border/50">
                  {row.band}
                </div>
                <div className="px-2.5 py-2.5 text-right tabular-nums font-bold text-exchange-buy border-r border-exchange-border/50">
                  {row.rate}
                </div>
                <div className="px-2.5 py-2.5 text-right tabular-nums font-bold text-exchange-yellow">
                  {row.payout}
                </div>
              </div>
            ))}
          </div>

          {/* guidance notes */}
          <ul className="mt-4 space-y-1.5 text-[11px] text-exchange-text-third leading-relaxed">
            <li>• {t('earn.matchNote1')}</li>
            <li>• {t('earn.matchNote2')}</li>
            <li>• {t('earn.matchNote3')}</li>
            <li>• {t('earn.matchNote4')}</li>
          </ul>

          <button
            onClick={onClose}
            className="mt-5 w-full py-2.5 rounded-xl bg-exchange-yellow text-black font-bold text-[13px] hover:opacity-90 transition-opacity"
          >
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
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
  // Staking-binary sponsor referral code. Only shown / used on the member's
  // FIRST stake (when they have no binary sponsor yet). Chosen ONCE, permanent.
  const [sponsorCode, setSponsorCode] = useState('');

  // Sponsor 2× 몸값 hard-cap headroom — how much of this stake will actually
  // roll up before the over-cap remainder is DROPPED (owner rule 2026-08-28).
  const [headroom, setHeadroom] = useState<{
    uncapped: boolean; headroom_usd: number | null;
    sponsor_cap_usd: number; sponsor_downline_usd: number; leg_assigned: boolean;
    has_sponsor?: boolean;
  } | null>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onEsc); };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    api.get('/earn/binary/stake-headroom')
      .then((r) => { if (alive) setHeadroom(r.data); })
      .catch(() => { if (alive) setHeadroom(null); });
    return () => { alive = false; };
  }, []);

  const targetUsd = parseFloat(usd) || 0;
  const requiredQta = usdToQta(targetUsd, qtaPrice);
  const inBand = targetUsd >= product.min_usd && targetUsd <= product.max_usd;
  const enough = requiredQta <= qtaBalance;
  // The sponsor referral input is required ONLY on the first stake (no binary
  // sponsor yet). headroom.has_sponsor === false means "no binary parent yet".
  const needsSponsor = !!headroom && headroom.has_sponsor === false;
  const sponsorOk = !needsSponsor || sponsorCode.trim().length > 0;
  const valid = targetUsd > 0 && inBand && enough && sponsorOk;

  // Capped only when the user is placed under a sponsor with an assigned leg.
  const capped = !!headroom && !headroom.uncapped && headroom.headroom_usd != null;
  const headroomUsd = capped ? (headroom!.headroom_usd as number) : Infinity;
  const overCap = capped && targetUsd > headroomUsd;
  const droppedUsd = overCap ? targetUsd - headroomUsd : 0;

  const totalDividendUsd = targetUsd * product.total_return;
  const totalDividendQta = totalDividendUsd / qtaPrice;
  const dailyQta = (targetUsd * product.daily_rate) / qtaPrice;

  const submit = async () => {
    if (!valid) return;
    // Over-cap warning popup (owner rule 2026-08-28): the portion above the
    // sponsor's remaining headroom will NOT count toward matching — it is
    // dropped. Let the user confirm or go back and resize the principal.
    if (overCap) {
      const ok = window.confirm(
        t('earn.capOverConfirm', {
          headroom: `$${Math.floor(headroomUsd).toLocaleString('en-US')}`,
          dropped: `$${Math.ceil(droppedUsd).toLocaleString('en-US')}`,
        }),
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      // On the FIRST stake (no binary sponsor yet) send the chosen sponsor
      // referral code — the server binds it as the permanent binary_parent_id.
      const payload: Record<string, unknown> = { product_id: product.id, amount_usd: targetUsd };
      if (needsSponsor && sponsorCode.trim()) {
        payload.sponsor_code = sponsorCode.trim();
      }
      const res = await api.post('/earn/subscribe', payload);
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
          {/* Referral (sponsor) code — FIRST stake only. Chosen ONCE, permanent. */}
          {needsSponsor && (
            <div>
              <div className="flex justify-between text-[12px] mb-1.5">
                <span className="text-exchange-text-third">{t('earn.sponsorLabel')}</span>
              </div>
              <input
                type="text"
                value={sponsorCode}
                onChange={(e) => setSponsorCode(e.target.value.toUpperCase())}
                className="input-field text-center tracking-widest font-semibold uppercase"
                placeholder={t('earn.sponsorPlaceholder')}
                maxLength={16}
              />
              <p className="text-[11px] text-exchange-text-third mt-1.5">
                {t('earn.sponsorHint')}
              </p>
            </div>
          )}
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

          {/* Sponsor 2× 몸값 cap headroom — informational when within limit,
              a hard warning when the target exceeds the sponsor's headroom
              (over-cap volume is DROPPED, owner rule 2026-08-28). */}
          {capped && !overCap && headroomUsd > 0 && (
            <div className="rounded-xl bg-exchange-input border border-exchange-border p-3 text-[11px] text-exchange-text-secondary flex items-start gap-2">
              <Scale size={13} className="text-exchange-text-third mt-0.5 shrink-0" />
              <span>{t('earn.capHeadroomHint', {
                headroom: `$${Math.floor(headroomUsd).toLocaleString('en-US')}`,
              })}</span>
            </div>
          )}
          {capped && headroomUsd <= 0 && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/40 p-3 text-[11px] text-red-300 flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{t('earn.capHeadroomFull')}</span>
            </div>
          )}
          {overCap && headroomUsd > 0 && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/40 p-3 text-[11px] text-red-300 flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{t('earn.capOverWarn', {
                headroom: `$${Math.floor(headroomUsd).toLocaleString('en-US')}`,
                dropped: `$${Math.ceil(droppedUsd).toLocaleString('en-US')}`,
              })}</span>
            </div>
          )}

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
              : overCap ? t('earn.confirmStakeOverCap')
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
