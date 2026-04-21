import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';
import { useI18n } from '../i18n';

export default function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-extrabold text-exchange-yellow/20 mb-4 tabular-nums">404</div>
        <h1 className="text-2xl font-bold mb-2">{t('error.notFound')}</h1>
        <p className="text-sm text-exchange-text-secondary mb-8">{t('error.notFoundDesc')}</p>
        <div className="flex gap-3 justify-center">
          <Link to="/trade/BTC-USDT" className="btn-primary !py-2.5 !px-6 text-sm rounded-lg flex items-center gap-2">
            <Home size={16} /> {t('nav.trade')}
          </Link>
          <button onClick={() => window.history.back()} className="bg-exchange-card border border-exchange-border text-exchange-text !py-2.5 !px-6 text-sm rounded-lg flex items-center gap-2 hover:bg-exchange-hover transition-colors">
            <ArrowLeft size={16} /> {t('error.goBack')}
          </button>
        </div>
      </div>
    </div>
  );
}
