import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, TrendingUp, TrendingDown, ArrowUpDown, Star } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import { formatPrice, formatPercent, formatVolume } from '../utils/format';
import CoinIcon from '../components/common/CoinIcon';

export default function MarketsPage() {
  const { markets, tickers, fetchMarkets } = useStore();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [quoteFilter, setQuoteFilter] = useState('USDT');
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'change' | 'volume'>('volume');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('qx_favs') || '[]')); }
    catch { return new Set(); }
  });
  const [showFavOnly, setShowFavOnly] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { fetchMarkets(); }, []);

  const toggleFav = (sym: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym); else next.add(sym);
      localStorage.setItem('qx_favs', JSON.stringify([...next]));
      return next;
    });
  };

  const quotes = useMemo(() => {
    const qs = new Set(markets.map((m) => m.quote_coin));
    return Array.from(qs);
  }, [markets]);

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const listed = useMemo(() => {
    return markets
      .filter((m) => m.quote_coin === quoteFilter)
      .filter((m) => !search || m.base_coin.toUpperCase().includes(search.toUpperCase()) || m.base_name?.toLowerCase().includes(search.toLowerCase()))
      .map((m) => {
        const sym = `${m.base_coin}-${m.quote_coin}`;
        const tick = tickers[sym];
        return { ...m, sym, last: tick?.last || 0, change: tick?.change || 0, volume: tick?.volume || 0 };
      })
      .filter((item) => !showFavOnly || favorites.has(item.sym))
      .sort((a, b) => {
        let diff = 0;
        if (sortBy === 'name') diff = a.base_coin.localeCompare(b.base_coin);
        else if (sortBy === 'price') diff = a.last - b.last;
        else if (sortBy === 'change') diff = a.change - b.change;
        else diff = a.volume - b.volume;
        return sortDir === 'asc' ? diff : -diff;
      });
  }, [markets, tickers, search, quoteFilter, sortBy, sortDir, showFavOnly, favorites]);

  const SortBtn = ({ col, label }: { col: typeof sortBy; label: string }) => (
    <button onClick={() => handleSort(col)} className="flex items-center gap-1 hover:text-exchange-text transition-colors">
      {label}
      {sortBy === col && <ArrowUpDown size={10} className="text-exchange-yellow" />}
    </button>
  );

  return (
    <div className="max-w-6xl mx-auto p-4 pb-20">
      <h1 className="text-2xl font-bold mb-1">{t('market.markets')}</h1>
      <p className="text-exchange-text-secondary text-sm mb-4">{t('app.description')}</p>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-exchange-text-third" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('market.searchPlaceholder')}
            className="input-field pl-10"
          />
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setShowFavOnly(!showFavOnly)}
            className={`px-3 py-2 rounded text-sm font-medium transition-colors flex items-center gap-1 ${
              showFavOnly ? 'bg-exchange-yellow text-black' : 'bg-exchange-card text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            <Star size={14} fill={showFavOnly ? 'currentColor' : 'none'} />
            {t('market.favorites')}
          </button>
          {quotes.map((q) => (
            <button
              key={q}
              onClick={() => { setQuoteFilter(q); setShowFavOnly(false); }}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                quoteFilter === q && !showFavOnly ? 'bg-exchange-yellow text-black' : 'bg-exchange-card text-exchange-text-secondary hover:text-exchange-text'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-exchange-text-third border-b border-exchange-border">
                <th className="text-left px-4 py-3 w-8"></th>
                <th className="text-left px-2 py-3"><SortBtn col="name" label={t('market.pair')} /></th>
                <th className="text-right px-4 py-3"><SortBtn col="price" label={t('market.lastPrice')} /></th>
                <th className="text-right px-4 py-3"><SortBtn col="change" label={t('market.change')} /></th>
                <th className="text-right px-4 py-3 hidden sm:table-cell"><SortBtn col="volume" label={t('market.volume')} /></th>
                <th className="text-right px-4 py-3 hidden md:table-cell">{t('market.chart')}</th>
                <th className="text-right px-4 py-3">{t('market.action')}</th>
              </tr>
            </thead>
            <tbody>
              {listed.map(({ sym, base_coin, base_name, last, change, volume }) => {
                const isUp = change >= 0;
                const isFav = favorites.has(sym);
                return (
                  <tr
                    key={sym}
                    className="border-b border-exchange-border/50 hover:bg-exchange-hover/30 cursor-pointer transition-colors"
                    onClick={() => navigate(`/trade/${sym}`)}
                  >
                    <td className="pl-4 py-3">
                      <button onClick={(e) => toggleFav(sym, e)} className="p-0.5">
                        <Star size={14} className={isFav ? 'text-exchange-yellow fill-exchange-yellow' : 'text-exchange-text-third'} />
                      </button>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2.5">
                        <CoinIcon symbol={base_coin} size={32} />
                        <div>
                          <div className="font-medium text-sm">{base_coin}<span className="text-exchange-text-third">/{quoteFilter}</span></div>
                          <div className="text-xs text-exchange-text-third">{base_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-mono tabular-nums">{formatPrice(last)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center gap-1 text-sm font-medium px-2 py-0.5 rounded ${
                        isUp ? 'bg-exchange-buy/10 text-exchange-buy' : 'bg-exchange-sell/10 text-exchange-sell'
                      }`}>
                        {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {formatPercent(change)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-exchange-text-secondary hidden sm:table-cell font-mono tabular-nums">
                      {formatVolume(volume)}
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <div className="h-8 flex items-center justify-end">
                        <svg width="80" height="30" viewBox="0 0 80 30">
                          <polyline
                            fill="none"
                            stroke={isUp ? '#0ECB81' : '#F6465D'}
                            strokeWidth="1.5"
                            points={Array.from({ length: 20 }, (_, i) => {
                              const x = (i / 19) * 80;
                              const y = 15 + Math.sin(i * 0.5 + (change || 0)) * 10 + (isUp ? -i * 0.3 : i * 0.3);
                              return `${x},${Math.max(2, Math.min(28, y))}`;
                            }).join(' ')}
                          />
                        </svg>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                        isUp ? 'bg-exchange-buy/15 text-exchange-buy hover:bg-exchange-buy/25' : 'bg-exchange-sell/15 text-exchange-sell hover:bg-exchange-sell/25'
                      }`}>
                        {t('market.tradeBtn')}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {listed.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-exchange-text-third">
                    {showFavOnly ? '관심 종목이 없습니다. 별표를 눌러 추가하세요.' : '검색 결과가 없습니다.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
