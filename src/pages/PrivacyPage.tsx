import { ShieldCheck, ChevronRight } from 'lucide-react';
import { useI18n } from '../i18n';

export default function PrivacyPage() {
  const { t } = useI18n();

  const sections = [
    {
      title: '1. 개인정보의 수집 항목 및 방법',
      content: `회사는 서비스 제공을 위해 다음의 개인정보를 수집합니다.

[필수 수집 항목]
• 이메일 주소, 비밀번호(암호화 저장), 닉네임
• 접속 IP, 접속 일시, 브라우저 정보

[KYC 인증 시 추가 수집 항목]
• 성명, 휴대전화 번호, 신분증 번호

[수집 방법]
• 회원가입, KYC 인증 절차를 통한 직접 입력
• 서비스 이용 과정에서 자동으로 생성되는 정보 수집`,
    },
    {
      title: '2. 개인정보의 수집 및 이용 목적',
      content: `수집한 개인정보는 다음의 목적으로 이용합니다.

• 회원 관리: 회원 식별, 본인 확인, 서비스 이용 계약 체결 및 유지
• 서비스 제공: 디지털 자산 거래, 입출금, 자산 관리 서비스 제공
• KYC/AML 준수: 자금세탁방지 및 본인확인 의무 이행
• 고객 지원: 문의 대응, 공지사항 전달
• 보안: 부정이용 방지, 이상 거래 탐지, 접근 통제
• 서비스 개선: 통계 분석, 서비스 품질 향상`,
    },
    {
      title: '3. 개인정보의 보유 및 이용 기간',
      content: `원칙적으로 개인정보 수집 및 이용 목적이 달성된 후에는 지체 없이 파기합니다. 단, 관련 법령에 따라 보존할 필요가 있는 경우 해당 법령에 정한 기간 동안 보관합니다.

• 계약 또는 청약철회 등에 관한 기록: 5년
• 대금결제 및 재화 등의 공급에 관한 기록: 5년
• 전자금융거래에 관한 기록: 5년
• 소비자 불만 또는 분쟁처리에 관한 기록: 3년
• 접속에 관한 기록(로그): 3개월

회원 탈퇴 시 개인정보는 즉시 파기하되, 법률에 의한 보존 의무가 있는 경우 해당 기간 동안 분리 보관합니다.`,
    },
    {
      title: '4. 개인정보의 제3자 제공',
      content: `회사는 원칙적으로 회원의 개인정보를 제3자에게 제공하지 않습니다. 다만, 다음의 경우에는 예외로 합니다.

• 회원이 사전에 동의한 경우
• 법률의 규정에 의하거나, 수사기관의 요청이 있는 경우
• 자금세탁방지 관련 법령에 따른 보고 의무가 있는 경우`,
    },
    {
      title: '5. 개인정보의 파기 절차 및 방법',
      content: `• 파기 절차: 수집 목적 달성 후 별도 DB로 옮겨 일정 기간 저장 후 파기
• 파기 방법:
  - 전자적 파일: 기술적 방법으로 복구 불가능하도록 삭제
  - 종이 문서: 분쇄기로 분쇄하거나 소각`,
    },
    {
      title: '6. 개인정보의 안전성 확보 조치',
      content: `회사는 개인정보의 안전성 확보를 위해 다음의 조치를 취하고 있습니다.

• 비밀번호 암호화: bcrypt 해시 알고리즘을 이용한 비밀번호 암호화 저장
• 접근 통제: 개인정보 처리 담당자에 대한 접근 권한 관리
• 보안 전송: HTTPS(TLS) 프로토콜을 통한 데이터 암호화 전송
• 로그 기록: 개인정보 접근 및 변경 기록 보관
• 2단계 인증: OTP 기반 추가 인증 시스템 제공
• 이상 탐지: 자동화된 이상 거래 및 비정상 접속 탐지 시스템 운영`,
    },
    {
      title: '7. 이용자의 권리 및 행사 방법',
      content: `회원은 다음의 권리를 행사할 수 있습니다.

• 개인정보 열람 요구
• 개인정보 정정 요구 (오류가 있는 경우)
• 개인정보 삭제 요구 (법령에 따른 보관 기간이 경과한 경우)
• 개인정보 처리 정지 요구

위 권리의 행사는 마이페이지 또는 고객센터를 통해 가능합니다.`,
    },
    {
      title: '8. 쿠키(Cookie)의 사용',
      content: `회사는 서비스의 편의성 향상을 위해 쿠키를 사용할 수 있습니다.

• 사용 목적: 로그인 상태 유지, 언어 설정 저장, 서비스 이용 분석
• 쿠키 거부: 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 일부 서비스 이용에 제한이 있을 수 있습니다.`,
    },
    {
      title: '9. 개인정보 보호 책임자',
      content: `회사는 개인정보 보호를 위해 다음과 같이 개인정보 보호 책임자를 지정하고 있습니다.

• 담당부서: 보안팀
• 이메일: privacy@quantaex.io
• 고객센터: support@quantaex.io

개인정보 침해 관련 상담은 다음 기관에서도 가능합니다:
• 개인정보침해 신고센터: 118 (privacy.kisa.or.kr)
• 대검찰청 사이버수사과: 1301 (spo.go.kr)
• 경찰청 사이버안전국: 182 (cyberbureau.police.go.kr)`,
    },
    {
      title: '10. 개인정보 처리방침의 변경',
      content: `본 개인정보 처리방침은 법령, 정책 또는 보안 기술의 변경에 따라 수정될 수 있습니다. 변경 시 최소 7일 전에 공지사항을 통해 안내하겠습니다.`,
    },
  ];

  return (
    <div className="max-w-4xl mx-auto p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck size={22} className="text-exchange-yellow" />
        <h1 className="text-2xl font-bold">{t('footer.privacy')}</h1>
      </div>
      <p className="text-sm text-exchange-text-third mb-8">최종 수정일: 2026년 4월 20일 | 시행일: 2026년 4월 20일</p>

      {/* Intro */}
      <div className="card p-5 mb-8">
        <p className="text-sm text-exchange-text-secondary leading-relaxed">
          QuantaEX(이하 "회사")는 개인정보보호법, 정보통신망 이용촉진 및 정보보호 등에 관한 법률 등 관련 법령을 준수하며,
          회원의 개인정보를 보호하기 위해 최선을 다하고 있습니다. 본 개인정보 처리방침은 회원의 개인정보가 어떻게 수집, 이용, 보관, 파기되는지를 안내합니다.
        </p>
      </div>

      {/* Table of Contents */}
      <div className="card p-5 mb-8">
        <h3 className="text-sm font-semibold text-exchange-text-secondary mb-3">목차</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {sections.map((s, i) => (
            <a
              key={i}
              href={`#privacy-${i}`}
              className="flex items-center gap-1.5 text-sm text-exchange-text-secondary hover:text-exchange-yellow transition-colors py-1"
            >
              <ChevronRight size={12} className="text-exchange-text-third" />
              {s.title}
            </a>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-6">
        {sections.map((s, i) => (
          <section key={i} id={`privacy-${i}`} className="card p-5">
            <h2 className="font-bold text-base mb-3 text-exchange-yellow">{s.title}</h2>
            <div className="text-sm text-exchange-text-secondary leading-relaxed whitespace-pre-line">{s.content}</div>
          </section>
        ))}
      </div>

      {/* Footer note */}
      <div className="mt-8 text-center text-xs text-exchange-text-third">
        <p>개인정보 관련 문의: privacy@quantaex.io | 고객센터: support@quantaex.io</p>
      </div>
    </div>
  );
}
