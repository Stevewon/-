import { useMemo, useRef, useEffect, useState } from 'react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import { formatPrice, formatAmountWhole } from '../../utils/format';

interface Props {
  onPriceClick?: (price: number) => void;
  mobile?: boolean;
}

export default function Orderbook({ onPriceClick, mobile }: Props) {
  const { orderbook, recentTrades, tickers, currentMarket } = useStore();
  const { t } = useI18n();
  const [flashPrices, setFlashPrices] = useState<Record<string, 'buy' | 'sell'>>({});
  const prevPricesRef = useRef<Set<string>>(new Set());

  // ★ OWNER RULE (2026-09-05): the book must look ALIVE — rows stay fully
  //   populated (mobile 8 / desktop 14) but the AMOUNTS jitter in place and the
  //   changed rows flash, exactly like a real exchange feed. This is purely
  //   cosmetic (does not touch the real backend amounts used for matching).
  //
  //   IMPORTANT: the old "ghost/double text" bug was caused by
  //   `transition-all duration-500` on the number spans, NOT by the wobble.
  //   So we keep the wobble but NEVER add a text transition.
  const [liveTick, setLiveTick] = useState(0);
  const wobbleRef = useRef<Record<string, number>>({});

  // Drive the animation ~800ms — fast enough to feel live, slow enough to read.
  useEffect(() => {
    const id = setInterval(() => setLiveTick(t => (t + 1) % 1_000_000), 800);
    return () => clearInterval(id);
  }, []);

  // Recompute the per-level cosmetic multiplier every tick. Each level does a
  // small mean-reverting random walk around 1.0 so the amounts breathe instead
  // of jumping around wildly.
  useEffect(() => {
    const next: Record<string, number> = {};
    const flashes: Record<string, 'buy' | 'sell'> = {};
    const roll = (key: string, side: 'buy' | 'sell') => {
      const prev = wobbleRef.current[key] ?? 1;
      // ~45% of levels move each tick; the rest hold steady.
      let factor = prev;
      if (Math.random() < 0.45) {
        const drift = (Math.random() - 0.5) * 0.24; // ±12%
        const meanRevert = (1 - prev) * 0.35;       // pull back toward 1.0
        factor = Math.min(1.6, Math.max(0.55, prev + drift + meanRevert));
        flashes[key] = side;
      }
      next[key] = factor;
    };
    orderbook.asks.forEach(a => roll(`ask-${a.price}`, 'sell'));
    orderbook.bids.forEach(b => roll(`bid-${b.price}`, 'buy'));
    wobbleRef.current = next;

    if (Object.keys(flashes).length > 0) {
      setFlashPrices(flashes);
      const timer = setTimeout(() => setFlashPrices({}), 380);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTick]);

  // Cosmetic amount = real backend amount × per-level wobble factor.
  const wob = (side: 'a' | 'b', price: number, amount: number) => {
    const key = `${side === 'a' ? 'ask' : 'bid'}-${price}`;
    const factor = wobbleRef.current[key] ?? 1;
    return amount * factor;
  };

  // Flash brand-new price levels the instant a fresh server snapshot arrives too.
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
      setFlashPrices(prev => ({ ...prev, ...flashes }));
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

  // Center price = last trade price, with a fallback to the live ticker last
  // price (and then the book mid) so a real-time price ALWAYS shows even when
  // this market has no recent trades yet (fresh / thin book).
  const tickerLast = tickers[currentMarket]?.last || 0;
  const bookMid =
    orderbook.asks[0]?.price && orderbook.bids[0]?.price
      ? (orderbook.asks[0].price + orderbook.bids[0].price) / 2
      : 0;
  const lastPrice = recentTrades[0]?.price || tickerLast || bookMid || 0;
  const prevPrice = recentTrades[1]?.price || lastPrice;
  const priceUp = lastPrice >= prevPrice;

  // ★ OWNER RULE (2026-09-05): MOBILE shows 8 asks + 8 bids, DESKTOP shows 14
  //   each. Asks are reversed so the BEST (lowest) ask sits just above the
  //   spread line.
  const ROWS = mobile ? 8 : 14;
  const asks = [...orderbook.asks].reverse().slice(-ROWS);
  const bids = orderbook.bids.slice(0, ROWS);

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
        <span className="w-[46%]">{t('trade.price')}</span>
        <span className="w-[30%] text-right">{t('trade.amount')}</span>
        <span className="w-[24%] text-right">{t('trade.total')}</span>
      </div>

      {/* Asks (sells) — fixed tight rows, no stretch (Bybit density) */}
      <div className="overflow-hidden flex flex-col justify-end">
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
                className={`ob-row${mb} cursor-pointer hover:bg-exchange-sell/8 relative ${
                  isFlashing ? 'bg-exchange-sell/15' : ''
                }`}
                onClick={() => onPriceClick?.(ask.price)}
              >
                <div
                  className="absolute right-0 top-0 bottom-0 bg-exchange-sell/10"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
                <span className="w-[46%] text-exchange-sell relative z-10 tabular-nums whitespace-nowrap overflow-hidden">{formatPrice(ask.price)}</span>
                <span className="w-[30%] text-right text-exchange-text relative z-10 tabular-nums whitespace-nowrap overflow-hidden">{formatAmountWhole(amt)}</span>
                <span className="w-[24%] text-right text-exchange-sell/70 relative z-10 tabular-nums whitespace-nowrap overflow-hidden">{formatAmountWhole(askRunning)}</span>
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

      {/* Bids (buys) — fixed tight rows, no stretch */}
      <div className="overflow-hidden">
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
                className={`ob-row${mb} cursor-pointer hover:bg-exchange-buy/8 relative ${
                  isFlashing ? 'bg-exchange-buy/15' : ''
                }`}
                onClick={() => onPriceClick?.(bid.price)}
              >
                <div
                  className="absolute right-0 top-0 bottom-0 bg-exchange-buy/10"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
                <span className="w-[46%] text-exchange-buy relative z-10 tabular-nums whitespace-nowrap overflow-hidden">{formatPrice(bid.price)}</span>
                <span className="w-[30%] text-right text-exchange-text relative z-10 tabular-nums whitespace-nowrap overflow-hidden">{formatAmountWhole(amt)}</span>
                <span className="w-[24%] text-right text-exchange-buy/70 relative z-10 tabular-nums whitespace-nowrap overflow-hidden">{formatAmountWhole(bidRunning)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
