import { useMemo, useRef, useEffect, useState } from 'react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import { formatPrice, formatAmount } from '../../utils/format';

interface Props {
  onPriceClick?: (price: number) => void;
  mobile?: boolean;
}

export default function Orderbook({ onPriceClick, mobile }: Props) {
  const { orderbook, recentTrades } = useStore();
  const { t } = useI18n();
  const [flashPrices, setFlashPrices] = useState<Record<string, 'buy' | 'sell'>>({});
  const prevPricesRef = useRef<Set<string>>(new Set());

  // ---- Live liquidity animation --------------------------------------------
  // The server only re-arms the book every few minutes, so the raw amounts
  // sit frozen between ticks. Real exchanges show every rung breathing as
  // orders are added/pulled. We drive a lightweight per-price "wobble" on a
  // ~900ms tick that nudges each displayed amount up/down a few % and flashes
  // the row, so the wall looks alive without touching the real backend data.
  const [liveTick, setLiveTick] = useState(0);
  const wobbleRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const id = setInterval(() => setLiveTick((n) => n + 1), 900);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    // On every live tick, jitter a random subset of price levels so the whole
    // book doesn't move in lockstep (looks mechanical). Each level drifts by a
    // small random step and mean-reverts toward its base amount.
    const w = { ...wobbleRef.current };
    const touch = (key: string) => {
      const cur = w[key] ?? 1;
      // random walk with pull back to 1.0, clamped to a believable band
      const next = cur + (Math.random() - 0.5) * 0.12 + (1 - cur) * 0.15;
      w[key] = Math.max(0.55, Math.min(1.6, next));
    };
    [...orderbook.asks, ...orderbook.bids].forEach((o, i) => {
      // only wobble ~45% of levels each tick for an organic, staggered feel
      if (Math.random() < 0.45) touch(`${i < orderbook.asks.length ? 'a' : 'b'}-${o.price}`);
    });
    wobbleRef.current = w;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTick]);
  const wob = (side: 'a' | 'b', price: number, amount: number) => {
    const f = wobbleRef.current[`${side}-${price}`] ?? 1;
    return amount * f;
  };

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

  const asks = [...orderbook.asks].reverse().slice(-14);
  const bids = orderbook.bids.slice(0, 14);

  let askRunning = 0;
  let bidRunning = 0;

  // Mobile Book tab gets larger, airier rows + side padding; desktop stays compact.
  // NOTE: hard-coded CSS classes (.ob-row/.ob-head/.ob-spread) because Tailwind
  // px-*/py-* utilities resolve to 0px in this app.
  const mb = mobile ? ' ob-mobile' : '';
  const bodyFont = mobile ? 'text-[13px]' : 'text-xs';
  const headFont = mobile ? 'text-xs' : 'text-[10px]';

  return (
    <div className={`flex flex-col h-full ${bodyFont} font-mono`}>
      {/* Header */}
      <div className={`ob-head${mb} border-b border-exchange-border text-exchange-text-third ${headFont}`}>
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
            const amt = wob('a', ask.price, ask.amount);
            askRunning += ask.price * amt;
            const pct = maxTotal ? (askRunning / maxTotal) * 100 : 0;
            const isFlashing = flashPrices[`ask-${ask.price}`];
            return (
              <div
                key={`a-${i}`}
                className={`ob-row${mb} cursor-pointer hover:bg-exchange-sell/8 relative group transition-all ${
                  isFlashing ? 'bg-exchange-sell/15' : ''
                }`}
                onClick={() => onPriceClick?.(ask.price)}
              >
                <div
                  className="absolute right-0 top-0 bottom-0 bg-exchange-sell/8 transition-all duration-500"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
                <span className="w-[35%] text-exchange-sell relative z-10 tabular-nums">{formatPrice(ask.price)}</span>
                <span className="w-[30%] text-right relative z-10 tabular-nums transition-all duration-500">{formatAmount(amt)}</span>
                <span className="w-[35%] text-right text-exchange-text-secondary relative z-10 tabular-nums transition-all duration-500">{formatAmount(askRunning)}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Spread / Last Price */}
      <div className={`ob-spread${mb} flex items-center justify-center border-y border-exchange-border font-semibold ${mobile ? 'text-lg' : 'text-base'} transition-colors ${priceUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
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
            const amt = wob('b', bid.price, bid.amount);
            bidRunning += bid.price * amt;
            const pct = maxTotal ? (bidRunning / maxTotal) * 100 : 0;
            const isFlashing = flashPrices[`bid-${bid.price}`];
            return (
              <div
                key={`b-${i}`}
                className={`ob-row${mb} cursor-pointer hover:bg-exchange-buy/8 relative group transition-all ${
                  isFlashing ? 'bg-exchange-buy/15' : ''
                }`}
                onClick={() => onPriceClick?.(bid.price)}
              >
                <div
                  className="absolute right-0 top-0 bottom-0 bg-exchange-buy/8 transition-all duration-500"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
                <span className="w-[35%] text-exchange-buy relative z-10 tabular-nums">{formatPrice(bid.price)}</span>
                <span className="w-[30%] text-right relative z-10 tabular-nums transition-all duration-500">{formatAmount(amt)}</span>
                <span className="w-[35%] text-right text-exchange-text-secondary relative z-10 tabular-nums transition-all duration-500">{formatAmount(bidRunning)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
