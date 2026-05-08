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

  /**
   * SPACING SYSTEM (8pt scale, hard-coded values per spec):
   *  4 / 8 / 12 / 16 / 20 / 24 / 32 px
   * Modal:    max-width 980px, radius 16px, padding 24px, internal gap 24px
   * Header:   min-h 56px, title↔subtitle 4px, header bottom-margin 20px, X-btn inset 8px/8px
   * Body:     2-col 1fr:1fr, column-gap 24px
   * Sections: vertical gap 16px (between section blocks)
   * Labels:   margin-bottom 8px
   * Inputs:   height 44px, padding 12px 14px, radius 10px
   * Stat row: gap 12px, padding 14px, min-h 64px
   * Warnings: row pad 10px, icon-text gap 8px, line gap 8px, top margin 8px
   * QR card:  padding 20px, radius 14px, tag area mt 16px
   * Address:  label mb 8px, box min-h 44px, copy inset right 10px, mb 8px
   */

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-[#11161d] border border-white/[0.08] w-full max-h-[92vh] overflow-y-auto animate-slide-up shadow-2xl"
        style={{
          maxWidth: '980px',
          borderRadius: '16px',
          padding: '24px',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ============ HEADER ============ */}
        <div
          className="flex items-start justify-between"
          style={{ minHeight: '56px', marginBottom: '20px' }}
        >
          <div className="flex items-center" style={{ gap: '12px' }}>
            <div
              className="rounded-xl bg-exchange-buy/15 flex items-center justify-center shrink-0"
              style={{ width: '44px', height: '44px' }}
            >
              <ArrowDownLeft size={22} className="text-exchange-buy" />
            </div>
            <div className="flex flex-col" style={{ gap: '4px' }}>
              <h2
                className="font-bold text-exchange-text"
                style={{ fontSize: '24px', lineHeight: 1.2, fontWeight: 700 }}
              >
                {t('wallet.deposit')}
              </h2>
              <p
                className="text-exchange-text-third"
                style={{ fontSize: '13px', lineHeight: 1.5 }}
              >
                {t('wallet.depositSubtitle') || 'Send crypto to your wallet address'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-exchange-text-third hover:text-exchange-text rounded-lg hover:bg-white/[0.06] transition-colors shrink-0"
            style={{ marginTop: '8px', marginRight: '8px', padding: '8px' }}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* ============ BODY: 2-column grid ============ */}
        <div
          className="grid grid-cols-1 md:grid-cols-2"
          style={{ columnGap: '24px', rowGap: '24px' }}
        >
          {/* ===== LEFT PANEL ===== */}
          <div className="flex flex-col">
            {/* Section: SELECT COIN */}
            <div style={{ marginBottom: '16px' }}>
              <label
                className="block text-exchange-text-third uppercase font-semibold"
                style={{
                  fontSize: '12px',
                  letterSpacing: '0.04em',
                  marginBottom: '8px',
                }}
              >
                {t('wallet.coinSelect')}
              </label>
              <div className="relative">
                <select
                  value={coin}
                  onChange={e => setCoin(e.target.value)}
                  className="w-full bg-[#151c25] border border-white/[0.08] text-exchange-text font-medium focus:outline-none focus:border-exchange-yellow/60 transition-colors"
                  style={{
                    height: '44px',
                    padding: '12px 14px 12px 44px',
                    borderRadius: '10px',
                    fontSize: '14px',
                  }}
                >
                  {wallets.map(w => (
                    <option key={w.coin_symbol} value={w.coin_symbol}>
                      {w.coin_symbol} — {w.coin_name}
                    </option>
                  ))}
                </select>
                <div
                  className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ left: '12px' }}
                >
                  <CoinIcon symbol={coin} size={22} />
                </div>
              </div>
            </div>

            {/* Section: BALANCE */}
            {selectedWallet && (
              <div
                className="bg-[#151c25] border border-white/[0.08] flex items-center justify-between"
                style={{
                  padding: '14px',
                  borderRadius: '10px',
                  minHeight: '52px',
                  marginBottom: '16px',
                }}
              >
                <span
                  className="text-exchange-text-third"
                  style={{ fontSize: '13px', lineHeight: 1.5 }}
                >
                  {t('wallet.currentBalance') || 'Balance'}
                </span>
                <span
                  className="text-exchange-text font-semibold tabular-nums"
                  style={{ fontSize: '16px' }}
                >
                  {selectedWallet.available} {coin}
                </span>
              </div>
            )}

            {/* Section: NETWORK */}
            <div style={{ marginBottom: '16px' }}>
              <label
                className="block text-exchange-text-third uppercase font-semibold"
                style={{
                  fontSize: '12px',
                  letterSpacing: '0.04em',
                  marginBottom: '8px',
                }}
              >
                {t('wallet.network')}
              </label>
              <div
                className="grid grid-cols-2"
                style={{ gap: '12px' }}
              >
                {networks.map(n => (
                  <button
                    key={n.id}
                    onClick={() => setNetworkId(n.id)}
                    className={`text-left transition-all ${
                      network.id === n.id
                        ? 'border-exchange-yellow bg-exchange-yellow/10 text-exchange-text'
                        : 'border-white/[0.08] bg-[#151c25] text-exchange-text-secondary hover:border-exchange-yellow/40 hover:bg-[#18202a]'
                    }`}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '10px',
                      borderWidth: '2px',
                      borderStyle: 'solid',
                      minHeight: '64px',
                    }}
                  >
                    <div
                      className="font-bold"
                      style={{ fontSize: '14px', lineHeight: 1.3, marginBottom: '4px' }}
                    >
                      {n.shortName}
                    </div>
                    <div
                      className="text-exchange-text-third truncate"
                      style={{ fontSize: '12px', lineHeight: 1.4 }}
                    >
                      {n.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Section: MIN DEPOSIT / CONFIRMATIONS */}
            <div
              className="grid grid-cols-2"
              style={{ gap: '12px', marginBottom: '16px' }}
            >
              <div
                className="bg-[#151c25] border border-white/[0.08] flex flex-col justify-center"
                style={{
                  padding: '14px',
                  borderRadius: '10px',
                  minHeight: '64px',
                }}
              >
                <div
                  className="flex items-center text-exchange-text-third uppercase font-semibold"
                  style={{
                    fontSize: '11px',
                    letterSpacing: '0.04em',
                    gap: '6px',
                    marginBottom: '6px',
                  }}
                >
                  <Shield size={11} /> {t('wallet.minDeposit')}
                </div>
                <div
                  className="text-exchange-text font-bold tabular-nums"
                  style={{ fontSize: '18px', lineHeight: 1.2 }}
                >
                  {network?.minDeposit}{' '}
                  <span className="text-exchange-text-third font-normal" style={{ fontSize: '13px' }}>
                    {coin}
                  </span>
                </div>
              </div>
              <div
                className="bg-[#151c25] border border-white/[0.08] flex flex-col justify-center"
                style={{
                  padding: '14px',
                  borderRadius: '10px',
                  minHeight: '64px',
                }}
              >
                <div
                  className="flex items-center text-exchange-text-third uppercase font-semibold"
                  style={{
                    fontSize: '11px',
                    letterSpacing: '0.04em',
                    gap: '6px',
                    marginBottom: '6px',
                  }}
                >
                  <Clock size={11} /> {t('wallet.confirmations')}
                </div>
                <div
                  className="text-exchange-text font-bold tabular-nums"
                  style={{ fontSize: '18px', lineHeight: 1.2 }}
                >
                  {network?.confirmations}{' '}
                  <span className="text-exchange-text-third font-normal" style={{ fontSize: '13px' }}>
                    · ~{network?.estimateMin}m
                  </span>
                </div>
              </div>
            </div>

            {/* Section: WARNINGS */}
            <div
              className="bg-exchange-yellow/[0.08] border border-exchange-yellow/30"
              style={{
                borderRadius: '10px',
                padding: '12px 14px',
                marginTop: '8px',
              }}
            >
              <div
                className="flex items-start text-exchange-text-secondary"
                style={{
                  gap: '8px',
                  paddingTop: '10px',
                  paddingBottom: '10px',
                  fontSize: '13px',
                  lineHeight: 1.5,
                }}
              >
                <AlertTriangle size={14} className="text-exchange-yellow shrink-0" style={{ marginTop: '2px' }} />
                <span>{t('wallet.warnSendOnlyCoin', { coin, network: network?.shortName })}</span>
              </div>
              <div
                className="border-t border-exchange-yellow/20 flex items-start text-exchange-text-secondary"
                style={{
                  gap: '8px',
                  paddingTop: '10px',
                  paddingBottom: '10px',
                  marginTop: '8px',
                  fontSize: '13px',
                  lineHeight: 1.5,
                }}
              >
                <Info size={14} className="text-exchange-yellow shrink-0" style={{ marginTop: '2px' }} />
                <span>{t('wallet.warnBelowMin', { min: network?.minDeposit, coin })}</span>
              </div>
            </div>
          </div>

          {/* ===== RIGHT PANEL ===== */}
          <div className="flex flex-col">
            {/* QR CARD */}
            <div
              className="bg-[#151c25] border border-white/[0.08] flex flex-col items-center justify-center"
              style={{
                padding: '20px',
                borderRadius: '14px',
                marginBottom: '16px',
              }}
            >
              <div
                className="bg-white shadow-lg"
                style={{ padding: '16px', borderRadius: '12px' }}
              >
                <QRCode value={memo ? `${address}?memo=${memo}` : address} size={200} />
              </div>

              {/* Tag area */}
              <div
                className="flex items-center justify-center"
                style={{ gap: '8px', marginTop: '16px' }}
              >
                <div
                  className="flex items-center bg-[#18202a] border border-white/[0.08]"
                  style={{
                    gap: '6px',
                    padding: '6px 10px',
                    borderRadius: '999px',
                    fontSize: '12px',
                  }}
                >
                  <CoinIcon symbol={coin} size={14} />
                  <span className="text-exchange-text font-medium">{coin}</span>
                </div>
                <div
                  className="bg-[#18202a] border border-white/[0.08] text-exchange-text-secondary font-medium"
                  style={{
                    padding: '6px 10px',
                    borderRadius: '999px',
                    fontSize: '12px',
                  }}
                >
                  {network?.shortName}
                </div>
              </div>
            </div>

            {/* DEPOSIT ADDRESS LABEL */}
            <label
              className="block text-exchange-text-third uppercase font-semibold"
              style={{
                fontSize: '12px',
                letterSpacing: '0.04em',
                marginBottom: '8px',
                marginTop: '16px',
              }}
            >
              {t('wallet.depositAddress')}
            </label>

            {/* ADDRESS BOX */}
            <div
              className="relative bg-[#151c25] border border-white/[0.08] hover:border-exchange-yellow/40 transition-colors"
              style={{
                minHeight: '44px',
                padding: '12px 44px 12px 12px',
                borderRadius: '10px',
                marginBottom: '8px',
              }}
            >
              <code
                className="block font-mono text-exchange-text break-all"
                style={{ fontSize: '13px', lineHeight: 1.5 }}
              >
                {address}
              </code>
              <button
                onClick={() => copy(address, 'address')}
                className="absolute top-1/2 -translate-y-1/2 rounded-md bg-[#18202a] hover:bg-exchange-yellow/15 text-exchange-text-secondary hover:text-exchange-yellow transition-all border border-white/[0.08]"
                style={{ right: '10px', padding: '6px' }}
                title={t('wallet.copy')}
                aria-label="Copy address"
              >
                {copied === 'address' ? (
                  <Check size={14} className="text-exchange-buy" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </div>

            {/* MEMO (conditional) */}
            {network?.memoRequired && (
              <div style={{ marginTop: '16px' }}>
                <label
                  className="flex items-center text-exchange-yellow uppercase font-semibold"
                  style={{
                    gap: '6px',
                    fontSize: '12px',
                    letterSpacing: '0.04em',
                    marginBottom: '8px',
                  }}
                >
                  <AlertTriangle size={12} />
                  {network.memoLabel || t('wallet.memo')} ({t('wallet.required')})
                </label>
                <div
                  className="relative bg-[#151c25] border-2 border-exchange-yellow/40"
                  style={{
                    minHeight: '44px',
                    padding: '12px 44px 12px 12px',
                    borderRadius: '10px',
                  }}
                >
                  <code
                    className="block font-mono text-exchange-text"
                    style={{ fontSize: '13px', lineHeight: 1.5 }}
                  >
                    {memo}
                  </code>
                  <button
                    onClick={() => copy(memo, 'memo')}
                    className="absolute top-1/2 -translate-y-1/2 rounded-md bg-[#18202a] hover:bg-exchange-yellow/15 text-exchange-text-secondary hover:text-exchange-yellow transition-all border border-exchange-yellow/30"
                    style={{ right: '10px', padding: '6px' }}
                  >
                    {copied === 'memo' ? <Check size={14} className="text-exchange-buy" /> : <Copy size={14} />}
                  </button>
                </div>
                <p
                  className="flex items-start text-exchange-yellow"
                  style={{
                    gap: '8px',
                    marginTop: '8px',
                    fontSize: '12px',
                    lineHeight: 1.5,
                  }}
                >
                  <AlertTriangle size={12} className="shrink-0" style={{ marginTop: '2px' }} />
                  {t('wallet.memoWarning')}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ============ FOOTER: Demo test ============ */}
        <div
          className="border-t border-white/[0.08]"
          style={{ marginTop: '24px', paddingTop: '16px' }}
        >
          <button
            onClick={() => setShowTest(!showTest)}
            className="flex items-center justify-between w-full text-exchange-text-third hover:text-exchange-text transition-colors"
            style={{ fontSize: '13px', lineHeight: 1.5 }}
          >
            <span className="flex items-center" style={{ gap: '8px' }}>
              <Info size={14} />
              <span className="font-medium">{t('wallet.testDeposit')}</span>
              <span
                className="rounded bg-exchange-yellow/15 text-exchange-yellow font-bold uppercase"
                style={{
                  padding: '2px 6px',
                  fontSize: '10px',
                  letterSpacing: '0.06em',
                }}
              >
                {t('wallet.demo')}
              </span>
            </span>
            {showTest ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showTest && (
            <div
              className="bg-[#151c25] border border-white/[0.08]"
              style={{
                marginTop: '16px',
                padding: '16px',
                borderRadius: '10px',
              }}
            >
              <p
                className="text-exchange-text-third"
                style={{
                  fontSize: '13px',
                  lineHeight: 1.5,
                  marginBottom: '12px',
                }}
              >
                {t('wallet.testDepositDesc')}
              </p>
              <div className="flex" style={{ gap: '12px' }}>
                <input
                  type="number"
                  value={testAmount}
                  onChange={e => setTestAmount(e.target.value)}
                  placeholder="0.00"
                  step="any"
                  className="flex-1 bg-[#11161d] border border-white/[0.08] text-exchange-text tabular-nums focus:outline-none focus:border-exchange-yellow/60 transition-colors"
                  style={{
                    height: '44px',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    fontSize: '14px',
                  }}
                />
                <button
                  onClick={handleTestDeposit}
                  disabled={loading}
                  className="btn-buy font-semibold disabled:opacity-50 whitespace-nowrap"
                  style={{
                    height: '44px',
                    padding: '0 20px',
                    borderRadius: '10px',
                    fontSize: '14px',
                  }}
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
