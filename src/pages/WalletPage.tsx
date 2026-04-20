import { useEffect, useState } from 'react';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, Eye, EyeOff, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import { formatPrice, formatPercent } from '../utils/format';
import CoinIcon from '../components/common/CoinIcon';
import api from '../utils/api';

export default function WalletPage() {
  const { wallets, fetchWallets } = useStore();
  const { t } = useI18n();
  const [showBalance, setShowBalance] = useState(true);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [selectedCoin, setSelectedCoin] = useState('');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [hideZero, setHideZero] = useState(false);

  useEffect(() => { fetchWallets(); }, []);

  const totalUSD = wallets.reduce((s, w) => s + (w.available + w.locked) * (w.price_usd || 0), 0);
  const totalKRW = totalUSD * 1350;

  const handleDeposit = async () => {
    setLoading(true);
    try {
      await api.post('/wallet/deposit', { coin_symbol: selectedCoin, amount: parseFloat(amount) });
      setMessage(t('wallet.depositSuccess'));
      fetchWallets();
      setAmount('');
    } catch (e: any) { setMessage(e.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const handleWithdraw = async () => {
    setLoading(true);
    try {
      await api.post('/wallet/withdraw', { coin_symbol: selectedCoin, amount: parseFloat(amount), address });
      setMessage(t('wallet.withdrawSubmitted'));
      fetchWallets();
      setAmount('');
      setAddress('');
    } catch (e: any) { setMessage(e.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const displayWallets = hideZero ? wallets.filter(w => (w.available + w.locked) > 0) : wallets;

  return (
    <div className="max-w-5xl mx-auto p-4 pb-20">
      {/* Overview Card */}
      <div className="card p-6 mb-6 bg-gradient-to-br from-exchange-card to-exchange-card/80">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-exchange-yellow/15 rounded-xl flex items-center justify-center">
              <Wallet className="text-exchange-yellow" size={22} />
            </div>
            <h1 className="text-xl font-bold">{t('wallet.myWallet')}</h1>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowBalance(!showBalance)}
              className="p-2 text-exchange-text-third hover:text-exchange-text rounded-lg hover:bg-exchange-hover/50 transition-colors"
              title={showBalance ? t('wallet.hideBalance') : t('wallet.showBalance')}>
              {showBalance ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
            <button onClick={fetchWallets}
              className="p-2 text-exchange-text-third hover:text-exchange-text rounded-lg hover:bg-exchange-hover/50 transition-colors"
              title={t('wallet.refresh')}>
              <RefreshCw size={18} />
            </button>
          </div>
        </div>

        <div className="mb-1 text-exchange-text-secondary text-xs">{t('wallet.estimatedBalance')}</div>
        <div className="text-3xl font-bold mb-0.5 tabular-nums">
          {showBalance ? `$${formatPrice(totalUSD)}` : '****'}
        </div>
        <div className="text-exchange-text-secondary text-sm tabular-nums">
          {showBalance ? `\u2248 ${formatPrice(totalKRW)} KRW` : '****'}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={() => { setShowDeposit(true); setShowWithdraw(false); setMessage(''); }}
            className="btn-primary flex items-center gap-2 text-sm rounded-lg">
            <ArrowDownToLine size={16} /> {t('wallet.deposit')}
          </button>
          <button onClick={() => { setShowWithdraw(true); setShowDeposit(false); setMessage(''); }}
            className="bg-exchange-input hover:bg-exchange-hover text-exchange-text px-4 py-2.5 rounded-lg flex items-center gap-2 text-sm transition-colors">
            <ArrowUpFromLine size={16} /> {t('wallet.withdraw')}
          </button>
        </div>
      </div>

      {/* Deposit/Withdraw Panel */}
      {(showDeposit || showWithdraw) && (
        <div className="card p-4 mb-6">
          <h3 className="font-semibold mb-3">{showDeposit ? t('wallet.deposit') : t('wallet.withdraw')}</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-exchange-text-third block mb-1">{t('wallet.coin')}</label>
              <select value={selectedCoin} onChange={(e) => setSelectedCoin(e.target.value)} className="input-field">
                <option value="">{t('wallet.selectCoin')}</option>
                {wallets.map(w => <option key={w.coin_symbol} value={w.coin_symbol}>{w.coin_symbol} - {w.coin_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-exchange-text-third block mb-1">{showDeposit ? t('wallet.depositAmount') : t('wallet.withdrawAmount')}</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="input-field" placeholder="0.00" step="any" />
            </div>
            {showWithdraw && (
              <div>
                <label className="text-xs text-exchange-text-third block mb-1">{t('wallet.walletAddress')}</label>
                <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
                  className="input-field" placeholder={t('wallet.addressPlaceholder')} />
              </div>
            )}
            {message && <div className={`text-xs px-3 py-2 rounded-lg ${message.includes('완료') || message.includes('success') || message.includes('submitted') ? 'bg-exchange-buy/10 text-exchange-buy' : 'bg-exchange-sell/10 text-exchange-sell'}`}>{message}</div>}
            <div className="flex gap-2">
              <button onClick={showDeposit ? handleDeposit : handleWithdraw} disabled={loading || !selectedCoin || !amount}
                className="btn-primary text-sm disabled:opacity-50 rounded-lg">
                {loading ? '처리중...' : showDeposit ? t('wallet.deposit') : t('wallet.withdraw')}
              </button>
              <button onClick={() => { setShowDeposit(false); setShowWithdraw(false); }}
                className="bg-exchange-input text-exchange-text-secondary px-4 py-2 rounded-lg text-sm hover:bg-exchange-hover transition-colors">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* Assets Table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-exchange-border flex items-center justify-between">
          <h2 className="font-semibold text-sm">{t('wallet.assets')}</h2>
          <label className="flex items-center gap-2 text-xs text-exchange-text-secondary cursor-pointer">
            <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)}
              className="accent-exchange-yellow" />
            0 잔고 숨기기
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-exchange-text-third border-b border-exchange-border">
                <th className="text-left px-4 py-2">{t('wallet.coin')}</th>
                <th className="text-right px-4 py-2">{t('wallet.availableBalance')}</th>
                <th className="text-right px-4 py-2 hidden sm:table-cell">{t('wallet.inOrders')}</th>
                <th className="text-right px-4 py-2">{t('wallet.usdValue')}</th>
              </tr>
            </thead>
            <tbody>
              {displayWallets.map((w) => {
                const total = w.available + w.locked;
                const value = total * (w.price_usd || 0);
                return (
                  <tr key={w.coin_symbol} className="border-b border-exchange-border/50 hover:bg-exchange-hover/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <CoinIcon symbol={w.coin_symbol} size={30} />
                        <div>
                          <div className="font-medium">{w.coin_symbol}</div>
                          <div className="text-xs text-exchange-text-third">{w.coin_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {showBalance ? formatPrice(w.available) : '****'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-exchange-text-secondary hidden sm:table-cell tabular-nums">
                      {showBalance ? formatPrice(w.locked) : '****'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {showBalance ? `$${formatPrice(value)}` : '****'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
