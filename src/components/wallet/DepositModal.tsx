import { useEffect, useMemo, useState } from 'react';
import {
  X, ArrowDownLeft, Copy, Check, AlertTriangle, Info,
  Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { getNetworks, generateDepositAddress, generateMemo } from '../../utils/networks';
import CoinIcon from '../common/CoinIcon';
import QRCode from '../common/QRCode';
import { showToast } from '../common/Toast';
import api from '../../utils/api';
import useStore from '../../store/useStore';
import { formatAmount } from '../../utils/format';

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
    // Reset network when coin changes
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
            <div className="w-8 h-8 rounded-lg bg-exchange-buy/10 flex items-center justify-center">
              <ArrowDownLeft size={18} className="text-exchange-buy" />
            </div>
            <h2 className="text-lg font-semibold text-exchange-text">{t('wallet.deposit')}</h2>
          </div>
          <button onClick={onClose} className="text-exchange-text-third hover:text-exchange-text p-1">
            <X size={20} />
          </button>
        </div>

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
                  <div className="font-semibold">{n.shortName}</div>
                  <div className="text-[10px] text-exchange-text-third mt-0.5">{n.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Address Card */}
          <div className="bg-exchange-bg rounded-xl border border-exchange-border p-4">
            <div className="flex flex-col items-center gap-3">
              <QRCode value={memo ? `${address}?memo=${memo}` : address} size={160} />

              <div className="w-full">
                <div className="text-[11px] text-exchange-text-third mb-1 uppercase tracking-wide">
                  {t('wallet.depositAddress')}
                </div>
                <div className="flex items-center gap-2 bg-exchange-card rounded-lg px-3 py-2.5 border border-exchange-border/50">
                  <code className="flex-1 text-[11px] md:text-xs font-mono text-exchange-text break-all">
                    {address}
                  </code>
                  <button
                    onClick={() => copy(address, 'address')}
                    className="shrink-0 text-exchange-text-secondary hover:text-exchange-yellow transition-colors p-1"
                    title={t('wallet.copy')}
                  >
                    {copied === 'address' ? <Check size={16} className="text-exchange-buy" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {network?.memoRequired && (
                <div className="w-full">
                  <div className="text-[11px] text-exchange-yellow mb-1 uppercase tracking-wide flex items-center gap-1">
                    <AlertTriangle size={11} /> {network.memoLabel || t('wallet.memo')} ({t('wallet.required')})
                  </div>
                  <div className="flex items-center gap-2 bg-exchange-card rounded-lg px-3 py-2.5 border border-exchange-yellow/30">
                    <code className="flex-1 text-xs font-mono text-exchange-text">{memo}</code>
                    <button
                      onClick={() => copy(memo, 'memo')}
                      className="shrink-0 text-exchange-text-secondary hover:text-exchange-yellow transition-colors p-1"
                    >
                      {copied === 'memo' ? <Check size={16} className="text-exchange-buy" /> : <Copy size={16} />}
                    </button>
                  </div>
                  <p className="text-[10px] text-exchange-yellow mt-1.5 flex items-start gap-1">
                    <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                    {t('wallet.memoWarning')}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-exchange-bg/40 rounded-lg p-3 border border-exchange-border/50">
              <div className="text-exchange-text-third text-[10px] uppercase">{t('wallet.minDeposit')}</div>
              <div className="text-exchange-text font-medium tabular-nums mt-0.5">
                {network?.minDeposit} {coin}
              </div>
            </div>
            <div className="bg-exchange-bg/40 rounded-lg p-3 border border-exchange-border/50">
              <div className="text-exchange-text-third text-[10px] uppercase flex items-center gap-1">
                <Clock size={10} /> {t('wallet.confirmations')}
              </div>
              <div className="text-exchange-text font-medium tabular-nums mt-0.5">
                {network?.confirmations} {t('wallet.blocks')} · ~{network?.estimateMin}m
              </div>
            </div>
          </div>

          {/* Warnings */}
          <div className="bg-exchange-yellow/5 border border-exchange-yellow/20 rounded-lg p-3 space-y-1.5">
            <div className="flex items-start gap-2 text-[11px] text-exchange-text-secondary">
              <AlertTriangle size={13} className="text-exchange-yellow shrink-0 mt-0.5" />
              <span>{t('wallet.warnSendOnlyCoin', { coin, network: network?.shortName })}</span>
            </div>
            <div className="flex items-start gap-2 text-[11px] text-exchange-text-secondary">
              <Info size={13} className="text-exchange-yellow shrink-0 mt-0.5" />
              <span>{t('wallet.warnBelowMin', { min: network?.minDeposit, coin })}</span>
            </div>
          </div>

          {/* Simulated Test Deposit (collapsed) */}
          <div className="border-t border-exchange-border pt-4">
            <button
              onClick={() => setShowTest(!showTest)}
              className="flex items-center justify-between w-full text-xs text-exchange-text-third hover:text-exchange-text"
            >
              <span className="flex items-center gap-1.5">
                <Info size={12} />
                {t('wallet.testDeposit')} ({t('wallet.demo')})
              </span>
              {showTest ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showTest && (
              <div className="mt-3 p-3 bg-exchange-bg/40 rounded-lg border border-exchange-border/50">
                <p className="text-[10px] text-exchange-text-third mb-2">{t('wallet.testDepositDesc')}</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={testAmount}
                    onChange={e => setTestAmount(e.target.value)}
                    placeholder="0.00"
                    step="any"
                    className="input-field flex-1 text-sm tabular-nums"
                  />
                  <button
                    onClick={handleTestDeposit}
                    disabled={loading}
                    className="btn-buy px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 whitespace-nowrap"
                  >
                    {loading ? t('wallet.processing') : t('wallet.credit')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
