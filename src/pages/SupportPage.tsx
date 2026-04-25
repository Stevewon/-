import { useState } from 'react';
import { Headphones, ChevronDown, ChevronUp, MessageSquare, Mail, Clock, Shield, Wallet, ArrowRightLeft, UserCog, AlertTriangle, Phone, ExternalLink } from 'lucide-react';
import { useI18n } from '../i18n';

interface FAQ {
  question: string;
  answer: string;
  category: string;
}

const FAQS_KO: FAQ[] = [
  { category: 'account', question: '회원가입은 어떻게 하나요?', answer: '상단 "회원가입" 버튼을 클릭하고, 이메일, 닉네임, 비밀번호를 입력하면 바로 가입할 수 있습니다. 가입 후 이메일 인증을 완료하면 1,000 QTA 웰컬 보너스가 지급됩니다.' },
  { category: 'account', question: 'KYC 인증은 어떻게 하나요?', answer: '로그인 후 마이페이지(지갑) > KYC 인증 메뉴에서 성명, 연락처, 신분증 번호를 입력하여 신청할 수 있습니다. 인증 처리는 최대 24시간 이내에 완료됩니다.' },
  { category: 'account', question: '비밀번호를 분실했어요. 어떻게 하나요?', answer: '로그인 페이지에서 "비밀번호 찾기"를 클릭하고, 가입 시 사용한 이메일을 입력하면 비밀번호 재설정 링크가 전송됩니다. (현재 준비 중인 기능입니다)' },
  { category: 'account', question: '2단계 인증(2FA)은 어떻게 설정하나요?', answer: 'Google Authenticator 앱을 설치한 후, 마이페이지 > 보안설정에서 2FA 설정을 진행할 수 있습니다. (향후 업데이트 예정)' },
  { category: 'trade', question: '주문은 어떻게 하나요?', answer: '거래소 페이지에서 원하는 코인을 선택한 후, 주문 패널에서 매수/매도 탭을 선택합니다. 지정가 주문은 원하는 가격과 수량을, 시장가 주문은 수량만 입력하면 됩니다.' },
  { category: 'trade', question: '지정가 주문과 시장가 주문의 차이는 무엇인가요?', answer: '지정가 주문은 원하는 가격을 직접 설정하여 주문하는 방식입니다. 해당 가격에 도달했을 때 체결됩니다. 시장가 주문은 현재 호가 기준으로 즉시 체결되는 주문입니다.' },
  { category: 'trade', question: '미체결 주문은 어떻게 취소하나요?', answer: '거래소 페이지 하단의 "미체결 주문" 탭에서 취소하고자 하는 주문의 "취소" 버튼을 클릭하면 됩니다. 취소 시 잠금된 자산은 즉시 해제됩니다.' },
  { category: 'trade', question: '거래 수수료는 얼마인가요?', answer: '기본 수수료는 Maker/Taker 0.10%이며, 30일 거래량에 따라 최대 0.04%까지 할인됩니다. QTA 토큰으로 수수료 결제 시 추가 25% 할인이 적용됩니다. 자세한 내용은 수수료 안내 페이지를 참고하세요.' },
  { category: 'wallet', question: '입금은 어떻게 하나요?', answer: '자산 페이지에서 입금 버튼을 클릭하고, 원하는 코인을 선택한 후 수량을 입력하면 입금이 처리됩니다. 입금 수수료는 무료입니다.' },
  { category: 'wallet', question: '출금은 어떻게 하나요?', answer: '자산 페이지에서 출금 버튼을 클릭하고, 출금할 코인, 수량, 출금 주소를 입력한 후 출금을 신청합니다. 관리자 승인 후 처리됩니다.' },
  { category: 'wallet', question: '출금은 얼마나 걸리나요?', answer: '출금 신청 후 관리자 승인 절차를 거쳐 처리됩니다. 통상 1~2시간 이내에 처리되며, 블록체인 네트워크 상황에 따라 지연될 수 있습니다.' },
  { category: 'wallet', question: '최소 출금액은 얼마인가요?', answer: '코인별로 최소 출금액이 다릅니다. 예를 들어 BTC는 0.001 BTC, ETH는 0.01 ETH입니다. 자세한 내용은 수수료 안내 페이지를 참고하세요.' },
  { category: 'other', question: 'QuantaEX는 어떤 거래소인가요?', answer: 'QuantaEX는 BTC, ETH, QTA 등 13종 이상의 암호화폐를 USDT 및 USDC 마켓에서 거래할 수 있는 글로벌 디지털 자산 거래 플랫폼입니다. 실시간 차트, 호가창, 빠른 주문 체결 등 전문적인 거래 환경을 제공합니다.' },
  { category: 'other', question: 'QTA 토큰은 무엇인가요?', answer: 'QTA(Quanta Token)은 QuantaEX 거래소의 자체 토큰입니다. 거래 수수료 할인(25%), 이벤트 참여, 거버넌스 투표 등 다양한 혜택이 제공됩니다.' },
];

