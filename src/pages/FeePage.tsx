import { useState } from 'react';
import { Percent, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, Info, CheckCircle2, Star, Shield, Zap, ChevronRight, HelpCircle, ExternalLink } from 'lucide-react';
import { useI18n } from '../i18n';
import CoinIcon from '../components/common/CoinIcon';

type Tab = 'trading' | 'withdraw' | 'deposit';

export default function FeePage() {
  const { t, lang } = useI18n();
  const isKo = lang === 'ko';
  const [activeTab, setActiveTab] = useState<Tab>('trading');
  const [hoveredTier, setHoveredTier] = useState<string | null>(null);

  const tradingFees = [
    { tier: 'Level 1', volume: '0 ~ 10 BTC', maker: 0.10, taker: 0.10, desc: t('fee.general'), color: 'text-exchange-text-secondary' },
    { tier: 'Level 2', volume: '10 ~ 50 BTC', maker: 0.09, taker: 0.09, desc: t('fee.advanced'), color: 'text-blue-400' },
    { tier: 'Level 3', volume: '50 ~ 100 BTC', maker: 0.08, taker: 0.08, desc: t('fee.premium'), color: 'text-purple-400' },
    { tier: 'Level 4', volume: '100 ~ 500 BTC', maker: 0.06, taker: 0.07, desc: 'VIP', color: 'text-exchange-yellow' },
    { tier: 'Level 5', volume: `500 BTC ${t('fee.above')}`, maker: 0.04, taker: 0.05, desc: 'VVIP', color: 'text-orange-400' },
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
    { coin: 'KRW', name: t('fee.krw'), network: t('fee.bankTransferNetwork'), fee: '1,000 KRW', min: '5,000 KRW', confirmations: 0 },
  ];

  const tabs: { key: Tab; icon: React.ReactNode; label: string }[] = [
    { key: 'trading', icon: <ArrowRightLeft size={16} />, label: t('fee.tradingFee') },
    { key: 'withdraw', icon: <ArrowUpFromLine size={16} />, label: t('fee.withdrawFee') },
    { key: 'deposit', icon: <ArrowDownToLine size={16} />, label: t('fee.depositGuide') },
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
              <p className="text-sm text-exchange-text-secondary mt-0.5">{t('fee.subtitle')}</p>
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
                {t('fee.qtaDiscount')}
                <span className="text-xs font-medium bg-exchange-yellow/20 text-exchange-yellow px-2 py-0.5 rounded-full">-25%</span>
              </h3>
              <p className="text-sm text-exchange-text-secondary leading-relaxed mb-3">
                {t('fee.qtaDiscountDesc')}
              </p>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2 bg-exchange-bg/60 rounded-lg px-3 py-2 text-xs">
                  <span className="text-exchange-text-third">{t('fee.example')} Level 1 Maker</span>
                  <span className="text-exchange-text-secondary line-through">0.10%</span>
                  <ChevronRight size={12} className="text-exchange-text-third" />
                  <span className="text-exchange-buy font-bold text-sm">0.075%</span>
                </div>
                <div className="flex items-center gap-2 bg-exchange-bg/60 rounded-lg px-3 py-2 text-xs">
                  <span className="text-exchange-text-third">{t('fee.example')} Level 5 Maker</span>
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
                  <p className="text-xs text-exchange-text-third">{t('fee.lowestMaker')}</p>
                  <p className="text-lg font-bold text-exchange-buy tabular-nums">0.030%</p>
                  <p className="text-[10px] text-exchange-text-third">{t('fee.withQta')}</p>
                </div>
              </div>
              <div className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
                  <Shield size={18} className="text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-exchange-text-third">{t('fee.lowestTaker')}</p>
                  <p className="text-lg font-bold text-exchange-buy tabular-nums">0.038%</p>
                  <p className="text-[10px] text-exchange-text-third">{t('fee.withQta')}</p>
                </div>
              </div>
              <div className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-exchange-yellow/10 flex items-center justify-center shrink-0">
                  <Star size={18} className="text-exchange-yellow" />
                </div>
                <div>
                  <p className="text-xs text-exchange-text-third">{t('fee.tierCount')}</p>
                  <p className="text-lg font-bold tabular-nums">{t('fee.tiers')}</p>
                  <p className="text-[10px] text-exchange-text-third">{t('fee.basedOn30d')}</p>
                </div>
              </div>
            </div>

            {/* Trading Fee Table */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-exchange-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft size={16} className="text-exchange-yellow" />
                  <h2 className="font-bold">{t('fee.feeSchedule')}</h2>
                </div>
                <div className="flex items-center gap-1 text-xs text-exchange-text-third">
                  <HelpCircle size={12} />
                  <span>{t('fee.autoApplied')}</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-exchange-hover/30">
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">{t('fee.tier')}</th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">{t('fee.volume30d')}</th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">Maker</th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">Taker</th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-exchange-yellow uppercase tracking-wider">
                        <div className="flex items-center justify-center gap-1">
                          <Star size={10} className="fill-exchange-yellow" />
                          {t('fee.qtaMaker')}
                        </div>
                      </th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-exchange-yellow uppercase tracking-wider">
                        <div className="flex items-center justify-center gap-1">
                          <Star size={10} className="fill-exchange-yellow" />
                          {t('fee.qtaTaker')}
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

            {/* Maker vs Taker Description */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-blue-500/15 flex items-center justify-center">
                    <span className="text-xs font-bold text-blue-400">M</span>
                  </div>
                  <h4 className="font-semibold text-sm">{t('fee.makerDesc')}</h4>
                </div>
                <p className="text-xs text-exchange-text-secondary leading-relaxed">
                  {t('fee.makerExplain')}
                </p>
              </div>
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-orange-500/15 flex items-center justify-center">
                    <span className="text-xs font-bold text-orange-400">T</span>
                  </div>
                  <h4 className="font-semibold text-sm">{t('fee.takerDesc')}</h4>
                </div>
                <p className="text-xs text-exchange-text-secondary leading-relaxed">
                  {t('fee.takerExplain')}
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
                  <p className="text-xs text-exchange-text-third">{t('fee.supportedCoins')}</p>
                  <p className="text-lg font-bold tabular-nums">{t('fee.coins', { count: '14' })}</p>
                </div>
              </div>
              <div className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Zap size={18} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-exchange-text-third">{t('fee.lowestNetwork')}</p>
                  <p className="text-lg font-bold">TRC-20</p>
                  <p className="text-[10px] text-exchange-text-third">{t('fee.usdt1')}</p>
                </div>
              </div>
              <div className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-exchange-buy/10 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={18} className="text-exchange-buy" />
                </div>
                <div>
                  <p className="text-xs text-exchange-text-third">{t('fee.depositFee')}</p>
                  <p className="text-lg font-bold text-exchange-buy">{t('fee.free')}</p>
                  <p className="text-[10px] text-exchange-text-third">{t('fee.allCoins')}</p>
                </div>
              </div>
            </div>

            {/* Withdrawal Fee Table */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-exchange-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowUpFromLine size={16} className="text-exchange-yellow" />
                  <h2 className="font-bold">{t('fee.withdrawFeeByCoins')}</h2>
                </div>
                <span className="text-xs text-exchange-text-third">{t('fee.subjectToChange')}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-exchange-hover/30">
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">{t('wallet.coin')}</th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">{t('fee.network')}</th>
                      <th className="text-right px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">{t('fee.withdrawFee')}</th>
                      <th className="text-right px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider">{t('fee.minWithdraw')}</th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-exchange-text-secondary uppercase tracking-wider hidden sm:table-cell">{t('fee.confirmations')}</th>
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
                            <span className="text-xs tabular-nums text-exchange-text-third">{t('fee.blocks', { n: String(row.confirmations) })}</span>
                          ) : (
                            <span className="text-xs text-exchange-text-third">{t('fee.instant')}</span>
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
                  <h4 className="font-semibold text-sm mb-1">{t('fee.networkWarning')}</h4>
                  <p className="text-xs text-exchange-text-secondary leading-relaxed">
                    {t('fee.networkWarningDesc')}
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
                <h2 className="text-2xl font-bold mb-2">{t('fee.freeDeposit')}</h2>
                <p className="text-exchange-text-secondary max-w-md mx-auto leading-relaxed">
                  {t('fee.freeDepositDesc')}
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
                  <h4 className="font-semibold text-sm">{t('fee.cryptoDeposit')}</h4>
                </div>
                <ul className="space-y-2.5 text-xs text-exchange-text-secondary">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>{t('fee.cryptoDepositFee')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>{t('fee.gasFeeNote')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>{t('fee.checkAddress')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>{t('fee.minDepositNote')}</span>
                  </li>
                </ul>
              </div>
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-blue-400">₩</span>
                  </div>
                  <h4 className="font-semibold text-sm">{t('fee.fiatDeposit')}</h4>
                </div>
                <ul className="space-y-2.5 text-xs text-exchange-text-secondary">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>{t('fee.cryptoDepositFee')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>{t('fee.ownAccount')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>{t('fee.depositTime')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-exchange-buy shrink-0 mt-0.5" />
                    <span>{t('fee.dailyLimit')}</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Deposit Processing Time */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-exchange-border">
                <h3 className="font-bold text-sm">{t('fee.depositProcessTime')}</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-exchange-border/30">
                {[
                  { coin: 'BTC', time: `${t('fee.approx')} 30min`, blocks: t('fee.blocks', { n: '3' }) },
                  { coin: 'ETH', time: `${t('fee.approx')} 5min`, blocks: t('fee.blocks', { n: '12' }) },
                  { coin: 'USDT', time: `${t('fee.approx')} 1~5min`, blocks: t('fee.byNetwork') },
                  { coin: 'SOL', time: `${t('fee.approx')} 1min`, blocks: t('fee.blocks', { n: '1' }) },
                  { coin: 'XRP', time: `${t('fee.approx')} 1min`, blocks: t('fee.blocks', { n: '1' }) },
                  { coin: 'BNB', time: `${t('fee.approx')} 3min`, blocks: t('fee.blocks', { n: '15' }) },
                  { coin: 'ADA', time: `${t('fee.approx')} 5min`, blocks: t('fee.blocks', { n: '15' }) },
                  { coin: 'KRW', time: `${t('fee.approx')} 1~5min`, blocks: t('fee.bankTransfer') },
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
            <h3 className="font-bold text-sm">{t('fee.notes')}</h3>
          </div>
          <div className="p-5">
            <ul className="space-y-3">
              {[
                t('fee.note1'),
                t('fee.note2'),
                t('fee.note3'),
                t('fee.note4'),
                t('fee.note5'),
                t('fee.note6'),
                t('fee.note7'),
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
