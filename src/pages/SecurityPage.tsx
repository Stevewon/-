import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';
import QRCode from '../components/common/QRCode';
import {
  Lock, ChevronLeft, Smartphone, Shield, Monitor, Copy,
  CheckCircle2, XCircle, Clock, AlertTriangle,
} from 'lucide-react';
import type { LoginHistoryEntry } from '../types';

export default function SecurityPage() {
  const { t } = useI18n();
  const { user, setUser } = useStore();
  const navigate = useNavigate();

  // 2FA state
  const [twoFaSetup, setTwoFaSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [disablePw, setDisablePw] = useState('');

  // Login history
  const [history, setHistory] = useState<LoginHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/profile/login-history');
        setHistory(res.data);
      } catch { /* ignore */ }
      setLoadingHistory(false);
    })();
  }, []);

  if (!user) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <p className="text-exchange-text-secondary mb-4">{t('wallet.loginRequired')}</p>
        <Link to="/login" className="btn-primary px-6 py-2 rounded-lg">{t('nav.login')}</Link>
      </div>
    );
  }

  const handleSetup2FA = async () => {
    setTwoFaLoading(true);
    try {
      const res = await api.post('/profile/2fa/setup');
      setTwoFaSetup(res.data);
    } catch (err: any) {
      showToast('error', t('security.twoFa'), err.response?.data?.error || t('profile.saveFailed'));
    } finally {
      setTwoFaLoading(false);
    }
  };

  const handleEnable2FA = async () => {
    if (twoFaCode.length !== 6) {
      showToast('warning', t('security.twoFa'), t('security.enter6Digit'));
      return;
    }
    setTwoFaLoading(true);
    try {
      await api.post('/profile/2fa/enable', { code: twoFaCode });
      if (user) setUser({ ...user, two_factor_enabled: 1 });
      showToast('success', t('security.twoFa'), t('security.twoFaEnabled'));
      setTwoFaSetup(null);
      setTwoFaCode('');
    } catch (err: any) {
      showToast('error', t('security.twoFa'), err.response?.data?.error || t('profile.saveFailed'));
    } finally {
      setTwoFaLoading(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!disablePw) {
      showToast('warning', t('security.twoFa'), t('profile.allFieldsRequired'));
      return;
    }
    setTwoFaLoading(true);
    try {
      await api.post('/profile/2fa/disable', { password: disablePw });
      if (user) setUser({ ...user, two_factor_enabled: 0 });
      showToast('success', t('security.twoFa'), t('security.twoFaDisabled'));
      setShowDisable(false);
      setDisablePw('');
    } catch (err: any) {
      showToast('error', t('security.twoFa'), err.response?.data?.error || t('profile.saveFailed'));
    } finally {
      setTwoFaLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('success', t('common.copied'), text);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button onClick={() => navigate('/profile')} className="flex items-center gap-1 text-sm text-exchange-text-secondary hover:text-exchange-text mb-4">
        <ChevronLeft size={16} /> {t('common.back')}
      </button>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 bg-exchange-yellow/10 rounded-xl flex items-center justify-center">
          <Lock size={22} className="text-exchange-yellow" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-exchange-text">{t('security.title')}</h1>
          <p className="text-xs text-exchange-text-third">{t('security.subtitle')}</p>
        </div>
      </div>

      {/* 2FA Card */}
      <div className="bg-exchange-card rounded-xl border border-exchange-border p-5 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-exchange-buy/10 rounded-lg flex items-center justify-center">
              <Smartphone size={20} className="text-exchange-buy" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-exchange-text">{t('security.twoFa')}</h3>
              <p className="text-xs text-exchange-text-third mt-0.5">{t('security.twoFaDesc')}</p>
            </div>
          </div>
          <span className={`text-xs font-medium px-2 py-1 rounded-md ${user.two_factor_enabled ? 'bg-exchange-buy/10 text-exchange-buy' : 'bg-exchange-hover text-exchange-text-third'}`}>
            {user.two_factor_enabled ? t('profile.enabled') : t('profile.disabled')}
          </span>
        </div>

        {!user.two_factor_enabled && !twoFaSetup && (
          <button onClick={handleSetup2FA} disabled={twoFaLoading} className="btn-primary text-sm !py-2 disabled:opacity-50">
            {twoFaLoading ? t('wallet.processing') : t('security.enable2Fa')}
          </button>
        )}

        {/* Setup flow */}
        {twoFaSetup && (
          <div className="mt-3 pt-4 border-t border-exchange-border space-y-4">
            <div className="bg-exchange-bg rounded-lg p-4">
              <h4 className="text-xs font-semibold text-exchange-text mb-2">{t('security.step1Scan')}</h4>
              <p className="text-[11px] text-exchange-text-third mb-3">{t('security.scanDesc')}</p>
              <div className="flex justify-center mb-3">
                <div className="bg-white p-3 rounded-lg">
                  <QRCode value={twoFaSetup.otpauth_url} size={160} />
                </div>
              </div>
              <div className="bg-exchange-card rounded px-3 py-2 flex items-center gap-2">
                <code className="flex-1 text-[11px] text-exchange-text-secondary font-mono break-all">{twoFaSetup.secret}</code>
                <button onClick={() => copyToClipboard(twoFaSetup.secret)} className="text-exchange-text-third hover:text-exchange-yellow">
                  <Copy size={14} />
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-exchange-text-third mb-1 block">{t('security.step2Code')}</label>
              <input
                type="text"
                value={twoFaCode}
                onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="input-field text-sm text-center tracking-[0.5em] font-mono text-lg"
              />
            </div>

            <div className="flex gap-2">
              <button onClick={() => { setTwoFaSetup(null); setTwoFaCode(''); }} className="flex-1 px-4 py-2.5 rounded-lg text-sm text-exchange-text-secondary border border-exchange-border hover:bg-exchange-hover">
                {t('common.cancel')}
              </button>
              <button onClick={handleEnable2FA} disabled={twoFaLoading || twoFaCode.length !== 6} className="flex-1 btn-primary text-sm !py-2.5 disabled:opacity-50">
                {twoFaLoading ? t('wallet.processing') : t('security.verify')}
              </button>
            </div>
          </div>
        )}

        {/* Disable flow */}
        {user.two_factor_enabled && !showDisable && (
          <button onClick={() => setShowDisable(true)} className="px-4 py-2 rounded-lg text-sm text-exchange-sell border border-exchange-sell/30 hover:bg-exchange-sell/10 transition-colors">
            {t('security.disable2Fa')}
          </button>
        )}
        {showDisable && (
          <div className="mt-3 pt-4 border-t border-exchange-border space-y-3">
            <div className="bg-exchange-sell/10 border border-exchange-sell/30 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-exchange-sell shrink-0 mt-0.5" />
              <p className="text-[11px] text-exchange-text-secondary">{t('security.disableWarning')}</p>
            </div>
            <input
              type="password"
              value={disablePw}
              onChange={e => setDisablePw(e.target.value)}
              placeholder={t('profile.currentPassword')}
              className="input-field text-sm"
            />
            <div className="flex gap-2">
              <button onClick={() => { setShowDisable(false); setDisablePw(''); }} className="flex-1 px-4 py-2 rounded-lg text-sm text-exchange-text-secondary border border-exchange-border hover:bg-exchange-hover">
                {t('common.cancel')}
              </button>
              <button onClick={handleDisable2FA} disabled={twoFaLoading} className="flex-1 px-4 py-2 rounded-lg text-sm bg-exchange-sell hover:bg-exchange-sell/90 text-white disabled:opacity-50">
                {twoFaLoading ? t('wallet.processing') : t('security.confirmDisable')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Login History */}
      <div className="bg-exchange-card rounded-xl border border-exchange-border p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-exchange-yellow/10 rounded-lg flex items-center justify-center">
            <Monitor size={20} className="text-exchange-yellow" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-exchange-text">{t('security.loginHistory')}</h3>
            <p className="text-xs text-exchange-text-third mt-0.5">{t('security.loginHistoryDesc')}</p>
          </div>
        </div>

        {loadingHistory ? (
          <div className="text-center py-6 text-xs text-exchange-text-third">{t('common.loading')}</div>
        ) : history.length === 0 ? (
          <div className="text-center py-6 text-xs text-exchange-text-third">{t('security.noHistory')}</div>
        ) : (
          <div className="divide-y divide-exchange-border/30 -mx-5">
            {history.map(h => (
              <div key={h.id} className="flex items-center gap-3 px-5 py-3">
                {h.status === 'success' ? (
                  <CheckCircle2 size={16} className="text-exchange-buy shrink-0" />
                ) : (
                  <XCircle size={16} className="text-exchange-sell shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-exchange-text">{h.device || 'Unknown'}</span>
                    <span className="text-[10px] text-exchange-text-third">{h.ip_address || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Clock size={10} className="text-exchange-text-third" />
                    <span className="text-[11px] text-exchange-text-third">{new Date(h.created_at).toLocaleString()}</span>
                    {h.reason && <span className="text-[10px] text-exchange-sell">· {h.reason}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
