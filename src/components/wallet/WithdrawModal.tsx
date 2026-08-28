import { useEffect, useMemo, useState } from 'react';
import {
  X, ArrowUpRight, AlertTriangle, Shield, ChevronLeft,
  Check, Info,
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { getNetworks, isQuantariumAsset } from '../../utils/networks';
import CoinIcon from '../common/CoinIcon';
import { showToast } from '../common/Toast';
import api from '../../utils/api';
import useStore from '../../store/useStore';
import { formatAmount, formatPrice } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  initialCoin?: string;
}

type Step = 'form' | 'confirm' | 'done';

export default function WithdrawModal({ open, onClose, initialCoin = 'USDT' }: Props) {
  const { t } = useI18n();
  const { user, wallets, fetchWallets } = useStore();
  const [coin, setCoin] = useState(initialCoin);
  const [networkId, setNetworkId] = useState('');
  const [address, setAddress] = useState('');
  const [memo, setMemo] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [twoFA, setTwoFA] = useState('');
  // ★ Quantarium-native assets (QTA / QX / QKEY) can ONLY be withdrawn to a
  //   Quantarium Network address. The user must explicitly acknowledge this
  //   before they can proceed (wrong-network sends are unrecoverable).
  const [qtaAck, setQtaAck] = useState(false);
  // ★ OWNER RULE (2026-08-28): QTA / QX / QKEY (and any QTA payout) are paid
  //   out ONLY to the company's fixed MAIN Quantarium wallet. The user can
  //   NEVER choose the destination — we fetch it from the chain state and
  //   render it read-only. The server force-overrides it regardless.
  const [mainWallet, setMainWallet] = useState('');

  // Fetch the fixed main payout wallet once the modal opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.get('/chain/qta/state')
      .then(res => { if (alive) setMainWallet(String(res.data?.chain?.main_payout_wallet || '')); })
      .catch(() => { /* leave empty — server still force-overrides on submit */ });
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (open) {
      setCoin(initialCoin);
      setAddress('');
      setMemo('');
      setAmount('');
      setStep('form');
      setTwoFA('');
      setQtaAck(false);
      setPayoutCoin(isQuantariumAsset(initialCoin) ? 'QTA' : 'USDT');
    }
  }, [open, initialCoin]);

  // Reset the acknowledgement whenever the coin changes.
  useEffect(() => {
    setQtaAck(false);
  }, [coin]);

  const networks = useMemo(() => getNetworks(coin), [coin]);
  const network = useMemo(
    () => networks.find(n => n.id === networkId) || networks[0],
    [networks, networkId]
  );

  useEffect(() => {
    setNetworkId(networks[0]?.id || '');
  }, [coin]); // eslint-disable-line

  const wallet = useMemo(
    () => wallets.find(w => w.coin_symbol === coin),
    [wallets, coin]
  );
  const available = wallet?.available || 0;
  // ★★★★★★★ Boss's permanent rule (2026-06-22):
  // available_initial = company-issued amount (sign-up bonus, referral
  // rewards, daily rewards, admin credits) — cannot leave the exchange.
  // withdrawable = available - available_initial. Falls back to 0 for
  // safety if the field is missing (old API response).
  const availableInitial = Number((wallet as any)?.available_initial || 0);
  const withdrawable = Math.max(0, available - availableInitial);

  // ★★★★★★★ Boss's withdrawal-fee rule (2026-08-26):
  //   • Flat 5% withdrawal fee — the user always receives 95% of what they
  //     request. This REPLACES the old per-network flat withdrawFee.
  //   • Minimum withdrawal = $50 USD equivalent, valued at the coin's live
  //     USD price that day. Below $50 -> hard-blocked with a warning.
  const WITHDRAW_FEE_RATE = 0.05;         // 5%
  const MIN_WITHDRAW_USD = 50;            // $50 minimum

  const numAmount = parseFloat(amount) || 0;
  const priceUsd = wallet?.price_usd || 0;
  const valueUsd = numAmount * priceUsd;
  // 5% fee, expressed in the withdrawn coin.
  const fee = numAmount * WITHDRAW_FEE_RATE;
  const receiveAmount = Math.max(0, numAmount - fee);
  const totalDebit = numAmount;
  // Minimum amount in the withdrawn coin = $50 / live price. Guard against a
  // zero/missing price (fall back so the field still works, never letting the
  // $50 floor evaporate to 0).
  const minAmountCoin = priceUsd > 0 ? MIN_WITHDRAW_USD / priceUsd : Infinity;
  const belowMinUsd = numAmount > 0 && valueUsd < MIN_WITHDRAW_USD;

  // ── Payout-coin choice (boss's 2026-08-26 rule): the user CHOOSES to
  //    receive their withdrawal value as QTA or USDT, converted at THIS
  //    moment's live prices. Live prices are read from the wallets feed
  //    (each wallet carries coins.price_usd). We fall back to the launch
  //    peg (QTA $0.00357142857, USDT $1.00) if a wallet is missing.
  const [payoutCoin, setPayoutCoin] = useState<'QTA' | 'USDT'>('USDT');
  const qtaPriceUsd = useMemo(
    () => wallets.find(w => w.coin_symbol === 'QTA')?.price_usd || 0.00357142857,
    [wallets],
  );
  const usdtPriceUsd = useMemo(
    () => wallets.find(w => w.coin_symbol === 'USDT')?.price_usd || 1,
    [wallets],
  );
  const payoutPriceUsd = payoutCoin === 'QTA' ? qtaPriceUsd : usdtPriceUsd;
  // The value the user receives, expressed in the chosen payout coin.
  const payoutReceive = payoutPriceUsd > 0 ? (receiveAmount * priceUsd) / payoutPriceUsd : 0;

  // ★ Quantarium-native asset flag. QTA / QX / QKEY live only on the
  //   Quantarium chain (chain_id 60000) and must go to a Quantarium address.
  const isQta = useMemo(() => isQuantariumAsset(coin), [coin]);
  const QTA_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

  // ★ A payout is settled as a Quantarium-native asset (→ forced main wallet)
  //   whenever the user receives QTA, or withdraws a Quantarium coin in-kind.
  const isQtaPayout = useMemo(
    () => payoutCoin === 'QTA' || (isQta && payoutCoin === coin),
    [payoutCoin, isQta, coin],
  );

  // When the destination is forced, keep `address` pinned to the main wallet
  // so the confirm screen and (belt-and-braces) request body carry it too.
  useEffect(() => {
    if (isQtaPayout && mainWallet) setAddress(mainWallet);
  }, [isQtaPayout, mainWallet]);

  const addressValid = useMemo(() => {
    // Forced-destination payouts are always valid once the main wallet is known.
    if (isQtaPayout) return mainWallet ? true : null;
    if (!address) return null;
    if (isQta) {
      // Strict: Quantarium Network address only (0x + 40 hex).
      return QTA_ADDR_RE.test(address);
    }
    if (!network) return null;
    return network.addressRegex.test(address);
  }, [address, network, isQta, isQtaPayout, mainWallet]);

  const amountValid = useMemo(() => {
    if (!numAmount) return null;
    // $50 USD minimum (valued at the coin's live price that day).
    if (belowMinUsd) return false;
    if (numAmount > withdrawable) return false;
    if (numAmount <= fee) return false;
    return true;
  }, [numAmount, withdrawable, fee, belowMinUsd]);

  const canProceed =
    addressValid === true &&
    amountValid === true &&
    (!network?.memoRequired || memo.trim()) &&
    (!isQta || qtaAck); // Quantarium assets require the acknowledgement

  const setPercent = (p: number) => {
    const v = (withdrawable * p) / 100;
    setAmount(v > 0 ? String(Number(v.toFixed(8))) : '');
  };

  const submitWithdraw = async () => {
    // ★ Forced-destination payouts (QTA / QX / QKEY → main wallet): the address
    //   is company-fixed; the server force-overrides it anyway. For all OTHER
    //   Quantarium in-kind sends keep the 0x-format safety net.
    const effectiveAddress = isQtaPayout ? (mainWallet || address) : address;
    if (isQta && !isQtaPayout && !QTA_ADDR_RE.test(effectiveAddress)) {
      showToast('error', t('wallet.qtaOnlyTitle'), t('wallet.qtaNotQuantariumAddr'));
      setStep('form');
      return;
    }
    setLoading(true);
    try {
      await api.post('/wallet/withdraw', {
        coin_symbol: coin,
        amount: numAmount,
        address: effectiveAddress,
        network: network.id,
        memo: memo || undefined,
        payout_coin: payoutCoin,
      });
      setStep('done');
      fetchWallets();
      showToast('success', t('wallet.withdrawSubmitted'), `${formatAmount(numAmount)} ${coin}`);
    } catch (err: any) {
      showToast('error', t('wallet.withdrawFailed'), err.response?.data?.error);
      setStep('form');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-exchange-card border border-exchange-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-exchange-border sticky top-0 bg-exchange-card z-10">
          <div className="flex items-center gap-2">
            {step === 'confirm' && (
              <button onClick={() => setStep('form')} className="text-exchange-text-third hover:text-exchange-text p-1">
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="w-8 h-8 rounded-lg bg-exchange-sell/10 flex items-center justify-center">
              <ArrowUpRight size={18} className="text-exchange-sell" />
            </div>
            <h2 className="text-lg font-semibold text-exchange-text">
              {step === 'confirm' ? t('wallet.confirmWithdraw') : step === 'done' ? t('wallet.withdrawSubmitted') : t('wallet.withdraw')}
            </h2>
          </div>
          <button onClick={onClose} className="text-exchange-text-third hover:text-exchange-text p-1">
            <X size={20} />
          </button>
        </div>

        {/* Step: FORM */}
        {step === 'form' && (
          <div className="p-5 space-y-4">
            {/* ★ Withdrawal notice — 5% fee + $50 minimum (boss rule 2026-08-26) */}
            <div className="bg-exchange-yellow/10 border border-exchange-yellow/30 rounded-lg p-3 flex items-start gap-2">
              <Info size={14} className="text-exchange-yellow shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed text-exchange-text-secondary">
                <p className="font-semibold text-exchange-yellow mb-0.5">{t('wallet.noticeTitle')}</p>
                <p>{t('wallet.noticeFee')}</p>
                <p>{t('wallet.noticeMin')}</p>
              </div>
            </div>
            {/* Coin Select */}
            <div>
              <label className="text-xs text-exchange-text-third mb-1.5 block font-medium">
                {t('wallet.coinSelect')}
              </label>
              <div className="relative">
                <select
                  value={coin}
                  onChange={e => setCoin(e.target.value)}
                  className="input-field w-full text-sm pl-10"
                >
                  {wallets.map(w => (
                    <option key={w.coin_symbol} value={w.coin_symbol}>
                      {w.coin_symbol} - {w.coin_name}
                    </option>
                  ))}
                </select>
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  <CoinIcon symbol={coin} size={22} />
                </div>
              </div>
              <p className="text-[11px] text-exchange-text-third mt-1 flex justify-between">
                <span>{t('wallet.availableBalance')}</span>
                <span className="tabular-nums text-exchange-text">
                  {formatAmount(available)} {coin}
                </span>
              </p>
              {/* ★ Withdrawable = available - available_initial */}
              <p className="text-[11px] mt-0.5 flex justify-between">
                <span className="text-exchange-buy">{t('wallet.withdrawable')}</span>
                <span className="tabular-nums text-exchange-buy font-semibold">
                  {formatAmount(withdrawable)} {coin}
                </span>
              </p>
              {availableInitial > 0 && (
                <p className="text-[10px] mt-0.5 flex justify-between text-exchange-text-third">
                  <span title={t('wallet.companyIssuedHint')}>
                    {t('wallet.companyIssued')} <span className="opacity-60">(?)</span>
                  </span>
                  <span className="tabular-nums">
                    {formatAmount(availableInitial)} {coin}
                  </span>
                </p>
              )}
            </div>

            {/* Network Select */}
            <div>
              <label className="text-xs text-exchange-text-third mb-1.5 block font-medium">
                {t('wallet.network')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {networks.map(n => (
                  <button
                    key={n.id}
                    onClick={() => setNetworkId(n.id)}
                    className={`text-left px-3 py-2.5 rounded-lg border text-xs transition-all ${
                      network.id === n.id
                        ? 'border-exchange-yellow bg-exchange-yellow/10 text-exchange-text'
                        : 'border-exchange-border bg-exchange-bg/50 text-exchange-text-secondary hover:border-exchange-yellow/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{n.shortName}</span>
                      <span className="text-[10px] text-exchange-text-third tabular-nums">
                        {t('wallet.fee')}: 5%
                      </span>
                    </div>
                    <div className="text-[10px] text-exchange-text-third mt-0.5">{n.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* ★ Payout coin choice — receive value as QTA or USDT at live price */}
            <div>
              <label className="text-xs text-exchange-text-third mb-1.5 block font-medium">
                {t('wallet.payoutCoin')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['QTA', 'USDT'] as const).map(pc => (
                  <button
                    key={pc}
                    type="button"
                    onClick={() => setPayoutCoin(pc)}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm transition-all ${
                      payoutCoin === pc
                        ? 'border-exchange-yellow bg-exchange-yellow/10 text-exchange-text'
                        : 'border-exchange-border bg-exchange-bg/50 text-exchange-text-secondary hover:border-exchange-yellow/50'
                    }`}
                  >
                    <CoinIcon symbol={pc} size={18} />
                    <span className="font-semibold">{pc}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-exchange-text-third mt-1 flex items-center gap-1">
                <Info size={11} className="shrink-0" />
                {payoutCoin === 'QTA'
                  ? `${t('wallet.payoutNote')} · 1 QTA ≈ $${qtaPriceUsd.toFixed(5)}`
                  : `${t('wallet.payoutNote')} · 1 USDT ≈ $${usdtPriceUsd.toFixed(4)}`}
              </p>
            </div>

            {/* ★ Quantarium-only warning banner (QTA / QX / QKEY) */}
            {isQta && (
              <div className="bg-exchange-sell/10 border-2 border-exchange-sell/40 rounded-lg p-3.5 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-exchange-sell shrink-0" />
                  <span className="text-sm font-bold text-exchange-sell">
                    {t('wallet.qtaOnlyTitle')}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-exchange-text-secondary">
                  {t('wallet.qtaOnlyWarn', { coin })}
                </p>
                <label className="flex items-start gap-2 cursor-pointer pt-1 select-none">
                  <input
                    type="checkbox"
                    checked={qtaAck}
                    onChange={e => setQtaAck(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-exchange-sell)] cursor-pointer"
                  />
                  <span className="text-[11px] font-medium text-exchange-text">
                    {t('wallet.qtaOnlyConfirm', { coin })}
                  </span>
                </label>
              </div>
            )}

            {/* Address */}
            {isQtaPayout ? (
              /* ★ OWNER RULE (2026-08-28): QTA/QX/QKEY payouts go ONLY to the
                 company's fixed MAIN Quantarium wallet. Destination is NOT
                 editable — shown read-only. */
              <div>
                <label className="text-xs text-exchange-text-third mb-1.5 block font-medium">
                  {t('wallet.mainWalletDestTitle')}
                </label>
                <div className="rounded-lg border border-exchange-yellow/30 bg-exchange-yellow/5 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Shield size={12} className="text-exchange-yellow shrink-0" />
                    <span className="text-[11px] font-semibold text-exchange-yellow">
                      {t('wallet.mainWalletDestLabel')}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-exchange-text break-all select-all">
                    {mainWallet || '—'}
                  </div>
                  <p className="text-[10px] text-exchange-text-third mt-1.5 flex items-start gap-1">
                    <Info size={11} className="shrink-0 mt-0.5" />
                    {t('wallet.mainWalletDestHint')}
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <label className="text-xs text-exchange-text-third mb-1.5 block font-medium">
                  {t('wallet.withdrawAddress')}
                  {isQta && (
                    <span className="ml-1 text-exchange-yellow">
                      · {t('wallet.qtaOnlyTitle')}
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={e => setAddress(e.target.value.trim())}
                  placeholder={isQta ? '0x...' : network?.addressExample}
                  disabled={isQta && !qtaAck}
                  className={`input-field w-full text-xs font-mono ${
                    addressValid === false ? 'border-exchange-sell/50' : ''
                  } ${isQta && !qtaAck ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
                {isQta && (
                  <p className="text-[10px] text-exchange-text-third mt-1 flex items-start gap-1">
                    <Info size={11} className="shrink-0 mt-0.5" />
                    {t('wallet.qtaOnlyAddrHint')}
                  </p>
                )}
                {addressValid === false && (
                  <p className="text-[11px] text-exchange-sell mt-1 flex items-center gap-1">
                    <AlertTriangle size={11} />{' '}
                    {isQta ? t('wallet.qtaNotQuantariumAddr') : t('wallet.invalidAddress')}
                  </p>
                )}
                {addressValid === true && (
                  <p className="text-[11px] text-exchange-buy mt-1 flex items-center gap-1">
                    <Check size={11} /> {t('wallet.validAddress')}
                  </p>
                )}
              </div>
            )}

            {/* Memo */}
            {network?.memoRequired && (
              <div>
                <label className="text-xs text-exchange-yellow mb-1.5 block font-medium flex items-center gap-1">
                  <AlertTriangle size={11} />
                  {network.memoLabel} ({t('wallet.required')})
                </label>
                <input
                  type="text"
                  value={memo}
                  onChange={e => setMemo(e.target.value.trim())}
                  placeholder="1234567"
                  className="input-field w-full text-sm font-mono"
                />
                <p className="text-[10px] text-exchange-text-third mt-1">{t('wallet.memoWarning')}</p>
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="text-xs text-exchange-text-third mb-1.5 block font-medium flex justify-between">
                <span>{t('wallet.withdrawAmount')}</span>
                <span className="text-exchange-text-third">
                  {t('wallet.min')}: <span className="tabular-nums">$50{minAmountCoin !== Infinity ? ` ≈ ${formatAmount(minAmountCoin)} ${coin}` : ''}</span>
                </span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  step="any"
                  className={`input-field w-full text-sm tabular-nums pr-16 ${
                    amountValid === false ? 'border-exchange-sell/50' : ''
                  }`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-exchange-text-third font-medium">
                  {coin}
                </span>
              </div>
              <div className="flex gap-1 mt-1.5">
                {[25, 50, 75, 100].map(p => (
                  <button
                    key={p}
                    onClick={() => setPercent(p)}
                    className="text-[10px] px-2 py-0.5 rounded bg-exchange-hover/50 text-exchange-text-secondary hover:text-exchange-yellow hover:bg-exchange-yellow/10 transition-colors tabular-nums"
                  >
                    {p}%
                  </button>
                ))}
              </div>
              {amountValid === false && numAmount > 0 && (
                <p className="text-[11px] text-exchange-sell mt-1 flex items-center gap-1">
                  <AlertTriangle size={11} />
                  {numAmount > withdrawable
                    ? (availableInitial > 0
                        ? t('wallet.insufficientWithdrawable')
                        : t('wallet.insufficientBalance'))
                    : belowMinUsd
                    ? t('wallet.belowMinUsd', { usd: MIN_WITHDRAW_USD })
                    : t('wallet.amountMustExceedFee')}
                </p>
              )}
            </div>

            {/* Summary */}
            <div className="bg-exchange-bg/50 rounded-lg border border-exchange-border/50 p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-exchange-text-third">{t('wallet.feePercent')}</span>
                <span className="tabular-nums text-exchange-text-secondary">
                  {formatAmount(fee)} {coin} (5%)
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-exchange-text-third">{t('wallet.youWillReceive')}</span>
                <span className="tabular-nums font-semibold text-exchange-buy">
                  {payoutReceive > 0 ? formatAmount(payoutReceive) : '0'} {payoutCoin}
                </span>
              </div>
              {coin !== payoutCoin && receiveAmount > 0 && (
                <div className="flex justify-between text-[10px] text-exchange-text-third">
                  <span>{t('wallet.convertedFrom')}</span>
                  <span className="tabular-nums">
                    {formatAmount(receiveAmount)} {coin} @ live price
                  </span>
                </div>
              )}
              {valueUsd > 0 && (
                <div className="flex justify-between text-[10px] text-exchange-text-third">
                  <span>≈ USD</span>
                  <span className="tabular-nums">${formatPrice(valueUsd)}</span>
                </div>
              )}
            </div>

            {/* Warning */}
            <div className="bg-exchange-sell/5 border border-exchange-sell/20 rounded-lg p-3 text-[11px] text-exchange-text-secondary flex items-start gap-2">
              <AlertTriangle size={13} className="text-exchange-sell shrink-0 mt-0.5" />
              <span>{t('wallet.warnWithdrawFinal', { network: network?.shortName })}</span>
            </div>

            <button
              onClick={() => {
                // ★ Hard warning popup for sub-$50 attempts (boss rule).
                if (belowMinUsd) {
                  showToast('error', t('wallet.minWarnTitle'), t('wallet.minWarnBody', { usd: MIN_WITHDRAW_USD }));
                  return;
                }
                if (!canProceed) return;
                setStep('confirm');
              }}
              disabled={!canProceed && !belowMinUsd}
              className="btn-sell w-full py-3 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('wallet.continue')}
            </button>
          </div>
        )}

        {/* Step: CONFIRM */}
        {step === 'confirm' && (
          <div className="p-5 space-y-4">
            <div className="bg-exchange-bg/50 rounded-xl border border-exchange-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-exchange-text-third">{t('wallet.coin')}</span>
                <div className="flex items-center gap-2">
                  <CoinIcon symbol={coin} size={20} />
                  <span className="text-sm font-semibold text-exchange-text">{coin}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-exchange-text-third">{t('wallet.network')}</span>
                <span className="text-sm text-exchange-text">{network.name}</span>
              </div>
              <div>
                <div className="text-xs text-exchange-text-third mb-1">{t('wallet.toAddress')}</div>
                <code className="text-[11px] font-mono text-exchange-text break-all block bg-exchange-card rounded-lg p-2 border border-exchange-border/50">
                  {address}
                </code>
              </div>
              {memo && (
                <div>
                  <div className="text-xs text-exchange-yellow mb-1">{network.memoLabel}</div>
                  <code className="text-xs font-mono text-exchange-text block bg-exchange-card rounded-lg p-2 border border-exchange-yellow/30">
                    {memo}
                  </code>
                </div>
              )}
              <div className="h-px bg-exchange-border" />
              <div className="flex justify-between text-xs">
                <span className="text-exchange-text-third">{t('wallet.amount')}</span>
                <span className="tabular-nums text-exchange-text">{formatAmount(numAmount)} {coin}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-exchange-text-third">{t('wallet.feePercent')}</span>
                <span className="tabular-nums text-exchange-text-secondary">{formatAmount(fee)} {coin} (5%)</span>
              </div>
              <div className="flex justify-between text-sm font-semibold pt-2 border-t border-exchange-border">
                <span className="text-exchange-text">{t('wallet.youWillReceive')}</span>
                <span className="tabular-nums text-exchange-buy">{formatAmount(payoutReceive)} {payoutCoin}</span>
              </div>
              {coin !== payoutCoin && (
                <div className="flex justify-between text-[10px] text-exchange-text-third">
                  <span>{t('wallet.convertedFrom')}</span>
                  <span className="tabular-nums">{formatAmount(receiveAmount)} {coin}</span>
                </div>
              )}
            </div>

            {/* 2FA (optional, demo) */}
            <div className="bg-exchange-yellow/5 border border-exchange-yellow/20 rounded-lg p-3">
              <label className="text-xs text-exchange-yellow font-medium mb-1.5 flex items-center gap-1.5">
                <Shield size={12} />
                {t('wallet.twoFactorCode')} ({t('wallet.optional')})
              </label>
              <input
                type="text"
                value={twoFA}
                onChange={e => setTwoFA(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="input-field w-full text-sm tabular-nums tracking-widest font-mono text-center"
                maxLength={6}
              />
              <p className="text-[10px] text-exchange-text-third mt-1">{t('wallet.twoFactorDesc')}</p>
            </div>

            {/* ★ Quantarium-only re-warning on final confirm */}
            {isQta && (
              <div className="bg-exchange-sell/10 border-2 border-exchange-sell/40 rounded-lg p-3 text-[11px] text-exchange-text-secondary flex items-start gap-2">
                <AlertTriangle size={14} className="text-exchange-sell shrink-0 mt-0.5" />
                <span className="font-medium text-exchange-text">
                  {t('wallet.qtaConfirmBanner')}
                </span>
              </div>
            )}

            <div className="bg-exchange-sell/5 border border-exchange-sell/20 rounded-lg p-3 text-[11px] text-exchange-text-secondary flex items-start gap-2">
              <AlertTriangle size={13} className="text-exchange-sell shrink-0 mt-0.5" />
              <span>{t('wallet.warnFinalConfirm')}</span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep('form')}
                className="flex-1 py-3 rounded-lg text-sm font-medium border border-exchange-border text-exchange-text-secondary hover:bg-exchange-hover/30"
              >
                {t('common.back')}
              </button>
              <button
                disabled={loading}
                onClick={submitWithdraw}
                className="flex-1 btn-sell py-3 rounded-lg text-sm font-semibold disabled:opacity-40"
              >
                {loading ? t('wallet.processing') : t('wallet.confirmSubmit')}
              </button>
            </div>
          </div>
        )}

        {/* Step: DONE */}
        {step === 'done' && (
          <div className="p-6 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-exchange-buy/10 flex items-center justify-center">
              <Check size={32} className="text-exchange-buy" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-exchange-text">{t('wallet.withdrawSubmitted')}</h3>
              <p className="text-xs text-exchange-text-secondary mt-1">{t('wallet.withdrawPendingDesc')}</p>
            </div>
            <div className="bg-exchange-bg/50 rounded-lg border border-exchange-border/50 p-3 text-left space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-exchange-text-third">{t('wallet.amount')}</span>
                <span className="tabular-nums text-exchange-text font-medium">
                  {formatAmount(numAmount)} {coin}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-exchange-text-third">{t('wallet.network')}</span>
                <span className="text-exchange-text">{network?.shortName}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-exchange-text-third">{t('admin.status')}</span>
                <span className="text-exchange-yellow">{t('status.pending')}</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-full btn-primary py-3 rounded-lg text-sm font-semibold"
            >
              {t('common.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
