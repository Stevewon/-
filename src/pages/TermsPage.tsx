import { FileText, ChevronRight } from 'lucide-react';
import { useI18n } from '../i18n';

export default function TermsPage() {
  const { t } = useI18n();

  const sections = [
    {
      title: '제1조 (목적)',
      content: `이 약관은 QuantaEX(이하 "회사")가 운영하는 디지털 자산 거래 플랫폼(이하 "서비스")의 이용과 관련하여, 회사와 회원 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.`,
    },
    {
      title: '제2조 (정의)',
      content: `① "서비스"란 회사가 제공하는 디지털 자산(암호화폐) 거래, 자산 보관, 정보 제공 등 일체의 서비스를 의미합니다.
② "회원"이란 본 약관에 동의하고 회사와 서비스 이용계약을 체결한 자를 말합니다.
③ "디지털 자산"이란 비트코인(BTC), 이더리움(ETH), QTA 등 블록체인 기술에 기반한 전자적 형태의 자산을 말합니다.
④ "KYC"란 회원의 신원을 확인하기 위한 본인확인(Know Your Customer) 절차를 말합니다.`,
    },
    {
      title: '제3조 (약관의 효력)',
      content: `① 본 약관은 회사의 웹사이트(quantaex.io) 및 서비스 내에 게시하여 공지합니다.
② 회사는 관련 법령에 위배되지 않는 범위에서 약관을 변경할 수 있으며, 변경 시 7일 전에 공지합니다.
③ 변경된 약관에 동의하지 않는 회원은 서비스 이용을 중단하고 탈퇴할 수 있습니다.`,
    },
    {
      title: '제4조 (회원가입)',
      content: `① 회원가입은 이메일 주소와 비밀번호를 등록하여 신청하며, 회사의 승인에 의해 완료됩니다.
② 회원은 가입 시 정확한 정보를 제공해야 하며, 허위 정보 제공 시 서비스 이용이 제한될 수 있습니다.
③ 만 19세 미만인 자는 서비스에 가입할 수 없습니다.
④ 회사는 KYC 인증을 요구할 수 있으며, 인증 미완료 시 일부 서비스 이용이 제한될 수 있습니다.`,
    },
    {
      title: '제5조 (서비스의 제공)',
      content: `회사는 다음의 서비스를 제공합니다:
① 디지털 자산 매매 거래 서비스 (현물 거래)
② 디지털 자산 입출금 서비스
③ 실시간 시세 정보 및 차트 제공 서비스
④ 자산 관리 및 포트폴리오 서비스
⑤ 기타 회사가 정하는 서비스`,
    },
    {
      title: '제6조 (거래 수수료)',
      content: `① 회사는 거래 시 수수료를 부과할 수 있으며, 수수료율은 별도의 수수료 안내 페이지에 게시합니다.
② 수수료율은 30일 누적 거래량에 따라 차등 적용됩니다.
③ QTA 토큰을 이용한 수수료 결제 시 할인 혜택이 적용됩니다.
④ 출금 시 네트워크 수수료가 별도로 부과될 수 있습니다.`,
    },
    {
      title: '제7조 (회원의 의무)',
      content: `① 회원은 관련 법령, 약관, 이용안내를 준수해야 합니다.
② 회원은 자신의 계정 정보를 안전하게 관리해야 하며, 타인에게 양도하거나 공유할 수 없습니다.
③ 다음 행위는 금지됩니다:
  - 타인의 정보를 도용하는 행위
  - 시세 조작 또는 부정 거래 행위
  - 자금세탁 또는 불법 자금 유통 행위
  - 서비스의 운영을 방해하는 행위
  - 기타 관련 법령에 위반되는 행위`,
    },
    {
      title: '제8조 (서비스 이용 제한)',
      content: `① 회사는 다음의 경우 서비스 이용을 제한하거나 계정을 정지할 수 있습니다:
  - 본 약관을 위반한 경우
  - 이상 거래가 탐지된 경우
  - 관련 법령에 의한 요청이 있는 경우
  - KYC 인증 정보가 불일치하는 경우
② 서비스 이용 제한 시 회사는 회원에게 통지합니다.`,
    },
    {
      title: '제9조 (면책 조항)',
      content: `① 회사는 디지털 자산의 가격 변동에 대해 책임을 지지 않습니다.
② 천재지변, 시스템 장애 등 불가항력에 의한 서비스 중단에 대해 책임을 지지 않습니다.
③ 회원의 귀책사유로 발생한 손실에 대해 회사는 책임을 지지 않습니다.
④ 블록체인 네트워크의 장애로 인한 입출금 지연에 대해 회사는 책임을 지지 않습니다.`,
    },
    {
      title: '제10조 (분쟁 해결)',
      content: `① 본 약관에 관한 분쟁은 대한민국 법률을 준거법으로 합니다.
② 서비스 이용으로 발생한 분쟁에 대해 회사와 회원은 상호 협의하여 해결합니다.
③ 협의가 이루어지지 않을 경우, 관할 법원에 소를 제기할 수 있습니다.`,
    },
  ];

  return (
    <div className="max-w-4xl mx-auto p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <FileText size={22} className="text-exchange-yellow" />
        <h1 className="text-2xl font-bold">{t('footer.terms')}</h1>
      </div>
      <p className="text-sm text-exchange-text-third mb-8">최종 수정일: 2026년 4월 20일 | 시행일: 2026년 4월 20일</p>

      {/* Table of Contents */}
      <div className="card p-5 mb-8">
        <h3 className="text-sm font-semibold text-exchange-text-secondary mb-3">목차</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {sections.map((s, i) => (
            <a
              key={i}
              href={`#terms-${i}`}
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
          <section key={i} id={`terms-${i}`} className="card p-5">
            <h2 className="font-bold text-base mb-3 text-exchange-yellow">{s.title}</h2>
            <div className="text-sm text-exchange-text-secondary leading-relaxed whitespace-pre-line">{s.content}</div>
          </section>
        ))}
      </div>

      {/* Footer note */}
      <div className="mt-8 text-center text-xs text-exchange-text-third">
        <p>본 약관에 대한 문의사항은 고객센터(support@quantaex.io)로 연락해 주시기 바랍니다.</p>
      </div>
    </div>
  );
}
