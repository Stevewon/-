import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, AlertCircle, Gift, Check, X, KeyRound, ShieldCheck } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import AuthLayout from '../components/common/AuthLayout';
import Turnstile from '../components/Turnstile';

// ----------------------------------------------------------------------------
// Google Identity Services (GIS) SDK loader.
// We lazy-load the script the first time the user lands on /login.
// The Client ID is fetched at runtime from GET /api/auth/google/config so we
// don't need to bake it into the bundle. (Client ID is public per Google's
// docs; only the Client Secret stays server-side.)
// Build-time and window globals are kept as fallbacks for resilience.
// ----------------------------------------------------------------------------
const GOOGLE_CLIENT_ID_BUILD =
  (import.meta as any).env?.VITE_GOOGLE_OAUTH_CLIENT_ID ||
  (typeof window !== 'undefined' && (window as any).__GOOGLE_OAUTH_CLIENT_ID__) ||
  '';

let gisLoadPromise: Promise<void> | null = null;
function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if ((window as any).google?.accounts?.id) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('GIS load failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoadPromise = null;
      reject(new Error('GIS load failed'));
    };
    document.head.appendChild(s);
  });
  return gisLoadPromise;
}

// ----------------------------------------------------------------------------
// OAuth 2.0 implicit-flow popup. Used on PC where the small GIS One-Tap chip
// looks cramped — a centred 500x650 popup window is much more presentable.
// We request response_type=id_token, so the redirect lands on our /login page
// with the JWT in the URL fragment, which the popup then postMessages back
// to the opener and closes itself.
// nonce protects against replay; we also verify state matches.
// ----------------------------------------------------------------------------
function openGoogleOAuthPopup(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('SSR'));

    const nonce = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, '');
    const state = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, '');
    sessionStorage.setItem('quantaex_google_oauth_state', state);

    // Centre the popup on the user's primary screen.
    const w = 500;
    const h = 650;
    const dualLeft  = (window as any).screenLeft ?? window.screenX ?? 0;
    const dualTop   = (window as any).screenTop  ?? window.screenY ?? 0;
    const winW = window.innerWidth || document.documentElement.clientWidth || screen.width;
    const winH = window.innerHeight || document.documentElement.clientHeight || screen.height;
    const left = dualLeft + Math.max(0, (winW - w) / 2);
    const top  = dualTop  + Math.max(0, (winH - h) / 2);

    const redirectUri = `${window.location.origin}/auth/google/callback`;
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: 'id_token',
      scope:         'openid email profile',
      nonce,
      state,
      prompt:        'select_account',
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    const features =
      `width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)},` +
      `menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`;
    const popup = window.open(url, 'quantaex_google_oauth', features);
    if (!popup) return reject(new Error('Popup blocked'));
    try { popup.focus(); } catch {/* noop */}

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
    };
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data: any = ev.data;
      if (!data || data.source !== 'quantaex_google_oauth') return;
      cleanup();
      settled = true;
      try { popup.close(); } catch {/* noop */}
      if (data.error) return reject(new Error(data.error));
      if (data.state !== state) return reject(new Error('state mismatch'));
      if (!data.idToken) return reject(new Error('Missing idToken'));
      resolve(data.idToken);
    };
    window.addEventListener('message', onMessage);

    const closedTimer = setInterval(() => {
      if (popup.closed) {
        if (!settled) {
          cleanup();
          reject(new Error('Popup closed by user'));
        }
      }
    }, 600);
  });
}

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

  // ---- Referral code (for Google new-signup; ignored for existing users) ----
  // Mirrors RegisterPage pattern: ?ref=CODE auto-catch + live validation.
  const [refCode, setRefCode] = useState('');
  const [showRef, setShowRef] = useState(false);
  const [refCheck, setRefCheck] = useState<{
    state: 'idle' | 'checking' | 'valid' | 'invalid';
    masked?: string;
  }>({ state: 'idle' });

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
  // Cloudflare Turnstile token 2014 empty when unconfigured (dev/preview).
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileErrored, setTurnstileErrored] = useState(false);

  // ---- Email-OTP (passwordless) login — Bybit-style one-time code ----
  const [authMethod, setAuthMethod] = useState<'password' | 'otp'>('password');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpResendIn, setOtpResendIn] = useState(0); // resend cooldown seconds
  const [otpNotice, setOtpNotice] = useState('');     // "code sent" info line

  // Resend countdown ticker.
  useEffect(() => {
    if (otpResendIn <= 0) return;
    const id = setInterval(() => setOtpResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [otpResendIn]);

  // Reset OTP state whenever the user switches login method or edits email.
  useEffect(() => {
    setOtpSent(false);
    setOtpCode('');
    setOtpNotice('');
    setOtpResendIn(0);
    setNeeds2fa(false);
    setError('');
  }, [authMethod]);

  // ---- Google OAuth state ----
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string>(GOOGLE_CLIENT_ID_BUILD);
  const googleInitialisedRef = useRef(false);

  // Fetch the Google Client ID from the server (runtime config) and pre-load
  // GIS in the background so the first click is fast.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!googleClientId) {
          const res = await api.get('/auth/google/config');
          if (!cancelled && res.data?.enabled && res.data?.clientId) {
            setGoogleClientId(res.data.clientId);
          }
        }
      } catch {/* config endpoint may not be deployed yet */}
      try { await loadGoogleIdentityServices(); } catch {/* retry on click */}
    })();
    return () => { cancelled = true; };
  }, [googleClientId]);

  // Auto-fill refCode from ?ref=CODE query param (referral link sharing).
  // Mirrors RegisterPage; if user lands on /login?ref=ABC123 the code is
  // captured and passed to /auth/google on new-account creation.
  useEffect(() => {
    const fromUrl = params.get('ref');
    if (fromUrl) {
      setRefCode(fromUrl.toUpperCase().trim());
      setShowRef(true);
    }
  }, [params]);

  // Live referral-code validation (debounced 400ms) — same UX as RegisterPage.
  useEffect(() => {
    const code = refCode.trim().toUpperCase();
    if (!code) { setRefCheck({ state: 'idle' }); return; }
    if (code.length < 4) { setRefCheck({ state: 'idle' }); return; }
    setRefCheck({ state: 'checking' });
    const tm = setTimeout(async () => {
      try {
        const r = await api.get(`/auth/referrals/check/${encodeURIComponent(code)}`);
        if (r.data?.valid) {
          setRefCheck({ state: 'valid', masked: r.data.masked_nickname });
        } else {
          setRefCheck({ state: 'invalid' });
        }
      } catch {
        setRefCheck({ state: 'invalid' });
      }
    }, 400);
    return () => clearTimeout(tm);
  }, [refCode]);

  // Server-side login with the Google idToken.
  // For new accounts (first Google sign-in), the optional refCode is attached
  // to the upline so L1/L2/L3 referral rewards trigger. For existing accounts
  // the server ignores refCode (already onboarded).
  const onGoogleCredential = async (idToken: string) => {
    if (!idToken) return;
    setError('');
    setGoogleLoading(true);
    try {
      // Only attach refCode if it has been confirmed valid by the live check;
      // we never block sign-in on an invalid code — silently drop it instead,
      // because the user may have typed a typo and we don't want to deny them
      // an account.
      const payload: any = { idToken };
      const code = refCode.trim().toUpperCase();
      if (code && refCheck.state === 'valid') payload.refCode = code;

      const res = await api.post('/auth/google', payload);
      setAuth(res.data.user, res.data.token);
      // Remember this email so the next non-Google login is also smooth.
      if (res.data?.user?.email) {
        localStorage.setItem('quantaex_last_email', res.data.user.email);
      }
      navigate(redirect);
    } catch (err: any) {
      const msg = err?.response?.data?.error || t('auth.googleFailed') || 'Google login failed';
      setError(msg);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleClick = async () => {
    setError('');
    // Resolve client id at click time — try state first, then fetch fresh
    // from /auth/google/config as a last-chance fallback.
    let clientId = googleClientId;
    if (!clientId) {
      try {
        const res = await api.get('/auth/google/config');
        if (res.data?.enabled && res.data?.clientId) {
          clientId = res.data.clientId;
          setGoogleClientId(clientId);
        }
      } catch {/* fall through */}
    }
    if (!clientId) {
      setError(t('auth.googleNotConfigured') || 'Google login is not configured');
      return;
    }

    // PC: open a centred 500x650 OAuth popup with the official Google account
    // chooser screen — much more presentable than the tiny GIS One-Tap chip.
    // Mobile: stick with GIS prompt() which adapts to the small viewport.
    const isDesktop =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(min-width: 768px)').matches
        : true;

    setGoogleLoading(true);

    if (isDesktop) {
      try {
        const idToken = await openGoogleOAuthPopup(clientId);
        await onGoogleCredential(idToken);
      } catch (e: any) {
        setGoogleLoading(false);
        const msg = (e?.message || '').toString();
        if (msg.includes('Popup blocked')) {
          setError(t('auth.googleBlocked') || 'Please allow popups and try again');
        } else if (msg.includes('closed by user')) {
          setError(t('auth.googleCancelled') || 'Google sign-in cancelled');
        } else {
          setError(t('auth.googleFailed') || 'Google login failed');
        }
      }
      return;
    }

    // Mobile path — GIS prompt() (small chip is fine on phone screens).
    try {
      await loadGoogleIdentityServices();
      const g = (window as any).google?.accounts?.id;
      if (!g) throw new Error('GIS unavailable');

      if (!googleInitialisedRef.current) {
        g.initialize({
          client_id: clientId,
          callback: (resp: any) => {
            if (resp?.credential) {
              onGoogleCredential(resp.credential);
            } else {
              setGoogleLoading(false);
              setError(t('auth.googleCancelled') || 'Google sign-in cancelled');
            }
          },
          ux_mode: 'popup',
          auto_select: false,
        });
        googleInitialisedRef.current = true;
      }

      g.prompt((notification: any) => {
        if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
          setGoogleLoading(false);
          setError(t('auth.googleBlocked') || 'Please allow popups for accounts.google.com and try again');
        }
      });
    } catch {
      setGoogleLoading(false);
      setError(t('auth.googleFailed') || 'Google login failed');
    }
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSubmit =
    authMethod === 'otp'
      ? // Before the code is sent: only a valid email is needed to request one.
        // After it's sent: require the full 6-digit code (+ 2FA if applicable).
        !otpSent
        ? emailValid && !loading && !otpSending
        : emailValid && otpCode.length === 6 && !loading && (!needs2fa || totp.length === 6)
      : emailValid && password.length >= 1 && !loading && (!needs2fa || totp.length === 6);

  // ---- Send / resend the email OTP code ----
  const requestOtp = async () => {
    setError('');
    if (mode === 'phone') return setError(t('auth.phoneComingSoon'));
    if (!emailValid) return setError(t('auth.invalidEmail'));
    setOtpSending(true);
    try {
      const payload: any = { email };
      if (turnstileToken) payload.turnstile_token = turnstileToken;
      const res = await api.post('/auth/login-otp/request', payload);
      setOtpSent(true);
      setOtpResendIn(30);
      setNeeds2fa(false);
      // Dev/preview: server returns dev_code when the mail provider isn't wired.
      const devCode = res.data?.dev_code;
      setOtpNotice(
        devCode
          ? `${t('auth.otpSent')} (dev: ${devCode})`
          : t('auth.otpSent')
      );
    } catch (err: any) {
      setError(err.response?.data?.error || t('auth.otpSendFailed'));
    } finally {
      setOtpSending(false);
    }
  };

  // ---- Verify the OTP code and log in ----
  const verifyOtp = async () => {
    setError('');
    if (!/^\d{6}$/.test(otpCode)) return setError(t('auth.otpDigits'));
    if (needs2fa && !/^\d{6}$/.test(totp))
      return setError(t('auth.totpDigits') || 'Enter 6-digit code');
    setLoading(true);
    try {
      const payload: any = { email, code: otpCode };
      if (needs2fa) payload.totp_code = totp;
      const res = await api.post('/auth/login-otp/verify', payload);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'phone') return setError(t('auth.phoneComingSoon'));
    if (!emailValid) return setError(t('auth.invalidEmail'));
    // Email-OTP (passwordless) path.
    if (authMethod === 'otp') {
      if (!otpSent) return requestOtp();
      return verifyOtp();
    }
    if (!password) return setError(t('auth.enterPassword'));
    if (needs2fa && !/^\d{6}$/.test(totp))
      return setError(t('auth.totpDigits') || 'Enter 6-digit code');

    setLoading(true);
    try {
      const payload: any = { email, password };
      if (needs2fa) payload.totp_code = totp;
      if (turnstileToken) payload.turnstile_token = turnstileToken;
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

  // Auto-submit once the 2FA code is complete. Re-runs whichever login flow
  // triggered the challenge (password login or email-OTP login).
  const submit2fa = async (code?: string) => {
    const totpVal = code ?? totp;
    if (!/^\d{6}$/.test(totpVal) || loading) return;
    if (authMethod === 'otp') {
      // OTP-verify path with the 2FA code attached.
      setLoading(true);
      setError('');
      try {
        const payload: any = { email, code: otpCode, totp_code: totpVal };
        const res = await api.post('/auth/login-otp/verify', payload);
        setAuth(res.data.user, res.data.token);
        if (remember) localStorage.setItem('quantaex_last_email', email);
        else localStorage.removeItem('quantaex_last_email');
        navigate(redirect);
      } catch (err: any) {
        setError(err.response?.data?.error || t('auth.loginFailed'));
      } finally {
        setLoading(false);
      }
      return;
    }
    // Password-login path with the 2FA code attached.
    setLoading(true);
    setError('');
    try {
      const payload: any = { email, password, totp_code: totpVal };
      if (turnstileToken) payload.turnstile_token = turnstileToken;
      const res = await api.post('/auth/login', payload);
      setAuth(res.data.user, res.data.token);
      if (remember) localStorage.setItem('quantaex_last_email', email);
      else localStorage.removeItem('quantaex_last_email');
      navigate(redirect);
    } catch (err: any) {
      setError(err.response?.data?.error || t('auth.loginFailed'));
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
      {/* Headline + inline register link (Binance mobile pattern) */}
      <div className="mb-9 sm:mb-10">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl lg:text-[34px] font-bold text-exchange-text leading-tight">
            {t('auth.welcome')}
          </h1>
          <Link
            to="/register"
            className="text-[14px] sm:text-[15px] text-exchange-yellow hover:underline font-semibold whitespace-nowrap mt-1 sm:mt-2"
          >
            {t('nav.register')} →
          </Link>
        </div>
        <p className="text-exchange-text-secondary mt-2 sm:mt-3 text-[15px] sm:text-base">
          {t('auth.loginTo')}
        </p>
      </div>

      {/* Email / Phone tab */}
      <div className="mb-6 sm:mb-7 flex items-center gap-0 rounded-lg sm:rounded-xl bg-exchange-card p-1.5 border border-exchange-border/60">
        <button
          type="button"
          onClick={() => setMode('email')}
          style={{ paddingTop: '11px', paddingBottom: '11px' }}
          className={`flex-1 text-[15px] sm:text-base font-medium rounded-md sm:rounded-lg transition-colors ${
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
          style={{ paddingTop: '11px', paddingBottom: '11px' }}
          className={`flex-1 text-[15px] sm:text-base font-medium rounded-md sm:rounded-lg transition-colors relative ${
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

      {/* Login method: password vs. email one-time code (Bybit-style) */}
      {mode === 'email' && (
        <div className="mb-7 sm:mb-6 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setAuthMethod('password')}
            style={{ paddingTop: '13px', paddingBottom: '13px' }}
            className={`flex items-center justify-center gap-2 text-[14px] sm:text-[15px] font-medium rounded-lg border transition-colors ${
              authMethod === 'password'
                ? 'border-exchange-yellow/70 bg-exchange-yellow/10 text-exchange-yellow'
                : 'border-exchange-border/60 bg-exchange-card text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            <Lock size={16} /> {t('auth.methodPassword')}
          </button>
          <button
            type="button"
            onClick={() => setAuthMethod('otp')}
            style={{ paddingTop: '13px', paddingBottom: '13px' }}
            className={`flex items-center justify-center gap-2 text-[14px] sm:text-[15px] font-medium rounded-lg border transition-colors ${
              authMethod === 'otp'
                ? 'border-exchange-yellow/70 bg-exchange-yellow/10 text-exchange-yellow'
                : 'border-exchange-border/60 bg-exchange-card text-exchange-text-secondary hover:text-exchange-text'
            }`}
          >
            <KeyRound size={16} /> {t('auth.methodOtp')}
          </button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex flex-col"
        style={{ gap: '26px' }}
        noValidate
      >
        {error && (
          <div className="bg-exchange-sell/10 border border-exchange-sell/30 text-exchange-sell rounded-lg px-3 py-2.5 text-sm flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Email */}
        <div>
          <label className="text-[15px] sm:text-[15px] font-medium text-exchange-text-secondary mb-2 sm:mb-2.5 block">
            {t('auth.email')}
          </label>
          <div className="auth-field">
            <span className="auth-icon">
              <Mail size={18} className="sm:!w-5 sm:!h-5" />
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused('')}
              placeholder={t('auth.emailPlaceholder')}
              required
              autoComplete="email"
              inputMode="email"
            />
          </div>
        </div>

        {/* Password (password login method only) */}
        {authMethod === 'password' && (
        <div>
          <div className="flex items-center justify-between mb-1.5 sm:mb-2.5">
            <label className="text-[15px] sm:text-[15px] font-medium text-exchange-text-secondary">
              {t('auth.password')}
            </label>
            <Link
              to="/forgot-password"
              className="text-[14px] sm:text-[14px] text-exchange-yellow hover:underline"
            >
              {t('auth.forgotPw')}
            </Link>
          </div>
          <div className="auth-field">
            <span className="auth-icon">
              <Lock size={18} className="sm:!w-5 sm:!h-5" />
            </span>
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
              placeholder={t('auth.passwordPlaceholder')}
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="auth-trailing"
              tabIndex={-1}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff size={18} className="sm:!w-5 sm:!h-5" /> : <Eye size={18} className="sm:!w-5 sm:!h-5" />}
            </button>
          </div>
          {capsOn && (
            <p className="mt-1.5 text-[11px] text-exchange-yellow flex items-center gap-1">
              <AlertCircle size={11} /> {t('auth.capsLockOn')}
            </p>
          )}
        </div>
        )}

        {/* Email one-time code (OTP login method only) */}
        {authMethod === 'otp' && (
        <div>
          <div className="flex items-center justify-between mb-1.5 sm:mb-2.5">
            <label className="text-[15px] sm:text-[15px] font-medium text-exchange-text-secondary">
              {t('auth.otpLabel')}
            </label>
            {otpSent && (
              <button
                type="button"
                onClick={requestOtp}
                disabled={otpResendIn > 0 || otpSending}
                className="text-[14px] sm:text-[14px] text-exchange-yellow hover:underline disabled:text-exchange-text-third disabled:no-underline disabled:cursor-not-allowed"
              >
                {otpResendIn > 0
                  ? t('auth.otpResendIn', { s: otpResendIn })
                  : t('auth.otpResend')}
              </button>
            )}
          </div>

          {!otpSent ? (
            <button
              type="button"
              onClick={requestOtp}
              disabled={!emailValid || otpSending}
              className="w-full flex items-center justify-center gap-2 py-3.5 text-sm font-semibold rounded-lg border border-exchange-yellow/60 bg-exchange-yellow/10 text-exchange-yellow hover:bg-exchange-yellow/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {otpSending ? (
                <span className="w-4 h-4 rounded-full border-2 border-exchange-yellow border-t-transparent animate-spin" />
              ) : (
                <KeyRound size={16} />
              )}
              {t('auth.otpSendBtn')}
            </button>
          ) : (
            <>
              <OtpBoxes
                value={otpCode}
                onChange={setOtpCode}
                onComplete={() => { if (!loading) verifyOtp(); }}
                autoFocus
                disabled={loading}
              />
              {otpNotice && (
                <p className="mt-2.5 text-[12px] text-exchange-buy flex items-center gap-1">
                  <Check size={12} /> {otpNotice}
                </p>
              )}
              <p className="mt-2 text-[12px] text-exchange-text-third">
                {t('auth.otpHint')}
              </p>
            </>
          )}
        </div>
        )}

        {/* Remember me */}
        <label className="flex items-center gap-2 sm:gap-2.5 cursor-pointer select-none w-fit pt-1">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-4 h-4 sm:w-[18px] sm:h-[18px] rounded border-exchange-border accent-exchange-yellow"
          />
          <span className="text-[14px] sm:text-[14px] text-exchange-text-secondary">
            {t('auth.rememberMe')}
          </span>
        </label>

        {/* 2FA challenge — Bybit-style "Security Verification" with a
             segmented 6-digit authenticator-code input. Only shown after the
             server responds { requires_2fa: true }, i.e. for users who have
             Google Authenticator enabled. Users without 2FA never see this and
             log in with just email + password. */}
        {needs2fa && (
          <div className="bg-exchange-card border border-exchange-border/70 rounded-xl p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={18} className="text-exchange-yellow" />
              <p className="text-[15px] font-semibold text-exchange-text">
                {t('auth.securityVerification') || 'Security Verification'}
              </p>
            </div>
            <div className="flex items-center gap-1.5 mb-4 text-exchange-text-secondary">
              <KeyRound size={14} />
              <span className="text-[13px]">
                {t('auth.googleAuthenticator') || 'Google Authenticator'}
              </span>
            </div>
            <OtpBoxes
              value={totp}
              onChange={setTotp}
              onComplete={(code) => submit2fa(code)}
              autoFocus
              disabled={loading}
            />
            <p className="mt-3 text-[12px] text-exchange-text-third">
              {t('auth.twoFactorDesc') ||
                'Enter the 6-digit code from your authenticator app.'}
            </p>
          </div>
        )}

        {/* Cloudflare Turnstile bot protection.
             The widget runs INVISIBLY in the background: it still tries to
             obtain a verification token (used automatically once server-side
             enforcement TURNSTILE_ENFORCE=strict is re-enabled), but it never
             renders a visible box or a "Troubleshoot" link, so the login form
             stays clean whether or not the site key has propagated. */}
        <div aria-hidden className="hidden">
          <Turnstile
            onToken={setTurnstileToken}
            onError={setTurnstileErrored}
            theme="dark"
            size="flexible"
          />
        </div>

        {/* Desktop / tablet inline submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="hidden sm:block w-full !py-4 sm:!py-[18px] text-[15px] sm:text-base font-semibold rounded-lg sm:rounded-xl bg-exchange-yellow text-black hover:bg-[#d9a60a] disabled:bg-exchange-border disabled:text-exchange-text-third disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow-md"
        >
          {loading
            ? t('auth.loggingIn')
            : needs2fa
            ? t('auth.verify') || 'Verify'
            : authMethod === 'otp' && !otpSent
            ? t('auth.otpSendBtn')
            : authMethod === 'otp'
            ? t('auth.otpLoginBtn')
            : t('auth.loginBtn')}
        </button>

        {/* Divider */}
        <div className="relative py-2 sm:py-3">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-exchange-border/60" />
          </div>
          <div className="relative flex justify-center">
            <span className="px-3 text-[12px] sm:text-[13px] uppercase tracking-wider text-exchange-text-third bg-exchange-bg">
              {t('auth.or')}
            </span>
          </div>
        </div>

        {/* Referral code (optional) — collapsible, auto-opens when ?ref=CODE present.
            Only applied when creating a new account via Google sign-up; ignored
            on existing-account login. Same UX as RegisterPage. */}
        <div>
          {!showRef ? (
            <button
              type="button"
              onClick={() => setShowRef(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 text-[14px] sm:text-[15px] text-exchange-text-secondary hover:text-exchange-yellow transition-colors"
            >
              <Gift size={15} className="opacity-70" />
              <span>{t('auth.refCodeAdd') || '추천 코드 입력 (선택)'}</span>
            </button>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[14px] sm:text-[15px] font-medium text-exchange-text-secondary flex items-center gap-1.5">
                  <Gift size={15} className="opacity-70" />
                  {t('auth.refCode') || '추천 코드'}
                  <span className="text-exchange-text-third">
                    ({t('auth.optional') || '선택'})
                  </span>
                </label>
                {refCheck.state === 'valid' && refCheck.masked && (
                  <span className="flex items-center gap-1 text-[12px] sm:text-[13px] text-exchange-buy">
                    <Check size={13} /> {refCheck.masked}
                  </span>
                )}
                {refCheck.state === 'invalid' && (
                  <span className="flex items-center gap-1 text-[12px] sm:text-[13px] text-exchange-sell">
                    <X size={13} /> {t('auth.refCodeInvalid') || '유효하지 않은 코드'}
                  </span>
                )}
                {refCheck.state === 'checking' && (
                  <span className="text-[12px] sm:text-[13px] text-exchange-text-third">…</span>
                )}
              </div>
              <input
                type="text"
                value={refCode}
                onChange={(e) =>
                  setRefCode(e.target.value.toUpperCase().trim().slice(0, 16))
                }
                placeholder={t('auth.refCodePlaceholder') || '예: ABC123'}
                maxLength={16}
                spellCheck={false}
                autoCapitalize="characters"
                className="auth-input-plain text-sm tracking-wider font-mono"
              />
              <p className="text-[12px] sm:text-[13px] text-exchange-text-third leading-snug">
                {t('auth.refCodeGoogleHint') ||
                  '구글 신규 가입 시에만 적용 — 기존 계정 로그인엔 영향 없음'}
              </p>
            </div>
          )}
        </div>

        {/* Social */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <SocialBtn
            label="Google"
            icon={<GoogleIcon />}
            onClick={handleGoogleClick}
            loading={googleLoading}
            enabled
          />
          <SocialBtn label="Apple" icon={<AppleIcon />} />
          <SocialBtn label="Kakao" icon={<KakaoIcon />} />
        </div>
      </form>

      {/* Trust row */}
      <div className="mt-10 sm:mt-12 flex items-center justify-center gap-4 text-[12px] sm:text-[13px] text-exchange-text-third">
        <span className="flex items-center gap-1">
          <Lock size={13} /> {t('auth.secure256')}
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
          {loading
            ? t('auth.loggingIn')
            : authMethod === 'otp' && !otpSent
            ? t('auth.otpSendBtn')
            : authMethod === 'otp'
            ? t('auth.otpLoginBtn')
            : t('auth.loginBtn')}
        </button>
      </div>
    </AuthLayout>
  );
}

// ============================================================================
// OtpBoxes — Bybit-style segmented 6-digit code input.
// ----------------------------------------------------------------------------
// Six individual boxes; typing a digit auto-advances, Backspace on an empty
// box steps back, and pasting a 6-digit code fills every box at once.
// Fully controlled via `value` (a string of up to 6 digits) + `onChange`.
// ============================================================================
function OtpBoxes({
  value,
  onChange,
  onComplete,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.split('').concat(Array(6).fill('')).slice(0, 6);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const setAt = (i: number, ch: string) => {
    const next = digits.slice();
    next[i] = ch;
    const joined = next.join('').replace(/\D/g, '').slice(0, 6);
    onChange(joined);
    if (joined.length === 6) onComplete?.(joined);
    return joined;
  };

  const handleChange = (i: number, raw: string) => {
    const only = raw.replace(/\D/g, '');
    if (!only) { setAt(i, ''); return; }
    // If the user typed/auto-filled more than one digit, distribute forward.
    if (only.length > 1) {
      const next = digits.slice();
      let j = i;
      for (const ch of only.split('')) {
        if (j > 5) break;
        next[j] = ch;
        j++;
      }
      const joined = next.join('').replace(/\D/g, '').slice(0, 6);
      onChange(joined);
      if (joined.length === 6) onComplete?.(joined);
      refs.current[Math.min(j, 5)]?.focus();
      return;
    }
    setAt(i, only);
    if (i < 5) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[i]) {
        setAt(i, '');
      } else if (i > 0) {
        refs.current[i - 1]?.focus();
        setAt(i - 1, '');
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < 5) {
      refs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    onChange(pasted);
    if (pasted.length === 6) onComplete?.(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="flex items-center justify-between gap-2 sm:gap-2.5">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={d}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          className="flex-1 min-w-0 h-14 sm:h-16 text-center text-xl sm:text-2xl font-semibold font-mono
                     rounded-xl bg-exchange-card border border-exchange-border/70 text-exchange-text
                     outline-none transition-colors focus:border-exchange-yellow
                     focus:ring-2 focus:ring-exchange-yellow/30 disabled:opacity-50"
        />
      ))}
    </div>
  );
}

function SocialBtn({
  label,
  icon,
  onClick,
  loading,
  enabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  loading?: boolean;
  enabled?: boolean;
}) {
  const disabled = !enabled || !!loading;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={enabled ? onClick : undefined}
      title={enabled ? label : `${label} (coming soon)`}
      className="flex items-center justify-center gap-2 h-12 sm:h-14 rounded-lg sm:rounded-xl border border-exchange-border bg-exchange-card hover:bg-exchange-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
    >
      {loading ? (
        <span className="w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 border-exchange-text-third border-t-transparent animate-spin" />
      ) : (
        icon
      )}
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
