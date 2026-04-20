import { Percent, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, Info, CheckCircle2, Star } from 'lucide-react';
import { useI18n } from '../i18n';

export default function FeePage() {
  const { t } = useI18n();

  const tradingFees = [
    { tier: 'Level 1', volume: '0 ~ 10 BTC', maker: '0.10%', taker: '0.10%', desc: '일반 회원' },
    { tier: 'Level 2', volume: '10 ~ 50 BTC', maker: '0.09%', taker: '0.09%', desc: '우수 회원' },
    { tier: 'Level 3', volume: '50 ~ 100 BTC', maker: '0.08%', taker: '0.08%', desc: '프리미엄' },
    { tier: 'Level 4', volume: '100 ~ 500 BTC', maker: '0.06%', taker: '0.07%', desc: 'VIP' },
    { tier: 'Level 5', volume: '500 BTC 이상', maker: '0.04%', taker: '0.05%', desc: 'VVIP' },
  ];

  const withdrawFees = [
    { coin: 'BTC', network: 'Bitcoin', fee: '0.0005 BTC', min: '0.001 BTC' },
    { coin: 'ETH', network: 'Ethereum (ERC-20)', fee: '0.005 ETH', min: '0.01 ETH' },
    { coin: 'USDT', network: 'Ethereum (ERC-20)', fee: '10 USDT', min: '20 USDT' },
    { coin: 'USDT', network: 'Tron (TRC-20)', fee: '1 USDT', min: '10 USDT' },
    { coin: 'BNB', network: 'BNB Smart Chain', fee: '0.005 BNB', min: '0.01 BNB' },
    { coin: 'SOL', network: 'Solana', fee: '0.01 SOL', min: '0.1 SOL' },
    { coin: 'XRP', network: 'XRP Ledger', fee: '0.25 XRP', min: '1 XRP' },
    { coin: 'ADA', network: 'Cardano', fee: '1 ADA', min: '5 ADA' },
    { coin: 'DOGE', network: 'Dogecoin', fee: '5 DOGE', min: '20 DOGE' },
    { coin: 'DOT', network: 'Polkadot', fee: '0.1 DOT', min: '1 DOT' },
    { coin: 'AVAX', network: 'Avalanche C-Chain', fee: '0.01 AVAX', min: '0.1 AVAX' },
    { coin: 'MATIC', network: 'Polygon', fee: '0.1 MATIC', min: '1 MATIC' },
    { coin: 'QTA', network: 'QuantaEX', fee: '100 QTA', min: '500 QTA' },
    { coin: 'KRW', network: '은행 이체', fee: '1,000 KRW', min: '5,000 KRW' },
  ];

  const feeNotes = [
    '거래 수수료는 30일 누적 거래량 기준으로 자동 적용됩니다.',
    'QTA 토큰으로 수수료 결제 시 추가 25% 할인이 적용됩니다.',
    '입금 수수료는 모든 코인에 대해 무료입니다.',
    '출금 수수료는 네트워크 수수료(Gas Fee) 변동에 따라 조정될 수 있습니다.',
    'KRW 입금은 무료이며, 출금 시 이체 수수료가 부과됩니다.',
    '마켓 메이커(지정가 주문)와 테이커(시장가 주문)의 수수료가 다를 수 있습니다.',
  ];

  return (
    <div className="max-w-5xl mx-auto p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2 mb-8">
        <Percent size={22} className="text-exchange-yellow" />
        <h1 className="text-2xl font-bold">{t('footer.fee')}</h1>
      </div>

      {/* QTA Discount Banner */}
      <div className="card p-5 mb-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-exchange-yellow/5 to-exchange-buy/5" />
        <div className="relative z-10 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-exchange-yellow/20 flex items-center justify-center shrink-0">
            <Star size={20} className="text-exchange-yellow" />
          </div>
          <div>
            <h3 className="font-semibold mb-1">QTA 토큰 수수료 할인</h3>
            <p className="text-sm text-exchange-text-secondary leading-relaxed">
              QTA 토큰을 보유하고 거래 수수료 결제 수단으로 설정하면 <span className="text-exchange-yellow font-semibold">25% 추가 할인</span>을 받을 수 있습니다.
              예: Level 1 기준 Maker 0.10% &rarr; <span className="text-exchange-buy font-semibold">0.075%</span>
            </p>
          </div>
        </div>
      </div>

      {/* Trading Fees */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <ArrowRightLeft size={18} className="text-exchange-text-secondary" />
          <h2 className="text-lg font-bold">거래 수수료</h2>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-exchange-hover/50 text-exchange-text-secondary text-xs">
                  <th className="text-left px-4 py-3 font-medium">등급</th>
                  <th className="text-left px-4 py-3 font-medium">30일 거래량</th>
                  <th className="text-right px-4 py-3 font-medium">Maker 수수료</th>
                  <th className="text-right px-4 py-3 font-medium">Taker 수수료</th>
                  <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">QTA 할인 적용</th>
                </tr>
              </thead>
              <tbody>
                {tradingFees.map((row) => {
                  const makerNum = parseFloat(row.maker);
                  const takerNum = parseFloat(row.taker);
                  return (
                    <tr key={row.tier} className="border-t border-exchange-border/50 hover:bg-exchange-hover/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-exchange-yellow font-medium">{row.tier}</span>
                          <span className="text-xs text-exchange-text-third">({row.desc})</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-exchange-text-secondary">{row.volume}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{row.maker}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{row.taker}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums hidden sm:table-cell text-exchange-buy">
                        {(makerNum * 0.75).toFixed(3)}% / {(takerNum * 0.75).toFixed(3)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Withdrawal Fees */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <ArrowUpFromLine size={18} className="text-exchange-text-secondary" />
          <h2 className="text-lg font-bold">출금 수수료</h2>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-exchange-hover/50 text-exchange-text-secondary text-xs">
                  <th className="text-left px-4 py-3 font-medium">코인</th>
                  <th className="text-left px-4 py-3 font-medium">네트워크</th>
                  <th className="text-right px-4 py-3 font-medium">출금 수수료</th>
                  <th className="text-right px-4 py-3 font-medium">최소 출금액</th>
                </tr>
              </thead>
              <tbody>
                {withdrawFees.map((row, i) => (
                  <tr key={`${row.coin}-${row.network}-${i}`} className="border-t border-exchange-border/50 hover:bg-exchange-hover/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{row.coin}</td>
                    <td className="px-4 py-3 text-exchange-text-secondary text-xs">{row.network}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.fee}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-exchange-text-secondary">{row.min}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Deposit Info */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <ArrowDownToLine size={18} className="text-exchange-text-secondary" />
          <h2 className="text-lg font-bold">입금 수수료</h2>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-exchange-buy">
            <CheckCircle2 size={18} />
            <span className="font-medium text-sm">모든 암호화폐 입금 수수료: 무료 (FREE)</span>
          </div>
          <p className="text-xs text-exchange-text-secondary mt-2 ml-7 leading-relaxed">
            입금 시에는 별도의 수수료가 부과되지 않습니다. 단, 전송 네트워크의 Gas Fee는 발신자 부담입니다.
          </p>
        </div>
      </section>

      {/* Notes */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Info size={18} className="text-exchange-text-secondary" />
          <h2 className="text-lg font-bold">유의사항</h2>
        </div>
        <div className="card p-5">
          <ul className="space-y-3">
            {feeNotes.map((note, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-exchange-text-secondary leading-relaxed">
                <span className="text-exchange-yellow mt-0.5 shrink-0">&bull;</span>
                {note}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
