import { create } from 'zustand';
import ko from './ko';
import en from './en';
import ja from './ja';
import zh from './zh';
import zhTW from './zh-TW';
import { LANGUAGE_CODES, RTL_LANGS, isSelectableLang } from './languages';

/**
 * Supported language codes.
 *   - The full user-selectable set lives in ./languages.ts (English default,
 *     major-country languages, NO Korean).
 *   - Korean ('ko') still exists as an internal/operator locale, unlocked only
 *     via ?lang=ko / localStorage / window.QUANTAEX_KO_UNLOCK. It is NEVER
 *     shown in the language selector.
 */
type Lang = string;
type TranslationKey = keyof typeof en;

/**
 * Translation bundles. English and Korean have full bundles. Every other
 * selectable language currently maps to the English bundle as its base — the
 * `t()` lookup already falls back to English for any missing key, so adding a
 * partial bundle later (e.g. `ja`) will progressively localize without any
 * code change: just add `import ja from './ja'` and a `ja` entry here.
 */
const translations: Record<string, Record<string, string>> = {
  en,
  ko,
  // Major-country languages fall back to English until dedicated bundles are
  // added. They are listed so `t()` resolves and the selector works today.
  zh,
  'zh-TW': zhTW,
  ja,
  es: en,
  pt: en,
  fr: en,
  de: en,
  ru: en,
  tr: en,
  vi: en,
  id: en,
  th: en,
  ar: en,
};

interface I18nStore {
  lang: Lang;
  /**
   * Whether the Korean locale is exposed in user-facing UI. True only when the
   * session was opened with `?lang=ko`, localStorage already has a Korean
   * preference, or the operator opted in via window.QUANTAEX_KO_UNLOCK = true.
   * Korean is NEVER shown in the standard language selector regardless.
   */
  koUnlocked: boolean;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/**
 * Resolve the initial UI language. English is the hard default. We DO NOT use
 * navigator.language so Korean residents are not auto-served Korean (offshore
 * policy). Selection priority:
 *   1. URL query `?lang=<code>` (must be a selectable language, or `ko` for
 *      the operator unlock)
 *   2. localStorage `quantaex_lang`
 *   3. English default.
 */
const getSavedLang = (): Lang => {
  if (typeof window === 'undefined') return 'en';

  try {
    const params = new URLSearchParams(window.location.search);
    const queryLang = params.get('lang');
    if (queryLang && (isSelectableLang(queryLang) || queryLang === 'ko')) {
      try { localStorage.setItem('quantaex_lang', queryLang); } catch (_) { /* ignore */ }
      return queryLang;
    }
  } catch (_) { /* malformed URL — fall through */ }

  try {
    const saved = localStorage.getItem('quantaex_lang');
    if (saved && (isSelectableLang(saved) || saved === 'ko')) return saved;
  } catch (_) { /* storage disabled — fall through */ }

  return 'en';
};

/**
 * The Korean locale is "unlocked" (usable) only when explicitly requested by
 * an operator; it never appears in the selector. Kept in lock-step with
 * getSavedLang.
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

const applyDocumentLang = (lang: Lang) => {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr';
};

export const useI18n = create<I18nStore>((set, get) => ({
  lang: getSavedLang(),
  koUnlocked: detectKoUnlocked(),
  setLang: (lang: Lang) => {
    // Only accept a known bundle. Unknown codes fall back to English so a bad
    // value can never blank the UI.
    const next = translations[lang] ? lang : 'en';
    try { localStorage.setItem('quantaex_lang', next); } catch (_) { /* ignore */ }
    applyDocumentLang(next);
    set({ lang: next, koUnlocked: next === 'ko' ? true : get().koUnlocked });
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

// Apply the initial document lang/dir on module load (client only).
if (typeof window !== 'undefined') {
  applyDocumentLang(getSavedLang());
}

export { LANGUAGE_CODES };
export type { Lang, TranslationKey };
