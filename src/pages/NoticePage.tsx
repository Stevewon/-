import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronRight, Pin, Calendar, Tag } from 'lucide-react';
import { useI18n } from '../i18n';

interface Notice {
  id: number;
  type: 'notice' | 'event' | 'maintenance' | 'listing';
  title: string;
  date: string;
  pinned?: boolean;
  content: string;
}

const NOTICES: Notice[] = [
  {
    id: 1,
    type: 'notice',
    title: 'QuantaEX 거래소 그랜드 오픈 안내',
    date: '2026-04-20',
    pinned: true,
    content: 'QuantaEX 거래소가 정식 오픈되었습니다. BTC, ETH, QTA 등 13종의 암호화폐를 USDT 및 KRW 마켓에서 거래하실 수 있습니다. 회원가입 시 10,000 USDT + 10,000,000 KRW 보너스가 지급됩니다. 많은 이용 부탁드립니다.',
  },
  {
    id: 2,
    type: 'listing',
    title: '[신규 상장] QTA (Quanta Token) 상장 안내',
    date: '2026-04-20',
    pinned: true,
    content: 'QTA (Quanta Token)이 QuantaEX 거래소에 신규 상장되었습니다.\n\n■ 상장일시: 2026년 4월 20일 (일) 00:00 (KST)\n■ 거래쌍: QTA/USDT, QTA/KRW\n■ 입출금: 즉시 가능\n\n상장 기념 이벤트로 QTA 거래 수수료 50% 할인이 진행됩니다.',
  },
  {
    id: 3,
    type: 'event',
    title: '[이벤트] 회원가입 보너스 지급 이벤트',
    date: '2026-04-20',
    content: '신규 회원가입 시 다음 보너스를 지급합니다:\n\n• 10,000 USDT\n• 10,000,000 KRW\n• 0.1 BTC\n• 2 ETH\n• 100,000 QTA\n\n이벤트 기간: 2026년 4월 20일 ~ 별도 공지 시까지',
  },
  {
    id: 4,
    type: 'notice',
    title: 'KYC 인증 절차 안내',
    date: '2026-04-19',
    content: '원활한 거래를 위해 KYC 인증을 완료해 주시기 바랍니다.\n\n■ 인증 방법: 마이페이지 > 보안설정 > KYC 인증\n■ 필요 서류: 성명, 연락처, 신분증 번호\n■ 처리 기간: 신청 후 최대 24시간 이내\n\nKYC 미인증 시 출금이 제한될 수 있습니다.',
  },
  {
    id: 5,
    type: 'maintenance',
    title: '[점검 완료] 서버 정기 점검 안내',
    date: '2026-04-18',
    content: '서버 정기 점검이 완료되었습니다.\n\n■ 점검일시: 2026년 4월 18일 02:00 ~ 04:00 (KST)\n■ 영향 범위: 전 서비스 일시 중단\n■ 현재 상태: 정상 운영 중\n\n이용에 불편을 드려 죄송합니다.',
  },
  {
    id: 6,
    type: 'notice',
    title: '이상 거래 탐지 시스템 업데이트 안내',
    date: '2026-04-17',
    content: '고객 자산 보호를 위해 이상 거래 탐지 시스템이 업데이트되었습니다.\n\n주요 변경사항:\n• 비정상 대량 주문 자동 차단\n• IP 기반 접속 제한 강화\n• 출금 시 추가 인증 절차 도입',
  },
];

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  notice: { label: '공지', color: 'text-blue-400', bg: 'bg-blue-400/10' },
  event: { label: '이벤트', color: 'text-exchange-yellow', bg: 'bg-exchange-yellow/10' },
  maintenance: { label: '점검', color: 'text-exchange-sell', bg: 'bg-exchange-sell/10' },
  listing: { label: '상장', color: 'text-exchange-buy', bg: 'bg-exchange-buy/10' },
};

export default function NoticePage() {
  const { t } = useI18n();
  const [selectedNotice, setSelectedNotice] = useState<Notice | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all' ? NOTICES : NOTICES.filter(n => n.type === filter);

  const filters = [
    { key: 'all', label: '전체' },
    { key: 'notice', label: '공지' },
    { key: 'event', label: '이벤트' },
    { key: 'listing', label: '상장' },
    { key: 'maintenance', label: '점검' },
  ];

  return (
    <div className="max-w-4xl mx-auto p-4 pb-20">
      <div className="flex items-center gap-2 mb-6">
        <Bell size={22} className="text-exchange-yellow" />
        <h1 className="text-2xl font-bold">{t('footer.notice')}</h1>
      </div>

      {/* Filters */}
      <div className="flex gap-1 mb-6 overflow-x-auto">
        {filters.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setFilter(key); setSelectedNotice(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              filter === key ? 'bg-exchange-yellow text-black' : 'bg-exchange-card text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Notice Detail */}
      {selectedNotice ? (
        <div className="card p-6">
          <button onClick={() => setSelectedNotice(null)} className="text-sm text-exchange-yellow mb-4 hover:underline">&larr; 목록으로</button>
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs px-2 py-0.5 rounded ${TYPE_CONFIG[selectedNotice.type].bg} ${TYPE_CONFIG[selectedNotice.type].color}`}>
              {TYPE_CONFIG[selectedNotice.type].label}
            </span>
            <span className="text-xs text-exchange-text-third">{selectedNotice.date}</span>
          </div>
          <h2 className="text-lg font-bold mb-4">{selectedNotice.title}</h2>
          <div className="text-sm text-exchange-text-secondary leading-relaxed whitespace-pre-line border-t border-exchange-border pt-4">
            {selectedNotice.content}
          </div>
        </div>
      ) : (
        /* Notice List */
        <div className="card overflow-hidden">
          {filtered.map((notice) => {
            const cfg = TYPE_CONFIG[notice.type];
            return (
              <button
                key={notice.id}
                onClick={() => setSelectedNotice(notice)}
                className="w-full flex items-center justify-between px-4 py-4 border-b border-exchange-border/50 hover:bg-exchange-hover/30 transition-colors text-left group"
              >
                <div className="flex items-start gap-3 min-w-0">
                  {notice.pinned && <Pin size={12} className="text-exchange-yellow shrink-0 mt-1" />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color} shrink-0`}>{cfg.label}</span>
                      <span className="text-sm font-medium text-exchange-text truncate group-hover:text-exchange-yellow transition-colors">
                        {notice.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-exchange-text-third">
                      <Calendar size={10} />
                      {notice.date}
                    </div>
                  </div>
                </div>
                <ChevronRight size={16} className="text-exchange-text-third shrink-0 group-hover:text-exchange-yellow transition-colors" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
