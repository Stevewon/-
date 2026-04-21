import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import { formatPrice, formatPercent, formatVolume } from '../utils/format';
import CoinIcon from '../components/common/CoinIcon';
import SkeletonLoader from '../components/common/SkeletonLoader';
import {
  Search, Star, TrendingUp, TrendingDown, ArrowUpDown,
  ChevronDown, ChevronUp, BarChart3, Flame, Clock, Filter,
} from 'lucide-react';

type SortField = 'name' | 'price' | 'change' | 'volume';
type QuickFilter = 'all' | 'gainers' | 'losers' | 'hot';

export default function MarketsPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { markets, tickers, isLoadingMarkets, fetchMarkets } = useStore();
  const [search, setSearch] = useState('');
  const [quoteFilter, setQuoteFilter] = useState('USDT');
  const [sortField, setSortField] = useState<SortField>('volume');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('favorites') || '[]')); } catch { return new Set(); }
  });
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');

  useEffect(() => { fetchMarkets(); }, []);

  const toggleFavorite = (sym: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym); else next.add(sym);
      localStorage.setItem('favorites', JSON.stringify([...next]));
      return next;
    });
  };

  const quotes = useMemo(() => {
    const qs = new Set(markets.map(m => m.quote_coin));
    return Array.from(qs);
  }, [markets]);

  const listed = useMemo(() => {
    let list = markets
      .filter(m => m.quote_coin === quoteFilter)
      .map(m => {
        const sym = `${m.base_coin}-${m.quote_coin}`;
        const ticker = tickers[sym];
        return {
          ...m,
          sym,
          last: ticker?.last ?? 0,
          change: ticker?.change ?? 0,
          volume: ticker?.volume ?? 0,
          high: ticker?.high ?? 0,
          low: ticker?.low ?? 0,
          isFav: favorites.has(sym),
        };
      });

    if (showFavOnly) list = list.filter(m => m.isFav);

    if (search) {
      const s = search.toUpperCase();
      list = list.filter(m => m.base_coin.includes(s) || (m.base_name || '').toUpperCase().includes(s));
    }

    // Quick filters
    if (quickFilter === 'gainers') list = list.filter(m => m.change > 0);
    if (quickFilter === 'losers') list = list.filter(m => m.change < 0);
    if (quickFilter === 'hot') list = list.sort((a, b) => b.volume - a.volume).slice(0, 10);

    // Sort
    list.sort((a, b) => {
      // Favorites first
      if (a.isFav !== b.isFav) return a.isFav ? -1 : 1;

      const dir = sortDir === 'desc' ? -1 : 1;
      switch (sortField) {
        case 'name': return dir * a.base_coin.localeCompare(b.base_coin);
        case 'price': return dir * (a.last - b.last);
        case 'change': return dir * (a.change - b.change);
        case 'volume': return dir * (a.volume - b.volume);
        default: return 0;
      }
    });

    return list;
  }, [markets, tickers, quoteFilter, search, sortField, sortDir, favorites, showFavOnly, quickFilter]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={10} className="text-exchange-text-third" />;
    return sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />;
  };

  // Sparkline SVG
  const Sparkline = ({ change }: { change: number }) => {
    const isUp = change >= 0;
    const points: number[] = [];
    let v = 50;
    for (let i = 0; i < 20; i++) {
      v += (Math.random() - (isUp ? 0.4 : 0.6)) * 8;
      v = Math.max(5, Math.min(95, v));
      points.push(v);
    }
    // Ensure end reflects direction
    if (isUp) points[points.length - 1] = Math.max(60, points[points.length - 1]);
    else points[points.length - 1] = Math.min(40, points[points.length - 1]);

    const path = points.map((p, i) => `${(i / (points.length - 1)) * 80},${100 - p}`).join(' ');

    return (
      <svg viewBox="0 0 80 100" className="w-20 h-8">
        <polyline
          points={path}
          fill="none"
          stroke={isUp ? '#0ECB81' : '#F6465D'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-exchange-text mb-1">{t('market.allMarkets')}</h1>
        <p className="text-sm text-exchange-text-secondary">
          {t('market.marketCount', { count: String(listed.length) })}
        </p>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Quote Tabs */}
        <div className="flex items-center gap-0.5 bg-exchange-card rounded-lg border border-exchange-border p-0.5">
          {quotes.map(q => (
            <button
              key={q}
              onClick={() => setQuoteFilter(q)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                quoteFilter === q
                  ? 'bg-exchange-yellow text-black'
                  : 'text-exchange-text-secondary hover:text-exchange-text'
              }`}
            >
              {q}
            </button>
          ))}
        </div>

        {/* Favorite Toggle */}
        <button
          onClick={() => setShowFavOnly(!showFavOnly)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            showFavOnly
              ? 'bg-exchange-yellow/10 text-exchange-yellow border-exchange-yellow/30'
              : 'text-exchange-text-secondary border-exchange-border hover:text-exchange-text'
          }`}
        >
          <Star size={12} fill={showFavOnly ? '#F0B90B' : 'none'} />
          {t('market.favorites')}
        </button>

        {/* Quick Filters */}
        <div className="flex items-center gap-1">
          {([
            { key: 'all' as QuickFilter, label: t('market.all'), icon: Filter },
            { key: 'gainers' as QuickFilter, label: t('market.rising'), icon: TrendingUp },
            { key: 'losers' as QuickFilter, label: t('market.falling'), icon: TrendingDown },
            { key: 'hot' as QuickFilter, label: t('market.hot'), icon: Flame },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setQuickFilter(key)}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-colors ${
                quickFilter === key
                  ? 'bg-exchange-hover text-exchange-yellow'
                  : 'text-exchange-text-third hover:text-exchange-text'
              }`}
            >
              <Icon size={11} />
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-exchange-text-third" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('market.searchCoin')}
            className="input-field pl-9 text-xs h-8 w-full"
          />
        </div>
      </div>

      {isLoadingMarkets ? (
        <div className="bg-exchange-card rounded-xl border border-exchange-border">
          <SkeletonLoader type="table" rows={10} />
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-exchange-card rounded-xl border border-exchange-border overflow-hidden">
            <div className="flex items-center px-4 py-3 text-xs text-exchange-text-third font-medium border-b border-exchange-border bg-exchange-bg/50">
              <span className="w-[4%]"></span>
              <button onClick={() => toggleSort('name')} className="w-[20%] flex items-center gap-1 hover:text-exchange-text">
                {t('market.pair')} <SortIcon field="name" />
              </button>
              <button onClick={() => toggleSort('price')} className="w-[18%] text-right flex items-center justify-end gap-1 hover:text-exchange-text">
                {t('trade.price')} <SortIcon field="price" />
              </button>
              <button onClick={() => toggleSort('change')} className="w-[14%] text-right flex items-center justify-end gap-1 hover:text-exchange-text">
                {t('market.change')} <SortIcon field="change" />
              </button>
              <button onClick={() => toggleSort('volume')} className="w-[16%] text-right flex items-center justify-end gap-1 hover:text-exchange-text">
                {t('market.volume')} <SortIcon field="volume" />
              </button>
              <span className="w-[16%] text-center">{t('market.chart')}</span>
              <span className="w-[12%] text-center">{t('market.tradeBtn')}</span>
            </div>

            {listed.length === 0 ? (
              <div className="py-16 text-center">
                <BarChart3 size={36} className="mx-auto text-exchange-text-third mb-3 opacity-40" />
                <p className="text-exchange-text-secondary text-sm">{t('market.noResults')}</p>
              </div>
            ) : (
              listed.map(m => {
                const isUp = m.change >= 0;
                return (
                  <div
                    key={m.sym}
                    className="flex items-center px-4 py-3 hover:bg-exchange-hover/30 border-b border-exchange-border/30 cursor-pointer transition-colors group"
                    onClick={() => navigate(`/trade/${m.sym}`)}
                  >
                    <span className="w-[4%]">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(m.sym); }}
                        className="p-0.5"
                      >
                        <Star
                          size={14}
                          fill={m.isFav ? '#F0B90B' : 'none'}
                          className={m.isFav ? 'text-exchange-yellow' : 'text-exchange-text-third hover:text-exchange-yellow'}
                        />
                      </button>
                    </span>
                    <span className="w-[20%] flex items-center gap-2.5">
                      <CoinIcon symbol={m.base_coin} size={28} />
                      <div>
                        <span className="text-sm font-semibold text-exchange-text">{m.base_coin}</span>
                        <span className="text-exchange-text-third text-xs ml-1">/{m.quote_coin}</span>
                        <div className="text-[11px] text-exchange-text-third">{m.base_name}</div>
                      </div>
                    </span>
                    <span className="w-[18%] text-right text-sm font-medium tabular-nums text-exchange-text">
                      {formatPrice(m.last)}
                    </span>
                    <span className={`w-[14%] text-right flex items-center justify-end gap-0.5 text-sm font-medium tabular-nums ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                      {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {formatPercent(m.change)}
                    </span>
                    <span className="w-[16%] text-right text-xs tabular-nums text-exchange-text-secondary">
                      {formatVolume(m.volume)}
                    </span>
                    <span className="w-[16%] flex justify-center">
                      <Sparkline change={m.change} />
                    </span>
                    <span className="w-[12%] flex justify-center">
                      <button
                        className="px-4 py-1.5 rounded-md text-xs font-semibold bg-exchange-yellow text-black hover:bg-exchange-yellow/90 transition-colors"
                        onClick={(e) => { e.stopPropagation(); navigate(`/trade/${m.sym}`); }}
                      >
                        {t('market.tradeBtn')}
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {listed.length === 0 ? (
              <div className="py-12 text-center">
                <BarChart3 size={32} className="mx-auto text-exchange-text-third mb-2 opacity-40" />
                <p className="text-exchange-text-secondary text-sm">{t('market.noResults')}</p>
              </div>
            ) : (
              listed.map(m => {
                const isUp = m.change >= 0;
                return (
                  <div
                    key={m.sym}
                    className="bg-exchange-card rounded-xl border border-exchange-border p-3 active:bg-exchange-hover/30 transition-colors"
                    onClick={() => navigate(`/trade/${m.sym}`)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(m.sym); }}
                          className="p-0.5"
                        >
                          <Star
                            size={14}
                            fill={m.isFav ? '#F0B90B' : 'none'}
                            className={m.isFav ? 'text-exchange-yellow' : 'text-exchange-text-third'}
                          />
                        </button>
                        <CoinIcon symbol={m.base_coin} size={28} />
                        <div>
                          <div className="text-sm font-semibold text-exchange-text">
                            {m.base_coin}<span className="text-exchange-text-third text-xs">/{m.quote_coin}</span>
                          </div>
                          <div className="text-[11px] text-exchange-text-third">{m.base_name}</div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-sm font-medium tabular-nums text-exchange-text">{formatPrice(m.last)}</div>
                        <div className={`text-xs tabular-nums flex items-center justify-end gap-0.5 ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                          {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {formatPercent(m.change)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-exchange-border/30">
                      <div className="flex items-center gap-3 text-[11px] text-exchange-text-third">
                        <span>{t('market.vol')} {formatVolume(m.volume)}</span>
                        <span>{t('market.high')} {formatPrice(m.high)}</span>
                      </div>
                      <Sparkline change={m.change} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
