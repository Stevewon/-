import { Globe } from 'lucide-react';
import { useI18n } from '../../i18n';

export default function LangSwitch() {
  const { lang, setLang, t } = useI18n();

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
