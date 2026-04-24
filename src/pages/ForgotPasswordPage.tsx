import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { useI18n } from '../i18n';
import AuthLayout from '../components/common/AuthLayout';

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [devUrl, setDevUrl] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!emailValid) return setError(t('auth.invalidEmail') || 'Invalid email');
    setLoading(true);
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setSent(true);
      if (res.data?.dev_url) setDevUrl(res.data.dev_url);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout variant="recover">
      <h1 className="text-2xl lg:text-3xl font-bold mb-2">
        {t('auth.forgotTitle')}
      </h1>
      <p className="text-sm text-exchange-text-secondary mb-6">
        {t('auth.forgotDesc')}
      </p>

      {sent ? (
        <div className="space-y-4">
          <div className="bg-exchange-buy/10 border border-exchange-buy/30 text-exchange-buy rounded-lg px-4 py-3 text-sm flex gap-2">
            <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
            <span>{t('auth.resetEmailSent')}</span>
          </div>
          {devUrl && (
            <div className="bg-exchange-card border border-exchange-border rounded-lg p-3 text-xs break-all">
              <p className="text-exchange-text-third mb-1">
                DEV link (email provider not configured):
              </p>
              <a href={devUrl} className="text-exchange-yellow underline">
                {devUrl}
              </a>
            </div>
          )}
          <Link
            to="/login"
            className="block text-center text-sm text-exchange-yellow hover:underline"
          >
            {t('auth.backToLogin')}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="bg-exchange-sell/10 border border-exchange-sell/30 text-exchange-sell rounded-lg px-3 py-2.5 text-sm flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div>
            <label className="text-[13px] font-medium text-exchange-text-secondary mb-1.5 block">
              {t('auth.email')}
            </label>
            <div className="auth-field">
              <span className="auth-icon">
                <Mail size={18} />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim().toLowerCase())}
                placeholder={t('auth.emailPlaceholder')}
                required
                autoComplete="email"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={!emailValid || loading}
            className="w-full !py-3.5 text-sm font-semibold rounded-lg bg-exchange-yellow text-black hover:bg-[#d9a60a] disabled:bg-exchange-border disabled:text-exchange-text-third transition-colors"
          >
            {loading ? '…' : t('auth.sendResetLink')}
          </button>
          <p className="text-center text-sm text-exchange-text-secondary mt-4">
            <Link to="/login" className="text-exchange-yellow hover:underline">
              {t('auth.backToLogin')}
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