const FAQS_EN: FAQ[] = [
  { category: 'account', question: 'How do I sign up?', answer: 'Click the "Register" button at the top, enter your email, nickname, and password to create an account instantly. After verifying your email, you will receive a 1,000 QTA welcome bonus.' },
  { category: 'account', question: 'How do I complete KYC verification?', answer: 'After logging in, go to My Page > KYC Verification and submit your full name, phone number, and ID number. Verification is typically completed within 24 hours.' },
  { category: 'account', question: 'I forgot my password. What should I do?', answer: 'On the login page, click "Forgot Password" and enter the email you used to register. A password reset link will be sent to you. (This feature is currently in development.)' },
  { category: 'account', question: 'How do I set up 2FA?', answer: 'Install the Google Authenticator app, then go to My Page > Security Settings to enable 2FA. (Coming in a future update.)' },
  { category: 'trade', question: 'How do I place an order?', answer: 'Select a coin on the Trade page, choose Buy or Sell in the order panel. For limit orders, enter your desired price and quantity. For market orders, just enter the quantity.' },
  { category: 'trade', question: 'What is the difference between limit and market orders?', answer: 'A limit order lets you set a specific price. It is executed when the market reaches that price. A market order is executed immediately at the current best price.' },
  { category: 'trade', question: 'How do I cancel an open order?', answer: 'Go to the "Open Orders" section at the bottom of the Trade page and click "Cancel" on the order you wish to cancel. Locked assets will be released immediately.' },
  { category: 'trade', question: 'What are the trading fees?', answer: 'The base fee is 0.10% for both Maker and Taker. Fees can be reduced to as low as 0.04% based on your 30-day trading volume. An additional 25% discount is available when paying fees with QTA tokens. See the Fees page for details.' },
  { category: 'wallet', question: 'How do I make a deposit?', answer: 'Go to the Wallet page, click Deposit, select the coin you want, and enter the amount. Deposit fees are free.' },
  { category: 'wallet', question: 'How do I withdraw?', answer: 'Go to the Wallet page, click Withdraw, select the coin, enter the amount and withdrawal address, then submit. Withdrawals are processed after admin approval.' },
  { category: 'wallet', question: 'How long does a withdrawal take?', answer: 'After submission, withdrawals go through an admin approval process. They are typically processed within 1-2 hours, though blockchain network conditions may cause delays.' },
  { category: 'wallet', question: 'What is the minimum withdrawal amount?', answer: 'Minimum withdrawal amounts vary by coin. For example, BTC is 0.001 BTC and ETH is 0.01 ETH. Check the Fees page for full details.' },
  { category: 'other', question: 'What is QuantaEX?', answer: 'QuantaEX is a global digital asset trading platform where you can trade 13+ cryptocurrencies including BTC, ETH, and QTA on USDT and USDC markets. We offer professional trading tools including real-time charts, order book, and fast order execution.' },
  { category: 'other', question: 'What is the QTA token?', answer: 'QTA (Quanta Token) is the native token of QuantaEX. It offers various benefits including a 25% trading fee discount, event participation, and governance voting.' },
];

// CATEGORIES is defined inside the component

