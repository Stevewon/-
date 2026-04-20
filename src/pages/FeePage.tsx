import { useState } from 'react';
import { Percent, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, Info, CheckCircle2, Star, Shield, Zap, ChevronRight, HelpCircle, ExternalLink } from 'lucide-react';
import { useI18n } from '../i18n';
import CoinIcon from '../components/common/CoinIcon';

type Tab = 'trading' | 'withdraw' | 'deposit';

export default function FeePage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<Tab>('trading');
  const [hoveredTier, setHoveredTier] = useState<string | null>(null);

  const tradingFees = [
    { tier: 'Level 1', volume: '0 ~ 10 BTC', maker: 0.10, taker: 0.10, desc: '일반 회원', color: 'text-exchange-text-secondary' },
    { tier: 'Level 2', volume: '10 ~ 50 BTC', maker: 0.09, taker: 0.09, desc: '우수 회원', color: 'text-blue-400' },
    { tier: 'Level 3', volume: '50 ~ 100 BTC', maker: 0.08, taker: 0.08, desc: '프리미엄', color: 'text-purple-400' },
    { tier: 'Level 4', volume: '100 ~ 500 BTC', maker: 0.06, taker: 0.07, desc: 'VIP', color: 'text-exchange-yellow' },
    { tier: 'Level 5', volume: '500 BTC 이상', maker: 0.04, taker: 0.05, desc: 'VVIP', color: 'text-orange-400' },
  ];

  const withdrawFees = [
    { coin: 'BTC', name: 'Bitcoin', network: 'Bitcoin', fee: '0.0005 BTC', min: '0.001 BTC', confirmations: 3 },
    { coin: 'ETH', name: 'Ethereum', network: 'ERC-20', fee: '0.005 ETH', min: '0.01 ETH', confirmations: 12 },
    { coin: 'USDT', name: 'Tether', network: 'ERC-20', fee: '10 USDT', min: '20 USDT', confirmations: 12 },
    { coin: 'USDT', name: 'Tether', network: 'TRC-20', fee: '1 USDT', min: '10 USDT', confirmations: 20 },
    { coin: 'BNB', name: 'BNB', network: 'BEP-20', fee: '0.005 BNB', min: '0.01 BNB', confirmations: 15 },
    { coin: 'SOL', name: 'Solana', network: 'Solana', fee: '0.01 SOL', min: '0.1 SOL', confirmations: 1 },
    { coin: 'XRP', name: 'Ripple', network: 'XRP Ledger', fee: '0.25 XRP', min: '1 XRP', confirmations: 1 },
    { coin: 'ADA', name: 'Cardano', network: 'Cardano', fee: '1 ADA', min: '5 ADA', confirmations: 15 },
    { coin: 'DOGE', name: 'Dogecoin', network: 'Dogecoin', fee: '5 DOGE', min: '20 DOGE', confirmations: 40 },
    { coin: 'DOT', name: 'Polkadot', network: 'Polkadot', fee: '0.1 DOT', min: '1 DOT', confirmations: 25 },
    { coin: 'AVAX', name: 'Avalanche', network: 'C-Chain', fee: '0.01 AVAX', min: '0.1 AVAX', confirmations: 12 },
    { coin: 'MATIC', name: 'Polygon', network: 'Polygon', fee: '0.1 MATIC', min: '1 MATIC', confirmations: 128 },
    { coin: 'QTA', name: 'QuantaEX', network: 'QuantaEX', fee: '100 QTA', min: '500 QTA', confirmations: 1 },
    { coin: 'KRW', name: '원화', network: '은행이체', fee: '1,000 KRW', min: '5,000 KRW', confirmations: 0 },
  ];

  const tabs: { key: Tab; icon: React.ReactNode; label: string }[] = [
    { key: 'trading', icon: <ArrowRightLeft size={16} />, label: '거래 수수료' },
    { key: 'withdraw', icon: <ArrowUpFromLine size={16} />, label: '출금 수수료' },
    { key: 'deposit', icon: <ArrowDownToLine size={16} />, label: '입금 안내' },
  ];

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="border-b border-exchange-border bg-exchange-card/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-exchange-yellow/10 flex items-center justify-center">
              <Percent size={20} className="text-exchange-yellow" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('footer.fee')}</h1>
              <p className="text-sm text-exchange-text-secondary mt-0.5">QuantaEX 거래소 수수료 정책 안내</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24">
        {/* QTA Discount Banner */}
        <div className="rounded-2xl border border-exchange-yellow/20 bg-gradient-to-r from-exchange-yellow/5 via-exchange-card to-exchange-buy/5 p-5 sm:p-6 mb-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-exchange-yellow/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
          <div className="relative z-10 flex flex-col sm:flex-row items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-exchange-yellow/15 flex items-center justify-center shrink-0 border border-exchange-yellow/20">
              <Star size={24} className="text-exchange-yellow" />
            </div>
            <div className="flex-1">
              <h3 className="text-base sm:text-lg font-bold mb-2 flex items-center gap-2">
                QTA 토큰 수수료 할인
                <span className="text-xs font-medium bg-exchange-yellow/20 text-exchange-yellow px-2 py-0.5 rounded-full">-25%</span>
              </h3>
              <p className="text-sm text-exchange-text-secondary leading-relaxed mb-3">
                QTA 토큰을 보유하고 거래 수수료 결제 수단으로 설정하면 모든 등급에서{' '}
                <span className="text-exchange-yellow font-semibold">25% 추가 할인</span>이 적용됩니다.
              </p>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2 bg-exchange-bg/60 rounded-lg px-3 py-2 text-xs">
                  <span className="text-exchange-text-third">예시) Level 1 Maker</span>
                  <span className="text-exchange-text-secondary line-through">0.10%</span>
                  <ChevronRight size={12} className="text-exchange-text-third" />
                  <span className="text-exchange-buy font-bold text-sm">0.075%</span>
                </div>
                <div className="flex items-center gap-2 bg-exchange-bg/60 rounded-lg px-3 py-2 text-xs">
                  <span className="text-exchange-text-third">예시) Level 5 Maker</span>
                  <span className="text-exchange-text-secondary line-through">0.04%</span>
                  <ChevronRight size={12} className="text-exchange-text-third" />
                  <span className="text-exchange-buy font-bold text-sm">0.030%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-exchange-card rounded-xl border border-exchange-border mb-6">
          {tabs.map(({ key, icon, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === key
                  ? 'bg-exchange-yellow text-black shadow-lg shadow-exchange-yellow/20'
                  : 'text-exchange-text-secondary hover:text-exchange-text hover:bg-exchange-hover/50'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Trading Fees Tab */}
        {activeTab === 'trading' && (
          <div className="space-y-6 animate-in fade-in">
            {/* Trading Fee Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Zap size={18} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-exchange-text-third">최저 Maker 수수료</p>
                  <p className="text-lg font-bold text-exchange-buy tabular-nums">0.030%</p>
                  <p className="text-[10px] text-exchange-text-third">QTA 할인 적용 시</p>
                </div>
              </div>
              <div className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
                  <Shield size={18} className="text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-exchange-text-third">최저 Taker 수수료</p>
                  <p className="text-lg font-bold text-exchange-buy tabular-nums">0.038%</p>
                  <p className="text-[10px] text-exchange-text-third">QTA 할인 적용 시</p>
                </div>
              </div>
              <div className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-exchange-yellow/10 flex items-center justify-center shrink-0">
                  <Star size={18} className="text-exchange-yellow" />
                </div>
                <div>
                  <p className="text-xs text-exchange-text-third">등급 수</p>
                  <p className="text-lg font-bold tabular-nums">5 등급</p>
                  <p className="text-[10px] text-exchange-text-third">30일 누적 거래량 기준</p>
                </div>
              </div>
            </div>

            {/* Trading Fee Table */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-exchange-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft size={16} className="text-exchange-yellow" />
                  <h2 className="font-bold">거래 수수료 등급표</h2>
                </div>
                <div className="flex items-center gap-1 text-xs text-exchange-text-third">
                  <HelpCircle size={12} />
                  <span>30일 누적 거래량 기준 자동 적용</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-exchange-hover/30">
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">등급</th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">30일 거래량</th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">Maker</th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">Taker</th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-exchange-yellow uppercase tracking-wider">
                        <div className="flex items-center justify-center gap-1">
                          <Star size={10} className="fill-exchange-yellow" />
                          QTA 할인 (Maker)
                        </div>
                      </th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-exchange-yellow uppercase tracking-wider">
                        <div className="flex items-center justify-center gap-1">
                          <Star size={10} className="fill-exchange-yellow" />
                          QTA 할인 (Taker)
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-exchange-border/40">
                    {tradingFees.map((row) => (
                      <tr
                        key={row.tier}
                        className={`transition-colors duration-150 ${
                          hoveredTier === row.tier ? 'bg-exchange-hover/40' : 'hover:bg-exchange-hover/20'
                        }`}
                        onMouseEnter={() => setHoveredTier(row.tier)}
                        onMouseLeave={() => setHoveredTier(null)}
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-2 h-2 rounded-full ${
                              row.tier === 'Level 1' ? 'bg-gray-400' :
                              row.tier === 'Level 2' ? 'bg-blue-400' :
                              row.tier === 'Level 3' ? 'bg-purple-400' :
                              row.tier === 'Level 4' ? 'bg-exchange-yellow' :
                              'bg-orange-400'
                            }`} />
                            <div>
                              <span className={`font-semibold text-sm ${row.color}`}>{row.tier}</span>
                              <span className="text-xs text-exchange-text-third ml-1.5">({row.desc})</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-sm text-exchange-text-secondary font-mono tabular-nums">{row.volume}</span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-sm font-semibold tabular-nums">{row.maker.toFixed(2)}%</span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-sm font-semibold tabular-nums">{row.taker.toFixed(2)}%</span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-sm font-bold text-exchange-buy tabular-nums">{(row.maker * 0.75).toFixed(3)}%</span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-sm font-bold text-exchange-buy tabular-nums">{(row.taker * 0.75).toFixed(3)}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Maker vs Taker 설명 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-blue-500/15 flex items-center justify-center">
                    <span className="text-xs font-bold text-blue-400">M</span>
                  </div>
                  <h4 className="font-semibold text-sm">Maker (메이커)</h4>
                </div>
                <p className="text-xs text-exchange-text-secondary leading-relaxed">
                  지정가 주문으로 호가창에 유동성을 제공하는 주문입니다. 즉시 체결되지 않고 호가창에 대기하는 주문으로, 
                  시장에 유동성을 공급하기 때문에 Taker보다 낮은 수수료가 적용됩니다.
                </p>
              </div>
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-orange-500/15 flex items-center justify-center">
                    <span className="text-xs font-bold text-orange-400">T</span>
                  </div>
                  <h4 className="font-semibold text-sm">Taker (테이커)</h4>
                </div>
                <p className="text-xs text-exchange-text-secondary leading-relaxed">
                  시장가 주문 또는 즉시 체결되는 지정가 주문입니다. 호가창의 기존 주문을 소비하여 유동성을 가져가기 때문에 
                  Maker보다 약간 높은 수수료가 적용될 수 있습니다.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Withdrawal Fees Tab */}
        {activeTab === 'withdraw' && (
          <div className="space-y-6 animate-in fade-in">
            {/* Withdrawal Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-exchange-sell/10 flex items-center justify-center shrink-0">
                  <ArrowUpFromLine size={18} className="text-exchange-sell" />
                </div>
                <div>
                  <p className="text-xs text-exchange-text-third">지원 코인</p>
                  <p className="text-lg font-bold tabular-nums">14종</p>
                </div>
              </div>
              <div className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Zap size={18} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-exchange-text-third">최저 수수료 네트워크</p>
                  <p className="text-lg font-bold">TRC-20</p>
                  <p className="text-[10px] text-exchange-text-third">USDT 1개</p>
                </div>
              </div>
              <div className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-exchange-buy/10 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={18} className="text-exchange-buy" />
                </div>
                <div>
                  <p className="text-xs text-exchange-text-third">입금 수수료</p>
                  <p className="text-lg font-bold text-exchange-buy">무료</p>
                  <p className="text-[10px] text-exchange-text-third">모든 코인</p>
                </div>
              </div>
            </div>

            {/* Withdrawal Fee Table */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-exchange-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowUpFromLine size={16} className="text-exchange-yellow" />
                  <h2 className="font-bold">코인별 출금 수수료</h2>
                </div>
                <span className="text-xs text-exchange-text-third">네트워크 상황에 따라 변동 가능</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-exchange-hover/30">
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">코인</th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">네트워크</th>
                      <th className="text-right px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">출금 수수료</th>
                      <th className="text-right px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">최소 출금액</th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider hidden sm:table-cell">확인 수</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-exchange-border/40">
                    {withdrawFees.map((row, i) => (
                      <tr key={`${row.coin}-${row.network}-${i}`} className="hover:bg-exchange-hover/20 transition-colors duration-150">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <CoinIcon symbol={row.coin} size={28} />
                            <div>
                              <span className="font-semibold text-sm">{row.coin}</span>
                              <span className="text-xs text-exchange-text-third ml-1.5 hidden sm:inline">{row.name}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center gap-1 text-xs font-medium bg-exchange-hover/50 text-exchange-text-secondary px-2 py-1 rounded-md">
                            {row.network}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-sm font-semibold tabular-nums text-exchange-yellow">{row.fee}</span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-sm tabular-nums text-exchange-text-secondary">{row.min}</span>
                        </td>
                        <td className="px-5 py-3.5 text-center hidden sm:table-cell">
                          {row.confirmations > 0 ? (
                            <span className="text-xs tabular-nums text-exchange-text-third">{row.confirmations} 블록</span>
                          ) : (
                            <span className="text-xs text-exchange-text-third">즉시</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Network Warning */}
            <div className="card p-5 border-l-4 border-l-exchange-yellow">
              <div className="flex items-start gap-3">
                <Info size={18} className="text-exchange-yellow shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm mb-1">네트워크 선택 시 주의사항</h4>
                  <p className="text-xs text-exchange-text-secondary leading-relaxed">
                    출금 시 반드시 수신 주소의 네트워크와 동일한 네트워크를 선택하세요. 
                    잘못된 네트워크로 전송 시 자산을 복구할 수 없습니다. 
                    USDT의 경우 ERC-20과 TRC-20의 수수료 차이가 크므로 TRC-20 네트워크 사용을 권장합니다.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Deposit Tab */}
        {activeTab === 'deposit' && (
          <div className="space-y-6 animate-in fade-in">
            {/* Free Deposit Banner */}
            <div className="card p-8 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-exchange-buy/5 to-transparent" />
              <div className="relative z-10">
                <div className="w-16 h-16 rounded-2xl bg-exchange-buy/15 flex items-center justify-center mx-auto mb-4 border border-exchange-buy/20">
                  <CheckCircle2 size={32} className="text-exchange-buy" />
                </div>
                <h2 className="text-2xl font-bold mb-2">입금 수수료 무료</h2>
                <p className="text-exchange-text-secondary max-w-md mx-auto leading-relaxed">
                  QuantaEX에서는 모든 암호화폐 및 원화(KRW) 입금에 대해 수수료를 부과하지 않습니다.
                </p>
              </div>
            </div>

            {/* Deposit Info Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-exchange-buy/10 flex items-center justify-center">
                    <ArrowDownToLine size={16} className="text-exchange-buy" />
                  </div>
                  <h4 className="font-semibold text-sm">암호화폐 입금</h4>
                </div>
                <ul className="space-y-2.5 text-xs text-exchange-text-secondary">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>입금 수수료: <strong className="text-exchange-buy">무료</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>네트워크 Gas Fee는 발신자(보내는 분) 부담</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>입금 주소는 코인/네트워크별로 상이하니 반드시 확인</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>최소 입금액 미만 전송 시 입금이 처리되지 않을 수 있음</span>
                  </li>
                </ul>
              </div>
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-blue-400">₩</span>
                  </div>
                  <h4 className="font-semibold text-sm">원화(KRW) 입금</h4>
                </div>
                <ul className="space-y-2.5 text-xs text-exchange-text-secondary">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>입금 수수료: <strong className="text-exchange-buy">무료</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>본인 명의 계좌에서만 입금 가능</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>입금 후 통상 1~5분 이내 잔고 반영</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>1일 입금 한도: KYC 인증 등급에 따라 상이</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Deposit Processing Time */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-exchange-border">
                <h3 className="font-bold text-sm">코인별 예상 입금 처리 시간</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-exchange-border/30">
                {[
                  { coin: 'BTC', time: '약 30분', blocks: '3 확인' },
                  { coin: 'ETH', time: '약 5분', blocks: '12 확인' },
                  { coin: 'USDT', time: '약 1~5분', blocks: '네트워크별' },
                  { coin: 'SOL', time: '약 1분', blocks: '1 확인' },
                  { coin: 'XRP', time: '약 1분', blocks: '1 확인' },
                  { coin: 'BNB', time: '약 3분', blocks: '15 확인' },
                  { coin: 'ADA', time: '약 5분', blocks: '15 확인' },
                  { coin: 'KRW', time: '약 1~5분', blocks: '은행이체' },
                ].map((item) => (
                  <div key={item.coin} className="bg-exchange-card p-4 flex items-center gap-3">
                    <CoinIcon symbol={item.coin} size={32} />
                    <div>
                      <p className="font-semibold text-sm">{item.coin}</p>
                      <p className="text-xs text-exchange-text-secondary">{item.time}</p>
                      <p className="text-[10px] text-exchange-text-third">{item.blocks}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Notes - Always visible */}
        <div className="mt-8 card overflow-hidden">
          <div className="px-5 py-4 border-b border-exchange-border flex items-center gap-2">
            <Info size={16} className="text-exchange-text-third" />
            <h3 className="font-bold text-sm">유의사항</h3>
          </div>
          <div className="p-5">
            <ul className="space-y-3">
              {[
                '거래 수수료는 30일 누적 거래량 기준으로 자동 적용되며, 매일 00:00(KST)에 갱신됩니다.',
                'QTA 토큰으로 수수료 결제 시 모든 등급에서 추가 25% 할인이 적용됩니다.',
                '입금 수수료는 모든 코인 및 원화에 대해 무료입니다.',
                '출금 수수료는 블록체인 네트워크 수수료(Gas Fee) 변동에 따라 사전 공지 후 조정될 수 있습니다.',
                'KRW 입금은 무료이며, 출금 시 은행 이체 수수료 1,000원이 부과됩니다.',
                '마켓 메이커(지정가 주문)와 테이커(시장가 주문)의 수수료가 다를 수 있습니다.',
                '수수료 정책은 사전 공지 후 변경될 수 있으며, 변경 시 공지사항을 통해 안내됩니다.',
              ].map((note, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-exchange-text-secondary leading-relaxed">
                  <span className="w-5 h-5 rounded-full bg-exchange-hover/60 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-exchange-text-third">{i + 1}</span>
                  </span>
                  {note}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
