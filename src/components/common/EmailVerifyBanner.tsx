import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, X } from 'lucide-react';
import useStore from '../../store/useStore';
import { useI18n } from '../../i18n';
import api from '../../utils/api';

/**
 * Global banner shown to logged-in users whose email is not verified.
 * Dismissible per-session (localStorage).
 */
export default function EmailVerifyBanner() {
  const { t } = useI18n();
  const user = useStore((s) => s.user);
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('email_verify_banner_dismissed') === '1',
  );
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!user) return null;
  // Anything truthy (verified) hides the banner
  if ((user as any).email_verified_at) return null;
  if (dismissed) return null;

  const resend = async () => {
    if (!user.email) return;
    setSending(true);
    try {
      await api.post('/auth/request-verification', { email: user.email });
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  const hide = () => {
    sessionStorage.setItem('email_verify_banner_dismissed', '1');
    setDismissed(true);
  };

  return (
    <div className="bg-exchange-yellow/10 border-b border-exchange-yellow/30 text-exchange-yellow">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3 text-xs sm:text-sm">
        <Mail size={16} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-semibold">{t('auth.verifyEmailBannerTitle')}</span>
          <span className="mx-2 opacity-60">—</span>
          <span className="opacity-80">{t('auth.verifyEmailBannerDesc')}</span>
        </div>
        {sent ? (
          <span className="text-[11px] opacity-80 whitespace-nowrap">✓ sent</span>
        ) : (
          <>
            <button
              onClick={resend}
              disabled={sending}
              className="px-2.5 py-1 rounded bg-exchange-yellow text-black font-semibold text-[11px] hover:bg-[#d9a60a] disabled:opacity-60 whitespace-nowrap"
            >
              {t('auth.verifyEmailBannerBtn')}
            </button>
            <Link
              to="/verify-email"
              className="hidden sm:inline text-[11px] underline whitespace-nowrap"
            >
              Open
            </Link>
          </>
        )}
        <button onClick={hide} className="p-1 hover:bg-exchange-yellow/20 rounded" aria-label="dismiss">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
