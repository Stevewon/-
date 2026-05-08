import { useEffect, useMemo, useState } from 'react';
import {
  X, ArrowDownLeft, Copy, Check, AlertTriangle, Info,
  Clock, ChevronDown, ChevronUp, Shield,
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { getNetworks, generateDepositAddress, generateMemo } from '../../utils/networks';
import CoinIcon from '../common/CoinIcon';
import QRCode from '../common/QRCode';
import { showToast } from '../common/Toast';
import api from '../../utils/api';
import useStore from '../../store/useStore';

interface Props {
  open: boolean;
  onClose: () => void;
  initialCoin?: string;
}

export default function DepositModal({ open, onClose, initialCoin = 'USDT' }: Props) {
  const { t } = useI18n();
  const { user, wallets, fetchWallets } = useStore();
  const [coin, setCoin] = useState(initialCoin);
  const [networkId, setNetworkId] = useState('');
  const [testAmount, setTestAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<'address' | 'memo' | null>(null);
  const [showTest, setShowTest] = useState(false);

  useEffect(() => {
    if (open) {
      setCoin(initialCoin);
      setTestAmount('');
      setShowTest(false);
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

  const address = useMemo(() => {
    if (!user || !network) return '';
    return generateDepositAddress(user.id, coin, network.id);
  }, [user, coin, network]);

  const memo = useMemo(() => {
    if (!user || !network?.memoRequired) return '';
    return generateMemo(user.id);
  }, [user, network]);

  const copy = async (text: string, type: 'address' | 'memo') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      showToast('success', t('wallet.copied'), text);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      showToast('error', t('wallet.copyFailed'));
    }
  };

  const handleTestDeposit = async () => {
    const amount = parseFloat(testAmount);
    if (!amount || amount <= 0) {
      showToast('error', t('wallet.invalidAmount'));
      return;
    }
    if (amount < network.minDeposit) {
      showToast('error', t('wallet.belowMinDeposit'), `${t('wallet.minAmount')}: ${network.minDeposit} ${coin}`);
      return;
    }
    setLoading(true);
    try {
      await api.post('/wallet/deposit', { coin_symbol: coin, amount });
      showToast('success', t('wallet.depositComplete'), `+${amount} ${coin}`);
      setTestAmount('');
      fetchWallets();
    } catch (err: any) {
      showToast('error', t('wallet.depositFailed'), err.response?.data?.error);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const selectedWallet = wallets.find(w => w.coin_symbol === coin);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-exchange-card border border-exchange-border rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto animate-slide-up shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-exchange-border sticky top-0 bg-exchange-card z-10 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-exchange-buy/15 flex items-center justify-center">
              <ArrowDownLeft size={20} className="text-exchange-buy" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-exchange-text leading-tight">{t('wallet.deposit')}</h2>
              <p className="text-xs text-exchange-text-third mt-0.5">
                {t('wallet.depositSubtitle') || 'Send crypto to your wallet address'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-exchange-text-third hover:text-exchange-text p-2 rounded-lg hover:bg-exchange-bg/60 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body — 2 columns on md+ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
          {/* LEFT — Selectors */}
          <div className="space-y-5">
            {/* Coin Select */}
            <div>
              <label className="text-xs text-exchange-text-third mb-2 block font-semibold uppercase tracking-wider">
                {t('wallet.coinSelect')}
              </label>
              <div className="relative">
                <select
                  value={coin}
                  onChange={e => setCoin(e.target.value)}
                  className="input-field w-full text-base pl-12 py-3.5 font-medium"
                >
                  {wallets.map(w => (
                    <option key={w.coin_symbol} value={w.coin_symbol}>
                      {w.coin_symbol} — {w.coin_name}
                    </option>
                  ))}
                </select>
                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <CoinIcon symbol={coin} size={26} />
                </div>
              </div>
              {selectedWallet && (
                <div className="mt-2 text-[11px] text-exchange-text-third flex items-center justify-between">
                  <span>{t('wallet.currentBalance') || 'Balance'}</span>
                  <span className="text-exchange-text font-medium tabular-nums">
                    {selectedWallet.available} {coin}
                  </span>
                </div>
              )}
            </div>

            {/* Network Select */}
            <div>
              <label className="text-xs text-exchange-text-third mb-2 block font-semibold uppercase tracking-wider">
                {t('wallet.network')}
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                {networks.map(n => (
                  <button
                    key={n.id}
                    onClick={() => setNetworkId(n.id)}
                    className={`text-left px-3.5 py-3 rounded-xl border-2 text-xs transition-all ${
                      network.id === n.id
                        ? 'border-exchange-yellow bg-exchange-yellow/10 text-exchange-text shadow-sm'
                        : 'border-exchange-border bg-exchange-bg/40 text-exchange-text-secondary hover:border-exchange-yellow/40 hover:bg-exchange-bg/70'
                    }`}
                  >
                    <div className="font-bold text-sm">{n.shortName}</div>
                    <div className="text-[10px] text-exchange-text-third mt-1 truncate">{n.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Info */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-exchange-bg/40 rounded-xl p-3.5 border border-exchange-border/60">
                <div className="text-[10px] text-exchange-text-third uppercase tracking-wider font-semibold flex items-center gap-1">
                  <Shield size={10} /> {t('wallet.minDeposit')}
                </div>
                <div className="text-exchange-text font-bold text-sm tabular-nums mt-1.5">
                  {network?.minDeposit} <span className="text-exchange-text-third font-normal">{coin}</span>
                </div>
              </div>
              <div className="bg-exchange-bg/40 rounded-xl p-3.5 border border-exchange-border/60">
                <div className="text-[10px] text-exchange-text-third uppercase tracking-wider font-semibold flex items-center gap-1">
                  <Clock size={10} /> {t('wallet.confirmations')}
                </div>
                <div className="text-exchange-text font-bold text-sm tabular-nums mt-1.5">
                  {network?.confirmations} <span className="text-exchange-text-third font-normal">· ~{network?.estimateMin}m</span>
                </div>
              </div>
            </div>

            {/* Warnings */}
            <div className="bg-gradient-to-br from-exchange-yellow/10 to-exchange-yellow/5 border border-exchange-yellow/30 rounded-xl p-3.5 space-y-2">
              <div className="flex items-start gap-2 text-[11px] text-exchange-text-secondary leading-relaxed">
                <AlertTriangle size={13} className="text-exchange-yellow shrink-0 mt-0.5" />
                <span>{t('wallet.warnSendOnlyCoin', { coin, network: network?.shortName })}</span>
              </div>
              <div className="flex items-start gap-2 text-[11px] text-exchange-text-secondary leading-relaxed">
                <Info size={13} className="text-exchange-yellow shrink-0 mt-0.5" />
                <span>{t('wallet.warnBelowMin', { min: network?.minDeposit, coin })}</span>
              </div>
            </div>
          </div>

          {/* RIGHT — QR + Address */}
          <div className="space-y-4">
            {/* QR Card */}
            <div className="bg-gradient-to-br from-exchange-bg to-exchange-bg/60 rounded-2xl border border-exchange-border p-6 flex flex-col items-center">
              <div className="bg-white p-4 rounded-2xl shadow-lg">
                <QRCode value={memo ? `${address}?memo=${memo}` : address} size={200} />
              </div>
              <div className="mt-4 flex items-center gap-2 text-[11px] text-exchange-text-third">
                <CoinIcon symbol={coin} size={14} />
                <span className="font-medium">{coin}</span>
                <span>·</span>
                <span>{network?.shortName}</span>
              </div>
            </div>

            {/* Address */}
            <div>
              <div className="text-[11px] text-exchange-text-third mb-1.5 uppercase tracking-wider font-semibold">
                {t('wallet.depositAddress')}
              </div>
              <div className="flex items-center gap-2 bg-exchange-bg rounded-xl px-4 py-3 border border-exchange-border hover:border-exchange-yellow/40 transition-colors group">
                <code className="flex-1 text-xs font-mono text-exchange-text break-all leading-relaxed">
                  {address}
                </code>
                <button
                  onClick={() => copy(address, 'address')}
                  className="shrink-0 px-2.5 py-2 rounded-lg bg-exchange-card hover:bg-exchange-yellow/10 text-exchange-text-secondary hover:text-exchange-yellow transition-all border border-exchange-border"
                  title={t('wallet.copy')}
                >
                  {copied === 'address' ? (
                    <Check size={16} className="text-exchange-buy" />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              </div>
            </div>

            {/* Memo (conditional) */}
            {network?.memoRequired && (
              <div>
                <div className="text-[11px] text-exchange-yellow mb-1.5 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  {network.memoLabel || t('wallet.memo')} ({t('wallet.required')})
                </div>
                <div className="flex items-center gap-2 bg-exchange-bg rounded-xl px-4 py-3 border-2 border-exchange-yellow/40">
                  <code className="flex-1 text-xs font-mono text-exchange-text">{memo}</code>
                  <button
                    onClick={() => copy(memo, 'memo')}
                    className="shrink-0 px-2.5 py-2 rounded-lg bg-exchange-card hover:bg-exchange-yellow/10 text-exchange-text-secondary hover:text-exchange-yellow transition-all border border-exchange-yellow/30"
                  >
                    {copied === 'memo' ? <Check size={16} className="text-exchange-buy" /> : <Copy size={16} />}
                  </button>
                </div>
                <p className="text-[10px] text-exchange-yellow mt-2 flex items-start gap-1.5 leading-relaxed">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  {t('wallet.memoWarning')}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer — Demo Test */}
        <div className="border-t border-exchange-border px-6 py-4 bg-exchange-bg/30">
          <button
            onClick={() => setShowTest(!showTest)}
            className="flex items-center justify-between w-full text-xs text-exchange-text-third hover:text-exchange-text transition-colors"
          >
            <span className="flex items-center gap-2">
              <Info size={13} />
              <span className="font-medium">{t('wallet.testDeposit')}</span>
              <span className="px-1.5 py-0.5 rounded bg-exchange-yellow/15 text-exchange-yellow text-[9px] font-bold uppercase tracking-wider">
                {t('wallet.demo')}
              </span>
            </span>
            {showTest ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showTest && (
            <div className="mt-3 p-4 bg-exchange-card rounded-xl border border-exchange-border">
              <p className="text-[11px] text-exchange-text-third mb-3 leading-relaxed">{t('wallet.testDepositDesc')}</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={testAmount}
                  onChange={e => setTestAmount(e.target.value)}
                  placeholder="0.00"
                  step="any"
                  className="input-field flex-1 text-sm tabular-nums py-2.5"
                />
                <button
                  onClick={handleTestDeposit}
                  disabled={loading}
                  className="btn-buy px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 whitespace-nowrap"
                >
                  {loading ? t('wallet.processing') : t('wallet.credit')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