export default function SupportPage() {
  const { t, lang } = useI18n();
  const isKo = lang === 'ko';

  const CATEGORIES = [
    { key: 'all', label: t('support.catAll'), icon: MessageSquare },
    { key: 'account', label: t('support.catAccount'), icon: Shield },
    { key: 'trade', label: t('support.catTrade'), icon: ArrowRightLeft },
    { key: 'wallet', label: t('support.catWallet'), icon: Wallet },
    { key: 'other', label: t('support.catOther'), icon: UserCog },
  ];
  const [category, setCategory] = useState('all');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const FAQS = isKo ? FAQS_KO : FAQS_EN;

  const filteredFaqs = category === 'all' ? FAQS : FAQS.filter(f => f.category === category);

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="border-b border-exchange-border bg-exchange-card/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-exchange-yellow/10 flex items-center justify-center">
              <Headphones size={20} className="text-exchange-yellow" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('footer.support')}</h1>
              <p className="text-sm text-exchange-text-secondary mt-0.5">{t('support.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24">
        {/* Contact Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="card p-6 hover:border-exchange-yellow/30 transition-all duration-200 group">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Mail size={22} className="text-blue-400" />
              </div>
              <div>
                <h3 className="font-bold text-sm mb-1">{t('support.emailInquiry')}</h3>
                <p className="text-xs text-exchange-text-third mb-2">{t('support.emailAvail')}</p>
                <a href="mailto:support@quantaex.io" className="text-sm text-exchange-yellow hover:underline font-medium">
                  support@quantaex.io
                </a>
              </div>
            </div>
          </div>
          <div className="card p-6 hover:border-exchange-yellow/30 transition-all duration-200 group">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-exchange-buy/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <MessageSquare size={22} className="text-exchange-buy" />
              </div>
              <div>
                <h3 className="font-bold text-sm mb-1">{t('support.liveChat')}</h3>
                <p className="text-xs text-exchange-text-third mb-2">{t('support.liveChatHours')}</p>
                <span className="text-xs font-medium text-exchange-text-third bg-exchange-hover/60 px-2 py-1 rounded">{t('support.comingSoon')}</span>
              </div>
            </div>
          </div>
          <div className="card p-6 hover:border-exchange-yellow/30 transition-all duration-200 group">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-exchange-yellow/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Clock size={22} className="text-exchange-yellow" />
              </div>
              <div>
                <h3 className="font-bold text-sm mb-1">{t('support.avgResponse')}</h3>
                <p className="text-xs text-exchange-text-third mb-2">{t('support.basedOnEmail')}</p>
                <span className="text-lg font-bold text-exchange-yellow">{t('support.within2h')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-6">
            <h2 className="text-xl font-bold">{t('support.faqTitle')}</h2>
            <span className="text-xs text-exchange-text-third bg-exchange-hover/60 px-2 py-1 rounded-full">{t('support.faqCount', { count: String(FAQS.length) })}</span>
          </div>

          {/* Category Filters */}
          <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
            {CATEGORIES.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => { setCategory(key); setOpenFaq(null); }}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200 ${
                  category === key
                    ? 'bg-exchange-yellow text-black shadow-lg shadow-exchange-yellow/20'
                    : 'bg-exchange-card text-exchange-text-secondary hover:text-exchange-text border border-exchange-border'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* FAQ List */}
        <div className="space-y-2">
          {filteredFaqs.map((faq, i) => {
            const isOpen = openFaq === i;
            return (
              <div key={i} className="card overflow-hidden transition-all duration-200">
                <button
                  onClick={() => setOpenFaq(isOpen ? null : i)}
                  className="w-full flex items-center justify-between px-5 sm:px-6 py-5 text-left hover:bg-exchange-hover/20 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-exchange-yellow/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-exchange-yellow">Q</span>
                    </span>
                    <span className="text-sm font-medium leading-relaxed">{faq.question}</span>
                  </div>
                  <div className={`shrink-0 ml-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
                    <ChevronDown size={16} className={isOpen ? 'text-exchange-yellow' : 'text-exchange-text-third'} />
                  </div>
                </button>
                {isOpen && (
                  <div className="px-5 sm:px-6 pb-5 border-t border-exchange-border/30">
                    <div className="flex items-start gap-3 pt-4">
                      <span className="w-6 h-6 rounded-lg bg-exchange-buy/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-exchange-buy">A</span>
                      </span>
                      <p className="text-sm text-exchange-text-secondary leading-[1.8]">{faq.answer}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Emergency Notice */}
        <div className="card p-6 mt-10 border-l-4 border-l-exchange-sell/60">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-exchange-sell/10 flex items-center justify-center shrink-0">
              <AlertTriangle size={20} className="text-exchange-sell" />
            </div>
            <div>
              <h3 className="font-bold text-sm mb-2">{t('support.emergency')}</h3>
              <p className="text-sm text-exchange-text-secondary leading-relaxed mb-3">
                {t('support.emergencyDesc')}
              </p>
              <a href="mailto:security@quantaex.io" className="inline-flex items-center gap-1.5 text-sm text-exchange-sell hover:underline font-medium">
                <Mail size={14} />
                security@quantaex.io
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
