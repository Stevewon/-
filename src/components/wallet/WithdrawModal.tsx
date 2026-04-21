import { useEffect, useMemo, useState } from 'react';
import {
  X, ArrowUpRight, AlertTriangle, Shield, ChevronLeft,
  Check, Info,
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { getNetworks } from '../../utils/networks';
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

  useEffect(() => {
    if (open) {
      setCoin(initialCoin);
      setAddress('');
      setMemo('');
      setAmount('');
      setStep('form');
      setTwoFA('');
    }
  }, [open, initialCoin]);

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

  const numAmount = parseFloat(amount) || 0;
  const fee = network?.withdrawFee || 0;
  const receiveAmount = Math.max(0, numAmount - fee);
  const totalDebit = numAmount;
  const priceUsd = wallet?.price_usd || 0;
  const valueUsd = numAmount * priceUsd;

  const addressValid = useMemo(() => {
    if (!address) return null;
    if (!network) return null;
    return network.addressRegex.test(address);
  }, [address, network]);

  const amountValid = useMemo(() => {
    if (!numAmount) return null;
    if (numAmount < network.minWithdraw) return false;
    if (numAmount > available) return false;
    if (numAmount <= fee) return false;
    return true;
  }, [numAmount, network, available, fee]);

  const canProceed = addressValid === true && amountValid === true && (!network?.memoRequired || memo.trim());

  const setPercent = (p: number) => {
    const v = (available * p) / 100;
    setAmount(v > 0 ? String(Number(v.toFixed(8))) : '');
  };

  const submitWithdraw = async () => {
    setLoading(true);
    try {
      await api.post('/wallet/withdraw', {
        coin_symbol: coin,
        amount: numAmount,
        address,
        network: network.id,
        memo: memo || undefined,
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
                        {t('wallet.fee')}: {n.withdrawFee}
                      </span>
                    </div>
                    <div className="text-[10px] text-exchange-text-third mt-0.5">{n.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="text-xs text-exchange-text-third mb-1.5 block font-medium">
                {t('wallet.withdrawAddress')}
              </label>
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value.trim())}
                placeholder={network?.addressExample}
                className={`input-field w-full text-xs font-mono ${
                  addressValid === false ? 'border-exchange-sell/50' : ''
                }`}
              />
              {addressValid === false && (
                <p className="text-[11px] text-exchange-sell mt-1 flex items-center gap-1">
                  <AlertTriangle size={11} /> {t('wallet.invalidAddress')}
                </p>
              )}
              {addressValid === true && (
                <p className="text-[11px] text-exchange-buy mt-1 flex items-center gap-1">
                  <Check size={11} /> {t('wallet.validAddress')}
                </p>
              )}
            </div>

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
                  {t('wallet.min')}: <span className="tabular-nums">{network?.minWithdraw} {coin}</span>
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
                  {numAmount > available
                    ? t('wallet.insufficientBalance')
                    : numAmount < network.minWithdraw
                    ? t('wallet.belowMinWithdraw', { min: network.minWithdraw, coin })
                    : t('wallet.amountMustExceedFee')}
                </p>
              )}
            </div>

            {/* Summary */}
            <div className="bg-exchange-bg/50 rounded-lg border border-exchange-border/50 p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-exchange-text-third">{t('wallet.networkFee')}</span>
                <span className="tabular-nums text-exchange-text-secondary">
                  {fee} {coin}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-exchange-text-third">{t('wallet.youWillReceive')}</span>
                <span className="tabular-nums font-semibold text-exchange-text">
                  {receiveAmount > 0 ? formatAmount(receiveAmount) : '0'} {coin}
                </span>
              </div>
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
              disabled={!canProceed}
              onClick={() => setStep('confirm')}
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
                <span className="text-exchange-text-third">{t('wallet.networkFee')}</span>
                <span className="tabular-nums text-exchange-text-secondary">{fee} {coin}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold pt-2 border-t border-exchange-border">
                <span className="text-exchange-text">{t('wallet.youWillReceive')}</span>
                <span className="tabular-nums text-exchange-buy">{formatAmount(receiveAmount)} {coin}</span>
              </div>
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
