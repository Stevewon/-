import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Check, X, Mail, User as UserIcon, Gift } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import AuthLayout from '../components/common/AuthLayout';

// ============================================================================
// Binance / Upbit-inspired register page
// - PC: 2-column split (hero left, form right) via <AuthLayout>
// - Mobile: single column, sticky bottom CTA for thumb reach
// - Real-time password rules checklist
// - Segmented Email / Phone tab
// ============================================================================
export default function RegisterPage() {
  const { t } = useI18n();
  const setAuth = useStore((s) => s.setAuth);
  const navigate = useNavigate();

  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [refCode, setRefCode] = useState('');
  const [showRef, setShowRef] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);
  const [focused, setFocused] = useState<string>('');

  const rules = useMemo(
    () => ({
      length: password.length >= 8,
      letter: /[A-Za-z]/.test(password),
      number: /[0-9]/.test(password),
      match: password.length > 0 && password === confirmPw,
    }),
    [password, confirmPw]
  );

  const strengthScore = useMemo(() => {
    let s = 0;
    if (password.length >= 8) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  }, [password]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const nickValid = nickname.length >= 2 && nickname.length <= 20;
  const allValid =
    emailValid &&
    nickValid &&
    rules.length &&
    rules.letter &&
    rules.number &&
    rules.match &&
    agreeTerms;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'phone') return setError(t('auth.phoneComingSoon'));
    if (!emailValid) return setError(t('auth.invalidEmail'));
    if (!nickValid) return setError(t('auth.invalidNickname'));
    if (!rules.length || !rules.letter || !rules.number)
      return setError(t('auth.passwordRulesFail'));
    if (!rules.match) return setError(t('auth.passwordMismatch'));
    if (!agreeTerms) return setError(t('auth.mustAgreeTerms'));

    setLoading(true);
    try {
      const res = await api.post('/auth/register', {
        email,
        password,
        nickname,
        ref_code: refCode || undefined,
        agree_marketing: agreeMarketing,
      });
      setAuth(res.data.user, res.data.token);
      navigate('/trade/BTC-USDT');
    } catch (err: any) {
      setError(err.response?.data?.error || t('auth.registerFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout variant="register">
      {/* Headline + inline login link (Binance mobile pattern) */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl lg:text-3xl font-bold text-exchange-text leading-tight">
            {t('auth.createAccount')}
          </h1>
          <Link
            to="/login"
            className="text-[13px] text-exchange-yellow hover:underline font-semibold whitespace-nowrap mt-1"
          >
            {t('nav.login')} →
          </Link>
        </div>
        <p className="text-exchange-text-secondary mt-2 text-sm">
          {t('auth.startTrading')}
        </p>
      </div>

      {/* Bonus banner */}
      <div className="mb-6 flex items-center gap-2.5 p-3 rounded-xl bg-gradient-to-r from-exchange-yellow/15 to-exchange-yellow/5 border border-exchange-yellow/30">
        <div className="w-9 h-9 rounded-full bg-exchange-yellow/20 flex items-center justify-center shrink-0">
          <Gift size={18} className="text-exchange-yellow" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-exchange-yellow leading-tight">
            {t('auth.bonusHeadline')}
          </div>
          <div className="text-[11px] text-exchange-text-secondary mt-0.5">
            {t('auth.bonusSubline')}
          </div>
        </div>
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
            <X size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Email */}
        <FieldWrap
          label={t('auth.email')}
          valid={email.length > 0 ? emailValid : null}
          hint={email.length > 0 && !emailValid ? t('auth.invalidEmail') : ''}
          focused={focused === 'email'}
        >
          <div className="relative">
            <Mail
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-exchange-text-third pointer-events-none"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused('')}
              className="auth-input py-3.5 pl-12 pr-4"
              placeholder={t('auth.emailPlaceholder')}
              required
              autoComplete="email"
              inputMode="email"
            />
          </div>
        </FieldWrap>

        {/* Nickname */}
        <FieldWrap
          label={t('auth.nickname')}
          valid={nickname.length > 0 ? nickValid : null}
          hint={nickname.length > 0 && !nickValid ? t('auth.nicknameRule') : ''}
          focused={focused === 'nick'}
        >
          <div className="relative">
            <UserIcon
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-exchange-text-third pointer-events-none"
            />
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onFocus={() => setFocused('nick')}
              onBlur={() => setFocused('')}
              className="auth-input py-3.5 pl-12 pr-4"
              placeholder={t('auth.nicknamePlaceholder')}
              required
              autoComplete="username"
              maxLength={20}
            />
          </div>
        </FieldWrap>

        {/* Password */}
        <FieldWrap label={t('auth.password')} focused={focused === 'pw'}>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocused('pw')}
              onBlur={() => setFocused('')}
              className="auth-input py-3.5 pl-4 pr-12"
              placeholder={t('auth.passwordPlaceholderNew')}
              required
              autoComplete="new-password"
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
          {password.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex gap-1 flex-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      i < strengthScore
                        ? strengthScore >= 3
                          ? 'bg-exchange-buy'
                          : strengthScore >= 2
                          ? 'bg-exchange-yellow'
                          : 'bg-exchange-sell'
                        : 'bg-exchange-border'
                    }`}
                  />
                ))}
              </div>
              <span
                className={`text-[11px] font-medium min-w-[46px] text-right ${
                  strengthScore >= 3
                    ? 'text-exchange-buy'
                    : strengthScore >= 2
                    ? 'text-exchange-yellow'
                    : 'text-exchange-sell'
                }`}
              >
                {strengthScore >= 3
                  ? t('auth.passwordStrength.strong')
                  : strengthScore >= 2
                  ? t('auth.passwordStrength.medium')
                  : t('auth.passwordStrength.weak')}
              </span>
            </div>
          )}
          {(focused === 'pw' || password.length > 0) && (
            <ul className="mt-2.5 space-y-1 text-[12px]">
              <RuleRow ok={rules.length} label={t('auth.pwRule8')} />
              <RuleRow ok={rules.letter} label={t('auth.pwRuleLetter')} />
              <RuleRow ok={rules.number} label={t('auth.pwRuleNumber')} />
            </ul>
          )}
        </FieldWrap>

        {/* Confirm password */}
        <FieldWrap
          label={t('auth.confirmPassword')}
          valid={confirmPw.length > 0 ? rules.match : null}
          hint={
            confirmPw.length > 0 && !rules.match ? t('auth.passwordMismatch') : ''
          }
          focused={focused === 'pw2'}
        >
          <div className="relative">
            <input
              type={showPw2 ? 'text' : 'password'}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              onFocus={() => setFocused('pw2')}
              onBlur={() => setFocused('')}
              className="auth-input py-3.5 pl-4 pr-12"
              placeholder={t('auth.confirmPasswordPlaceholder')}
              required
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPw2(!showPw2)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-exchange-text-third hover:text-exchange-text transition-colors"
              tabIndex={-1}
              aria-label={showPw2 ? 'Hide password' : 'Show password'}
            >
              {showPw2 ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </FieldWrap>

        {/* Referral code */}
        <div>
          <button
            type="button"
            onClick={() => setShowRef(!showRef)}
            className="text-xs text-exchange-text-secondary hover:text-exchange-yellow transition-colors flex items-center gap-1"
          >
            <span>{t('auth.referralCode')}</span>
            <span className="text-exchange-text-third">
              ({t('auth.optional')})
            </span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="currentColor"
              className={`transition-transform ${showRef ? 'rotate-180' : ''}`}
            >
              <path d="M5 7L1 3h8L5 7z" />
            </svg>
          </button>
          {showRef && (
            <input
              type="text"
              value={refCode}
              onChange={(e) => setRefCode(e.target.value.toUpperCase())}
              className="auth-input py-3.5 px-4 mt-2"
              placeholder={t('auth.referralPlaceholder')}
              maxLength={12}
            />
          )}
        </div>

        {/* Terms */}
        <div className="space-y-2.5 pt-1">
          <label className="flex items-start gap-2.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-exchange-border accent-exchange-yellow shrink-0"
            />
            <span className="text-xs text-exchange-text-secondary leading-relaxed">
              {t('auth.agreeTermsPre')}{' '}
              <Link
                to="/terms"
                className="text-exchange-yellow hover:underline"
              >
                {t('auth.termsOfService')}
              </Link>
              {' '}{t('auth.and')}{' '}
              <Link
                to="/privacy"
                className="text-exchange-yellow hover:underline"
              >
                {t('auth.privacyPolicy')}
              </Link>
              <span className="text-exchange-sell ml-0.5">*</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={agreeMarketing}
              onChange={(e) => setAgreeMarketing(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-exchange-border accent-exchange-yellow shrink-0"
            />
            <span className="text-xs text-exchange-text-secondary leading-relaxed">
              {t('auth.agreeMarketing')}{' '}
              <span className="text-exchange-text-third">
                ({t('auth.optional')})
              </span>
            </span>
          </label>
        </div>

        {/* Desktop / tablet inline submit */}
        <button
          type="submit"
          disabled={loading || !allValid}
          className="hidden sm:block w-full !py-3.5 text-sm font-semibold rounded-lg bg-exchange-yellow text-black hover:bg-[#d9a60a] disabled:bg-exchange-border disabled:text-exchange-text-third disabled:cursor-not-allowed transition-colors mt-2"
        >
          {loading ? t('auth.creating') : t('auth.registerBtn')}
        </button>

        {/* Divider */}
        <div className="relative py-2 mt-2">
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
          disabled={loading || !allValid}
          className="w-full py-3.5 text-sm font-bold rounded-lg bg-exchange-yellow text-black hover:bg-[#d9a60a] disabled:bg-exchange-border disabled:text-exchange-text-third disabled:cursor-not-allowed transition-colors"
        >
          {loading ? t('auth.creating') : t('auth.registerBtn')}
        </button>
      </div>
    </AuthLayout>
  );
}

// ============================================================================
// Shared field wrapper
// ============================================================================
function FieldWrap({
  label,
  children,
  valid,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  valid?: boolean | null;
  hint?: string;
  focused?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[13px] font-medium text-exchange-text-secondary">
          {label}
        </label>
        {valid === true && (
          <span className="flex items-center gap-1 text-[11px] text-exchange-buy">
            <Check size={12} /> OK
          </span>
        )}
      </div>
      {children}
      {hint && valid === false && (
        <p className="mt-1.5 text-[11px] text-exchange-sell flex items-center gap-1">
          <X size={11} /> {hint}
        </p>
      )}
    </div>
  );
}

function RuleRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className={`flex items-center gap-1.5 transition-colors ${
        ok ? 'text-exchange-buy' : 'text-exchange-text-third'
      }`}
    >
      {ok ? (
        <Check size={12} strokeWidth={3} />
      ) : (
        <span className="w-[12px] h-[12px] rounded-full border border-current inline-block" />
      )}
      <span>{label}</span>
    </li>
  );
}

function SocialBtn({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      title={`${label} (coming soon)`}
      className="flex items-center justify-center gap-2 h-12 rounded-lg border border-exchange-border bg-exchange-card hover:bg-exchange-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
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
