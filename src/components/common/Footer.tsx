import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import QuantaLogo from './QuantaLogo';
import LangSwitch from './LangSwitch';

export default function Footer() {
  const { t } = useI18n();

  return (
    <footer className="bg-exchange-card border-t border-exchange-border mt-auto">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div>
            <QuantaLogo size={26} />
            <p className="text-xs text-exchange-text-third mt-3 leading-relaxed">
              {t('app.slogan')}
            </p>
          </div>

          {/* Services */}
          <div>
            <h4 className="text-sm font-semibold mb-3 text-exchange-text">{t('lang.ko') === '한국어' ? '서비스' : 'Services'}</h4>
            <div className="flex flex-col gap-2 text-sm text-exchange-text-secondary">
              <Link to="/trade/BTC-USDT" className="hover:text-exchange-text transition-colors">{t('nav.trade')}</Link>
              <Link to="/markets" className="hover:text-exchange-text transition-colors">{t('nav.markets')}</Link>
              <Link to="/fee" className="hover:text-exchange-text transition-colors">{t('footer.fee')}</Link>
            </div>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-sm font-semibold mb-3 text-exchange-text">{t('lang.ko') === '한국어' ? '지원' : 'Support'}</h4>
            <div className="flex flex-col gap-2 text-sm text-exchange-text-secondary">
              <Link to="/notice" className="hover:text-exchange-text transition-colors">{t('footer.notice')}</Link>
              <Link to="/support" className="hover:text-exchange-text transition-colors">{t('footer.support')}</Link>
            </div>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-semibold mb-3 text-exchange-text">{t('lang.ko') === '한국어' ? '법적 고지' : 'Legal'}</h4>
            <div className="flex flex-col gap-2 text-sm text-exchange-text-secondary">
              <Link to="/terms" className="hover:text-exchange-text transition-colors">{t('footer.terms')}</Link>
              <Link to="/privacy" className="hover:text-exchange-text transition-colors">{t('footer.privacy')}</Link>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-exchange-border pt-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-exchange-text-third">&copy; 2026 {t('footer.copyright')}</p>
          <div className="flex items-center gap-4">
            <LangSwitch />
          </div>
        </div>
      </div>
    </footer>
  );
}
