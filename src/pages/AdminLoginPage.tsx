import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck, AlertCircle } from 'lucide-react';
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

  // Inline styles — bypasses Tailwind purge / CDN cache. Forces wide layout.
  const wrapStyle: React.CSSProperties = {
    minHeight: '100vh',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0b0e11',
    padding: '24px',
    boxSizing: 'border-box',
  };
  const cardStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '720px',
    background: '#15181f',
    border: '1px solid #2a2e39',
    borderRadius: '24px',
    padding: '64px 72px',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
    boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block',
    padding: '0 4px',
    fontSize: '12px',
    fontWeight: 500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#9aa1ad',
    marginBottom: '10px',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '16px 20px',
    fontSize: '16px',
    borderRadius: '12px',
    background: '#0b0e11',
    border: '1px solid #2a2e39',
    color: '#eaecef',
    outline: 'none',
    boxSizing: 'border-box',
  };
  const pwInputStyle: React.CSSProperties = {
    ...inputStyle,
    paddingRight: '56px',
  };
  const btnStyle: React.CSSProperties = {
    width: '100%',
    padding: '16px',
    fontSize: '16px',
    fontWeight: 600,
    borderRadius: '12px',
    background: '#f0b90b',
    color: '#000',
    border: 'none',
    cursor: canSubmit ? 'pointer' : 'not-allowed',
    opacity: canSubmit ? 1 : 0.5,
    transition: 'background 0.2s',
  };

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        {/* Brand */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '40px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              background: 'rgba(240,185,11,0.15)',
              border: '1px solid rgba(240,185,11,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '20px',
            }}
          >
            <ShieldCheck style={{ width: '32px', height: '32px', color: '#f0b90b' }} />
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#f0b90b', margin: '0 0 6px 0' }}>
            QuantaEX Admin
          </h1>
          <p style={{ fontSize: '14px', color: '#9aa1ad', textAlign: 'center', margin: 0 }}>
            관리자 비밀번호를 입력하세요
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Email */}
          <div>
            <label style={labelStyle}>{t('auth.email') || 'Email'}</label>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              disabled={loading || needs2fa}
            />
          </div>

          {/* Password */}
          <div>
            <label style={labelStyle}>{t('auth.password') || 'Password'}</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={onPwKey}
                onKeyUp={onPwKey}
                style={pwInputStyle}
                disabled={loading || needs2fa}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                tabIndex={-1}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9aa1ad',
                  padding: '6px',
                }}
              >
                {showPw ? <EyeOff style={{ width: '20px', height: '20px' }} /> : <Eye style={{ width: '20px', height: '20px' }} />}
              </button>
            </div>
            {capsOn && (
              <p style={{ fontSize: '11px', color: '#f0b90b', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <AlertCircle style={{ width: '12px', height: '12px' }} /> {t('auth.capsOn') || 'Caps Lock is on'}
              </p>
            )}
          </div>

          {/* 2FA */}
          {needs2fa && (
            <div>
              <label style={labelStyle}>{t('auth.totpLabel') || 'Authenticator code'}</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                style={{ ...inputStyle, fontSize: '20px', textAlign: 'center', fontFamily: 'monospace', letterSpacing: '0.5em' }}
                autoFocus
              />
              <p style={{ fontSize: '11px', color: '#9aa1ad', marginTop: '6px' }}>
                {t('auth.totpHint') || '6-digit code from your authenticator app'}
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', padding: '10px' }}>
              <p style={{ fontSize: '12px', color: '#ef4444', display: 'flex', alignItems: 'flex-start', gap: '8px', margin: 0 }}>
                <AlertCircle style={{ width: '14px', height: '14px', flexShrink: 0, marginTop: '2px' }} />
                <span>{error}</span>
              </p>
            </div>
          )}

          {/* Submit */}
          <button type="submit" disabled={!canSubmit} style={btnStyle}>
            {loading
              ? '...'
              : needs2fa
              ? t('auth.verify') || 'Verify'
              : t('admin.loginCta') || 'Sign in to admin'}
          </button>
        </form>

        <p style={{ marginTop: '28px', textAlign: 'center', fontSize: '11px', color: '#9aa1ad' }}>
          {t('admin.loginAuditNotice') ||
            'Every login attempt is recorded in the audit log.'}
        </p>
      </div>
    </div>
  );
}
