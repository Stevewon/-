import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Check, ChevronDown, Search, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { COUNTRIES, getCountryOption } from '../../i18n/countries';

/**
 * Country / region selector for the "Where do you live?" signup step.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bybit-style: tapping the field opens a FULL-SCREEN BOTTOM-SHEET MODAL that
 * slides up from the bottom with a dimmed overlay and an OPAQUE background
 * (rendered in a portal on <body> so it can never bleed through / be overlapped
 * by the form behind it). Self-declaration of residency; does NOT change the UI
 * language. Emits the ISO alpha-2 code via onChange.
 */
export default function CountrySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value ? getCountryOption(value) : undefined;

  // Lock body scroll + focus search while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const pick = (code: string) => {
    onChange(code);
    close();
  };

  return (
    <>
      {/* Trigger field */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl bg-exchange-input border border-exchange-border hover:border-exchange-yellow/50 transition-colors text-left"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {selected ? (
            <>
              <span className="text-lg leading-none">{selected.flag}</span>
              <span className="text-exchange-text font-medium truncate">{selected.name}</span>
            </>
          ) : (
            <>
              <MapPin size={18} className="text-exchange-text-third" />
              <span className="text-exchange-text-third truncate">{t('country.placeholder')}</span>
            </>
          )}
        </span>
        <ChevronDown size={18} className="text-exchange-text-third shrink-0" />
      </button>

      {/* Bottom-sheet modal (portal → body, so nothing behind can overlap it) */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex flex-col justify-end">
            {/* Dim overlay — tap to close */}
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-fade-in"
              onClick={close}
              aria-hidden="true"
            />

            {/* Sheet */}
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t('country.title')}
              className="relative w-full max-w-lg mx-auto bg-exchange-card border-t border-exchange-border rounded-t-2xl shadow-2xl flex flex-col max-h-[85vh] animate-sheet-up"
            >
              {/* Drag handle */}
              <div className="pt-3 pb-1 flex justify-center shrink-0">
                <span className="h-1 w-10 rounded-full bg-exchange-border" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-1 pb-3 shrink-0">
                <h3 className="text-base font-semibold text-exchange-text">{t('country.title')}</h3>
                <button
                  type="button"
                  onClick={close}
                  className="p-1.5 -mr-1.5 rounded-lg text-exchange-text-third hover:text-exchange-text hover:bg-exchange-hover transition-colors"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Search */}
              <div className="px-5 pb-3 shrink-0">
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-exchange-input border border-exchange-border focus-within:border-exchange-yellow/60 transition-colors">
                  <Search size={16} className="text-exchange-text-third shrink-0" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('country.search')}
                    className="flex-1 bg-transparent outline-none text-sm text-exchange-text placeholder:text-exchange-text-third"
                  />
                </div>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {filtered.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-exchange-text-third">—</div>
                )}
                {filtered.map((c) => {
                  const active = selected?.code === c.code;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => pick(c.code)}
                      className={
                        'w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-colors ' +
                        (active
                          ? 'bg-exchange-yellow/10'
                          : 'hover:bg-exchange-hover active:bg-exchange-hover')
                      }
                    >
                      <span className="text-xl leading-none shrink-0">{c.flag}</span>
                      <span className="flex-1 text-sm text-exchange-text truncate">{c.name}</span>
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
