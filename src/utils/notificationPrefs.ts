/**
 * Notification preferences (persisted in localStorage).
 * - soundEnabled: play sound on new notification
 * - desktopEnabled: show browser Notification API popups (requires permission)
 * - typeFilters: per-type toggle (trade, deposit, withdraw, system, price)
 */

export interface NotifPrefs {
  soundEnabled: boolean;
  desktopEnabled: boolean;
  typeFilters: {
    order_filled: boolean;
    deposit: boolean;
    withdraw: boolean;
    system: boolean;
    price: boolean;
  };
}

const STORAGE_KEY = 'qta_notif_prefs_v1';

const defaultPrefs: NotifPrefs = {
  soundEnabled: true,
  desktopEnabled: false,
  typeFilters: {
    order_filled: true,
    deposit: true,
    withdraw: true,
    system: true,
    price: true,
  },
};

export function loadPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPrefs;
    const parsed = JSON.parse(raw);
    return { ...defaultPrefs, ...parsed, typeFilters: { ...defaultPrefs.typeFilters, ...(parsed.typeFilters || {}) } };
  } catch {
    return defaultPrefs;
  }
}

export function savePrefs(prefs: NotifPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

/**
 * Play a short WebAudio "ding" without needing external assets.
 * Uses OscillatorNode so bundle size stays tiny.
 */
let audioCtx: AudioContext | null = null;
export function playNotificationSound(type: string = 'default') {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtx;
    // resume if suspended (autoplay policy)
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

    // Pick two notes based on type for variety
    const notes: Record<string, [number, number]> = {
      order_filled: [880, 1320],  // A5 → E6 (exciting)
      deposit: [659, 988],        // E5 → B5 (pleasant)
      withdraw: [523, 440],       // C5 → A4 (slight down)
      price: [1047, 1319],        // C6 → E6 (bright)
      system: [587, 784],         // D5 → G5 (neutral)
      default: [659, 880],
    };
    const [f1, f2] = notes[type] || notes.default;

    [f1, f2].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.12);
      osc.connect(gain);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.2);
    });
  } catch { /* audio not supported */ }
}

/**
 * Request desktop notification permission and show a desktop notification.
 */
export async function requestDesktopPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

export function showDesktopNotification(title: string, body?: string, icon?: string) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    const n = new Notification(title, {
      body,
      icon: icon || '/favicon.ico',
      tag: 'quantaex-notif',
    });
    // Auto close after 5s
    setTimeout(() => { try { n.close(); } catch { /* ignore */ } }, 5000);
    n.onclick = () => {
      window.focus();
      window.location.href = '/notifications';
      n.close();
    };
  } catch { /* ignore */ }
}
