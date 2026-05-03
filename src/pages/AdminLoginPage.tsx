import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, ShieldCheck, AlertCircle } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';

// ============================================================================
// /admin/login — admin-only login entry point.
//
// Why a separate page:
//   - The public /login is a marketing-styled split layout that points users
//     at sign-up, social providers, etc.
//   - Admin operators wanted a stripped-down, dark, single-purpose form they
//     can land on directly from /admin without seeing user-facing CTAs.
//   - Successful auth on this page enforces role==='admin' BEFORE redirecting
//     to /admin. Non-admins land here with a clear error and stay logged out.
//
// Flow:
//   1. If already authed AND role==='admin'    → navigate('/admin')
//   2. If already authed AND role!=='admin'    → show "not an admin" error,
//                                                clear store, stay on page
//   3. POST /auth/login → 2FA challenge handled inline like the public form
//   4. On success, role gate runs again before navigating
// ============================================================================
export default function AdminLoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setAuth = useStore((s) => s.setAuth);
  const logout = useStore((s) => s.logout);
  const user = useStore((s) => s.user);

  const [email, setEmail] = useState(
    () => localStorage.getItem('quantaex_admin_last_email') || '',
  );
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [needs2fa, setNeeds2fa] = useState(false);
  const [totp, setTotp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  // Auto-redirect if already an admin.
  useEffect(() => {
    if (user?.role === 'admin') {
      navigate('/admin', { replace: true });
    }
  }, [user, navigate]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSubmit =
    emailValid && password.length >= 1 && !loading && (!needs2fa || totp.length === 6);

  const onPwKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const caps =
      typeof (e as any).getModifierState === 'function' &&
      (e as any).getModifierState('CapsLock');
    setCapsOn(!!caps);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!emailValid) return setError(t('auth.invalidEmail'));
    if (!password) return setError(t('auth.enterPassword'));
    if (needs2fa && !/^\d{6}$/.test(totp)) {
      return setError(t('auth.totpDigits') || 'Enter 6-digit code');
    }

    setLoading(true);
    try {
      const payload: any = { email, password };
      if (needs2fa) payload.totp_code = totp;
      const res = await api.post('/auth/login', payload);
      const u = res.data?.user;

      // Admin gate — non-admin users must NOT enter the admin console.
      if (u?.role !== 'admin') {
        logout();
        setError(
          t('admin.loginNotAdmin') ||
            'This account does not have administrator privileges.',
        );
        setLoading(false);
        return;
      }

      setAuth(u, res.data.token);
      localStorage.setItem('quantaex_admin_last_email', email);
      navigate('/admin', { replace: true });
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

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-exchange-bg px-4 sm:px-6 py-10">
      <div className="w-full max-w-[1400px] grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12 items-stretch">
        {/* LEFT — Brand / hero panel (hidden on phones, shown md+) */}
        <div className="hidden md:flex flex-col justify-between rounded-3xl border border-exchange-border bg-gradient-to-br from-exchange-card via-exchange-card to-exchange-bg p-8 lg:p-12 shadow-xl overflow-hidden relative min-h-[520px]">
          <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-exchange-yellow/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-exchange-yellow/5 blur-3xl pointer-events-none" />

          <div className="relative">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-2xl bg-exchange-yellow/15 border border-exchange-yellow/30 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-exchange-yellow" />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-exchange-text-third">
                  QuantaEX
                </div>
                <div className="text-xl font-bold text-exchange-text">
                  {t('admin.loginTitle') || 'Admin Console'}
                </div>
              </div>
            </div>

            <h2 className="text-3xl lg:text-4xl xl:text-5xl font-extrabold text-exchange-text leading-tight mb-4">
              {t('admin.loginHeroTitle') || 'Operate the exchange with confidence.'}
            </h2>
            <p className="text-base text-exchange-text-secondary leading-relaxed max-w-md">
              {t('admin.loginHeroSubtitle') ||
                'Restricted, audit-logged operator console for QuantaEX. Every action you take here is signed, time-stamped, and reviewable.'}
            </p>
          </div>

          <div className="relative grid grid-cols-3 gap-4 mt-10">
            <div className="rounded-xl border border-exchange-border bg-exchange-bg/40 p-4">
              <div className="text-[10px] uppercase tracking-wider text-exchange-text-third mb-1">Audit</div>
              <div className="text-sm font-semibold text-exchange-text">100% logged</div>
            </div>
            <div className="rounded-xl border border-exchange-border bg-exchange-bg/40 p-4">
              <div className="text-[10px] uppercase tracking-wider text-exchange-text-third mb-1">Auth</div>
              <div className="text-sm font-semibold text-exchange-text">2FA + role</div>
            </div>
            <div className="rounded-xl border border-exchange-border bg-exchange-bg/40 p-4">
              <div className="text-[10px] uppercase tracking-wider text-exchange-text-third mb-1">Crypto</div>
              <div className="text-sm font-semibold text-exchange-text">PQ-ready</div>
            </div>
          </div>
        </div>

        {/* RIGHT — Login form panel */}
        <div className="flex flex-col justify-center w-full">
          {/* Mobile-only brand strip */}
          <div className="md:hidden flex items-center justify-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-xl bg-exchange-yellow/15 border border-exchange-yellow/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-exchange-yellow" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-exchange-text-third">
                QuantaEX
              </div>
              <div className="text-base font-bold text-exchange-text">
                {t('admin.loginTitle') || 'Admin Console'}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-exchange-border bg-exchange-card p-8 lg:p-10 shadow-xl">
            <h1 className="text-2xl font-bold text-exchange-text mb-2">
              {t('admin.loginHeading') || 'Sign in to administer'}
            </h1>
            <p className="text-sm text-exchange-text-third mb-7">
              {t('admin.loginSubheading') ||
                'Restricted to operators with the admin role. All actions are audit-logged.'}
            </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="text-[11px] font-medium text-exchange-text-secondary uppercase tracking-wider">
                {t('auth.email') || 'Email'}
              </label>
              <div className="relative mt-2">
                <Mail className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-exchange-text-third" />
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@quantaex.io"
                  className="w-full pl-12 pr-4 py-3.5 text-base rounded-xl bg-exchange-bg border border-exchange-border text-exchange-text placeholder:text-exchange-text-third/60 focus:border-exchange-yellow/60 focus:outline-none"
                  disabled={loading || needs2fa}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-[11px] font-medium text-exchange-text-secondary uppercase tracking-wider">
                {t('auth.password') || 'Password'}
              </label>
              <div className="relative mt-2">
                <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-exchange-text-third" />
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onPwKey}
                  onKeyUp={onPwKey}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-12 py-3.5 text-base rounded-xl bg-exchange-bg border border-exchange-border text-exchange-text placeholder:text-exchange-text-third/60 focus:border-exchange-yellow/60 focus:outline-none"
                  disabled={loading || needs2fa}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-exchange-text-third hover:text-exchange-text"
                >
                  {showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {capsOn && (
                <p className="text-[11px] text-exchange-yellow mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {t('auth.capsOn') || 'Caps Lock is on'}
                </p>
              )}
            </div>

            {/* 2FA */}
            {needs2fa && (
              <div>
                <label className="text-[11px] font-medium text-exchange-text-secondary uppercase tracking-wider">
                  {t('auth.totpLabel') || 'Authenticator code'}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="w-full mt-2 px-4 py-3.5 text-xl text-center font-mono tracking-[0.5em] rounded-xl bg-exchange-bg border border-exchange-border text-exchange-text focus:border-exchange-yellow/60 focus:outline-none"
                  autoFocus
                />
                <p className="text-[11px] text-exchange-text-third mt-1.5">
                  {t('auth.totpHint') || '6-digit code from your authenticator app'}
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-exchange-sell/30 bg-exchange-sell/5 p-2.5">
                <p className="text-xs text-exchange-sell flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-3.5 text-base font-semibold rounded-xl bg-exchange-yellow hover:bg-exchange-yellow/90 text-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? '...'
                : needs2fa
                ? t('auth.verify') || 'Verify'
                : t('admin.loginCta') || 'Sign in to admin'}
            </button>
          </form>

            <p className="mt-6 text-center text-[11px] text-exchange-text-third">
              {t('admin.loginAuditNotice') ||
                'Every login attempt is recorded in the audit log.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
