import { useRef, useEffect, useState } from 'react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import { formatPrice, formatAmount } from '../../utils/format';

export default function RecentTrades() {
  const { recentTrades } = useStore();
  const { t } = useI18n();
  const [newTradeIds, setNewTradeIds] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());

  // Flash new trades
  useEffect(() => {
    const currentIds = new Set(recentTrades.map(tr => tr.id));
    const newIds = new Set<string>();

    currentIds.forEach(id => {
      if (!prevIdsRef.current.has(id)) newIds.add(id);
    });

    if (newIds.size > 0 && newIds.size < 10) {
      setNewTradeIds(newIds);
      const timer = setTimeout(() => setNewTradeIds(new Set()), 500);
      prevIdsRef.current = currentIds;
      return () => clearTimeout(timer);
    }

    prevIdsRef.current = currentIds;
  }, [recentTrades]);

  return (
    <div className="flex flex-col h-full text-xs font-mono">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-exchange-border text-exchange-text-third">
        <span className="w-[35%]">{t('trade.price')}</span>
        <span className="w-[30%] text-right">{t('trade.amount')}</span>
        <span className="w-[35%] text-right">{t('trade.time')}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {recentTrades.length === 0 ? (
          <div className="p-4 text-center text-exchange-text-third text-xs">
            {t('trade.noTrades')}
          </div>
        ) : (
          recentTrades.slice(0, 30).map((trade, i) => {
            const isNew = newTradeIds.has(trade.id);
            return (
              <div
                key={`${trade.id}-${i}`}
                className={`flex items-center justify-between px-2 py-[3px] transition-all ${
                  isNew
                    ? trade.side === 'buy' ? 'bg-exchange-buy/12' : 'bg-exchange-sell/12'
                    : 'hover:bg-exchange-hover/30'
                }`}
              >
                <span className={`w-[35%] tabular-nums ${trade.side === 'buy' ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                  {formatPrice(trade.price)}
                </span>
                <span className="w-[30%] text-right text-exchange-text tabular-nums">{formatAmount(trade.amount)}</span>
                <span className="w-[35%] text-right text-exchange-text-third">
                  {trade.time ? new Date(trade.time).toLocaleTimeString('en', { hour12: false }) :
                   trade.created_at ? new Date(trade.created_at).toLocaleTimeString('en', { hour12: false }) : ''}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
