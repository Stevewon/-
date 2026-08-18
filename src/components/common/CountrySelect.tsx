import { useState, useRef, useEffect, useMemo } from 'react';
import { MapPin, Check, ChevronDown, Search } from 'lucide-react';
import { useI18n } from '../../i18n';
import { COUNTRIES, getCountryOption } from '../../i18n/countries';

/**
 * Country / region selector for the "Where do you live?" signup step
 * (Bybit-style). Self-declaration of residency; does NOT change the UI
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
  const ref = useRef<HTMLDivElement>(null);

  const selected = value ? getCountryOption(value) : undefined;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl bg-exchange-input border border-exchange-border hover:border-exchange-yellow/50 transition-colors text-left"
        aria-haspopup="listbox"
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

      {open && (
        <div
          className="absolute z-50 mt-2 left-0 right-0 rounded-xl border border-exchange-border bg-exchange-panel shadow-xl overflow-hidden"
          role="listbox"
        >
          <div className="p-2 border-b border-exchange-border">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-exchange-input">
              <Search size={16} className="text-exchange-text-third shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('country.search')}
                className="flex-1 bg-transparent outline-none text-sm text-exchange-text placeholder:text-exchange-text-third"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-exchange-text-third">—</div>
            )}
            {filtered.map((c) => {
              const active = selected?.code === c.code;
              return (
                <button
                  key={c.code}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(c.code);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={
                    'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-exchange-hover ' +
                    (active ? 'bg-exchange-hover' : '')
                  }
                >
                  <span className="text-lg leading-none">{c.flag}</span>
                  <span className="flex-1 text-sm text-exchange-text truncate">{c.name}</span>
                  {active && <Check size={16} className="text-exchange-buy shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
