import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, LogOut, RefreshCw, Volume2 } from 'lucide-react';
import useStore from '../store/useStore';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';

/**
 * /admin/deposits — MOBILE deposit monitor (owner order 2026-09-14):
 *   "모바일에서 간단히 테더 입금쪽만 확인할 수 있게. 로그인 상태면 띵동거리면서.
 *    다른 기능은 안 보여도 되니까."
 *
 * Standalone (no exchange header/footer), admin-only, one screen:
 *   • big "sound ON/OFF" tile — tap once to arm audio (browser gesture rule),
 *   • today's totals (count / USDT),
 *   • live list of credited on-chain deposits (who, how much, from, when),
 *   • polls every 10s; every NEW credited deposit → ding-dong + Korean voice
 *     "띵동, 테더가 입금되었습니다 [닉네임] [금액]" + toast + browser notification.
 * Keeps the screen awake (Wake Lock API) while armed so the phone can sit on
 * the desk and ring. Operator console → Korean voice/labels are intentional.
 */
const POLL_MS = 10_000;
const LS_KEY = 'qx_admin_deposit_bell';

function playDingDong(ctx: AudioContext) {
  const now = ctx.currentTime;
  const tone = (freq: number, at: number, dur: number, gain = 0.3) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + dur + 0.05);
  };
  tone(659.25, now, 0.7); tone(523.25, now + 0.45, 0.9);
}
function speak(text: string) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR'; u.rate = 1.0; u.pitch = 1.05;
    const ko = window.speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('ko'));
    if (ko) u.voice = ko;
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
const kst = (iso: string) => {
  const d = new Date(iso); if (isNaN(d.getTime())) return iso;
  const k = new Date(d.getTime() + 9 * 3600_000);
  return `${String(k.getUTCMonth() + 1).padStart(2, '0')}/${String(k.getUTCDate()).padStart(2, '0')} ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
};
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '-');

export default function AdminDepositsMobilePage() {
  const { user, logout } = useStore();
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState<boolean>(() => localStorage.getItem(LS_KEY) === 'on');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastPoll, setLastPoll] = useState<string>('');
  const [newCount, setNewCount] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const sinceRef = useRef<string>(new Date().toISOString());
  const seenRef = useRef<Set<string>>(new Set());
  const wakeRef = useRef<any>(null);

  useEffect(() => {
    if (!user) navigate('/admin/login', { replace: true });
    else if (user.role !== 'admin') navigate('/trade/QTA-USDT', { replace: true });
  }, [user, navigate]);

  const ensureAudio = async () => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctxRef.current.state === 'suspended') await ctxRef.current.resume();
    return ctxRef.current;
  };
  const arm = async () => {
    try {
      const ctx = await ensureAudio();
      playDingDong(ctx);
      speak('띵동, 입금 알림이 켜졌습니다');
      if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* */ } }
      try { if ('wakeLock' in navigator) wakeRef.current = await (navigator as any).wakeLock.request('screen'); } catch { /* */ }
      localStorage.setItem(LS_KEY, 'on'); setEnabled(true);
    } catch { /* ignore */ }
  };
  const disarm = () => {
    localStorage.setItem(LS_KEY, 'off'); setEnabled(false);
    try { wakeRef.current?.release?.(); } catch { /* */ }
  };
  // Re-acquire wake lock when returning to the tab.
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState === 'visible' && enabled) {
        try { if ('wakeLock' in navigator) wakeRef.current = await (navigator as any).wakeLock.request('screen'); } catch { /* */ }
        try { await ensureAudio(); } catch { /* */ }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled]);

  const loadList = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/ext-deposits?status=credited&limit=50');
      setRows(res.data?.rows || []);
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { loadList(); }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await api.get(`/admin/ext-deposits/recent?since=${encodeURIComponent(sinceRef.current)}`);
        const fresh: any[] = (res.data?.rows || []).filter((r: any) => !seenRef.current.has(r.id));
        if (res.data?.now) sinceRef.current = res.data.now;
        setLastPoll(new Date().toLocaleTimeString());
        for (const r of fresh) seenRef.current.add(r.id);
        if (fresh.length && !stop) {
          setNewCount(c => c + fresh.length);
          setRows(prev => [...fresh.slice().reverse(), ...prev].slice(0, 100));
          for (const r of fresh) {
            const coin = String(r.coin_symbol || 'USDT').toUpperCase();
            showToast('success', `+${r.amount} ${coin}`, `${r.nickname || '-'} · ${r.email || ''}`);
            if (enabled) {
              try { playDingDong(await ensureAudio()); } catch { /* */ }
              const label = coin === 'USDT' ? '테더' : coin;
              setTimeout(() => speak(`띵동, ${label}가 입금되었습니다. ${r.nickname || ''} ${Number(r.amount)} ${coin}`), 900);
              if ('vibrate' in navigator) { try { (navigator as any).vibrate([200, 100, 200]); } catch { /* */ } }
            }
            if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
              try { new Notification(`+${r.amount} ${coin} 입금`, { body: `${r.nickname || '-'} · ${r.email || ''}` }); } catch { /* */ }
            }
          }
        }
      } catch { /* silent */ }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, [enabled]);

  // Today's (KST) totals.
  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const todayRows = rows.filter(r => {
    const t = r.credited_at || r.created_at; if (!t) return false;
    return new Date(new Date(t).getTime() + 9 * 3600_000).toISOString().slice(0, 10) === todayKst;
  });
  const todayUsdt = todayRows.filter(r => String(r.coin_symbol).toUpperCase() === 'USDT').reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div className="min-h-screen bg-exchange-bg text-exchange-text flex flex-col">
      <header className="sticky top-0 z-20 bg-exchange-card/90 backdrop-blur border-b border-exchange-border px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-bold tracking-tight">QuantaEX · 입금 모니터</div>
          <div className="text-[10px] text-exchange-text-third">{user?.email} · poll {lastPoll || '…'}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadList} className="p-2 rounded-lg bg-exchange-hover text-exchange-text-secondary" aria-label="refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => { logout(); navigate('/admin/login', { replace: true }); }} className="p-2 rounded-lg bg-exchange-hover text-exchange-text-secondary" aria-label="logout">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 space-y-4 max-w-md w-full mx-auto">
        {/* Sound tile */}
        <button
          onClick={enabled ? disarm : arm}
          className={`w-full rounded-2xl p-5 flex items-center gap-4 border-2 text-left transition-colors ${
            enabled ? 'bg-exchange-buy/15 border-exchange-buy/50' : 'bg-exchange-sell/10 border-exchange-sell/50 animate-pulse'
          }`}
        >
          <div className={`p-3 rounded-full ${enabled ? 'bg-exchange-buy/25 text-exchange-buy' : 'bg-exchange-sell/20 text-exchange-sell'}`}>
            {enabled ? <Bell size={28} /> : <BellOff size={28} />}
          </div>
          <div className="flex-1">
            <div className="text-base font-bold">{enabled ? '띵동 알림 켜짐' : '탭해서 소리 켜기'}</div>
            <div className="text-[11px] text-exchange-text-secondary mt-0.5">
              {enabled ? '테더 입금 시 "띵동, 테더가 입금되었습니다" · 화면 꺼짐 방지 중' : '브라우저 정책상 한 번 눌러야 소리가 납니다'}
            </div>
          </div>
          {newCount > 0 && <span className="px-2.5 py-1 rounded-full bg-exchange-yellow text-black text-sm font-bold tabular-nums">{newCount}</span>}
        </button>
        {enabled && (
          <button onClick={async () => { try { playDingDong(await ensureAudio()); speak('띵동, 테더가 입금되었습니다. 테스트'); } catch { /* */ } }}
            className="w-full text-xs py-2 rounded-lg bg-exchange-hover text-exchange-text-secondary flex items-center justify-center gap-1.5">
            <Volume2 size={13} /> 소리 테스트
          </button>
        )}

        {/* Today totals */}
        <div className="grid grid-cols-2 gap-3">
          <div className="card p-4">
            <div className="text-[11px] text-exchange-text-third">오늘 입금 건수</div>
            <div className="text-2xl font-bold tabular-nums mt-1">{todayRows.length}</div>
          </div>
          <div className="card p-4">
            <div className="text-[11px] text-exchange-text-third">오늘 USDT 합계</div>
            <div className="text-2xl font-bold tabular-nums mt-1 text-exchange-buy">{todayUsdt.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          </div>
        </div>

        {/* List */}
        <div className="card divide-y divide-exchange-border/50">
          <div className="px-4 py-2 text-[11px] text-exchange-text-third flex justify-between">
            <span>최근 입금 (자동 반영)</span><span>KST</span>
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-exchange-text-third">입금 내역 없음</div>
          ) : rows.map(r => (
            <div key={r.id} className="px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{r.nickname || '-'}</div>
                <div className="text-[11px] text-exchange-text-third truncate">{r.email}</div>
                <div className="text-[10px] text-exchange-text-third font-mono mt-0.5">
                  from {short(r.from_address)} · <a className="underline" href={`https://bscscan.com/tx/${r.tx_hash}`} target="_blank" rel="noreferrer">tx {short(r.tx_hash)}</a>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-base font-bold tabular-nums text-exchange-buy">+{Number(r.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} <span className="text-xs">{r.coin_symbol}</span></div>
                <div className="text-[10px] text-exchange-text-third tabular-nums">{kst(r.credited_at || r.created_at)}</div>
                <div className="text-[9px] text-exchange-text-third uppercase">{r.network}{r.approved_by === 'auto' ? ' · auto' : ''}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center text-[10px] text-exchange-text-third pb-6">
          전체 관리자 화면: <a className="underline" href="/admin">/admin</a>
        </div>
      </main>
    </div>
  );
}
