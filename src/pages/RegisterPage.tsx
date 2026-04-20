import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Gift } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import QuantaLogo from '../components/common/QuantaLogo';
import LangSwitch from '../components/common/LangSwitch';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setAuth = useStore((s) => s.setAuth);
  const navigate = useNavigate();
  const { t } = useI18n();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPw) return setError(t('auth.passwordMismatch'));
    if (password.length < 6) return setError(t('auth.passwordTooShort'));

    setLoading(true);
    try {
      const res = await api.post('/auth/register', { email, password, nickname });
      setAuth(res.data.user, res.data.token);
      navigate('/trade/BTC-USDT');
    } catch (err: any) {
      setError(err.response?.data?.error || t('auth.registerFailed'));
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
            <h1 className="text-2xl font-bold text-exchange-text">{t('auth.createAccount')}</h1>
            <p className="text-exchange-text-secondary mt-1 text-sm">{t('auth.startTrading')}</p>
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
              <label className="text-sm text-exchange-text-secondary mb-1.5 block font-medium">{t('auth.nickname')}</label>
              <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)}
                className="input-field" placeholder={t('auth.nicknamePlaceholder')} required autoComplete="username" />
            </div>

            <div>
              <label className="text-sm text-exchange-text-secondary mb-1.5 block font-medium">{t('auth.password')}</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="input-field pr-10" placeholder="6자 이상" required autoComplete="new-password" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-exchange-text-third hover:text-exchange-text transition-colors">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm text-exchange-text-secondary mb-1.5 block font-medium">{t('auth.confirmPassword')}</label>
              <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                className="input-field" placeholder={t('auth.confirmPasswordPlaceholder')} required autoComplete="new-password" />
            </div>

            <button type="submit" disabled={loading}
              className="btn-primary w-full disabled:opacity-50 !py-3 text-sm font-semibold rounded-lg">
              {loading ? t('auth.creating') : t('auth.registerBtn')}
            </button>
          </form>

          <p className="text-center text-sm text-exchange-text-secondary mt-6">
            {t('auth.hasAccount')}{' '}
            <Link to="/login" className="text-exchange-yellow hover:underline font-medium">{t('nav.login')}</Link>
          </p>

          <div className="mt-4 p-3 bg-exchange-buy/5 border border-exchange-buy/20 rounded-lg flex items-start gap-2">
            <Gift size={16} className="text-exchange-buy mt-0.5 shrink-0" />
            <span className="text-xs text-exchange-buy leading-relaxed">{t('auth.registerBonus')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
