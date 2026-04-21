import { create } from 'zustand';
import ko from './ko';
import en from './en';

type Lang = 'ko' | 'en';
type TranslationKey = keyof typeof en;

const translations: Record<Lang, Record<string, string>> = { ko, en };

interface I18nStore {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const getSavedLang = (): Lang => {
  if (typeof window === 'undefined') return 'en';
  return (localStorage.getItem('quantaex_lang') as Lang) || 'en';
};

export const useI18n = create<I18nStore>((set, get) => ({
  lang: getSavedLang(),
  setLang: (lang: Lang) => {
    localStorage.setItem('quantaex_lang', lang);
    document.documentElement.lang = lang;
    set({ lang });
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
