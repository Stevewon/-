import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import { subscribeToMarket, unsubscribeFromMarket, onTickerUpdate } from '../utils/socket';
import { formatPrice, formatPercent, formatVolume } from '../utils/format';
import CandleChart from '../components/chart/CandleChart';
import Orderbook from '../components/orderbook/Orderbook';
import TradePanel from '../components/trade/TradePanel';
import RecentTrades from '../components/trade/RecentTrades';
import OpenOrders from '../components/trade/OpenOrders';
import MarketSelector from '../components/market/MarketSelector';
import CoinIcon from '../components/common/CoinIcon';
import { ChevronDown, X, TrendingUp, TrendingDown } from 'lucide-react';

export default function TradePage() {
  const { symbol = 'BTC-USDT' } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { tickers, setCurrentMarket, fetchOrderbook, fetchRecentTrades, updateTicker } = useStore();
  const [selectedPrice, setSelectedPrice] = useState<number | undefined>();
  const [showMarkets, setShowMarkets] = useState(false);
  const [bottomTab, setBottomTab] = useState<'orders' | 'trades'>('orders');
  const [mobilePanel, setMobilePanel] = useState<'buy' | 'sell' | null>(null);

  const [base, quote] = symbol.split('-');
  const ticker = tickers[symbol];
  const isUp = (ticker?.change ?? 0) >= 0;

  useEffect(() => {
    setCurrentMarket(symbol);
    subscribeToMarket(symbol);
    fetchOrderbook(symbol);
    fetchRecentTrades(symbol);

    const interval = setInterval(() => {
      fetchOrderbook(symbol);
      fetchRecentTrades(symbol);
    }, 3000);

    const unsubTicker = onTickerUpdate((data) => {
      Object.entries(data).forEach(([sym, tickerData]) => {
        updateTicker(sym, tickerData as any);
      });
    });

    return () => {
      unsubscribeFromMarket(symbol);
      clearInterval(interval);
      unsubTicker();
    };
  }, [symbol]);

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col sm:pb-0 pb-14">
      {/* Market Info Bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-exchange-border bg-exchange-card overflow-x-auto">
        <button
          onClick={() => setShowMarkets(!showMarkets)}
          className="flex items-center gap-2 hover:bg-exchange-hover/50 px-2 py-1 rounded-md transition-colors shrink-0"
        >
          <CoinIcon symbol={base} size={24} />
          <span className="text-base font-bold text-exchange-text">{base}<span className="text-exchange-text-third">/{quote}</span></span>
          <ChevronDown size={14} className="text-exchange-text-third" />
        </button>

        <div className={`text-lg font-bold tabular-nums ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
          {formatPrice(ticker?.last || 0)}
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex flex-col">
            <span className="text-exchange-text-third text-[10px]">{t('market.change24h')}</span>
            <span className={`font-medium tabular-nums ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
              {isUp ? <TrendingUp size={10} className="inline mr-0.5" /> : <TrendingDown size={10} className="inline mr-0.5" />}
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

      {/* Main Content */}
      <div className="flex-1 flex min-h-0 relative">
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
        <div className="hidden md:flex flex-col w-[580px]">
          <div className="flex flex-1 min-h-0">
            {/* Orderbook */}
            <div className="w-[280px] border-r border-exchange-border flex flex-col">
              <div className="px-2 py-1.5 border-b border-exchange-border text-xs font-medium text-exchange-text-secondary">
                {t('trade.orderbook')}
              </div>
              <div className="flex-1 min-h-0">
                <Orderbook onPriceClick={(p) => setSelectedPrice(p)} />
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

      {/* Mobile Trade Buttons */}
      <div className="md:hidden fixed bottom-14 left-0 right-0 bg-exchange-card border-t border-exchange-border p-2 flex gap-2 z-30">
        <button className="flex-1 btn-buy text-sm py-2.5 rounded-lg font-semibold" onClick={() => setMobilePanel('buy')}>
          {t('trade.buy')} {base}
        </button>
        <button className="flex-1 btn-sell text-sm py-2.5 rounded-lg font-semibold" onClick={() => setMobilePanel('sell')}>
          {t('trade.sell')} {base}
        </button>
      </div>

      {/* Mobile Trade Panel Modal */}
      {mobilePanel && (
        <div className="md:hidden fixed inset-0 z-50 bg-exchange-bg/90 backdrop-blur-sm flex items-end">
          <div className="w-full bg-exchange-card rounded-t-2xl border-t border-exchange-border p-4 pb-8 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{mobilePanel === 'buy' ? t('trade.buy') : t('trade.sell')} {base}</h3>
              <button onClick={() => setMobilePanel(null)} className="p-1"><X size={20} className="text-exchange-text-third" /></button>
            </div>
            <TradePanel symbol={symbol} initialPrice={selectedPrice} forceSide={mobilePanel} onComplete={() => setMobilePanel(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
