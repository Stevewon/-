import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Globe, Check, ChevronDown, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { LANGUAGES, getLanguageOption } from '../../i18n/languages';

/**
 * Language selector (Bybit-style).
 * ─────────────────────────────────────────────────────────────────────────────
 * Lists the major-country languages from i18n/languages.ts (English default,
 * NO Korean). Korean is never offered here — Korean users rely on the
 * browser's own Google Translate. Selecting a language persists it via the
 * i18n store (localStorage) and applies immediately.
 *
 * Tapping the control opens a FULL-SCREEN BOTTOM-SHEET MODAL (rendered in a
 * portal on <body>, with a dimmed overlay and an OPAQUE background) so it can
 * never bleed through / be overlapped by content behind it.
 *
 * Two visual trigger variants:
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

  // Current selection; if the active lang is Korean (operator unlock) or an
  // unknown code, fall back to showing English in the selector.
  const current = getLanguageOption(lang) || getLanguageOption('en')!;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (code: string) => {
    setLang(code);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === 'compact'
            ? 'flex items-center gap-1 text-xs text-exchange-text-secondary hover:text-exchange-text transition-colors px-2 py-1 rounded hover:bg-exchange-hover'
            : 'w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-exchange-input hover:bg-exchange-hover transition-colors text-left'
        }
        aria-haspopup="dialog"
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

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex flex-col justify-end">
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-fade-in"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />

            <div
              role="dialog"
              aria-modal="true"
              className="relative w-full max-w-lg mx-auto bg-exchange-card border-t border-exchange-border rounded-t-2xl shadow-2xl flex flex-col max-h-[85vh] animate-sheet-up"
            >
              <div className="pt-3 pb-1 flex justify-center shrink-0">
                <span className="h-1 w-10 rounded-full bg-exchange-border" />
              </div>

              <div className="flex items-center justify-between px-5 pt-1 pb-3 shrink-0">
                <h3 className="text-base font-semibold text-exchange-text">
                  {current.englishName ? 'Language' : 'Language'}
                </h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1.5 -mr-1.5 rounded-lg text-exchange-text-third hover:text-exchange-text hover:bg-exchange-hover transition-colors"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
                        'w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-colors ' +
                        (active
                          ? 'bg-exchange-yellow/10'
                          : 'hover:bg-exchange-hover active:bg-exchange-hover')
                      }
                    >
                      <span className="text-xl leading-none shrink-0">{l.flag}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-exchange-text truncate">{l.label}</span>
                        <span className="block text-[11px] text-exchange-text-third truncate">
                          {l.englishName}
                        </span>
                      </span>
                      {active && <Check size={17} className="text-exchange-yellow shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
