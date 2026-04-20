import { useEffect } from 'react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import { formatPrice, formatAmount, timeAgo } from '../../utils/format';
import { X } from 'lucide-react';
import api from '../../utils/api';

interface Props {
  symbol: string;
}

export default function OpenOrders({ symbol }: Props) {
  const { user, openOrders, fetchOpenOrders, fetchWallets } = useStore();
  const { t } = useI18n();

  useEffect(() => {
    if (user) fetchOpenOrders(symbol);
    const interval = setInterval(() => { if (user) fetchOpenOrders(symbol); }, 5000);
    return () => clearInterval(interval);
  }, [user, symbol]);

  const cancelOrder = async (orderId: string) => {
    try {
      await api.delete(`/orders/${orderId}`);
      fetchOpenOrders(symbol);
      fetchWallets();
    } catch (e) {
      console.error(e);
    }
  };

  if (!user) return (
    <div className="p-4 text-center text-exchange-text-third text-sm">
      {t('trade.loginToView')}
    </div>
  );

  return (
    <div className="text-xs">
      <div className="flex items-center px-3 py-2 border-b border-exchange-border text-exchange-text-third font-medium">
        <span className="w-[15%]">{t('trade.pair')}</span>
        <span className="w-[10%]">{t('trade.side')}</span>
        <span className="w-[12%]">{t('trade.type')}</span>
        <span className="w-[15%] text-right">{t('trade.price')}</span>
        <span className="w-[15%] text-right">{t('trade.amount')}</span>
        <span className="w-[15%] text-right">{t('trade.filled')}</span>
        <span className="w-[12%] text-right">{t('trade.time')}</span>
        <span className="w-[6%]"></span>
      </div>

      {openOrders.length === 0 ? (
        <div className="p-4 text-center text-exchange-text-third">{t('trade.noOpenOrders')}</div>
      ) : (
        openOrders.map((order) => (
          <div key={order.id} className="flex items-center px-3 py-2 hover:bg-exchange-hover/30 border-b border-exchange-border/50 transition-colors">
            <span className="w-[15%] text-exchange-text">{order.base_coin}/{order.quote_coin}</span>
            <span className={`w-[10%] font-medium ${order.side === 'buy' ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
              {order.side === 'buy' ? t('trade.buy') : t('trade.sell')}
            </span>
            <span className="w-[12%] text-exchange-text-secondary">{order.type === 'limit' ? t('trade.limit') : t('trade.market')}</span>
            <span className="w-[15%] text-right tabular-nums">{order.price ? formatPrice(order.price) : t('trade.market')}</span>
            <span className="w-[15%] text-right tabular-nums">{formatAmount(order.amount)}</span>
            <span className="w-[15%] text-right text-exchange-text-secondary tabular-nums">
              {((order.filled / order.amount) * 100).toFixed(1)}%
            </span>
            <span className="w-[12%] text-right text-exchange-text-third">{timeAgo(order.created_at)}</span>
            <span className="w-[6%] flex justify-end">
              <button onClick={() => cancelOrder(order.id)} className="text-exchange-sell hover:text-red-400 p-1 rounded hover:bg-exchange-sell/10 transition-colors">
                <X size={12} />
              </button>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
