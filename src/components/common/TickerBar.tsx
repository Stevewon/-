import { useNavigate } from 'react-router-dom';
import useStore from '../../store/useStore';
import { formatPrice, formatPercent } from '../../utils/format';
import CoinIcon from './CoinIcon';

export default function TickerBar() {
  const { markets, tickers } = useStore();
  const navigate = useNavigate();

  // ★ OWNER RULE (2026-09-07): our own coins scroll FIRST — QTA, then QX, then
  //   QKEY — followed by everything else in its existing (BTC-first) order.
  const PRIORITY: Record<string, number> = { QTA: 0, QX: 1, QKEY: 2 };
  const items = markets
    .filter((m) => m.quote_coin === 'USDT')
    .map((m, idx) => {
      const sym = `${m.base_coin}-${m.quote_coin}`;
      const t = tickers[sym];
      return { sym, base: m.base_coin, last: t?.last || 0, change: t?.change || 0, _idx: idx };
    })
    .filter((item) => item.last > 0)
    .sort((a, b) => {
      const pa = PRIORITY[a.base] ?? 99;
      const pb = PRIORITY[b.base] ?? 99;
      if (pa !== pb) return pa - pb;   // our coins first, in fixed order
      return a._idx - b._idx;          // otherwise keep original order
    });

  if (items.length === 0) return null;

  const doubled = [...items, ...items];

  return (
    <div className="bg-exchange-bg border-b border-exchange-border overflow-hidden h-10 sm:h-11 relative select-none">
      <div className="ticker-scroll flex items-center h-full gap-4 sm:gap-7 whitespace-nowrap">
        {doubled.map((item, i) => {
          const isUp = item.change >= 0;
          return (
            <button
              key={`${item.sym}-${i}`}
              onClick={() => navigate(`/trade/${item.sym}`)}
              className="flex items-center gap-1.5 sm:gap-2 text-[13px] sm:text-sm hover:bg-exchange-hover/40 px-2 sm:px-2.5 py-1.5 sm:py-2 rounded transition-colors shrink-0"
            >
              <CoinIcon symbol={item.base} size={18} className="sm:w-5 sm:h-5" />
              <span className="text-exchange-text-secondary font-medium">{item.base}</span>
              <span className={`font-mono font-semibold ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                ${formatPrice(item.last)}
              </span>
              <span className={`font-mono text-[11px] sm:text-xs font-semibold px-1.5 py-0.5 rounded ${
                isUp ? 'bg-exchange-buy/15 text-exchange-buy' : 'bg-exchange-sell/15 text-exchange-sell'
              }`}>
                {formatPercent(item.change)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
