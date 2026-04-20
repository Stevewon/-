import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import QuantaLogo from '../components/common/QuantaLogo';
import LangSwitch from '../components/common/LangSwitch';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setAuth = useStore((s) => s.setAuth);
  const navigate = useNavigate();
  const { t } = useI18n();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      setAuth(res.data.user, res.data.token);
      navigate('/trade/BTC-USDT');
    } catch (err: any) {
      setError(err.response?.data?.error || t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-exchange-bg flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <Link to="/">
          <QuantaLogo size={28} />
        </Link>
        <LangSwitch />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-12">
        <div className="card p-8 w-full max-w-md border border-exchange-border/60">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-exchange-text">{t('auth.welcome')}</h1>
            <p className="text-exchange-text-secondary mt-1 text-sm">{t('auth.loginTo')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-exchange-sell/10 border border-exchange-sell/30 text-exchange-sell rounded-lg px-3 py-2 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="text-sm text-exchange-text-secondary mb-1.5 block font-medium">{t('auth.email')}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="input-field" placeholder={t('auth.emailPlaceholder')} required autoComplete="email" />
            </div>

            <div>
              <label className="text-sm text-exchange-text-secondary mb-1.5 block font-medium">{t('auth.password')}</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="input-field pr-10" placeholder={t('auth.passwordPlaceholder')} required autoComplete="current-password" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-exchange-text-third hover:text-exchange-text transition-colors">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="btn-primary w-full disabled:opacity-50 !py-3 text-sm font-semibold rounded-lg">
              {loading ? t('auth.loggingIn') : t('auth.loginBtn')}
            </button>
          </form>

          <p className="text-center text-sm text-exchange-text-secondary mt-6">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="text-exchange-yellow hover:underline font-medium">{t('nav.register')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
