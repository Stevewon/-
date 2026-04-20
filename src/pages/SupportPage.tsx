import { useState } from 'react';
import { Headphones, ChevronDown, ChevronUp, MessageSquare, Mail, Clock, Shield, Wallet, ArrowRightLeft, UserCog, AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n';

interface FAQ {
  question: string;
  answer: string;
  category: string;
}

const FAQS: FAQ[] = [
  // 계정/보안
  {
    category: 'account',
    question: '회원가입은 어떻게 하나요?',
    answer: '상단 "회원가입" 버튼을 클릭하고, 이메일, 닉네임, 비밀번호를 입력하면 바로 가입할 수 있습니다. 가입 시 10,000 USDT + 10,000,000 KRW 보너스가 자동 지급됩니다.',
  },
  {
    category: 'account',
    question: 'KYC 인증은 어떻게 하나요?',
    answer: '로그인 후 마이페이지(지갑) > KYC 인증 메뉴에서 성명, 연락처, 신분증 번호를 입력하여 신청할 수 있습니다. 인증 처리는 최대 24시간 이내에 완료됩니다.',
  },
  {
    category: 'account',
    question: '비밀번호를 분실했어요. 어떻게 하나요?',
    answer: '로그인 페이지에서 "비밀번호 찾기"를 클릭하고, 가입 시 사용한 이메일을 입력하면 비밀번호 재설정 링크가 전송됩니다. (현재 준비 중인 기능입니다)',
  },
  {
    category: 'account',
    question: '2단계 인증(2FA)은 어떻게 설정하나요?',
    answer: 'Google Authenticator 앱을 설치한 후, 마이페이지 > 보안설정에서 2FA 설정을 진행할 수 있습니다. (향후 업데이트 예정)',
  },

  // 거래
  {
    category: 'trade',
    question: '주문은 어떻게 하나요?',
    answer: '거래소 페이지에서 원하는 코인을 선택한 후, 주문 패널에서 매수/매도 탭을 선택합니다. 지정가 주문은 원하는 가격과 수량을, 시장가 주문은 수량만 입력하면 됩니다.',
  },
  {
    category: 'trade',
    question: '지정가 주문과 시장가 주문의 차이는 무엇인가요?',
    answer: '지정가 주문은 원하는 가격을 직접 설정하여 주문하는 방식입니다. 해당 가격에 도달했을 때 체결됩니다. 시장가 주문은 현재 호가 기준으로 즉시 체결되는 주문입니다.',
  },
  {
    category: 'trade',
    question: '미체결 주문은 어떻게 취소하나요?',
    answer: '거래소 페이지 하단의 "미체결 주문" 탭에서 취소하고자 하는 주문의 "취소" 버튼을 클릭하면 됩니다. 취소 시 잠금된 자산은 즉시 해제됩니다.',
  },
  {
    category: 'trade',
    question: '거래 수수료는 얼마인가요?',
    answer: '기본 수수료는 Maker/Taker 0.10%이며, 30일 거래량에 따라 최대 0.04%까지 할인됩니다. QTA 토큰으로 수수료 결제 시 추가 25% 할인이 적용됩니다. 자세한 내용은 수수료 안내 페이지를 참고하세요.',
  },

  // 입출금
  {
    category: 'wallet',
    question: '입금은 어떻게 하나요?',
    answer: '자산 페이지에서 입금 버튼을 클릭하고, 원하는 코인을 선택한 후 수량을 입력하면 입금이 처리됩니다. 입금 수수료는 무료입니다.',
  },
  {
    category: 'wallet',
    question: '출금은 어떻게 하나요?',
    answer: '자산 페이지에서 출금 버튼을 클릭하고, 출금할 코인, 수량, 출금 주소를 입력한 후 출금을 신청합니다. 관리자 승인 후 처리됩니다.',
  },
  {
    category: 'wallet',
    question: '출금은 얼마나 걸리나요?',
    answer: '출금 신청 후 관리자 승인 절차를 거쳐 처리됩니다. 통상 1~2시간 이내에 처리되며, 블록체인 네트워크 상황에 따라 지연될 수 있습니다.',
  },
  {
    category: 'wallet',
    question: '최소 출금액은 얼마인가요?',
    answer: '코인별로 최소 출금액이 다릅니다. 예를 들어 BTC는 0.001 BTC, ETH는 0.01 ETH입니다. 자세한 내용은 수수료 안내 페이지를 참고하세요.',
  },

  // 기타
  {
    category: 'other',
    question: 'QuantaEX는 어떤 거래소인가요?',
    answer: 'QuantaEX는 BTC, ETH, QTA 등 13종 이상의 암호화폐를 USDT 및 KRW 마켓에서 거래할 수 있는 디지털 자산 거래 플랫폼입니다. 실시간 차트, 호가창, 빠른 주문 체결 등 전문적인 거래 환경을 제공합니다.',
  },
  {
    category: 'other',
    question: 'QTA 토큰은 무엇인가요?',
    answer: 'QTA(Quanta Token)은 QuantaEX 거래소의 자체 토큰입니다. 거래 수수료 할인(25%), 이벤트 참여, 거버넌스 투표 등 다양한 혜택이 제공됩니다.',
  },
];

const CATEGORIES = [
  { key: 'all', label: '전체', icon: MessageSquare },
  { key: 'account', label: '계정/보안', icon: Shield },
  { key: 'trade', label: '거래', icon: ArrowRightLeft },
  { key: 'wallet', label: '입출금', icon: Wallet },
  { key: 'other', label: '기타', icon: UserCog },
];

export default function SupportPage() {
  const { t } = useI18n();
  const [category, setCategory] = useState('all');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const filteredFaqs = category === 'all' ? FAQS : FAQS.filter(f => f.category === category);

  return (
    <div className="max-w-4xl mx-auto p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Headphones size={22} className="text-exchange-yellow" />
        <h1 className="text-2xl font-bold">{t('footer.support')}</h1>
      </div>
      <p className="text-sm text-exchange-text-secondary mb-8">궁금한 점이 있으시면 FAQ를 확인하시거나 고객센터로 문의해 주세요.</p>

      {/* Contact Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <div className="card p-4 text-center hover:border-exchange-yellow/30 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto mb-3">
            <Mail size={20} className="text-blue-400" />
          </div>
          <h3 className="font-semibold text-sm mb-1">이메일 문의</h3>
          <p className="text-xs text-exchange-text-secondary mb-2">24시간 접수</p>
          <a href="mailto:support@quantaex.io" className="text-sm text-exchange-yellow hover:underline">support@quantaex.io</a>
        </div>
        <div className="card p-4 text-center hover:border-exchange-yellow/30 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-exchange-buy/10 flex items-center justify-center mx-auto mb-3">
            <MessageSquare size={20} className="text-exchange-buy" />
          </div>
          <h3 className="font-semibold text-sm mb-1">실시간 채팅</h3>
          <p className="text-xs text-exchange-text-secondary mb-2">평일 09:00-18:00</p>
          <span className="text-sm text-exchange-text-third">준비 중</span>
        </div>
        <div className="card p-4 text-center hover:border-exchange-yellow/30 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-exchange-yellow/10 flex items-center justify-center mx-auto mb-3">
            <Clock size={20} className="text-exchange-yellow" />
          </div>
          <h3 className="font-semibold text-sm mb-1">응답 시간</h3>
          <p className="text-xs text-exchange-text-secondary mb-2">평균 응답 시간</p>
          <span className="text-sm text-exchange-yellow">2시간 이내</span>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="mb-6">
        <h2 className="text-lg font-bold mb-4">자주 묻는 질문 (FAQ)</h2>

        {/* Category Filters */}
        <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
          {CATEGORIES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setCategory(key); setOpenFaq(null); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                category === key
                  ? 'bg-exchange-yellow text-black'
                  : 'bg-exchange-card text-exchange-text-secondary hover:text-exchange-text'
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
            <div key={i} className="card overflow-hidden">
              <button
                onClick={() => setOpenFaq(isOpen ? null : i)}
                className="w-full flex items-center justify-between px-4 py-4 text-left hover:bg-exchange-hover/20 transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span className="text-exchange-yellow font-bold text-sm shrink-0">Q</span>
                  <span className="text-sm font-medium">{faq.question}</span>
                </div>
                {isOpen ? (
                  <ChevronUp size={16} className="text-exchange-yellow shrink-0 ml-2" />
                ) : (
                  <ChevronDown size={16} className="text-exchange-text-third shrink-0 ml-2" />
                )}
              </button>
              {isOpen && (
                <div className="px-4 pb-4 border-t border-exchange-border/50">
                  <div className="flex items-start gap-3 pt-3">
                    <span className="text-exchange-buy font-bold text-sm shrink-0">A</span>
                    <p className="text-sm text-exchange-text-secondary leading-relaxed">{faq.answer}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Emergency Notice */}
      <div className="card p-5 mt-10 border-exchange-sell/30">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-exchange-sell shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-sm mb-1">긴급 문의</h3>
            <p className="text-xs text-exchange-text-secondary leading-relaxed">
              해킹, 계정 도용, 비정상적인 출금 등 긴급 상황 발생 시 즉시 <a href="mailto:security@quantaex.io" className="text-exchange-sell hover:underline">security@quantaex.io</a>로 연락해 주세요.
              제목에 "[긴급]"을 표기해 주시면 우선 처리됩니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
