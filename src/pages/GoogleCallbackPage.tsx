import { useEffect } from 'react';

// ============================================================================
// /auth/google/callback
// ----------------------------------------------------------------------------
// Lightweight bounce page rendered inside the OAuth popup window. After Google
// redirects here with the id_token in the URL fragment, we postMessage the
// token back to the opener (the LoginPage) and close ourselves.
// No UI is needed — the user only sees this for a fraction of a second.
// ============================================================================
export default function GoogleCallbackPage() {
  useEffect(() => {
    const send = (payload: Record<string, any>) => {
      try {
        if (window.opener) {
          window.opener.postMessage(
            { source: 'quantaex_google_oauth', ...payload },
            window.location.origin,
          );
        }
      } catch { /* ignore */ }
      setTimeout(() => {
        try { window.close(); } catch { /* ignore */ }
      }, 50);
    };

    // Google returns the token in the URL fragment for response_type=id_token.
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const idToken = params.get('id_token') || '';
    const state   = params.get('state') || '';
    const error   = params.get('error') || '';

    if (error) {
      send({ error });
    } else if (!idToken) {
      send({ error: 'Missing id_token' });
    } else {
      send({ idToken, state });
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-exchange-bg text-exchange-text">
      <div className="text-center">
        <div className="w-10 h-10 mx-auto mb-4 rounded-full border-2 border-exchange-yellow border-t-transparent animate-spin" />
        <p className="text-sm text-exchange-text-secondary">Signing in with Google…</p>
      </div>
    </div>
  );
}
