import { Globe } from 'lucide-react';
import { useI18n } from '../../i18n';

/**
 * Sprint 5 Phase G2 (offshore-exchange compliance, option A):
 *   - The Korean toggle is hidden from default global visitors.
 *   - It is rendered only when the session was unlocked via `?lang=ko`
 *     query parameter, a persisted localStorage `quantaex_lang=ko`, or
 *     the debug flag `window.QUANTAEX_KO_UNLOCK = true`.
 *   - Default users therefore never see a Korean affordance, satisfying
 *     the "no Korean-language solicitation" stance for the Seychelles IBC
 *     + Marshall DAO LLC operating model.
 */
export default function LangSwitch() {
  const { lang, setLang, koUnlocked } = useI18n();

  // Hide the toggle entirely when the operator has not opted into Korean.
  // This keeps the bundle small in render output and removes the visible
  // Korean affordance from default global visitors.
  if (!koUnlocked) return null;

  return (
    <button
      onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
      className="flex items-center gap-1 text-xs text-exchange-text-secondary hover:text-exchange-text transition-colors px-2 py-1 rounded hover:bg-exchange-hover"
      title={lang === 'ko' ? 'Switch to English' : '한국어로 전환'}
    >
      <Globe size={14} />
      <span>{lang === 'ko' ? 'EN' : 'KO'}</span>
    </button>
  );
}
