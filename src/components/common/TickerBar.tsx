import { useNavigate } from 'react-router-dom';
import useStore from '../../store/useStore';
import { formatPrice, formatPercent } from '../../utils/format';
import CoinIcon from './CoinIcon';

export default function TickerBar() {
  const { markets, tickers } = useStore();
  const navigate = useNavigate();

  const items = markets
    .filter((m) => m.quote_coin === 'USDT')
    .map((m) => {
      const sym = `${m.base_coin}-${m.quote_coin}`;
      const t = tickers[sym];
      return { sym, base: m.base_coin, last: t?.last || 0, change: t?.change || 0 };
    })
    .filter((item) => item.last > 0);

  if (items.length === 0) return null;

  // Double items for seamless scroll
  const doubled = [...items, ...items];

  return (
    <div className="bg-exchange-bg border-b border-exchange-border overflow-hidden h-8 relative select-none">
      <div className="ticker-scroll flex items-center h-full gap-6 whitespace-nowrap">
        {doubled.map((item, i) => {
          const isUp = item.change >= 0;
          return (
            <button
              key={`${item.sym}-${i}`}
              onClick={() => navigate(`/trade/${item.sym}`)}
              className="flex items-center gap-1.5 text-xs hover:bg-exchange-hover/40 px-2 py-1 rounded transition-colors shrink-0"
            >
              <CoinIcon symbol={item.base} size={16} />
              <span className="text-exchange-text-secondary font-medium">{item.base}</span>
              <span className={`font-mono font-medium ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                ${formatPrice(item.last)}
              </span>
              <span className={`font-mono text-[10px] px-1 py-0.5 rounded ${
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
