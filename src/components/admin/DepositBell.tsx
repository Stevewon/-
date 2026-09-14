import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import api from '../../utils/api';
import { showToast } from '../common/Toast';

/**
 * Admin DEPOSIT BELL — owner order 2026-09-14:
 *   "앞으로 테더 입금이 들어오면 어드민에서 소리나게 만들어! 띵똥, 테더가 입금되었습니다!"
 *
 * Polls /admin/ext-deposits/recent every 10s while the admin UI is open. For
 * every newly CREDITED on-chain deposit it:
 *   • plays a two-tone "ding-dong" chime (Web Audio, no asset file needed),
 *   • speaks "띵동, 테더가 입금되었습니다" via SpeechSynthesis (ko-KR) —
 *     this is the OPERATOR console, not a member screen, so the Korean
 *     announcement is intentional,
 *   • shows a toast with who / how much / from where,
 *   • sends a browser Notification if the tab is in the background.
 * Browsers block audio until the user interacts once, so the bell shows
 * "Click to enable sound" until the admin clicks it (state kept in
 * localStorage so it stays armed across reloads once allowed).
 */
const POLL_MS = 10_000;
const LS_KEY = 'qx_admin_deposit_bell';

function playDingDong(ctx: AudioContext) {
  const now = ctx.currentTime;
  const tone = (freq: number, at: number, dur: number, gain = 0.25) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + dur + 0.05);
  };
  // "Ding" (E5) then "Dong" (C5) — classic doorbell.
  tone(659.25, now, 0.7);
  tone(523.25, now + 0.45, 0.9);
}

function speak(text: string) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 1.0;
    u.pitch = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const ko = voices.find(v => v.lang?.toLowerCase().startsWith('ko'));
    if (ko) u.voice = ko;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

export default function DepositBell() {
  const [enabled, setEnabled] = useState<boolean>(() => localStorage.getItem(LS_KEY) === 'on');
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<any>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sinceRef = useRef<string>(new Date().toISOString());
  const seenRef = useRef<Set<string>>(new Set());

  const arm = async () => {
    try {
      if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      await ctxRef.current.resume();
      playDingDong(ctxRef.current);
      speak('띵동, 입금 알림이 켜졌습니다');
      if ('Notification' in window && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch { /* ignore */ }
      }
      localStorage.setItem(LS_KEY, 'on');
      setEnabled(true);
    } catch { /* ignore */ }
  };
  const disarm = () => { localStorage.setItem(LS_KEY, 'off'); setEnabled(false); };

  useEffect(() => {
    // If previously armed, try to resume the AudioContext silently on first
    // interaction anywhere in the page (browsers require a gesture).
    const resume = async () => {
      if (!enabled) return;
      try {
        if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (ctxRef.current.state === 'suspended') await ctxRef.current.resume();
      } catch { /* ignore */ }
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
  }, [enabled]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await api.get(`/admin/ext-deposits/recent?since=${encodeURIComponent(sinceRef.current)}`);
        const rows: any[] = res.data?.rows || [];
        if (res.data?.now) sinceRef.current = res.data.now;
        const fresh = rows.filter(r => !seenRef.current.has(r.id));
        for (const r of fresh) seenRef.current.add(r.id);
        if (fresh.length && !stop) {
          setCount(c => c + fresh.length);
          setLast(fresh[fresh.length - 1]);
          for (const r of fresh) {
            const coin = String(r.coin_symbol || 'USDT').toUpperCase();
            const who = `${r.nickname || '-'} (${r.email || r.user_id})`;
            showToast('success', `Deposit credited: +${r.amount} ${coin}`, `${who} · ${String(r.network || '').toUpperCase()} · from ${r.from_address ? String(r.from_address).slice(0, 10) + '…' : '?'}`);
            if (enabled) {
              try {
                if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                if (ctxRef.current.state === 'suspended') await ctxRef.current.resume();
                playDingDong(ctxRef.current);
              } catch { /* ignore */ }
              const label = coin === 'USDT' ? '테더' : coin;
              setTimeout(() => speak(`띵동, ${label}가 입금되었습니다. ${r.nickname || ''} ${Number(r.amount)} ${coin}`), 900);
            }
            if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
              try { new Notification(`+${r.amount} ${coin} deposited`, { body: who }); } catch { /* ignore */ }
            }
          }
        }
      } catch { /* silent */ }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, [enabled]);

  return (
    <button
      onClick={enabled ? disarm : arm}
      title={enabled ? 'Deposit sound ON — click to mute' : 'Click to enable deposit sound (띵동)'}
      className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] ${
        enabled ? 'bg-exchange-buy/15 text-exchange-buy border-exchange-buy/40' : 'bg-exchange-sell/10 text-exchange-sell border-exchange-sell/40 animate-pulse'
      }`}
    >
      {enabled ? <Bell size={13} /> : <BellOff size={13} />}
      <span className="hidden sm:inline">{enabled ? 'Deposit bell ON' : 'Enable deposit sound'}</span>
      {count > 0 && (
        <span className="ml-1 px-1.5 rounded-full bg-exchange-yellow text-black text-[10px] font-bold tabular-nums">{count}</span>
      )}
      {last && enabled && (
        <span className="hidden lg:inline text-[10px] text-exchange-text-third ml-1 tabular-nums">
          last: +{last.amount} {last.coin_symbol} {last.nickname || ''}
        </span>
      )}
    </button>
  );
}
