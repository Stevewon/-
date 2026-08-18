import LanguageSelector from './LanguageSelector';

/**
 * Header/footer language switcher.
 * ─────────────────────────────────────────────────────────────────────────────
 * Previously this was a KO⇄EN toggle that was hidden unless Korean was
 * unlocked. It now renders the full multi-language selector (English default,
 * major-country languages, NO Korean — Korean users rely on the browser's own
 * Google Translate). Kept as a thin wrapper so every existing call site
 * (Footer, AuthLayout, Layout, HomePage) picks up the new selector without
 * changes.
 */
export default function LangSwitch() {
  return <LanguageSelector variant="compact" />;
}
