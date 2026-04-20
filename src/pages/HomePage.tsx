import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Shield, Zap, BarChart3, Globe, TrendingUp, TrendingDown, Users, Lock, Headphones } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import { formatPrice, formatPercent, formatVolume } from '../utils/format';
import CoinIcon from '../components/common/CoinIcon';
import QuantaLogo from '../components/common/QuantaLogo';
import LangSwitch from '../components/common/LangSwitch';

export default function HomePage() {
  const { markets, tickers, fetchMarkets } = useStore();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [animatedCount, setAnimatedCount] = useState(0);

  useEffect(() => {
    fetchMarkets();
    // Animated counter
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setAnimatedCount(Math.min(i * 847, 25000));
      if (i * 847 >= 25000) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, []);

  const topCoins = markets
    .filter((m) => m.quote_coin === 'USDT')
    .map((m) => {
      const sym = `${m.base_coin}-${m.quote_coin}`;
      const tick = tickers[sym];
      return { sym, base: m.base_coin, name: m.base_name, last: tick?.last || 0, change: tick?.change || 0, volume: tick?.volume || 0 };
    })
    .filter((c) => c.last > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 6);

  const features = [
    { icon: Zap, title: '초고속 주문 체결', desc: '밀리초 단위 매칭 엔진으로 빠르고 정확한 거래를 제공합니다.', color: 'text-exchange-yellow' },
    { icon: Shield, title: '안전한 자산 보호', desc: '다중 보안 시스템과 콜드 월렛으로 고객 자산을 안전하게 보관합니다.', color: 'text-exchange-buy' },
    { icon: BarChart3, title: '전문 트레이딩 도구', desc: '실시간 캔들차트, 호가창, 기술적 분석 도구를 제공합니다.', color: 'text-blue-400' },
    { icon: Globe, title: '글로벌 마켓', desc: 'BTC, ETH, QTA 등 다양한 디지털 자산을 거래할 수 있습니다.', color: 'text-purple-400' },
    { icon: Lock, title: '2단계 인증 (2FA)', desc: 'Google OTP를 통한 추가 보안으로 계정을 보호합니다.', color: 'text-exchange-sell' },
    { icon: Headphones, title: '24/7 고객 지원', desc: '전문 상담원이 24시간 고객님의 문의를 지원합니다.', color: 'text-cyan-400' },
  ];

  const stats = [
    { label: '누적 거래량', value: '$2.5B+' },
    { label: '등록 회원', value: `${animatedCount.toLocaleString()}+` },
    { label: '지원 코인', value: '13+' },
    { label: '마켓 수', value: '22' },
  ];

  return (
    <div className="min-h-screen bg-exchange-bg">
      {/* Header */}
      <header className="bg-exchange-card/50 backdrop-blur-md border-b border-exchange-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <QuantaLogo size={32} />
          <div className="flex items-center gap-3">
            <LangSwitch />
            <Link to="/login" className="text-sm text-exchange-text-secondary hover:text-exchange-text transition-colors">
              {t('nav.login')}
            </Link>
            <Link to="/register" className="btn-primary text-sm !py-2 !px-4 rounded-lg">
              {t('nav.register')}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-exchange-yellow/5 via-transparent to-exchange-buy/5" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-exchange-yellow/5 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-exchange-buy/5 rounded-full blur-3xl" />

        <div className="max-w-7xl mx-auto px-4 py-16 sm:py-24 relative z-10">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-exchange-yellow/10 border border-exchange-yellow/20 rounded-full px-4 py-1.5 mb-6">
              <div className="w-2 h-2 bg-exchange-buy rounded-full animate-pulse" />
              <span className="text-xs text-exchange-yellow font-medium">실시간 거래 가능</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-4 leading-tight">
              <span className="text-exchange-text">신뢰할 수 있는</span>
              <br />
              <span className="bg-gradient-to-r from-exchange-yellow to-yellow-300 bg-clip-text text-transparent">디지털 자산 거래소</span>
            </h1>

            <p className="text-exchange-text-secondary text-lg sm:text-xl mb-8 leading-relaxed">
              BTC, ETH, QTA 등 다양한 암호화폐를<br className="hidden sm:block" />
              안전하고 빠르게 거래하세요.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/register" className="btn-primary !py-3.5 !px-8 text-base font-semibold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-exchange-yellow/20">
                지금 시작하기 <ArrowRight size={18} />
              </Link>
              <Link to="/trade/BTC-USDT" className="bg-exchange-card border border-exchange-border text-exchange-text !py-3.5 !px-8 text-base font-semibold rounded-xl flex items-center justify-center gap-2 hover:bg-exchange-hover transition-colors">
                거래소 둘러보기
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Live Market Prices */}
      <section className="max-w-7xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">실시간 시세</h2>
          <Link to="/markets" className="text-sm text-exchange-yellow hover:underline flex items-center gap-1">
            전체보기 <ArrowRight size={14} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {topCoins.map((coin) => {
            const isUp = coin.change >= 0;
            return (
              <div
                key={coin.sym}
                onClick={() => navigate(`/trade/${coin.sym}`)}
                className="card p-4 cursor-pointer hover:border-exchange-yellow/30 transition-all hover:-translate-y-0.5 group"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <CoinIcon symbol={coin.base} size={36} />
                    <div>
                      <div className="font-semibold text-sm">{coin.base}<span className="text-exchange-text-third">/USDT</span></div>
                      <div className="text-xs text-exchange-text-third">{coin.name}</div>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-md font-medium ${
                    isUp ? 'bg-exchange-buy/10 text-exchange-buy' : 'bg-exchange-sell/10 text-exchange-sell'
                  }`}>
                    {isUp ? <TrendingUp size={10} className="inline mr-0.5" /> : <TrendingDown size={10} className="inline mr-0.5" />}
                    {formatPercent(coin.change)}
                  </span>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <div className={`text-xl font-bold tabular-nums ${isUp ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                      ${formatPrice(coin.last)}
                    </div>
                    <div className="text-xs text-exchange-text-third tabular-nums mt-0.5">
                      거래량 {formatVolume(coin.volume)}
                    </div>
                  </div>
                  {/* Mini sparkline */}
                  <svg width="60" height="24" viewBox="0 0 60 24" className="opacity-50 group-hover:opacity-100 transition-opacity">
                    <polyline
                      fill="none"
                      stroke={isUp ? '#0ECB81' : '#F6465D'}
                      strokeWidth="1.5"
                      points={Array.from({ length: 15 }, (_, i) => {
                        const x = (i / 14) * 60;
                        const y = 12 + Math.sin(i * 0.7 + coin.change) * 8 + (isUp ? -i * 0.4 : i * 0.4);
                        return `${x},${Math.max(2, Math.min(22, y))}`;
                      }).join(' ')}
                    />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Stats Banner */}
      <section className="bg-exchange-card border-y border-exchange-border">
        <div className="max-w-7xl mx-auto px-4 py-10">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-exchange-yellow tabular-nums">{stat.value}</div>
                <div className="text-sm text-exchange-text-secondary mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">왜 QuantaEX인가?</h2>
          <p className="text-exchange-text-secondary">전문적이고 안전한 거래 환경을 제공합니다.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className="card p-6 hover:border-exchange-yellow/20 transition-all group">
              <div className={`w-12 h-12 rounded-xl bg-exchange-hover flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                <f.icon size={24} className={f.color} />
              </div>
              <h3 className="font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-exchange-text-secondary leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <div className="card p-8 sm:p-12 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-exchange-yellow/5 to-exchange-buy/5" />
          <div className="relative z-10">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">지금 바로 시작하세요</h2>
            <p className="text-exchange-text-secondary mb-6 max-w-lg mx-auto">
              회원가입 시 10,000 USDT + 10,000,000 KRW 보너스를 지급합니다.
            </p>
            <Link to="/register" className="btn-primary !py-3.5 !px-10 text-base font-semibold rounded-xl inline-flex items-center gap-2 shadow-lg shadow-exchange-yellow/20">
              무료 회원가입 <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-exchange-card border-t border-exchange-border">
        <div className="max-w-7xl mx-auto px-4 py-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-8">
            <div>
              <QuantaLogo size={28} />
              <p className="text-xs text-exchange-text-third mt-3 leading-relaxed">{t('app.slogan')}</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-3">서비스</h4>
              <div className="flex flex-col gap-2 text-sm text-exchange-text-secondary">
                <Link to="/trade/BTC-USDT" className="hover:text-exchange-text transition-colors">{t('nav.trade')}</Link>
                <Link to="/markets" className="hover:text-exchange-text transition-colors">{t('nav.markets')}</Link>
                <Link to="/fee" className="hover:text-exchange-text transition-colors">{t('footer.fee')}</Link>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-3">지원</h4>
              <div className="flex flex-col gap-2 text-sm text-exchange-text-secondary">
                <Link to="/notice" className="hover:text-exchange-text transition-colors">{t('footer.notice')}</Link>
                <Link to="/support" className="hover:text-exchange-text transition-colors">{t('footer.support')}</Link>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-3">법적 고지</h4>
              <div className="flex flex-col gap-2 text-sm text-exchange-text-secondary">
                <Link to="/terms" className="hover:text-exchange-text transition-colors">{t('footer.terms')}</Link>
                <Link to="/privacy" className="hover:text-exchange-text transition-colors">{t('footer.privacy')}</Link>
              </div>
            </div>
          </div>
          <div className="border-t border-exchange-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-exchange-text-third">&copy; 2026 {t('footer.copyright')}</p>
            <div className="flex items-center gap-4">
              <LangSwitch />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
