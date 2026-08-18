/**
 * Selectable UI languages (Bybit-style).
 * ─────────────────────────────────────────────────────────────────────────────
 * English is the default and always first. Major-country languages follow.
 *
 * IMPORTANT (owner directive, 2026-08-18):
 *   - Korean ('ko') is intentionally NOT in this list. It must NOT appear in
 *     any user-facing language selector or settings menu. Korean users who
 *     want their own language rely on the browser's own Google Translate,
 *     which is outside our UI. The Korean string bundle still ships for
 *     internal/operator use (unlocked only via ?lang=ko), but is never
 *     advertised.
 *
 * Each language may provide a partial translation bundle; any missing key
 * falls back to English automatically (see i18n/index.ts `t()`).
 */

export interface LanguageOption {
  /** BCP-47 / ISO-639-1 code used as the store key. */
  code: string;
  /** Endonym (name in its own language) — shown in the selector. */
  label: string;
  /** English name — shown as a secondary hint. */
  englishName: string;
  /** Small flag emoji for a quick visual cue. */
  flag: string;
}

/**
 * The selectable languages, English first. This mirrors the major-market
 * language set used by global exchanges (Bybit / Binance) minus Korean.
 */
export const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English',            englishName: 'English',              flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'zh', label: '\u7B80\u4F53\u4E2D\u6587', englishName: 'Chinese (Simplified)', flag: '\u{1F1E8}\u{1F1F3}' },
  { code: 'zh-TW', label: '\u7E41\u9AD4\u4E2D\u6587', englishName: 'Chinese (Traditional)', flag: '\u{1F1ED}\u{1F1F0}' },
  { code: 'ja', label: '\u65E5\u672C\u8A9E',       englishName: 'Japanese',             flag: '\u{1F1EF}\u{1F1F5}' },
  { code: 'es', label: 'Espa\u00F1ol',            englishName: 'Spanish',              flag: '\u{1F1EA}\u{1F1F8}' },
  { code: 'pt', label: 'Portugu\u00EAs',          englishName: 'Portuguese',           flag: '\u{1F1E7}\u{1F1F7}' },
  { code: 'fr', label: 'Fran\u00E7ais',           englishName: 'French',               flag: '\u{1F1EB}\u{1F1F7}' },
  { code: 'de', label: 'Deutsch',            englishName: 'German',               flag: '\u{1F1E9}\u{1F1EA}' },
  { code: 'ru', label: '\u0420\u0443\u0441\u0441\u043A\u0438\u0439', englishName: 'Russian', flag: '\u{1F1F7}\u{1F1FA}' },
  { code: 'tr', label: 'T\u00FCrk\u00E7e',        englishName: 'Turkish',              flag: '\u{1F1F9}\u{1F1F7}' },
  { code: 'vi', label: 'Ti\u1EBFng Vi\u1EC7t',    englishName: 'Vietnamese',           flag: '\u{1F1FB}\u{1F1F3}' },
  { code: 'id', label: 'Bahasa Indonesia',   englishName: 'Indonesian',           flag: '\u{1F1EE}\u{1F1E9}' },
  { code: 'th', label: '\u0E44\u0E17\u0E22',       englishName: 'Thai',                 flag: '\u{1F1F9}\u{1F1ED}' },
  { code: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064A\u0629', englishName: 'Arabic', flag: '\u{1F1F8}\u{1F1E6}' },
];

/** Codes that render right-to-left. */
export const RTL_LANGS = new Set(['ar']);

/** All selectable language codes (Korean intentionally excluded). */
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

export function isSelectableLang(code: string): boolean {
  return LANGUAGE_CODES.includes(code);
}

export function getLanguageOption(code: string): LanguageOption | undefined {
  return LANGUAGES.find((l) => l.code === code);
}
