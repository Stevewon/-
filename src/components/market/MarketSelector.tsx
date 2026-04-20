import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Star } from 'lucide-react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import { formatPrice, formatPercent } from '../../utils/format';
import CoinIcon from '../common/CoinIcon';

interface Props {
  currentSymbol: string;
  onClose?: () => void;
}

export default function MarketSelector({ currentSymbol, onClose }: Props) {
  const { markets, tickers } = useStore();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [quoteFilter, setQuoteFilter] = useState('USDT');
  const navigate = useNavigate();

  const quotes = useMemo(() => {
    const qs = new Set(markets.map((m) => m.quote_coin));
    return Array.from(qs);
  }, [markets]);

  const filtered = useMemo(() => {
    return markets
      .filter((m) => m.quote_coin === quoteFilter)
      .filter((m) => {
        if (!search) return true;
        const s = search.toUpperCase();
        return m.base_coin.includes(s) || m.base_name?.toLowerCase().includes(search.toLowerCase());
      })
      .map((m) => {
        const sym = `${m.base_coin}-${m.quote_coin}`;
        const ticker = tickers[sym];
        return { ...m, sym, ticker };
      });
  }, [markets, tickers, search, quoteFilter]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-exchange-text-third" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('market.searchPlaceholder')}
            className="input-field pl-8 text-xs"
          />
        </div>
      </div>

      <div className="flex gap-1 px-2 pb-2 border-b border-exchange-border">
        {quotes.map((q) => (
          <button
            key={q}
            onClick={() => setQuoteFilter(q)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              quoteFilter === q
                ? 'bg-exchange-yellow/20 text-exchange-yellow'
                : 'text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            {q}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center px-2 py-1 text-[10px] text-exchange-text-third">
          <span className="w-[40%]">{t('market.pair')}</span>
          <span className="w-[35%] text-right">{t('trade.price')}</span>
          <span className="w-[25%] text-right">{t('market.change')}</span>
        </div>
        {filtered.map(({ sym, base_coin, base_name, ticker }) => {
          const change = ticker?.change ?? 0;
          const isUp = change >= 0;
          return (
            <div
              key={sym}
              onClick={() => { navigate(`/trade/${sym}`); onClose?.(); }}
              className={`flex items-center px-2 py-2 cursor-pointer hover:bg-exchange-hover transition-colors ${
                sym === currentSymbol ? 'bg-exchange-hover' : ''
              }`}
            >
              <div className="w-[40%] flex items-center gap-2">
                <CoinIcon symbol={base_coin} size={20} />
                <div>
                  <div className="text-xs font-medium text-exchange-text">{base_coin}<span className="text-exchange-text-third">/{quoteFilter}</span></div>
                  <div className="text-[10px] text-exchange-text-third">{base_name}</div>
                </div>
              </div>
              <div className="w-[35%] text-right text-xs font-mono tabular-nums">{formatPrice(ticker?.last || 0)}</div>
              <div className={`w-[25%] text-right text-xs font-mono tabular-nums ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                {formatPercent(change)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
