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
    <div className="min-h-screen flex items-center justify-center bg-exchange-bg px-4 py-10">
      <div className="w-full max-w-md">
        {/* Brand strip */}
        <div className="flex items-center justify-center gap-2 mb-6">
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

        <div className="rounded-2xl border border-exchange-border bg-exchange-card p-6 shadow-xl">
          <h1 className="text-lg font-bold text-exchange-text mb-1">
            {t('admin.loginHeading') || 'Sign in to administer'}
          </h1>
          <p className="text-xs text-exchange-text-third mb-5">
            {t('admin.loginSubheading') ||
              'Restricted to operators with the admin role. All actions are audit-logged.'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="text-[11px] font-medium text-exchange-text-secondary uppercase tracking-wider">
                {t('auth.email') || 'Email'}
              </label>
              <div className="relative mt-1.5">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-exchange-text-third" />
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@quantaex.io"
                  className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg bg-exchange-bg border border-exchange-border text-exchange-text placeholder:text-exchange-text-third/60 focus:border-exchange-yellow/60 focus:outline-none"
                  disabled={loading || needs2fa}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-[11px] font-medium text-exchange-text-secondary uppercase tracking-wider">
                {t('auth.password') || 'Password'}
              </label>
              <div className="relative mt-1.5">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-exchange-text-third" />
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onPwKey}
                  onKeyUp={onPwKey}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 text-sm rounded-lg bg-exchange-bg border border-exchange-border text-exchange-text placeholder:text-exchange-text-third/60 focus:border-exchange-yellow/60 focus:outline-none"
                  disabled={loading || needs2fa}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-exchange-text-third hover:text-exchange-text"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
                  className="w-full mt-1.5 px-3 py-2.5 text-base text-center font-mono tracking-widest rounded-lg bg-exchange-bg border border-exchange-border text-exchange-text focus:border-exchange-yellow/60 focus:outline-none"
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
              className="w-full py-2.5 text-sm font-semibold rounded-lg bg-exchange-yellow hover:bg-exchange-yellow/90 text-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? '...'
                : needs2fa
                ? t('auth.verify') || 'Verify'
                : t('admin.loginCta') || 'Sign in to admin'}
            </button>
          </form>

          <p className="mt-5 text-center text-[11px] text-exchange-text-third">
            {t('admin.loginAuditNotice') ||
              'Every login attempt is recorded in the audit log.'}
          </p>
        </div>
      </div>
    </div>
  );
}
