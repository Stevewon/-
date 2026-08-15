// ============================================================================
// Cloudflare Turnstile React wrapper.
// ----------------------------------------------------------------------------
// Renders the invisible/managed challenge widget and calls onToken when the
// visitor solves it. When VITE_TURNSTILE_SITE_KEY is unset we no-op and fire
// onToken('') on mount so the parent form does not block — this preserves the
// "fail-open in dev" contract that the server middleware also honours.
//
// The script (challenges.cloudflare.com/turnstile/v0/api.js) is loaded on
// demand and shared across all mount points.
// ============================================================================

import { useEffect, useRef, useState } from 'react';

const SCRIPT_ID = 'cf-turnstile-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback?: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact' | 'flexible';
          appearance?: 'always' | 'execute' | 'interaction-only';
        },
      ) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve();
    if (window.turnstile) return resolve();
    let el = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (el) {
      el.addEventListener('load', () => resolve());
      el.addEventListener('error', () => reject(new Error('turnstile script failed')));
      return;
    }
    el = document.createElement('script');
    el.id = SCRIPT_ID;
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('turnstile script failed'));
    document.head.appendChild(el);
  });
}

interface Props {
  onToken: (token: string) => void;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact' | 'flexible';
  className?: string;
  /** Called with true when the widget fails to render (e.g. Turnstile 400020
   *  when the site key hasn't propagated) and with false once it recovers, so
   *  the parent can hide the surrounding "Security check" label instead of
   *  leaving an ugly broken/Troubleshoot widget on screen. */
  onError?: (errored: boolean) => void;
}

/**
 * Turnstile widget. Fails OPEN when VITE_TURNSTILE_SITE_KEY is unset so the
 * form still submits — the server side likewise fails open when its secret
 * is not configured.
 */
// QuantaEX production Turnstile SITE key (Cloudflare Turnstile dashboard,
// widget "quantaex-login", hostname quantaex.io, mode Managed). Site keys are
// PUBLIC by design (they ship to the browser), so hard-coding it here is safe.
// It can be overridden at build time via VITE_TURNSTILE_SITE_KEY.
//
// Real bot ENFORCEMENT still requires the matching SECRET key to be set as the
// TURNSTILE_SECRET environment variable on the Cloudflare Pages project, plus
// TURNSTILE_ENFORCE='strict'. Until then the widget is shown and validated by
// Cloudflare, but the server fails open (does not reject) if the secret is unset.
// Cloudflare Turnstile site key for the "quantaex-login-2" widget (Managed
// mode; hostnames quantaex.io / www.quantaex.io / quantaex.pages.dev).
// Format is the canonical 0x4AAAAAAA (0x4 + eight A) prefix + suffix.
// The previous widget's key produced Cloudflare error 400020, so a fresh
// widget was created. Overridable at build time via VITE_TURNSTILE_SITE_KEY.
const TURNSTILE_PROD_SITE_KEY = '0x4AAAAAAAEQiYDpYXkamzaZI';

export default function Turnstile({ onToken, onError, theme = 'dark', size = 'flexible', className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [errored, setErrored] = useState(false);
  const envKey = (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY as string | undefined;
  // Use the build-time env key if provided, otherwise the hard-coded prod key.
  const siteKey = envKey && envKey.trim() ? envKey.trim() : TURNSTILE_PROD_SITE_KEY;

  useEffect(() => {
    // Fail-open: no site key configured → immediately signal empty token so
    // the parent form treats this as "no challenge required".
    if (!siteKey) {
      onToken('');
      return;
    }

    let cancelled = false;
    const markError = () => {
      // Widget could not render / validate (e.g. Turnstile 400020 before the
      // site key has propagated). Fail open: emit an empty token and tell the
      // parent to hide the challenge UI so no broken widget is shown.
      onToken('');
      if (!cancelled) setErrored(true);
      onError?.(true);
    };

    loadScript()
      .then(() => {
        if (cancelled) return;
        if (!ref.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme,
          size,
          appearance: 'always',
          callback: (token: string) => {
            if (cancelled) return;
            setErrored(false);
            onError?.(false);
            onToken(token);
          },
          'expired-callback': () => onToken(''),
          'error-callback': () => markError(),
        });
      })
      .catch((e) => {
        console.warn('[turnstile] load failed — failing open:', e);
        markError();
      });

    return () => {
      cancelled = true;
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
        }
      } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  // When no key is configured, or the widget errored out, render nothing so
  // the login form stays clean (no "Troubleshoot" broken-widget UI).
  if (!siteKey || errored) return null;

  return <div ref={ref} className={className} />;
}
