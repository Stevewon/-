import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import DesktopPageLayout from '../components/common/DesktopPageLayout';
import CoinIcon from '../components/common/CoinIcon';
import {
  Search, Ticket, LayoutGrid, ChevronRight, PieChart,
  Zap, Link2, Gem, Sparkles, ChevronDown, SlidersHorizontal,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Earn page — Binance-style layout (idle-asset banner, category circles,
// product grid, Explore Products list). Curated static products; APRs are
// display-only marketing figures.
// ---------------------------------------------------------------------------

type Filter = 'steady' | 'top' | 'vip';

const CATEGORIES = [
  { key: 'easy', icon: Zap, badge: null as string | null },
  { key: 'onchain', icon: Link2, badge: null },
  { key: 'rwa', icon: Gem, badge: 'New' },
  { key: 'advanced', icon: Sparkles, badge: null },
];

const PRODUCTS = [
  { coin: 'USDT', kind: 'flexible', apr: '6.82%', top: false },
  { coin: 'USDC', kind: 'flexible', apr: '6.40%', top: false },
  { coin: 'BTC', kind: 'flexible', apr: '1.20%', top: false },
  { coin: 'ETH', kind: 'flexible', apr: '2.35%', top: false },
  { coin: 'QX', kind: 'flexible', apr: '12.00%', top: true },
  { coin: 'SOL', kind: 'flexible', apr: '4.10%', top: true },
];

export default function EarnPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('steady');

  const filtered = PRODUCTS.filter((p) => {
    if (search && !p.coin.toUpperCase().includes(search.toUpperCase())) return false;
    if (filter === 'top') return p.top;
    return true;
  });

  return (
    <DesktopPageLayout>
      {/* Search bar + header icons */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-exchange-text-third" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('earn.searchPlaceholder')}
            className="input-field pl-10 h-11 w-full rounded-full text-[14px]"
          />
        </div>
        <button className="text-exchange-text-secondary hover:text-exchange-text p-1"><Ticket size={22} /></button>
        <button className="text-exchange-text-secondary hover:text-exchange-text p-1"><LayoutGrid size={22} /></button>
      </div>

      {/* Total Earn Asset row */}
      <div className="flex items-center gap-2 text-[13px] mb-4">
        <span className="text-exchange-text-third">{t('earn.totalEarnAsset')}</span>
        <span className="text-exchange-text font-medium tabular-nums">0.00 USD</span>
        <span className="text-exchange-border">|</span>
        <button className="flex items-center gap-1 text-exchange-text-secondary">
          {t('earn.autoEarn')} <span className="text-exchange-text-third">{t('earn.off')}</span>
          <ChevronRight size={13} />
        </button>
      </div>

      {/* 100% idle asset banner */}
      <div
        className="flex items-center justify-between rounded-2xl mb-6 overflow-hidden"
        style={{
          padding: '18px 20px',
          background: 'linear-gradient(100deg, #1E2329 0%, #14171A 100%)',
          border: '1px solid var(--color-exchange-border)',
        }}
      >
        <div className="flex items-center gap-4">
          <div
            className="rounded-full flex items-center justify-center shrink-0"
            style={{ width: 44, height: 44, background: 'radial-gradient(circle at 30% 30%, #C0C4CC, #6B7079)' }}
          >
            <PieChart size={22} className="text-exchange-yellow" />
          </div>
          <div className="text-[17px] font-bold text-exchange-text">{t('earn.idleAsset')}</div>
        </div>
        <button className="rounded-full border border-exchange-text-third/50 text-exchange-text text-[13px] font-medium hover:bg-exchange-hover/40 transition-colors flex items-center gap-1" style={{ padding: '9px 16px' }}>
          {t('earn.earnNow')} <ChevronRight size={14} />
        </button>
      </div>

      {/* Category circles */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {CATEGORIES.map(({ key, icon: Icon, badge }) => (
          <button key={key} className="flex flex-col items-center gap-2.5 group">
            <div className="relative">
              <div
                className="rounded-full flex items-center justify-center bg-exchange-card border border-exchange-border group-hover:border-exchange-yellow/40 transition-colors"
                style={{ width: 52, height: 52 }}
              >
                <Icon size={22} className="text-exchange-text" />
              </div>
              {badge && (
                <span className="absolute -top-1 -right-1 bg-exchange-yellow text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {badge}
                </span>
              )}
            </div>
            <span className="text-[12px] text-exchange-text-secondary text-center leading-tight">
              {t(`earn.cat.${key}`)}
            </span>
          </button>
        ))}
      </div>

      {/* Featured 2x2 grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {/* Big left card */}
        <button
          onClick={() => navigate('/wallet')}
          className="row-span-2 bg-exchange-card border border-exchange-border rounded-2xl text-left flex flex-col justify-between hover:border-exchange-yellow/40 transition-colors"
          style={{ padding: 18, minHeight: 148 }}
        >
          <div className="flex items-start justify-between">
            <CoinIcon symbol="XRP" size={38} />
            <span className="text-[11px] text-exchange-text-third bg-exchange-hover/50 px-2 py-0.5 rounded-full">2/2</span>
          </div>
          <div>
            <div className="text-[15px] font-bold text-exchange-text">XRP</div>
            <div className="text-[12px] text-exchange-text-third mb-2">{t('earn.easyEarn')}</div>
            <div className="text-[22px] font-bold text-exchange-buy leading-none">2.00%</div>
          </div>
        </button>

        {/* Top-right card */}
        <button className="bg-exchange-card border border-exchange-border rounded-2xl text-left flex items-center gap-3 hover:border-exchange-yellow/40 transition-colors" style={{ padding: 16, minHeight: 68 }}>
          <CoinIcon symbol="USDT" size={32} />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-exchange-text">USD1</div>
            <div className="text-[11px] text-exchange-text-third">{t('earn.earnWlfi')}</div>
          </div>
          <div className="text-[16px] font-bold text-exchange-yellow tabular-nums">7.14%</div>
        </button>

        {/* Bottom-right card */}
        <button className="bg-exchange-card border border-exchange-border rounded-2xl text-left flex items-center gap-3 hover:border-exchange-yellow/40 transition-colors" style={{ padding: 16, minHeight: 68 }}>
          <div className="flex -space-x-2 shrink-0">
            <CoinIcon symbol="SOL" size={30} />
            <CoinIcon symbol="USDT" size={30} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-exchange-text truncate">{t('earn.dualAsset')}</div>
            <div className="text-[11px] text-exchange-text-third truncate">SOL-USDT</div>
          </div>
          <div className="text-[16px] font-bold text-exchange-buy tabular-nums">261.92%</div>
        </button>
      </div>

      {/* Events row */}
      <button className="w-full flex items-center gap-3 bg-exchange-card/60 border border-exchange-border rounded-xl mb-6 hover:bg-exchange-hover/30 transition-colors" style={{ padding: '12px 16px' }}>
        <Sparkles size={20} className="text-exchange-yellow shrink-0" />
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[11px] text-exchange-text-third">{t('earn.events')}</div>
          <div className="text-[13px] text-exchange-text truncate">{t('earn.eventCopy')}</div>
        </div>
        <span className="text-[11px] text-exchange-text-third bg-exchange-hover/50 px-2 py-0.5 rounded-full shrink-0">1/5</span>
      </button>

      {/* Explore Products heading */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[18px] font-bold text-exchange-text">{t('earn.exploreProducts')}</h2>
        <SlidersHorizontal size={18} className="text-exchange-text-secondary" />
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-4">
        {([
          { key: 'steady' as Filter, label: t('earn.steadyReturns') },
          { key: 'top' as Filter, label: t('earn.topGains') },
          { key: 'vip' as Filter, label: t('earn.vipExclusive') },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              filter === key
                ? 'bg-exchange-hover text-exchange-text'
                : key === 'vip'
                ? 'text-exchange-yellow'
                : 'text-exchange-text-third'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Product cards */}
      <div className="space-y-3">
        {filtered.map((p) => (
          <div key={p.coin} className="bg-exchange-card border border-exchange-border rounded-2xl" style={{ padding: 16 }}>
            <div className="flex items-center gap-2.5 mb-3">
              <CoinIcon symbol={p.coin} size={30} />
              <span className="text-[15px] font-bold text-exchange-text">{p.coin}</span>
              <ChevronDown size={16} className="text-exchange-text-third ml-auto" />
            </div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[11px] text-exchange-text-third mb-1">{t('earn.easyEarn')} · {t('earn.flexible')}</div>
                <div className="text-[15px] font-bold text-exchange-text">{t('earn.flexible')}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-exchange-text-third mb-1">APR</div>
                <div className="text-[18px] font-bold text-exchange-buy tabular-nums">{p.apr}</div>
              </div>
              <button
                onClick={() => navigate('/wallet')}
                className="rounded-full bg-exchange-yellow text-black text-[13px] font-bold flex items-center gap-1 hover:bg-exchange-yellow/90 transition-colors"
                style={{ padding: '10px 18px' }}
              >
                {t('earn.subscribe')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </DesktopPageLayout>
  );
}
