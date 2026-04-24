import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { useI18n } from '../i18n';
import AuthLayout from '../components/common/AuthLayout';

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const strong = pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
  const match = pw === pw2 && pw.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token) return setError(t('auth.resetInvalid'));
    if (!strong) return setError(t('auth.passwordTooShort'));
    if (!match) return setError(t('auth.passwordMismatch'));
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, new_password: pw });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: any) {
      setError(err.response?.data?.error || t('auth.resetInvalid'));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout variant="recover">
        <div className="bg-exchange-card border border-exchange-border rounded-xl p-6 text-center">
          <AlertCircle className="mx-auto text-exchange-sell mb-2" size={32} />
          <p className="text-sm text-exchange-text-secondary mb-4">
            {t('auth.resetInvalid')}
          </p>
          <Link
            to="/forgot-password"
            className="text-exchange-yellow hover:underline text-sm"
          >
            {t('auth.forgotTitle')}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout variant="recover">
      <h1 className="text-2xl lg:text-3xl font-bold mb-2">{t('auth.resetTitle')}</h1>
      <p className="text-sm text-exchange-text-secondary mb-6">
        {t('auth.resetDesc')}
      </p>

      {done ? (
            <div className="bg-exchange-buy/10 border border-exchange-buy/30 text-exchange-buy rounded-lg px-4 py-3 text-sm flex gap-2">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <span>{t('auth.resetSuccess')}</span>
            </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
              {error && (
                <div className="bg-exchange-sell/10 border border-exchange-sell/30 text-exchange-sell rounded-lg px-3 py-2.5 text-sm flex gap-2">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="text-[13px] font-medium text-exchange-text-secondary mb-1.5 block">
                  {t('auth.newPassword')}
                </label>
                <div className="auth-field">
                  <span className="auth-icon">
                    <Lock size={18} />
                  </span>
                  <input
                    type={show ? 'text' : 'password'}
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="auth-trailing"
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className={`mt-1.5 text-[11px] ${strong ? 'text-exchange-buy' : 'text-exchange-text-third'}`}>
                  {t('auth.passwordMin6').replace('6', '8')} · A–Z · 0–9
                </p>
              </div>

              <div>
                <label className="text-[13px] font-medium text-exchange-text-secondary mb-1.5 block">
                  {t('auth.confirmPassword')}
                </label>
                <div className="auth-field">
                  <span className="auth-icon">
                    <Lock size={18} />
                  </span>
                  <input
                    type={show ? 'text' : 'password'}
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
                {pw2 && !match && (
                  <p className="mt-1.5 text-[11px] text-exchange-sell">{t('auth.passwordMismatch')}</p>
                )}
              </div>

          <button
            type="submit"
            disabled={!strong || !match || loading}
            className="w-full !py-3.5 text-sm font-semibold rounded-lg bg-exchange-yellow text-black hover:bg-[#d9a60a] disabled:bg-exchange-border disabled:text-exchange-text-third transition-colors"
          >
            {loading ? '…' : t('auth.resetPwCta')}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
