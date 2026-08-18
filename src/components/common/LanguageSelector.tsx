import { useState, useRef, useEffect } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { useI18n } from '../../i18n';
import { LANGUAGES, getLanguageOption } from '../../i18n/languages';

/**
 * Language selector (Bybit-style dropdown).
 * ─────────────────────────────────────────────────────────────────────────────
 * Lists the major-country languages from i18n/languages.ts (English default,
 * NO Korean). Korean is never offered here — Korean users rely on the
 * browser's own Google Translate. Selecting a language persists it via the
 * i18n store (localStorage) and applies immediately.
 *
 * Two visual variants:
 *   - variant="compact"  → small header pill with a globe icon + code
 *   - variant="full"     → full-width settings row with the current language
 */
export default function LanguageSelector({
  variant = 'compact',
}: {
  variant?: 'compact' | 'full';
}) {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Current selection; if the active lang is Korean (operator unlock) or an
  // unknown code, fall back to showing English in the selector.
  const current = getLanguageOption(lang) || getLanguageOption('en')!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (code: string) => {
    setLang(code);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          variant === 'compact'
            ? 'flex items-center gap-1 text-xs text-exchange-text-secondary hover:text-exchange-text transition-colors px-2 py-1 rounded hover:bg-exchange-hover'
            : 'w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-exchange-input hover:bg-exchange-hover transition-colors text-left'
        }
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {variant === 'compact' ? (
          <>
            <Globe size={14} />
            <span className="uppercase">{current.code === 'zh-TW' ? 'ZH-TW' : current.code}</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-2.5">
              <span className="text-lg leading-none">{current.flag}</span>
              <span className="text-exchange-text font-medium">{current.label}</span>
              <span className="text-exchange-text-third text-xs">{current.englishName}</span>
            </span>
            <ChevronDown size={18} className="text-exchange-text-third" />
          </>
        )}
      </button>

      {open && (
        <div
          className={
            'absolute z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-exchange-border bg-exchange-panel shadow-xl ' +
            (variant === 'compact' ? 'right-0 w-56' : 'left-0 right-0')
          }
          role="listbox"
        >
          {LANGUAGES.map((l) => {
            const active = l.code === current.code;
            return (
              <button
                key={l.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => choose(l.code)}
                className={
                  'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-exchange-hover ' +
                  (active ? 'bg-exchange-hover' : '')
                }
              >
                <span className="text-lg leading-none">{l.flag}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-exchange-text truncate">{l.label}</span>
                  <span className="block text-[11px] text-exchange-text-third truncate">{l.englishName}</span>
                </span>
                {active && <Check size={16} className="text-exchange-buy shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
