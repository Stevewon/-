import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import api from '../utils/api';
import { useI18n } from '../i18n';
import QuantaLogo from '../components/common/QuantaLogo';
import LangSwitch from '../components/common/LangSwitch';
import useStore from '../store/useStore';

export default function VerifyEmailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [message, setMessage] = useState('');
  const user = useStore((s) => s.user);

  useEffect(() => {
    if (!token) return;
    setStatus('loading');
    api.post('/auth/verify-email', { token })
      .then(() => {
        setStatus('ok');
        setMessage(t('auth.verifyEmailSuccess'));
        // Refresh user in store
        api.get('/auth/me').then((r) => {
          const u = useStore.getState().user;
          if (u) useStore.getState().setAuth({ ...u, ...r.data }, localStorage.getItem('token') || '');
        }).catch(() => {});
      })
      .catch((err) => {
        setStatus('err');
        setMessage(err.response?.data?.error || t('auth.resetInvalid'));
      });
  }, [token]);

  const resend = async () => {
    const email = user?.email || localStorage.getItem('quantaex_last_email') || '';
    if (!email) return;
    try {
      await api.post('/auth/request-verification', { email });
      setStatus('ok');
      setMessage(t('auth.verifyEmailDesc'));
    } catch (err: any) {
      setStatus('err');
      setMessage(err.response?.data?.error || 'Failed');
    }
  };

  return (
    <div className="min-h-screen bg-exchange-bg flex flex-col">
      <header className="sticky top-0 z-30 bg-exchange-bg/95 backdrop-blur border-b border-exchange-border/40">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="p-1 -ml-1 hover:bg-exchange-hover rounded-md">
            <ArrowLeft size={22} />
          </Link>
          <QuantaLogo size={24} />
          <LangSwitch />
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2">{t('auth.verifyEmail')}</h1>

          {status === 'loading' && (
            <div className="flex justify-center my-8">
              <Loader2 className="animate-spin text-exchange-yellow" size={36} />
            </div>
          )}
          {status === 'ok' && (
            <div className="bg-exchange-buy/10 border border-exchange-buy/30 text-exchange-buy rounded-lg px-4 py-3 text-sm flex items-start gap-2 my-4">
              <CheckCircle2 className="shrink-0 mt-0.5" size={18} />
              <span>{message}</span>
            </div>
          )}
          {status === 'err' && (
            <div className="bg-exchange-sell/10 border border-exchange-sell/30 text-exchange-sell rounded-lg px-4 py-3 text-sm flex items-start gap-2 my-4">
              <AlertCircle className="shrink-0 mt-0.5" size={18} />
              <span>{message}</span>
            </div>
          )}

          {!token && (
            <>
              <p className="text-sm text-exchange-text-secondary mb-6">{t('auth.verifyEmailDesc')}</p>
              {user && (
                <button
                  onClick={resend}
                  className="bg-exchange-yellow text-black px-4 py-2.5 rounded-lg font-semibold text-sm hover:bg-[#d9a60a]"
                >
                  {t('auth.verifyEmailResend')}
                </button>
              )}
            </>
          )}

          <div className="mt-6">
            <Link to="/" className="text-sm text-exchange-yellow hover:underline">
              {t('common.home') || 'Home'}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
