import { useMemo, useRef, useEffect, useState } from 'react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import { formatPrice, formatAmount } from '../../utils/format';

interface Props {
  onPriceClick?: (price: number) => void;
}

export default function Orderbook({ onPriceClick }: Props) {
  const { orderbook, recentTrades } = useStore();
  const { t } = useI18n();
  const [flashPrices, setFlashPrices] = useState<Record<string, 'buy' | 'sell'>>({});
  const prevPricesRef = useRef<Set<string>>(new Set());

  // Track price changes for flash effect
  useEffect(() => {
    const newPrices = new Set<string>();
    const flashes: Record<string, 'buy' | 'sell'> = {};

    orderbook.bids.forEach(b => {
      const key = `bid-${b.price}`;
      newPrices.add(key);
      if (!prevPricesRef.current.has(key)) {
        flashes[key] = 'buy';
      }
    });

    orderbook.asks.forEach(a => {
      const key = `ask-${a.price}`;
      newPrices.add(key);
      if (!prevPricesRef.current.has(key)) {
        flashes[key] = 'sell';
      }
    });

    if (Object.keys(flashes).length > 0 && Object.keys(flashes).length < 10) {
      setFlashPrices(flashes);
      const timer = setTimeout(() => setFlashPrices({}), 400);
      prevPricesRef.current = newPrices;
      return () => clearTimeout(timer);
    }

    prevPricesRef.current = newPrices;
  }, [orderbook]);

  const maxTotal = useMemo(() => {
    const bidTotals = orderbook.bids.reduce((acc, b, i) => {
      acc.push((acc[i - 1] || 0) + b.price * b.amount);
      return acc;
    }, [] as number[]);
    const askTotals = orderbook.asks.reduce((acc, a, i) => {
      acc.push((acc[i - 1] || 0) + a.price * a.amount);
      return acc;
    }, [] as number[]);
    return Math.max(bidTotals[bidTotals.length - 1] || 0, askTotals[askTotals.length - 1] || 0);
  }, [orderbook]);

  const lastPrice = recentTrades[0]?.price || 0;
  const prevPrice = recentTrades[1]?.price || lastPrice;
  const priceUp = lastPrice >= prevPrice;

  const asks = [...orderbook.asks].reverse().slice(-12);
  const bids = orderbook.bids.slice(0, 12);

  let askRunning = 0;
  let bidRunning = 0;

  return (
    <div className="flex flex-col h-full text-xs font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-exchange-border text-exchange-text-third text-[10px]">
        <span className="w-[35%]">{t('trade.price')}</span>
        <span className="w-[30%] text-right">{t('trade.amount')}</span>
        <span className="w-[35%] text-right">{t('trade.total')}</span>
      </div>

      {/* Asks (sells) */}
      <div className="flex-1 overflow-hidden flex flex-col justify-end">
        {asks.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-exchange-text-third text-[10px]">
            {t('trade.noAsks')}
          </div>
        ) : (
          asks.map((ask, i) => {
            askRunning += ask.price * ask.amount;
            const pct = maxTotal ? (askRunning / maxTotal) * 100 : 0;
            const isFlashing = flashPrices[`ask-${ask.price}`];
            return (
              <div
                key={`a-${i}`}
                className={`flex items-center justify-between px-2 py-[3px] cursor-pointer hover:bg-exchange-sell/8 relative group transition-all ${
                  isFlashing ? 'bg-exchange-sell/15' : ''
                }`}
                onClick={() => onPriceClick?.(ask.price)}
              >
                <div
                  className="absolute right-0 top-0 bottom-0 bg-exchange-sell/8 transition-all duration-300"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
                <span className="w-[35%] text-exchange-sell relative z-10 tabular-nums">{formatPrice(ask.price)}</span>
                <span className="w-[30%] text-right relative z-10 tabular-nums">{formatAmount(ask.amount)}</span>
                <span className="w-[35%] text-right text-exchange-text-secondary relative z-10 tabular-nums">{formatAmount(askRunning)}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Spread / Last Price */}
      <div className={`flex items-center justify-center py-2.5 border-y border-exchange-border font-semibold text-base transition-colors ${priceUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
        <span className="tabular-nums">{formatPrice(lastPrice)}</span>
        <span className="ml-1.5 text-xs">{priceUp ? '\u25B2' : '\u25BC'}</span>
      </div>

      {/* Bids (buys) */}
      <div className="flex-1 overflow-hidden">
        {bids.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-exchange-text-third text-[10px] h-full">
            {t('trade.noBids')}
          </div>
        ) : (
          bids.map((bid, i) => {
            bidRunning += bid.price * bid.amount;
            const pct = maxTotal ? (bidRunning / maxTotal) * 100 : 0;
            const isFlashing = flashPrices[`bid-${bid.price}`];
            return (
              <div
                key={`b-${i}`}
                className={`flex items-center justify-between px-2 py-[3px] cursor-pointer hover:bg-exchange-buy/8 relative group transition-all ${
                  isFlashing ? 'bg-exchange-buy/15' : ''
                }`}
                onClick={() => onPriceClick?.(bid.price)}
              >
                <div
                  className="absolute right-0 top-0 bottom-0 bg-exchange-buy/8 transition-all duration-300"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
                <span className="w-[35%] text-exchange-buy relative z-10 tabular-nums">{formatPrice(bid.price)}</span>
                <span className="w-[30%] text-right relative z-10 tabular-nums">{formatAmount(bid.amount)}</span>
                <span className="w-[35%] text-right text-exchange-text-secondary relative z-10 tabular-nums">{formatAmount(bidRunning)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
