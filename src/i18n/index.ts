import { create } from 'zustand';
import ko from './ko';
import en from './en';

type Lang = 'ko' | 'en';
type TranslationKey = keyof typeof en;

const translations: Record<Lang, Record<string, string>> = { ko, en };

interface I18nStore {
  lang: Lang;
  /**
   * Whether the Korean locale is exposed in user-facing UI (LangSwitch button,
   * settings menus). True only when the current session was opened with
   * `?lang=ko`, when localStorage already has a Korean preference, or when
   * the operator opted in via window.QUANTAEX_KO_UNLOCK = true.
   *
   * Sprint 5 Phase G2 (offshore-exchange compliance, option A):
   *   - Default users see English-only UI; Korean stays present in the bundle
   *     for operators / internal use but is not advertised.
   *   - The query parameter unlocks the LangSwitch widget for the current
   *     session and persists the choice in localStorage so refreshes don't
   *     bounce the operator back to English.
   */
  koUnlocked: boolean;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/**
 * Resolve the initial UI language without leaking Korean to default visitors
 * coming from blocked / restricted regions. Selection priority:
 *   1. URL query parameter `?lang=ko` or `?lang=en` (operator unlock)
 *   2. localStorage `quantaex_lang` (returning visitor / persisted unlock)
 *   3. Hard-coded English default — IMPORTANT: we DO NOT use
 *      navigator.language so Korean residents are not auto-served Korean,
 *      which would contradict the offshore-exchange policy.
 */
const getSavedLang = (): Lang => {
  if (typeof window === 'undefined') return 'en';

  try {
    const params = new URLSearchParams(window.location.search);
    const queryLang = params.get('lang');
    if (queryLang === 'ko' || queryLang === 'en') {
      // Persist immediately so the operator doesn't have to re-pass ?lang=ko
      // on every navigation. Wrapped in try because some sandboxed iframes
      // disable storage.
      try { localStorage.setItem('quantaex_lang', queryLang); } catch (_) { /* ignore */ }
      return queryLang;
    }
  } catch (_) { /* malformed URL — fall through */ }

  try {
    const saved = localStorage.getItem('quantaex_lang');
    if (saved === 'ko' || saved === 'en') return saved;
  } catch (_) { /* storage disabled — fall through */ }

  return 'en';
};

/**
 * The Korean LangSwitch widget is exposed only when one of the following is
 * true (kept in lock-step with getSavedLang above):
 *   - Current visit explicitly carries `?lang=ko` (operator unlocking)
 *   - localStorage already has 'quantaex_lang' = 'ko' (persisted unlock)
 *   - window.QUANTAEX_KO_UNLOCK === true (debug / e2e override)
 *
 * Sprint 5 Phase G2: hides the Korean toggle from default global users so
 * the SPA presents an English-only surface unless the operator deliberately
 * opted in.
 */
const detectKoUnlocked = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('lang') === 'ko') return true;
  } catch (_) { /* ignore */ }
  try {
    if (localStorage.getItem('quantaex_lang') === 'ko') return true;
  } catch (_) { /* ignore */ }
  if ((window as unknown as { QUANTAEX_KO_UNLOCK?: boolean }).QUANTAEX_KO_UNLOCK === true) return true;
  return false;
};

export const useI18n = create<I18nStore>((set, get) => ({
  lang: getSavedLang(),
  koUnlocked: detectKoUnlocked(),
  setLang: (lang: Lang) => {
    try { localStorage.setItem('quantaex_lang', lang); } catch (_) { /* ignore */ }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
    // Switching to Korean implicitly unlocks the toggle for the rest of the
    // session; switching to English keeps the toggle visible if it was
    // already unlocked, so the operator can flip back.
    set({ lang, koUnlocked: lang === 'ko' ? true : get().koUnlocked });
  },
  t: (key: string, params?: Record<string, string | number>) => {
    const { lang } = get();
    let text = translations[lang]?.[key] || translations['en']?.[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  },
}));

export type { Lang, TranslationKey };
