import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, AlertCircle } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import AuthLayout from '../components/common/AuthLayout';

// ============================================================================
// Binance / Upbit-inspired login page
// - PC: 2-column split (hero left, form right) via <AuthLayout>
// - Mobile: single column, sticky bottom CTA
// - Email / Phone tab, social placeholders, Caps-Lock warning, remember-me
// - 2FA challenge step when server returns {requires_2fa: true}
// ============================================================================
export default function LoginPage() {
  const { t } = useI18n();
  const setAuth = useStore((s) => s.setAuth);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/trade/BTC-USDT';

  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState(
    () => localStorage.getItem('quantaex_last_email') || ''
  );
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [capsOn, setCapsOn] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [, setFocused] = useState<string>('');

  const [needs2fa, setNeeds2fa] = useState(false);
  const [totp, setTotp] = useState('');

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSubmit =
    emailValid &&
    password.length >= 1 &&
    !loading &&
    (!needs2fa || totp.length === 6);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'phone') return setError(t('auth.phoneComingSoon'));
    if (!emailValid) return setError(t('auth.invalidEmail'));
    if (!password) return setError(t('auth.enterPassword'));
    if (needs2fa && !/^\d{6}$/.test(totp))
      return setError(t('auth.totpDigits') || 'Enter 6-digit code');

    setLoading(true);
    try {
      const payload: any = { email, password };
      if (needs2fa) payload.totp_code = totp;
      const res = await api.post('/auth/login', payload);
      setAuth(res.data.user, res.data.token);
      if (remember) localStorage.setItem('quantaex_last_email', email);
      else localStorage.removeItem('quantaex_last_email');
      navigate(redirect);
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.requires_2fa) {
        setNeeds2fa(true);
        setTotp('');
        setError('');
      } else {
        setError(data?.error || t('auth.loginFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const onPwKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const caps =
      typeof (e as any).getModifierState === 'function' &&
      (e as any).getModifierState('CapsLock');
    setCapsOn(!!caps);
  };

  return (
    <AuthLayout variant="login">
      {/* Headline */}
      <div className="mb-7">
        <h1 className="text-2xl lg:text-3xl font-bold text-exchange-text leading-tight">
          {t('auth.welcome')}
        </h1>
        <p className="text-exchange-text-secondary mt-2 text-sm">
          {t('auth.loginTo')}
        </p>
      </div>

      {/* Email / Phone tab */}
      <div className="mb-5 flex items-center gap-0 rounded-lg bg-exchange-card p-1 border border-exchange-border/60">
        <button
          type="button"
          onClick={() => setMode('email')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            mode === 'email'
              ? 'bg-exchange-bg text-exchange-text shadow-sm'
              : 'text-exchange-text-secondary hover:text-exchange-text'
          }`}
        >
          {t('auth.tabEmail')}
        </button>
        <button
          type="button"
          onClick={() => setMode('phone')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors relative ${
            mode === 'phone'
              ? 'bg-exchange-bg text-exchange-text shadow-sm'
              : 'text-exchange-text-secondary hover:text-exchange-text'
          }`}
        >
          {t('auth.tabPhone')}
          <span className="absolute -top-1 -right-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-exchange-text-third/30 text-exchange-text-secondary">
            {t('auth.soon')}
          </span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <div className="bg-exchange-sell/10 border border-exchange-sell/30 text-exchange-sell rounded-lg px-3 py-2.5 text-sm flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Email */}
        <div>
          <label className="text-[13px] font-medium text-exchange-text-secondary mb-1.5 block">
            {t('auth.email')}
          </label>
          <div className="relative">
            <Mail
              size={18}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-exchange-text-third pointer-events-none"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused('')}
              className="auth-input pl-10"
              placeholder={t('auth.emailPlaceholder')}
              required
              autoComplete="email"
              inputMode="email"
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[13px] font-medium text-exchange-text-secondary">
              {t('auth.password')}
            </label>
            <Link
              to="/forgot-password"
              className="text-[12px] text-exchange-yellow hover:underline"
            >
              {t('auth.forgotPw')}
            </Link>
          </div>
          <div className="relative">
            <Lock
              size={18}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-exchange-text-third pointer-events-none"
            />
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onPwKey}
              onKeyUp={onPwKey}
              onFocus={() => setFocused('pw')}
              onBlur={() => {
                setFocused('');
                setCapsOn(false);
              }}
              className="auth-input pl-10 pr-11"
              placeholder={t('auth.passwordPlaceholder')}
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-exchange-text-third hover:text-exchange-text transition-colors"
              tabIndex={-1}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {capsOn && (
            <p className="mt-1.5 text-[11px] text-exchange-yellow flex items-center gap-1">
              <AlertCircle size={11} /> {t('auth.capsLockOn')}
            </p>
          )}
        </div>

        {/* Remember me */}
        <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-4 h-4 rounded border-exchange-border accent-exchange-yellow"
          />
          <span className="text-xs text-exchange-text-secondary">
            {t('auth.rememberMe')}
          </span>
        </label>

        {/* 2FA challenge */}
        {needs2fa && (
          <div className="bg-exchange-yellow/10 border border-exchange-yellow/30 rounded-lg p-4 space-y-3">
            <div>
              <p className="text-[13px] font-semibold text-exchange-yellow mb-1">
                {t('auth.twoFactorTitle') || 'Two-Factor Authentication'}
              </p>
              <p className="text-[11px] text-exchange-text-secondary">
                {t('auth.twoFactorDesc') ||
                  'Enter the 6-digit code from your authenticator app.'}
              </p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={totp}
              onChange={(e) =>
                setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="123456"
              maxLength={6}
              autoFocus
              className="auth-input text-center text-xl tracking-[0.5em] font-mono"
            />
          </div>
        )}

        {/* Desktop / tablet inline submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="hidden sm:block w-full !py-3.5 text-sm font-semibold rounded-lg bg-exchange-yellow text-black hover:bg-[#d9a60a] disabled:bg-exchange-border disabled:text-exchange-text-third disabled:cursor-not-allowed transition-colors"
        >
          {loading
            ? t('auth.loggingIn')
            : needs2fa
            ? t('auth.verify') || 'Verify'
            : t('auth.loginBtn')}
        </button>

        {/* Divider */}
        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-exchange-border/60" />
          </div>
          <div className="relative flex justify-center">
            <span className="px-3 text-[11px] uppercase tracking-wider text-exchange-text-third bg-exchange-bg">
              {t('auth.or')}
            </span>
          </div>
        </div>

        {/* Social */}
        <div className="grid grid-cols-3 gap-2">
          <SocialBtn label="Google" icon={<GoogleIcon />} />
          <SocialBtn label="Apple" icon={<AppleIcon />} />
          <SocialBtn label="Kakao" icon={<KakaoIcon />} />
        </div>
      </form>

      <p className="text-center text-sm text-exchange-text-secondary mt-8">
        {t('auth.noAccount')}{' '}
        <Link
          to="/register"
          className="text-exchange-yellow hover:underline font-semibold"
        >
          {t('nav.register')}
        </Link>
      </p>

      {/* Trust row */}
      <div className="mt-10 flex items-center justify-center gap-4 text-[11px] text-exchange-text-third">
        <span className="flex items-center gap-1">
          <Lock size={11} /> {t('auth.secure256')}
        </span>
        <span className="w-1 h-1 rounded-full bg-exchange-text-third" />
        <span>{t('auth.trustedBy')}</span>
      </div>

      {/* Sticky bottom CTA - mobile only */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 px-4 py-3 bg-exchange-bg/95 backdrop-blur border-t border-exchange-border/60 pb-[max(12px,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={(e) => {
            const form = (e.target as HTMLElement)
              .closest('section')
              ?.querySelector('form');
            form?.requestSubmit();
          }}
          disabled={!canSubmit}
          className="w-full py-3.5 text-sm font-bold rounded-lg bg-exchange-yellow text-black hover:bg-[#d9a60a] disabled:bg-exchange-border disabled:text-exchange-text-third disabled:cursor-not-allowed transition-colors"
        >
          {loading ? t('auth.loggingIn') : t('auth.loginBtn')}
        </button>
      </div>
    </AuthLayout>
  );
}

function SocialBtn({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      title={`${label} (coming soon)`}
      className="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-exchange-border bg-exchange-card hover:bg-exchange-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
    >
      {icon}
      <span className="text-xs text-exchange-text-secondary hidden sm:inline">
        {label}
      </span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.259h2.908c1.702-1.567 2.685-3.874 2.685-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A9.002 9.002 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.579c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EAECEF"
        d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.016-.06-.05-.3-.05-.54 0-1.16.584-2.27 1.244-2.97.835-.9 2.1-1.54 3.17-1.58.03.14.1.34.1.47zM20.5 17.47c-.47 1.04-.7 1.5-1.3 2.42-.83 1.3-2 2.91-3.46 2.93-1.3.02-1.64-.84-3.4-.83-1.77 0-2.13.84-3.43.83-1.46-.02-2.56-1.48-3.4-2.78C2.5 16.5 1.2 11.5 3.65 8.1c1.37-1.9 3.54-3.12 5.54-3.12 1.84 0 3 .84 4.52.84 1.48 0 2.4-.84 4.52-.84 1.78 0 3.67 1 4.99 2.7-4.38 2.4-3.67 8.66-2.72 9.79z"
      />
    </svg>
  );
}
function KakaoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#FEE500"
        d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.84 5.32 4.6 6.74l-.94 3.45c-.1.36.28.64.6.44l4.12-2.73c.54.06 1.08.1 1.62.1 5.52 0 10-3.58 10-8C22 6.58 17.52 3 12 3z"
      />
    </svg>
  );
}
