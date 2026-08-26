import { useState, useEffect } from 'react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import api from '../../utils/api';
import { formatPrice } from '../../utils/format';
import { showToast } from '../common/Toast';
import FeeTierBadge from './FeeTierBadge';

interface Props {
  symbol: string;
  initialPrice?: number;
  forceSide?: 'buy' | 'sell';
  onComplete?: () => void;
}

type OrderType = 'limit' | 'market' | 'stop_limit';
type Tif = 'GTC' | 'IOC' | 'FOK' | 'POST_ONLY';

export default function TradePanel({ symbol, initialPrice, forceSide, onComplete }: Props) {
  const { user, wallets, fetchWallets, fetchOpenOrders } = useStore();
  const { t } = useI18n();
  const [side, setSide] = useState<'buy' | 'sell'>(forceSide || 'buy');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [tif, setTif] = useState<Tif>('GTC');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [sliderPct, setSliderPct] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [base, quote] = symbol.split('-');

  useEffect(() => {
    if (forceSide) setSide(forceSide);
  }, [forceSide]);

  useEffect(() => {
    if (initialPrice && initialPrice > 0) {
      setPrice(String(initialPrice));
    }
  }, [initialPrice]);

  useEffect(() => {
    if (user) fetchWallets();
  }, [user]);

  // When switching to market order, TIF must be GTC (server ignores it anyway)
  useEffect(() => {
    if (orderType === 'market' && tif !== 'GTC') setTif('GTC');
  }, [orderType]);

  const quoteWallet = wallets.find((w) => w.coin_symbol === quote);
  const baseWallet = wallets.find((w) => w.coin_symbol === base);
  const available = side === 'buy' ? (quoteWallet?.available || 0) : (baseWallet?.available || 0);

  const hasPrice = orderType === 'limit' || orderType === 'stop_limit';
  const total = hasPrice && price && amount ? parseFloat(price) * parseFloat(amount) : 0;
  const fee = total * 0.001;

  const setPercentage = (pct: number) => {
    setSliderPct(pct);
    if (side === 'buy' && price && parseFloat(price) > 0) {
      const maxAmount = (available / parseFloat(price)) * 0.999; // account for fee
      setAmount((maxAmount * pct / 100).toFixed(6));
    } else if (side === 'sell') {
      setAmount(((baseWallet?.available || 0) * pct / 100).toFixed(6));
    }
  };

  const handleSubmit = async () => {
    if (!user) { setMessage(t('trade.loginToTrade')); return; }
    if (!amount || parseFloat(amount) <= 0) { setMessage(t('trade.invalidAmount')); return; }
    if (hasPrice && (!price || parseFloat(price) <= 0)) { setMessage(t('trade.invalidPrice')); return; }
    if (orderType === 'stop_limit' && (!stopPrice || parseFloat(stopPrice) <= 0)) {
      setMessage(t('trade.invalidStopPrice'));
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const payload: any = { market_symbol: symbol, side, type: orderType, amount: parseFloat(amount) };
      if (hasPrice) payload.price = parseFloat(price);
      if (orderType === 'stop_limit') payload.stop_price = parseFloat(stopPrice);
      if (orderType === 'limit' && tif !== 'GTC') payload.time_in_force = tif;

      const res = await api.post('/orders', payload);
      const tradeCount = res.data.trades?.length || 0;
      const status = res.data.order?.status;
      let msg: string;
      if (status === 'pending') {
        msg = t('trade.stopPending');
      } else if (tradeCount > 0) {
        msg = `${t('trade.orderPlaced')} ${tradeCount}${t('trade.tradesExecuted')}`;
      } else {
        msg = `${t('trade.orderPlaced')} ${t('trade.waitingMatch')}`;
      }
      setMessage(msg);
      showToast('success', side === 'buy' ? t('trade.buyOrder') : t('trade.sellOrder'), msg);
      setAmount('');
      setStopPrice('');
      setSliderPct(0);
      fetchWallets();
      fetchOpenOrders(symbol);
      if (onComplete) setTimeout(onComplete, 1500);
    } catch (err: any) {
      const data = err.response?.data || {};
      const rawErr = data.error || data.message || t('trade.orderFailed');
      let shown = rawErr;
      // Friendly mapping for TIF rejections
      const lower = String(rawErr).toLowerCase();
      if (rawErr === 'QTA_DAILY_SELL_LIMIT') {
        const remaining = Number(data.remaining_usdt || 0);
        const remainKrw = Math.max(0, Math.floor(remaining * 1400));
        shown = t('trade.qtaSellLimit', {
          krw: '50,000',
          usd: '35.71',
          remainKrw: remainKrw.toLocaleString('en-US'),
        });
      }
      else if (lower.includes('post_only') || lower.includes('post-only')) shown = t('trade.postOnlyRejected');
      else if (lower.includes('fok') || lower.includes('fill or kill')) shown = t('trade.fokRejected');
      setMessage(shown);
      showToast('error', t('trade.orderFailed'), shown);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="trade-panel">
      {/* Buy/Sell toggle — Bybit-style rounded segment */}
      {!forceSide && (
        <div className="flex gap-2">
          <button
            onClick={() => setSide('buy')}
            className={`flex-1 !py-4 text-base font-bold rounded-xl transition-all ${
              side === 'buy' ? 'bg-exchange-buy text-white' : 'bg-exchange-input text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            {t('trade.buy')}
          </button>
          <button
            onClick={() => setSide('sell')}
            className={`flex-1 !py-4 text-base font-bold rounded-xl transition-all ${
              side === 'sell' ? 'bg-exchange-sell text-white' : 'bg-exchange-input text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            {t('trade.sell')}
          </button>
        </div>
      )}

      {/* Order type + fee tier badge */}
      <div className="flex items-center justify-between border-b border-exchange-border pb-3">
        <div className="flex gap-4">
          {([
            { key: 'limit' as const, label: t('trade.limit') },
            { key: 'market' as const, label: t('trade.market') },
            { key: 'stop_limit' as const, label: t('trade.stopLimit') },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setOrderType(key)}
              className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
                orderType === key
                  ? 'border-exchange-yellow text-exchange-yellow'
                  : 'border-transparent text-exchange-text-secondary hover:text-exchange-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <FeeTierBadge compact />
      </div>

      {/* Available */}
      <div className="flex justify-between items-center text-sm">
        <span className="text-exchange-text-third">{t('trade.available')}</span>
        <span className="text-exchange-text-secondary font-mono tabular-nums">
          {formatPrice(available)} {side === 'buy' ? quote : base}
        </span>
      </div>

      {/* Stop price input (stop-limit only) */}
      {orderType === 'stop_limit' && (
        <div>
          <label className="text-sm text-exchange-text-secondary mb-2 block">
            {t('trade.stopPrice')} ({quote})
          </label>
          <input
            type="number"
            value={stopPrice}
            onChange={(e) => setStopPrice(e.target.value)}
            className="input-field text-right tabular-nums"
            placeholder="0.00"
            step="any"
          />
          <p className="text-xs text-exchange-text-third mt-2">{t('trade.stopPriceHint')}</p>
        </div>
      )}

      {/* Price input */}
      {hasPrice && (
        <div>
          <label className="text-sm text-exchange-text-secondary mb-2 block">{t('trade.price')} ({quote})</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input-field text-right tabular-nums"
            placeholder="0.00"
            step="any"
          />
        </div>
      )}

      {/* Amount input */}
      <div>
        <label className="text-sm text-exchange-text-secondary mb-2 block">{t('trade.amount')} ({base})</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setSliderPct(0); }}
          className="input-field text-right tabular-nums"
          placeholder="0.00"
          step="any"
        />
      </div>

      {/* Percentage slider */}
      <div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={sliderPct}
          onChange={(e) => setPercentage(parseInt(e.target.value))}
          className="w-full h-1.5 accent-exchange-yellow cursor-pointer"
        />
        <div className="flex justify-between mt-3">
          {[0, 25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              onClick={() => setPercentage(pct)}
              className={`text-xs font-medium w-12 py-2 rounded-full transition-colors ${
                sliderPct >= pct ? 'bg-exchange-yellow/20 text-exchange-yellow' : 'bg-exchange-input text-exchange-text-secondary'
              }`}
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      {/* Advanced / TIF — limit orders only */}
      {orderType === 'limit' && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[11px] text-exchange-text-third hover:text-exchange-yellow flex items-center gap-1"
          >
            <span className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▸</span>
            {t('trade.timeInForce')}
            <span className="ml-1 px-1.5 py-0.5 rounded bg-exchange-input text-exchange-text-secondary font-mono text-[10px]">
              {tif}
            </span>
          </button>
          {showAdvanced && (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {([
                { key: 'GTC' as const, label: t('trade.tif.gtc'), desc: t('trade.tif.gtcDesc') },
                { key: 'IOC' as const, label: t('trade.tif.ioc'), desc: t('trade.tif.iocDesc') },
                { key: 'FOK' as const, label: t('trade.tif.fok'), desc: t('trade.tif.fokDesc') },
                { key: 'POST_ONLY' as const, label: t('trade.tif.postOnly'), desc: t('trade.tif.postOnlyDesc') },
              ]).map(({ key, label, desc }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTif(key)}
                  title={desc}
                  className={`text-[10px] px-2 py-1.5 rounded border transition-colors text-left ${
                    tif === key
                      ? 'border-exchange-yellow bg-exchange-yellow/10 text-exchange-yellow'
                      : 'border-exchange-border bg-exchange-input text-exchange-text-secondary hover:border-exchange-yellow/50'
                  }`}
                >
                  <div className="font-semibold">{label}</div>
                  <div className="text-[9px] opacity-70 truncate">{desc}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Total & Fee */}
      {hasPrice && (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-exchange-text-third">{t('trade.total')}</span>
            <span className="text-exchange-text-secondary font-mono tabular-nums">{formatPrice(total)} {quote}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-exchange-text-third">{t('trade.feeRate')}</span>
            <span className="text-exchange-text-secondary font-mono tabular-nums">{formatPrice(fee)} {quote}</span>
          </div>
        </div>
      )}

      {/* spacer pushes submit to bottom */}
      <div className="flex-1" />
      {/* Submit — Bybit-style big rounded pill */}
      <button
        onClick={handleSubmit}
        disabled={loading}
        className={`w-full !py-4 !rounded-xl font-bold text-base transition-all disabled:opacity-50 ${
          side === 'buy' ? 'btn-buy' : 'btn-sell'
        }`}
      >
        {loading ? t('trade.processing') : `${side === 'buy' ? t('trade.buy') : t('trade.sell')} ${base}`}
      </button>

      {/* Message */}
      {message && (
        <div className={`mt-2 text-xs text-center px-2 py-1.5 rounded-lg ${
          message.includes('failed') || message.includes('Insufficient') || message.includes('login') || message.includes('Failed') || message.includes('실패') || message.includes('로그인') || message.includes('rejected') || message.includes('거절')
            ? 'bg-exchange-sell/10 text-exchange-sell'
            : message.includes('pending') || message.includes('대기')
              ? 'bg-exchange-yellow/10 text-exchange-yellow'
              : 'bg-exchange-buy/10 text-exchange-buy'
        }`}>
          {message}
        </div>
      )}
    </div>
  );
}
