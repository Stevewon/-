import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import { subscribeToMarket, unsubscribeFromMarket, onTickerUpdate, onOrderbookUpdate, onTradesUpdate } from '../utils/socket';
import { formatPrice, formatPercent, formatVolume } from '../utils/format';
import CandleChart from '../components/chart/CandleChart';
import Orderbook from '../components/orderbook/Orderbook';
import TradePanel from '../components/trade/TradePanel';
import RecentTrades from '../components/trade/RecentTrades';
import OpenOrders from '../components/trade/OpenOrders';
import MarketSelector from '../components/market/MarketSelector';
import CoinIcon from '../components/common/CoinIcon';
import SkeletonLoader from '../components/common/SkeletonLoader';
import { ChevronDown, X, TrendingUp, TrendingDown, BarChart3, BookOpen, ArrowLeftRight } from 'lucide-react';

type MobileView = 'chart' | 'orderbook' | 'book' | 'trades';

export default function TradePage() {
  const { symbol = 'BTC-USDT' } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const {
    tickers, prevTickers, setCurrentMarket,
    fetchTickers, fetchOrderbook, fetchRecentTrades,
    updateAllTickers, updateOrderbook, addTrades, setRecentTrades,
    isLoadingOrderbook, isLoadingTrades,
  } = useStore();
  const [selectedPrice, setSelectedPrice] = useState<number | undefined>();
  const [showMarkets, setShowMarkets] = useState(false);
  const [bottomTab, setBottomTab] = useState<'orders' | 'trades'>('orders');
  const [mobileView, setMobileView] = useState<MobileView>('orderbook');

  const [base, quote] = symbol.split('-');
  const ticker = tickers[symbol];
  const prevTicker = prevTickers[symbol];
  const isUp = (ticker?.change ?? 0) >= 0;

  // Price flash effect
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (!ticker || !prevTicker) return;
    if (ticker.last > prevTicker.last) {
      setPriceFlash('up');
    } else if (ticker.last < prevTicker.last) {
      setPriceFlash('down');
    }
    const timer = setTimeout(() => setPriceFlash(null), 600);
    return () => clearTimeout(timer);
  }, [ticker?.last]);

  useEffect(() => {
    setCurrentMarket(symbol);
    subscribeToMarket(symbol);

    // Initial data fetch. Also pull the ticker snapshot so the header price
    // is populated IMMEDIATELY on entry (esp. when navigating straight to a
    // trade screen without the markets list having loaded tickers), instead
    // of showing 0 until the first SSE tick.
    fetchTickers();
    fetchOrderbook(symbol);
    fetchRecentTrades(symbol);

    // SSE: ticker updates (all markets)
    const unsubTicker = onTickerUpdate((data) => {
      updateAllTickers(data as any);
    });

    // SSE: orderbook updates for this market
    const unsubOrderbook = onOrderbookUpdate((data) => {
      updateOrderbook(data);
    });

    // SSE: trade updates for this market
    let isFirstTradeUpdate = true;
    const unsubTrades = onTradesUpdate((data) => {
      if (Array.isArray(data)) {
        if (isFirstTradeUpdate && data.length > 5) {
          setRecentTrades(data);
          isFirstTradeUpdate = false;
        } else {
          addTrades(data);
        }
      }
    });

    return () => {
      unsubscribeFromMarket(symbol);
      unsubTicker();
      unsubOrderbook();
      unsubTrades();
    };
  }, [symbol]);

  return (
    <div className="h-[calc(100dvh-89px)] w-full max-w-full min-w-0 overflow-x-hidden flex flex-col sm:pb-0 pb-14">
      {/* Market Info Bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-exchange-border bg-exchange-card min-w-0 max-w-full overflow-x-auto no-scrollbar">
        <button
          onClick={() => setShowMarkets(!showMarkets)}
          className="flex items-center gap-2 hover:bg-exchange-hover/50 px-2 py-1 rounded-md transition-colors shrink-0"
        >
          <CoinIcon symbol={base} size={24} />
          <span className="text-base font-bold text-exchange-text">{base}<span className="text-exchange-text-third">/{quote}</span></span>
          <ChevronDown size={14} className="text-exchange-text-third" />
        </button>

        <div className={`text-lg font-bold tabular-nums transition-all duration-300 shrink-0 ${
          priceFlash === 'up' ? 'text-exchange-buy scale-105' :
          priceFlash === 'down' ? 'text-exchange-sell scale-105' :
          isUp ? 'text-exchange-buy' : 'text-exchange-sell'
        }`}>
          {formatPrice(ticker?.last || 0)}
        </div>

        <div className="flex items-center gap-4 text-xs shrink-0">
          <div className="flex flex-col">
            <span className="text-exchange-text-third text-[10px]">{t('market.change24h')}</span>
            <span className={`chg-pill ${isUp ? 'up' : 'down'} mt-0.5`}>
              {formatPercent(ticker?.change || 0)}
            </span>
          </div>
          <div className="hidden sm:flex flex-col">
            <span className="text-exchange-text-third text-[10px]">{t('market.high24h')}</span>
            <span className="text-exchange-text tabular-nums">{formatPrice(ticker?.high || 0)}</span>
          </div>
          <div className="hidden sm:flex flex-col">
            <span className="text-exchange-text-third text-[10px]">{t('market.low24h')}</span>
            <span className="text-exchange-text tabular-nums">{formatPrice(ticker?.low || 0)}</span>
          </div>
          <div className="hidden md:flex flex-col">
            <span className="text-exchange-text-third text-[10px]">{t('market.volume24h')}</span>
            <span className="text-exchange-text tabular-nums">{formatVolume(ticker?.volume || 0)}</span>
          </div>
        </div>
      </div>

      {/* ===== DESKTOP LAYOUT (md+) ===== */}
      <div className="hidden md:flex flex-1 min-h-0 relative">
        {/* Market Selector Overlay */}
        {showMarkets && (
          <div className="absolute inset-0 z-40 bg-exchange-bg/95 backdrop-blur-sm">
            <div className="h-full max-w-md border-r border-exchange-border bg-exchange-card shadow-2xl">
              <div className="flex items-center justify-between px-3 py-2 border-b border-exchange-border">
                <span className="text-sm font-medium">{t('market.markets')}</span>
                <button onClick={() => setShowMarkets(false)} className="p-1 hover:bg-exchange-hover rounded"><X size={16} className="text-exchange-text-third" /></button>
              </div>
              <MarketSelector currentSymbol={symbol} onClose={() => setShowMarkets(false)} />
            </div>
          </div>
        )}

        {/* Left: Chart */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-exchange-border">
          <div className="flex-1 min-h-0">
            <CandleChart symbol={symbol} />
          </div>

          {/* Bottom: Open Orders / Trade History */}
          <div className="h-48 border-t border-exchange-border flex flex-col">
            <div className="flex items-center gap-4 px-3 border-b border-exchange-border">
              {([
                { key: 'orders' as const, label: t('trade.openOrders') },
                { key: 'trades' as const, label: t('trade.tradeHistory') },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setBottomTab(key)}
                  className={`py-2 text-xs font-medium border-b-2 transition-colors ${
                    bottomTab === key
                      ? 'border-exchange-yellow text-exchange-yellow'
                      : 'border-transparent text-exchange-text-secondary hover:text-exchange-text'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {bottomTab === 'orders' ? <OpenOrders symbol={symbol} /> : <RecentTrades />}
            </div>
          </div>
        </div>

        {/* Right Panel: Orderbook + Trade */}
        <div className="flex flex-col w-[580px]">
          <div className="flex flex-1 min-h-0">
            {/* Orderbook */}
            <div className="w-[280px] border-r border-exchange-border flex flex-col">
              <div className="px-2 py-1.5 border-b border-exchange-border text-xs font-medium text-exchange-text-secondary">
                {t('trade.orderbook')}
              </div>
              <div className="flex-1 min-h-0">
                {isLoadingOrderbook && useStore.getState().orderbook.bids.length === 0 ? (
                  <SkeletonLoader type="orderbook" />
                ) : (
                  <Orderbook onPriceClick={(p) => setSelectedPrice(p)} />
                )}
              </div>
            </div>

            {/* Trade Panel */}
            <div className="w-[300px] flex flex-col">
              <div className="px-3 py-1.5 border-b border-exchange-border text-xs font-medium text-exchange-text-secondary">
                {t('trade.placeOrder')}
              </div>
              <div className="flex-1 overflow-y-auto">
                <TradePanel symbol={symbol} initialPrice={selectedPrice} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== MOBILE LAYOUT (< md) ===== */}
      <div className="md:hidden flex flex-col flex-1 min-h-0 min-w-0 max-w-full overflow-x-hidden">
        {/* Market Selector Overlay (Mobile) */}
        {showMarkets && (
          <div className="absolute inset-0 z-40 bg-exchange-bg/95 backdrop-blur-sm">
            <div className="h-full bg-exchange-card">
              <div className="flex items-center justify-between px-3 py-2 border-b border-exchange-border">
                <span className="text-sm font-medium">{t('market.markets')}</span>
                <button onClick={() => setShowMarkets(false)} className="p-1 hover:bg-exchange-hover rounded"><X size={16} className="text-exchange-text-third" /></button>
              </div>
              <MarketSelector currentSymbol={symbol} onClose={() => setShowMarkets(false)} />
            </div>
          </div>
        )}

        {/* Mobile view switch — Order form (default) vs Order book vs Chart */}
        <div className="trade-tabs border-b border-exchange-border bg-exchange-card">
          {([
            { key: 'orderbook' as MobileView, label: t('trade.placeOrder'), icon: BookOpen },
            { key: 'book' as MobileView, label: t('trade.orderbookTab'), icon: BookOpen },
            { key: 'chart' as MobileView, label: t('trade.chart'), icon: BarChart3 },
            { key: 'trades' as MobileView, label: t('trade.tradesTab'), icon: ArrowLeftRight },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setMobileView(key)}
              className={`trade-tab ${
                mobileView === key
                  ? '!border-exchange-yellow text-exchange-text'
                  : 'text-exchange-text-third'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* Mobile Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* DEFAULT: Order form full-width (Bybit mobile style). */}
          {mobileView === 'orderbook' && (
            <div className="min-h-0">
              <TradePanel symbol={symbol} initialPrice={selectedPrice} />
            </div>
          )}

          {/* Order book — its own tab, full width */}
          {mobileView === 'book' && (
            <div className="h-full min-h-0">
              {isLoadingOrderbook && useStore.getState().orderbook.bids.length === 0 ? (
                <SkeletonLoader type="orderbook" />
              ) : (
                <Orderbook onPriceClick={(p) => setSelectedPrice(p)} mobile />
              )}
            </div>
          )}

          {mobileView === 'chart' && (
            <div className="h-[70vh] flex flex-col">
              <div className="flex-1 min-h-0">
                <CandleChart symbol={symbol} />
              </div>
            </div>
          )}

          {mobileView === 'trades' && (
            <div className="min-h-[60vh]">
              {isLoadingTrades ? (
                <SkeletonLoader type="trades" />
              ) : (
                <RecentTrades />
              )}
            </div>
          )}
        </div>

        {/* Bottom sub-tabs: Orders / Trade history */}
        <div className="border-t border-exchange-border bg-exchange-card">
          <div className="flex items-center gap-5 px-3">
            {([
              { key: 'orders' as const, label: t('trade.openOrders') },
              { key: 'trades' as const, label: t('trade.tradeHistory') },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setBottomTab(key)}
                className={`py-2.5 text-[13px] font-semibold border-b-2 transition-colors ${
                  bottomTab === key
                    ? 'border-exchange-yellow text-exchange-text'
                    : 'border-transparent text-exchange-text-third'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="max-h-40 overflow-y-auto">
            {bottomTab === 'orders' ? <OpenOrders symbol={symbol} /> : <RecentTrades />}
          </div>
        </div>
      </div>
    </div>
  );
}
