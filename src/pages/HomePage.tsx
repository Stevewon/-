import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Shield, Zap, BarChart3, Globe, Lock, Headphones, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import { formatPrice, formatPercent, formatVolume } from '../utils/format';
import CoinIcon from '../components/common/CoinIcon';
import QuantaLogo from '../components/common/QuantaLogo';
import LangSwitch from '../components/common/LangSwitch';
import Footer from '../components/common/Footer';

export default function HomePage() {
  const { markets, tickers, fetchMarkets } = useStore();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [animatedUsers, setAnimatedUsers] = useState(0);
  const [animatedVol, setAnimatedVol] = useState(0);

  useEffect(() => {
    fetchMarkets();
    const dur = 1200;
    const steps = 30;
    const interval = dur / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedUsers(Math.floor(eased * 25000));
      setAnimatedVol(+(eased * 2.5).toFixed(1));
      if (step >= steps) clearInterval(timer);
    }, interval);
    return () => clearInterval(timer);
  }, []);

  const topCoins = useMemo(() =>
    markets
      .filter((m) => m.quote_coin === 'USDT')
      .map((m) => {
        const sym = `${m.base_coin}-${m.quote_coin}`;
        const tick = tickers[sym];
        return { sym, base: m.base_coin, name: m.base_name, last: tick?.last || 0, change: tick?.change || 0, volume: tick?.volume || 0 };
      })
      .filter((c) => c.last > 0)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 8),
    [markets, tickers]
  );

  const features = [
    { icon: Zap, title: t('home.features.speed'), desc: t('home.features.speedDesc'), color: 'text-exchange-yellow', bg: 'bg-exchange-yellow/10' },
    { icon: Shield, title: t('home.features.security'), desc: t('home.features.securityDesc'), color: 'text-exchange-buy', bg: 'bg-exchange-buy/10' },
    { icon: BarChart3, title: t('home.features.tools'), desc: t('home.features.toolsDesc'), color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { icon: Globe, title: t('home.features.global'), desc: t('home.features.globalDesc'), color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { icon: Lock, title: t('home.features.2fa'), desc: t('home.features.2faDesc'), color: 'text-orange-400', bg: 'bg-orange-400/10' },
    { icon: Headphones, title: t('home.features.support'), desc: t('home.features.supportDesc'), color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  ];

  return (
    <div className="min-h-screen bg-exchange-bg">
      {/* ========== HEADER ========== */}
      <header className="bg-exchange-card/80 backdrop-blur-xl border-b border-exchange-border sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between">
          <QuantaLogo size={30} />
          <div className="flex items-center gap-2 sm:gap-4">
            <LangSwitch />
            <Link to="/login" className="hidden sm:inline text-sm text-exchange-text-secondary hover:text-exchange-text transition-colors px-3 py-1.5">
              {t('nav.login')}
            </Link>
            <Link to="/register" className="btn-primary text-xs sm:text-sm !py-2 !px-4 sm:!px-6 rounded-lg font-semibold">
              {t('nav.register')}
            </Link>
          </div>
        </div>
      </header>

      {/* ========== HERO SECTION ========== */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-exchange-yellow/[0.04] via-transparent to-exchange-buy/[0.04]" />
        <div className="absolute top-1/3 left-[10%] w-[600px] h-[600px] bg-exchange-yellow/[0.05] rounded-full blur-[150px] hidden lg:block" />
        <div className="absolute bottom-0 right-[15%] w-[500px] h-[500px] bg-exchange-buy/[0.04] rounded-full blur-[120px] hidden lg:block" />

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="flex flex-col lg:flex-row items-center gap-10 lg:gap-20 py-14 sm:py-20 lg:py-28">
            {/* Left: Text */}
            <div className="flex-1 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 bg-exchange-yellow/10 border border-exchange-yellow/20 rounded-full px-4 py-1.5 mb-6 sm:mb-8">
                <div className="w-2 h-2 bg-exchange-buy rounded-full animate-pulse" />
                <span className="text-xs text-exchange-yellow font-medium tracking-wide">{t('home.hero.badge')}</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-[64px] font-extrabold leading-[1.1] mb-5 sm:mb-6">
                <span className="text-exchange-text">{t('home.hero.title1')}</span>
                <br />
                <span className="bg-gradient-to-r from-exchange-yellow via-yellow-400 to-amber-400 bg-clip-text text-transparent">
                  {t('home.hero.title2')}
                </span>
              </h1>

              <p className="text-base sm:text-lg lg:text-xl text-exchange-text-secondary leading-relaxed mb-8 sm:mb-10 whitespace-pre-line max-w-lg mx-auto lg:mx-0">
                {t('home.hero.desc')}
              </p>

              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center lg:justify-start">
                <Link to="/register"
                  className="btn-primary !py-3.5 sm:!py-4 !px-8 sm:!px-10 text-base font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-exchange-yellow/25 hover:shadow-exchange-yellow/40 transition-all">
                  {t('home.hero.cta')} <ArrowRight size={18} />
                </Link>
                <Link to="/trade/BTC-USDT"
                  className="bg-exchange-card border border-exchange-border text-exchange-text !py-3.5 sm:!py-4 !px-8 sm:!px-10 text-base font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-exchange-hover hover:border-exchange-yellow/20 transition-all">
                  {t('home.hero.explore')}
                </Link>
              </div>
            </div>

            {/* Right: Hero cards (PC) */}
            <div className="hidden lg:block flex-1 max-w-[520px] w-full">
              <div className="grid grid-cols-2 gap-4">
                {topCoins.slice(0, 4).map((coin) => {
                  const isUp = coin.change >= 0;
                  return (
                    <div key={coin.sym} onClick={() => navigate(`/trade/${coin.sym}`)}
                      className="bg-exchange-card/70 backdrop-blur-sm border border-exchange-border rounded-2xl p-5 cursor-pointer hover:border-exchange-yellow/30 hover:-translate-y-1 transition-all duration-200 group">
                      <div className="flex items-center gap-2.5 mb-4">
                        <CoinIcon symbol={coin.base} size={32} />
                        <div className="min-w-0">
                          <div className="text-base font-bold truncate">{coin.base}<span className="text-exchange-text-third font-normal">/USDT</span></div>
                          <div className="text-xs text-exchange-text-third truncate">{coin.name}</div>
                        </div>
                      </div>
                      <div className={`text-xl font-bold tabular-nums mb-2 ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                        ${formatPrice(coin.last)}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-semibold tabular-nums ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                          {isUp ? '+' : ''}{formatPercent(coin.change)}
                        </span>
                        <svg width="56" height="20" viewBox="0 0 56 20" className="opacity-40 group-hover:opacity-70 transition-opacity">
                          <polyline fill="none" stroke={isUp ? '#0ECB81' : '#F6465D'} strokeWidth="1.5" strokeLinecap="round"
                            points={Array.from({ length: 14 }, (_, i) => {
                              const x = (i / 13) * 56;
                              const y = 10 + Math.sin(i * 0.8 + coin.change) * 7 + (isUp ? -i * 0.3 : i * 0.3);
                              return `${x},${Math.max(2, Math.min(18, y))}`;
                            }).join(' ')} />
                        </svg>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========== STATS BANNER ========== */}
      <section className="border-y border-exchange-border bg-exchange-card/40">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-exchange-border">
            {[
              { value: `$${animatedVol}B+`, label: t('home.stats.volume') },
              { value: `${animatedUsers.toLocaleString()}+`, label: t('home.stats.users') },
              { value: '13+', label: t('home.stats.coins') },
              { value: '22', label: t('home.stats.markets') },
            ].map((stat) => (
              <div key={stat.label} className="py-7 sm:py-10 lg:py-12 px-4 sm:px-8 text-center">
                <div className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-exchange-yellow tabular-nums leading-none mb-2">
                  {stat.value}
                </div>
                <div className="text-xs sm:text-sm text-exchange-text-third font-medium">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== LIVE MARKET PRICES ========== */}
      <section className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-18 lg:py-20">
        <div className="flex items-end justify-between mb-6 sm:mb-10">
          <div>
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold">{t('home.livePrice')}</h2>
            <p className="text-sm text-exchange-text-third mt-1 hidden sm:block">{t('app.description')}</p>
          </div>
          <Link to="/markets" className="text-sm text-exchange-yellow hover:text-yellow-400 flex items-center gap-1 font-semibold transition-colors">
            {t('home.viewAll')} <ChevronRight size={16} />
          </Link>
        </div>

        {/* --- PC Table --- */}
        <div className="hidden md:block">
          <div className="bg-exchange-card border border-exchange-border rounded-2xl overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-12 px-6 lg:px-8 py-4 text-xs lg:text-sm text-exchange-text-third font-semibold border-b border-exchange-border bg-exchange-hover/20 uppercase tracking-wide">
              <div className="col-span-3">{t('home.table.coin')}</div>
              <div className="col-span-2 text-right">{t('home.table.price')}</div>
              <div className="col-span-2 text-right">{t('home.table.change')}</div>
              <div className="col-span-2 text-right">{t('home.table.volume')}</div>
              <div className="col-span-2 text-center">{t('home.table.chart')}</div>
              <div className="col-span-1 text-center">{t('home.table.trade')}</div>
            </div>
            {/* Table Rows */}
            {topCoins.map((coin, idx) => {
              const isUp = coin.change >= 0;
              return (
                <div key={coin.sym}
                  className={`grid grid-cols-12 px-6 lg:px-8 py-4 lg:py-5 items-center cursor-pointer hover:bg-exchange-hover/40 transition-colors ${
                    idx < topCoins.length - 1 ? 'border-b border-exchange-border/40' : ''
                  }`}
                  onClick={() => navigate(`/trade/${coin.sym}`)}>
                  <div className="col-span-3 flex items-center gap-3 lg:gap-4">
                    <CoinIcon symbol={coin.base} size={36} />
                    <div>
                      <div className="text-base font-bold">{coin.base}<span className="text-exchange-text-third font-normal ml-0.5">/USDT</span></div>
                      <div className="text-xs text-exchange-text-third mt-0.5">{coin.name}</div>
                    </div>
                  </div>
                  <div className={`col-span-2 text-right text-base lg:text-lg font-bold tabular-nums ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                    ${formatPrice(coin.last)}
                  </div>
                  <div className="col-span-2 text-right">
                    <span className={`inline-flex items-center gap-1 text-sm font-bold tabular-nums px-3 py-1.5 rounded-lg ${
                      isUp ? 'bg-exchange-buy/10 text-exchange-buy' : 'bg-exchange-sell/10 text-exchange-sell'
                    }`}>
                      {isUp ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                      {isUp ? '+' : ''}{formatPercent(coin.change)}
                    </span>
                  </div>
                  <div className="col-span-2 text-right text-sm text-exchange-text-secondary tabular-nums font-medium">
                    {formatVolume(coin.volume)}
                  </div>
                  <div className="col-span-2 flex justify-center">
                    <svg width="80" height="28" viewBox="0 0 80 28" className="opacity-50">
                      <polyline fill="none" stroke={isUp ? '#0ECB81' : '#F6465D'} strokeWidth="1.8" strokeLinecap="round"
                        points={Array.from({ length: 20 }, (_, i) => {
                          const x = (i / 19) * 80;
                          const y = 14 + Math.sin(i * 0.5 + coin.change + idx) * 9 + (isUp ? -i * 0.3 : i * 0.3);
                          return `${x},${Math.max(3, Math.min(25, y))}`;
                        }).join(' ')} />
                    </svg>
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <span className="text-xs font-bold text-exchange-bg bg-exchange-yellow hover:bg-yellow-400 px-4 py-2 rounded-lg transition-colors">
                      {t('home.table.trade')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* --- Mobile Cards --- */}
        <div className="md:hidden space-y-2.5">
          {topCoins.slice(0, 6).map((coin) => {
            const isUp = coin.change >= 0;
            return (
              <div key={coin.sym} onClick={() => navigate(`/trade/${coin.sym}`)}
                className="bg-exchange-card border border-exchange-border rounded-xl p-3.5 flex items-center gap-3 active:bg-exchange-hover transition-colors">
                <CoinIcon symbol={coin.base} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{coin.base}</span>
                    <span className="text-[10px] text-exchange-text-third">{coin.name}</span>
                  </div>
                  <div className="text-[11px] text-exchange-text-third tabular-nums mt-0.5">Vol {formatVolume(coin.volume)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-sm font-bold tabular-nums ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>${formatPrice(coin.last)}</div>
                  <div className={`text-[11px] font-medium tabular-nums mt-0.5 ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                    {isUp ? '+' : ''}{formatPercent(coin.change)}
                  </div>
                </div>
                <ChevronRight size={14} className="text-exchange-text-third shrink-0" />
              </div>
            );
          })}
        </div>
      </section>

      {/* ========== FEATURES ========== */}
      <section className="bg-[#0d1117] border-y border-exchange-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-18 lg:py-24">
          <div className="text-center mb-10 sm:mb-14 lg:mb-16">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4">{t('home.whyTitle')}</h2>
            <p className="text-sm sm:text-base text-exchange-text-secondary max-w-xl mx-auto">{t('home.whyDesc')}</p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-8">
            {features.map((f) => (
              <div key={f.title}
                className="bg-exchange-card border border-exchange-border rounded-2xl p-5 sm:p-6 lg:p-8 hover:border-exchange-yellow/25 hover:bg-exchange-card/80 transition-all duration-200 group min-h-[140px] sm:min-h-[180px] lg:min-h-[220px] flex flex-col">
                <div className={`w-11 h-11 sm:w-12 sm:h-12 lg:w-14 lg:h-14 rounded-xl lg:rounded-2xl ${f.bg} flex items-center justify-center mb-4 sm:mb-5 lg:mb-6 group-hover:scale-110 transition-transform duration-200`}>
                  <f.icon className={`${f.color} w-5 h-5 sm:w-6 sm:h-6 lg:w-7 lg:h-7`} />
                </div>
                <h3 className="text-sm sm:text-base lg:text-lg font-bold mb-1.5 sm:mb-2 lg:mb-3">{f.title}</h3>
                <p className="text-[11px] sm:text-xs lg:text-sm text-exchange-text-secondary leading-relaxed flex-1">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== CTA SECTION ========== */}
      <section className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-18 lg:py-24">
        <div className="relative overflow-hidden rounded-2xl lg:rounded-3xl border border-exchange-border bg-exchange-card/50">
          <div className="absolute inset-0 bg-gradient-to-br from-exchange-yellow/[0.08] via-transparent to-exchange-buy/[0.06]" />
          <div className="absolute -top-32 -right-32 w-80 h-80 bg-exchange-yellow/10 rounded-full blur-[100px]" />
          <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-exchange-buy/10 rounded-full blur-[100px]" />

          <div className="relative z-10 px-6 sm:px-12 lg:px-20 py-12 sm:py-16 lg:py-20 text-center">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4">{t('home.ctaTitle')}</h2>
            <p className="text-sm sm:text-base text-exchange-text-secondary mb-8 sm:mb-10 max-w-xl mx-auto leading-relaxed">
              {t('home.ctaDesc')}
            </p>

            {/* Bonus badges */}
            <div className="flex flex-wrap justify-center gap-2.5 sm:gap-3 lg:gap-4 mb-8 sm:mb-10">
              {[
                { label: '10,000 USDT', color: 'text-exchange-buy', border: 'border-exchange-buy/20' },
                { label: '10,000,000 KRW', color: 'text-blue-400', border: 'border-blue-400/20' },
                { label: '0.1 BTC', color: 'text-orange-400', border: 'border-orange-400/20' },
                { label: '2 ETH', color: 'text-purple-400', border: 'border-purple-400/20' },
                { label: '1,000 QTA', color: 'text-exchange-yellow', border: 'border-exchange-yellow/20' },
              ].map((b) => (
                <span key={b.label}
                  className={`text-xs sm:text-sm font-bold px-3.5 sm:px-5 py-1.5 sm:py-2 rounded-full bg-exchange-hover/80 border ${b.border} ${b.color}`}>
                  {b.label}
                </span>
              ))}
            </div>

            <Link to="/register"
              className="btn-primary !py-3.5 sm:!py-4 !px-10 sm:!px-14 text-base sm:text-lg font-bold rounded-xl inline-flex items-center gap-2.5 shadow-lg shadow-exchange-yellow/25 hover:shadow-exchange-yellow/40 transition-all">
              {t('home.ctaBtn')} <ArrowRight size={20} />
            </Link>
          </div>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <Footer />
    </div>
  );
}
