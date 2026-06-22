import { useState } from 'react';
import { ShieldCheck, ChevronRight } from 'lucide-react';
import { useI18n } from '../i18n';

export default function PrivacyPage() {
  const { t, lang } = useI18n();
  const isKo = lang === 'ko';
  const [activeToc, setActiveToc] = useState<number | null>(null);

  const sectionsKo = [
    { title: '1. 개인정보의 수집 항목 및 방법', content: '회사는 서비스 제공을 위해 다음의 개인정보를 수집합니다.\n\n[필수 수집 항목]\n• 이메일 주소, 비밀번호(암호화 저장), 닉네임\n• 접속 IP, 접속 일시, 브라우저 정보\n\n[KYC 인증 시 추가 수집 항목]\n• 성명, 휴대전화 번호, 신분증 번호\n\n[수집 방법]\n• 회원가입, KYC 인증 절차를 통한 직접 입력\n• 서비스 이용 과정에서 자동으로 생성되는 정보 수집' },
    { title: '2. 개인정보의 수집 및 이용 목적', content: '수집한 개인정보는 다음의 목적으로 이용합니다.\n\n• 회원 관리: 회원 식별, 본인 확인, 서비스 이용 계약 체결 및 유지\n• 서비스 제공: 디지털 자산 거래, 입출금, 자산 관리 서비스 제공\n• KYC/AML 준수: 자금세탁방지 및 본인확인 의무 이행\n• 고객 지원: 문의 대응, 공지사항 전달\n• 보안: 부정이용 방지, 이상 거래 탐지, 접근 통제\n• 서비스 개선: 통계 분석, 서비스 품질 향상' },
    { title: '3. 개인정보의 보유 및 이용 기간', content: '원칙적으로 개인정보 수집 및 이용 목적이 달성된 후에는 지체 없이 파기합니다. 단, 세이션 공화국의 국제사업회사법(IBC Act) 및 자금세탁방지법(AML/CFT Act 2020) 등 관련 법령에 따라 보존할 필요가 있는 경우 해당 법령에서 정한 기간 동안 보관합니다.\n\n• KYC/AML 관련 고객 실사 기록: 7년 (세이션 AML/CFT Act 2020)\n• 거래 및 입출금 기록: 7년 (FATF 권고안 및 세이션 금융정보분석원 지침)\n• 분쟁 및 감사 기록: 5년\n• 계정 관련 통신 기록: 3년\n• 접속 로그 및 보안 기록: 6개월\n\n회원 탈퇴 시 개인정보는 즉시 파기되되, 위 법령에 의한 보존 의무가 있는 경우 해당 기간 동안 암호화되어 분리 보관됩니다.' },
    { title: '4. 개인정보의 제3자 제공', content: '회사는 원칙적으로 회원의 개인정보를 제3자에게 제공하지 않습니다. 다만, 다음의 경우에는 예외로 합니다.\n\n• 회원이 사전에 동의한 경우\n• 법률의 규정에 의하거나, 수사기관의 요청이 있는 경우\n• 자금세탁방지 관련 법령에 따른 보고 의무가 있는 경우' },
    { title: '5. 개인정보의 파기 절차 및 방법', content: '• 파기 절차: 수집 목적 달성 후 별도 DB로 옮겨 일정 기간 저장 후 파기\n• 파기 방법:\n  - 전자적 파일: 기술적 방법으로 복구 불가능하도록 삭제\n  - 종이 문서: 분쇄기로 분쇄하거나 소각' },
    { title: '6. 개인정보의 안전성 확보 조치', content: '회사는 개인정보의 안전성 확보를 위해 다음의 조치를 취하고 있습니다.\n\n• 비밀번호 암호화: bcrypt 해시 알고리즘을 이용한 비밀번호 암호화 저장\n• 접근 통제: 개인정보 처리 담당자에 대한 접근 권한 관리\n• 보안 전송: HTTPS(TLS) 프로토콜을 통한 데이터 암호화 전송\n• 로그 기록: 개인정보 접근 및 변경 기록 보관\n• 2단계 인증: OTP 기반 추가 인증 시스템 제공\n• 이상 탐지: 자동화된 이상 거래 및 비정상 접속 탐지 시스템 운영' },
    { title: '7. 이용자의 권리 및 행사 방법', content: '회원은 다음의 권리를 행사할 수 있습니다.\n\n• 개인정보 열람 요구\n• 개인정보 정정 요구 (오류가 있는 경우)\n• 개인정보 삭제 요구 (법령에 따른 보관 기간이 경과한 경우)\n• 개인정보 처리 정지 요구\n\n위 권리의 행사는 마이페이지 또는 고객센터를 통해 가능합니다.' },
    { title: '8. 쿠키(Cookie)의 사용', content: '회사는 서비스의 편의성 향상을 위해 쿠키를 사용할 수 있습니다.\n\n• 사용 목적: 로그인 상태 유지, 언어 설정 저장, 서비스 이용 분석\n• 쿠키 거부: 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 일부 서비스 이용에 제한이 있을 수 있습니다.' },
    { title: '9. 개인정보 보호 책임자 (Global DPO)', content: '회사는 개인정보 보호를 위해 글로벌 개인정보 보호 책임자(Data Protection Officer, DPO)를 지정하고 있습니다.\n\n• 책임 기관: QuantaEX Holdings Ltd. (Seychelles IBC) 보안 및 컴플라이언스팀\n• 글로벌 DPO 이메일: dpo@quantaex.io\n• 개인정보 문의: privacy@quantaex.io\n• 일반 고객지원: support@quantaex.io\n• 처리 소요 시간: 접수 후 30일 이내 (GDPR / CCPA 기준)\n\n【적용 가능한 국제 개인정보 보호 규정】\n회원의 거주 국가에 따라 다음의 권리가 추가로 보장될 수 있습니다:\n• EU/EEA 거주자: GDPR(EU General Data Protection Regulation) 제15~22조에 따른 접근권, 정정권, 삭제권, 이전권, 이의제기권\n• 캘리포니아 거주자: CCPA/CPRA에 따른 알 권리, 삭제권, 옥아웃 권리\n• 영국 거주자: UK GDPR 및 데이터 보호법(Data Protection Act 2018)\n• 기타 국가 거주자: 해당 국가의 개인정보 보호 법령에 따른 권리\n\n권리 행사는 dpo@quantaex.io로 서면 요청해 주시며, 회사는 신원 확인 후 합리적 기간 내 처리합니다.' },
    { title: '10. 개인정보 처리방침의 변경', content: '본 개인정보 처리방침은 법령, 정책 또는 보안 기술의 변경에 따라 수정될 수 있습니다. 변경 시 최소 7일 전에 공지사항을 통해 안내하겠습니다.' },
  ];

  const sectionsEn = [
    { title: '1. Personal Information Collected', content: 'The Company collects the following personal information to provide its services.\n\n[Required Information]\n• Email address, password (encrypted), nickname\n• Access IP, access time, browser information\n\n[Additional KYC Information]\n• Full name, mobile phone number, ID number\n\n[Collection Methods]\n• Direct input through registration and KYC verification\n• Automatic collection during service usage' },
    { title: '2. Purpose of Collection and Use', content: 'Collected personal information is used for the following purposes:\n\n• Member management: identification, verification, service agreements\n• Service provision: digital asset trading, deposits/withdrawals, asset management\n• KYC/AML compliance: anti-money laundering and identity verification obligations\n• Customer support: responding to inquiries, delivering announcements\n• Security: fraud prevention, suspicious transaction detection, access control\n• Service improvement: statistical analysis, quality enhancement' },
    { title: '3. Retention Period', content: 'Personal information is destroyed without delay after its collection purpose has been fulfilled. However, information may be retained for periods required by Seychelles International Business Companies Act and the Anti-Money Laundering and Countering the Financing of Terrorism Act 2020 (AML/CFT Act 2020), and other applicable laws.\n\n• KYC/AML customer due-diligence records: 7 years (Seychelles AML/CFT Act 2020)\n• Transaction and deposit/withdrawal records: 7 years (FATF Recommendations and Seychelles FIU guidance)\n• Dispute and audit records: 5 years\n• Account-related communications: 3 years\n• Access logs and security records: 6 months\n\nUpon membership withdrawal, personal information is immediately destroyed, except where the above legal retention obligations apply, in which case data is encrypted and stored separately for the required period.' },
    { title: '4. Sharing with Third Parties', content: 'The Company does not share member personal information with third parties in principle. Exceptions include:\n\n• Prior consent from the member\n• Legal requirements or requests from investigative agencies\n• Reporting obligations under anti-money laundering laws' },
    { title: '5. Destruction Procedures', content: '• Procedure: After the purpose is fulfilled, data is transferred to a separate database and destroyed after a retention period.\n• Methods:\n  - Electronic files: Permanently deleted using technical methods\n  - Paper documents: Shredded or incinerated' },
    { title: '6. Security Measures', content: 'The Company takes the following measures to secure personal information:\n\n• Password encryption: bcrypt hashing for password storage\n• Access control: Managed access permissions for data handlers\n• Secure transmission: Data encryption via HTTPS (TLS) protocol\n• Logging: Records of personal information access and modifications\n• Two-factor authentication: OTP-based additional verification system\n• Anomaly detection: Automated suspicious transaction and abnormal access detection' },
    { title: '7. User Rights', content: 'Members may exercise the following rights:\n\n• Request to view personal information\n• Request to correct errors in personal information\n• Request to delete personal information (after legal retention period)\n• Request to suspend processing of personal information\n\nThese rights can be exercised through My Page or Customer Support.' },
    { title: '8. Use of Cookies', content: 'The Company may use cookies to improve service convenience.\n\n• Purpose: Maintaining login status, storing language settings, analyzing service usage\n• Opting out: You can refuse cookie storage through browser settings, but some services may be limited.' },
    { title: '9. Global Data Protection Officer (DPO)', content: 'The Company designates a Global Data Protection Officer (DPO) responsible for personal information protection:\n\n• Responsible entity: QuantaEX Holdings Ltd. (Seychelles IBC) - Security and Compliance Team\n• Global DPO email: dpo@quantaex.io\n• Privacy inquiries: privacy@quantaex.io\n• General customer support: support@quantaex.io\n• Response time: Within 30 days of receipt (in line with GDPR / CCPA standards)\n\n[Applicable International Privacy Regulations]\nAdditional rights may apply depending on the member\'s country of residence:\n• EU/EEA residents: Access, rectification, erasure, portability, and objection rights under GDPR Articles 15-22\n• California residents: Right to know, right to delete, and opt-out rights under CCPA/CPRA\n• UK residents: Rights under UK GDPR and the Data Protection Act 2018\n• Residents of other jurisdictions: Rights granted under the applicable local data protection laws\n\nTo exercise these rights, please send a written request to dpo@quantaex.io. After verifying your identity, the Company will respond within a reasonable timeframe.' },
    { title: '10. Changes to This Policy', content: 'This Privacy Policy may be revised due to changes in laws, policies, or security technology. We will provide at least 7 days advance notice through announcements.' },
  ];

  const sections = isKo ? sectionsKo : sectionsEn;

  // Effective date and version metadata (single source of truth)
  const EFFECTIVE_DATE = '2026-06-22';
  const VERSION = '1.0';

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="border-b border-exchange-border bg-exchange-card/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-exchange-yellow/10 flex items-center justify-center">
              <ShieldCheck size={20} className="text-exchange-yellow" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('footer.privacy')}</h1>
              <p className="text-sm text-exchange-text-secondary mt-0.5">{t('privacy.subtitle')}</p>
            </div>
          </div>
          {/* Effective date + version + entity badge */}
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
            <span className="px-2.5 py-1 rounded-md bg-exchange-yellow/10 text-exchange-yellow font-medium">
              {isKo ? '시행일' : 'Effective'}: {EFFECTIVE_DATE}
            </span>
            <span className="px-2.5 py-1 rounded-md bg-exchange-hover/40 text-exchange-text-secondary">
              {isKo ? '버전' : 'Version'} {VERSION}
            </span>
            <span className="px-2.5 py-1 rounded-md bg-exchange-hover/40 text-exchange-text-third">
              QuantaEX Holdings Ltd. · Seychelles IBC
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24">
        {/* Intro */}
        <div className="card p-5 sm:p-6 mb-6">
          <p className="text-sm text-exchange-text-secondary leading-[1.8]">
            {t('privacy.intro')}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar TOC */}
          <div className="lg:col-span-1">
            <div className="card p-4 lg:sticky lg:top-20">
              <h3 className="text-xs font-semibold text-exchange-text-third uppercase tracking-wider mb-3 px-2">{t('privacy.toc')}</h3>
              <nav className="space-y-0.5">
                {sections.map((s, i) => (
                  <a
                    key={i}
                    href={`#privacy-${i}`}
                    onClick={() => setActiveToc(i)}
                    className={`flex items-center gap-2 text-xs py-2 px-2 rounded-lg transition-colors ${
                      activeToc === i
                        ? 'bg-exchange-yellow/10 text-exchange-yellow font-medium'
                        : 'text-exchange-text-secondary hover:text-exchange-text hover:bg-exchange-hover/30'
                    }`}
                  >
                    <span className="w-5 text-right text-exchange-text-third tabular-nums">{i + 1}</span>
                    <span className="truncate">{s.title.replace(/^\d+\.\s*/, '')}</span>
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
                id={`privacy-${i}`}
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
        <div className="mt-10 text-center text-xs text-exchange-text-third space-y-1">
          <p>
            {isKo ? '글로벌 DPO' : 'Global DPO'}: <a href="mailto:dpo@quantaex.io" className="text-exchange-yellow hover:underline">dpo@quantaex.io</a>
            {' | '}
            {t('privacy.footerContact')} <a href="mailto:privacy@quantaex.io" className="text-exchange-yellow hover:underline">privacy@quantaex.io</a>
            {' | '}
            {t('privacy.footerSupport')} <a href="mailto:support@quantaex.io" className="text-exchange-yellow hover:underline">support@quantaex.io</a>
          </p>
          <p className="text-exchange-text-third/70">
            QuantaEX Holdings Ltd. · Registered in the Republic of Seychelles
          </p>
        </div>
      </div>
    </div>
  );
}
