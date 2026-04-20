import { useState } from 'react';
import { Bell, ChevronRight, Pin, Calendar, Tag, ArrowLeft, Search } from 'lucide-react';
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
    id: 1, type: 'notice', title: 'QuantaEX 거래소 그랜드 오픈 안내', date: '2026-04-20', pinned: true,
    content: 'QuantaEX 거래소가 정식 오픈되었습니다. BTC, ETH, QTA 등 13종의 암호화폐를 USDT 및 KRW 마켓에서 거래하실 수 있습니다. 회원가입 시 10,000 USDT + 10,000,000 KRW 보너스가 지급됩니다. 많은 이용 부탁드립니다.',
  },
  {
    id: 2, type: 'listing', title: '[신규 상장] QTA (Quanta Token) 상장 안내', date: '2026-04-20', pinned: true,
    content: 'QTA (Quanta Token)이 QuantaEX 거래소에 신규 상장되었습니다.\n\n■ 상장일시: 2026년 4월 20일 (일) 00:00 (KST)\n■ 거래쌍: QTA/USDT, QTA/KRW\n■ 입출금: 즉시 가능\n\n상장 기념 이벤트로 QTA 거래 수수료 50% 할인이 진행됩니다.',
  },
  {
    id: 3, type: 'event', title: '[이벤트] 회원가입 보너스 지급 이벤트', date: '2026-04-20',
    content: '신규 회원가입 시 다음 보너스를 지급합니다:\n\n• 10,000 USDT\n• 10,000,000 KRW\n• 0.1 BTC\n• 2 ETH\n• 1,000 QTA\n\n이벤트 기간: 2026년 4월 20일 ~ 별도 공지 시까지',
  },
  {
    id: 4, type: 'notice', title: 'KYC 인증 절차 안내', date: '2026-04-19',
    content: '원활한 거래를 위해 KYC 인증을 완료해 주시기 바랍니다.\n\n■ 인증 방법: 마이페이지 > 보안설정 > KYC 인증\n■ 필요 서류: 성명, 연락처, 신분증 번호\n■ 처리 기간: 신청 후 최대 24시간 이내\n\nKYC 미인증 시 출금이 제한될 수 있습니다.',
  },
  {
    id: 5, type: 'maintenance', title: '[점검 완료] 서버 정기 점검 안내', date: '2026-04-18',
    content: '서버 정기 점검이 완료되었습니다.\n\n■ 점검일시: 2026년 4월 18일 02:00 ~ 04:00 (KST)\n■ 영향 범위: 전 서비스 일시 중단\n■ 현재 상태: 정상 운영 중\n\n이용에 불편을 드려 죄송합니다.',
  },
  {
    id: 6, type: 'notice', title: '이상 거래 탐지 시스템 업데이트 안내', date: '2026-04-17',
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
  const [search, setSearch] = useState('');

  const filtered = NOTICES
    .filter(n => filter === 'all' || n.type === filter)
    .filter(n => !search || n.title.toLowerCase().includes(search.toLowerCase()));

  const filters = [
    { key: 'all', label: '전체', count: NOTICES.length },
    { key: 'notice', label: '공지', count: NOTICES.filter(n => n.type === 'notice').length },
    { key: 'event', label: '이벤트', count: NOTICES.filter(n => n.type === 'event').length },
    { key: 'listing', label: '상장', count: NOTICES.filter(n => n.type === 'listing').length },
    { key: 'maintenance', label: '점검', count: NOTICES.filter(n => n.type === 'maintenance').length },
  ];

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="border-b border-exchange-border bg-exchange-card/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-exchange-yellow/10 flex items-center justify-center">
              <Bell size={20} className="text-exchange-yellow" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('footer.notice')}</h1>
              <p className="text-sm text-exchange-text-secondary mt-0.5">QuantaEX 주요 공지사항 및 업데이트</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24">
        {/* Filters + Search */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex gap-1.5 overflow-x-auto pb-1 w-full sm:w-auto">
            {filters.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => { setFilter(key); setSelectedNotice(null); }}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200 ${
                  filter === key
                    ? 'bg-exchange-yellow text-black shadow-lg shadow-exchange-yellow/20'
                    : 'bg-exchange-card text-exchange-text-secondary hover:text-exchange-text border border-exchange-border'
                }`}
              >
                {label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  filter === key ? 'bg-black/20' : 'bg-exchange-hover/60'
                }`}>{count}</span>
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-exchange-text-third" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="공지사항 검색..."
              className="input-field pl-9 text-sm !py-2.5"
            />
          </div>
        </div>

        {/* Notice Detail */}
        {selectedNotice ? (
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-exchange-border bg-exchange-hover/20">
              <button
                onClick={() => setSelectedNotice(null)}
                className="flex items-center gap-1.5 text-sm text-exchange-yellow hover:underline mb-4"
              >
                <ArrowLeft size={14} />
                목록으로 돌아가기
              </button>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs font-medium px-2.5 py-1 rounded-lg ${TYPE_CONFIG[selectedNotice.type].bg} ${TYPE_CONFIG[selectedNotice.type].color}`}>
                  {TYPE_CONFIG[selectedNotice.type].label}
                </span>
                {selectedNotice.pinned && (
                  <span className="text-xs font-medium px-2 py-1 rounded-lg bg-exchange-yellow/10 text-exchange-yellow flex items-center gap-1">
                    <Pin size={10} /> 고정
                  </span>
                )}
              </div>
              <h2 className="text-xl font-bold mb-2">{selectedNotice.title}</h2>
              <div className="flex items-center gap-1.5 text-xs text-exchange-text-third">
                <Calendar size={12} />
                {selectedNotice.date}
              </div>
            </div>
            <div className="p-6">
              <div className="text-sm text-exchange-text-secondary leading-[1.8] whitespace-pre-line">
                {selectedNotice.content}
              </div>
            </div>
          </div>
        ) : (
          /* Notice List */
          <div className="card overflow-hidden divide-y divide-exchange-border/40">
            {filtered.length === 0 ? (
              <div className="p-12 text-center text-exchange-text-third">
                <Bell size={32} className="mx-auto mb-3 opacity-30" />
                <p>검색 결과가 없습니다.</p>
              </div>
            ) : (
              filtered.map((notice) => {
                const cfg = TYPE_CONFIG[notice.type];
                return (
                  <button
                    key={notice.id}
                    onClick={() => setSelectedNotice(notice)}
                    className="w-full flex items-center justify-between px-5 sm:px-6 py-5 hover:bg-exchange-hover/20 transition-colors text-left group"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {notice.pinned && (
                        <div className="mt-1 shrink-0">
                          <Pin size={14} className="text-exchange-yellow" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${cfg.bg} ${cfg.color} shrink-0`}>
                            {cfg.label}
                          </span>
                          <span className="text-sm sm:text-base font-medium text-exchange-text truncate group-hover:text-exchange-yellow transition-colors">
                            {notice.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-exchange-text-third">
                          <Calendar size={10} />
                          {notice.date}
                          <span className="ml-2 text-exchange-text-third/50 hidden sm:inline">
                            {notice.content.substring(0, 60)}...
                          </span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-exchange-text-third shrink-0 group-hover:text-exchange-yellow transition-colors ml-3" />
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
