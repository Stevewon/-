import { useState } from 'react';
import { FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { useI18n } from '../i18n';

export default function TermsPage() {
  const { t, lang } = useI18n();
  const isKo = lang === 'ko';
  const [activeToc, setActiveToc] = useState<number | null>(null);

  const sectionsKo = [
    { title: '제1조 (목적)', content: '이 약관은 QuantaEX(이하 "회사")가 운영하는 디지털 자산 거래 플랫폼(이하 "서비스")의 이용과 관련하여, 회사와 회원 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.' },
    { title: '제2조 (정의)', content: '① "서비스"란 회사가 제공하는 디지털 자산(암호화폐) 거래, 자산 보관, 정보 제공 등 일체의 서비스를 의미합니다.\n② "회원"이란 본 약관에 동의하고 회사와 서비스 이용계약을 체결한 자를 말합니다.\n③ "디지털 자산"이란 비트코인(BTC), 이더리움(ETH), QTA 등 블록체인 기술에 기반한 전자적 형태의 자산을 말합니다.\n④ "KYC"란 회원의 신원을 확인하기 위한 본인확인(Know Your Customer) 절차를 말합니다.' },
    { title: '제3조 (약관의 효력)', content: '① 본 약관은 회사의 웹사이트(quantaex.io) 및 서비스 내에 게시하여 공지합니다.\n② 회사는 관련 법령에 위배되지 않는 범위에서 약관을 변경할 수 있으며, 변경 시 7일 전에 공지합니다.\n③ 변경된 약관에 동의하지 않는 회원은 서비스 이용을 중단하고 탈퇴할 수 있습니다.' },
    { title: '제4조 (회원가입)', content: '① 회원가입은 이메일 주소와 비밀번호를 등록하여 신청하며, 회사의 승인에 의해 완료됩니다.\n② 회원은 가입 시 정확한 정보를 제공해야 하며, 허위 정보 제공 시 서비스 이용이 제한될 수 있습니다.\n③ 만 19세 미만인 자는 서비스에 가입할 수 없습니다.\n④ 회사는 KYC 인증을 요구할 수 있으며, 인증 미완료 시 일부 서비스 이용이 제한될 수 있습니다.' },
    { title: '제5조 (서비스의 제공)', content: '회사는 다음의 서비스를 제공합니다:\n① 디지털 자산 매매 거래 서비스 (현물 거래)\n② 디지털 자산 입출금 서비스\n③ 실시간 시세 정보 및 차트 제공 서비스\n④ 자산 관리 및 포트폴리오 서비스\n⑤ 기타 회사가 정하는 서비스' },
    { title: '제6조 (거래 수수료)', content: '① 회사는 거래 시 수수료를 부과할 수 있으며, 수수료율은 별도의 수수료 안내 페이지에 게시합니다.\n② 수수료율은 30일 누적 거래량에 따라 차등 적용됩니다.\n③ QTA 토큰을 이용한 수수료 결제 시 할인 혜택이 적용됩니다.\n④ 출금 시 네트워크 수수료가 별도로 부과될 수 있습니다.' },
    { title: '제7조 (회원의 의무)', content: '① 회원은 관련 법령, 약관, 이용안내를 준수해야 합니다.\n② 회원은 자신의 계정 정보를 안전하게 관리해야 하며, 타인에게 양도하거나 공유할 수 없습니다.\n③ 다음 행위는 금지됩니다:\n  - 타인의 정보를 도용하는 행위\n  - 시세 조작 또는 부정 거래 행위\n  - 자금세탁 또는 불법 자금 유통 행위\n  - 서비스의 운영을 방해하는 행위\n  - 기타 관련 법령에 위반되는 행위' },
    { title: '제8조 (서비스 이용 제한)', content: '① 회사는 다음의 경우 서비스 이용을 제한하거나 계정을 정지할 수 있습니다:\n  - 본 약관을 위반한 경우\n  - 이상 거래가 탐지된 경우\n  - 관련 법령에 의한 요청이 있는 경우\n  - KYC 인증 정보가 불일치하는 경우\n② 서비스 이용 제한 시 회사는 회원에게 통지합니다.' },
    { title: '제9조 (면책 조항)', content: '① 회사는 디지털 자산의 가격 변동에 대해 책임을 지지 않습니다.\n② 천재지변, 시스템 장애 등 불가항력에 의한 서비스 중단에 대해 책임을 지지 않습니다.\n③ 회원의 귀책사유로 발생한 손실에 대해 회사는 책임을 지지 않습니다.\n④ 블록체인 네트워크의 장애로 인한 입출금 지연에 대해 회사는 책임을 지지 않습니다.' },
    { title: '제10조 (분쟁 해결)', content: '① 본 약관에 관한 분쟁은 대한민국 법률을 준거법으로 합니다.\n② 서비스 이용으로 발생한 분쟁에 대해 회사와 회원은 상호 협의하여 해결합니다.\n③ 협의가 이루어지지 않을 경우, 관할 법원에 소를 제기할 수 있습니다.' },
  ];

  const sectionsEn = [
    { title: 'Article 1 (Purpose)', content: 'These Terms govern the rights, obligations, and responsibilities between QuantaEX (hereinafter "Company") and its members regarding the use of the digital asset trading platform (hereinafter "Service").' },
    { title: 'Article 2 (Definitions)', content: '① "Service" refers to all services provided by the Company, including digital asset (cryptocurrency) trading, asset custody, and information services.\n② "Member" refers to a person who agrees to these Terms and enters into a service agreement with the Company.\n③ "Digital Assets" refers to electronic assets based on blockchain technology, including Bitcoin (BTC), Ethereum (ETH), QTA, etc.\n④ "KYC" refers to Know Your Customer procedures to verify a member\'s identity.' },
    { title: 'Article 3 (Effectiveness of Terms)', content: '① These Terms are published on the Company\'s website (quantaex.io) and within the Service.\n② The Company may modify these Terms within the scope permitted by applicable laws, with 7 days prior notice.\n③ Members who disagree with modified Terms may discontinue use and withdraw from the Service.' },
    { title: 'Article 4 (Membership)', content: '① Membership registration is completed by submitting an email address and password, subject to Company approval.\n② Members must provide accurate information; service access may be restricted for providing false information.\n③ Persons under 19 years of age cannot register for the Service.\n④ The Company may require KYC verification; certain services may be restricted without completed verification.' },
    { title: 'Article 5 (Service Provision)', content: 'The Company provides the following services:\n① Digital asset spot trading service\n② Digital asset deposit and withdrawal service\n③ Real-time market data and chart service\n④ Asset management and portfolio service\n⑤ Other services as determined by the Company' },
    { title: 'Article 6 (Trading Fees)', content: '① The Company may charge trading fees; fee rates are published on the separate Fees page.\n② Fee rates vary based on 30-day cumulative trading volume.\n③ Discounts are applied when paying fees with QTA tokens.\n④ Network fees may apply separately for withdrawals.' },
    { title: 'Article 7 (Member Obligations)', content: '① Members must comply with applicable laws, these Terms, and usage guidelines.\n② Members must manage their account information securely and may not transfer or share it with others.\n③ The following activities are prohibited:\n  - Identity theft or impersonation\n  - Market manipulation or fraudulent trading\n  - Money laundering or illegal fund transfers\n  - Interference with service operations\n  - Any other violation of applicable laws' },
    { title: 'Article 8 (Service Restrictions)', content: '① The Company may restrict service access or suspend accounts in the following cases:\n  - Violation of these Terms\n  - Detection of suspicious transactions\n  - Requests pursuant to applicable laws\n  - Inconsistency in KYC verification information\n② The Company will notify members when service access is restricted.' },
    { title: 'Article 9 (Disclaimer)', content: '① The Company is not responsible for fluctuations in digital asset prices.\n② The Company is not liable for service interruptions caused by force majeure, including natural disasters or system failures.\n③ The Company is not responsible for losses caused by the member\'s own negligence.\n④ The Company is not liable for deposit or withdrawal delays caused by blockchain network failures.' },
    { title: 'Article 10 (Dispute Resolution)', content: '① Disputes regarding these Terms shall be governed by the laws of the Republic of Korea.\n② The Company and members shall attempt to resolve disputes arising from service use through mutual consultation.\n③ If consultation fails, either party may file a lawsuit with the competent court.' },
  ];

  const sections = isKo ? sectionsKo : sectionsEn;

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="border-b border-exchange-border bg-exchange-card/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-exchange-yellow/10 flex items-center justify-center">
              <FileText size={20} className="text-exchange-yellow" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('footer.terms')}</h1>
              <p className="text-sm text-exchange-text-secondary mt-0.5">{t('terms.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar TOC */}
          <div className="lg:col-span-1">
            <div className="card p-4 lg:sticky lg:top-20">
              <h3 className="text-xs font-semibold text-exchange-text-third uppercase tracking-wider mb-3 px-2">{t('terms.toc')}</h3>
              <nav className="space-y-0.5">
                {sections.map((s, i) => (
                  <a
                    key={i}
                    href={`#terms-${i}`}
                    onClick={() => setActiveToc(i)}
                    className={`flex items-center gap-2 text-xs py-2 px-2 rounded-lg transition-colors ${
                      activeToc === i
                        ? 'bg-exchange-yellow/10 text-exchange-yellow font-medium'
                        : 'text-exchange-text-secondary hover:text-exchange-text hover:bg-exchange-hover/30'
                    }`}
                  >
                    <span className="w-5 text-right text-exchange-text-third tabular-nums">{i + 1}</span>
                    <span className="truncate">{s.title.replace(/^(제\d+조\s*|Article \d+\s*)/, '')}</span>
                  </a>
                ))}
              </nav>
            </div>
          </div>

          {/* Content */}
          <div className="lg:col-span-3 space-y-4">
            {sections.map((s, i) => (
              <section
                key={i}
                id={`terms-${i}`}
                className="card p-5 sm:p-6 scroll-mt-20"
                onClick={() => setActiveToc(i)}
              >
                <h2 className="font-bold text-base mb-4 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-exchange-yellow/10 flex items-center justify-center text-xs font-bold text-exchange-yellow tabular-nums">
                    {i + 1}
                  </span>
                  {s.title}
                </h2>
                <div className="text-sm text-exchange-text-secondary leading-[1.9] whitespace-pre-line pl-9">
                  {s.content}
                </div>
              </section>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <div className="mt-10 text-center text-xs text-exchange-text-third">
          <p>{t('terms.footerNote')} <a href="mailto:support@quantaex.io" className="text-exchange-yellow hover:underline">support@quantaex.io</a></p>
        </div>
      </div>
    </div>
  );
}
