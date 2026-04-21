import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';
import {
  User, Shield, Mail, Clock, CheckCircle2, AlertCircle, XCircle,
  ChevronRight, LogOut, Lock, Smartphone, FileText, Settings,
} from 'lucide-react';

export default function ProfilePage() {
  const { t } = useI18n();
  const { user, logout } = useStore();
  const navigate = useNavigate();

  // KYC form
  const [showKyc, setShowKyc] = useState(false);
  const [kycName, setKycName] = useState('');
  const [kycPhone, setKycPhone] = useState('');
  const [kycIdNumber, setKycIdNumber] = useState('');
  const [kycLoading, setKycLoading] = useState(false);

  const handleKycSubmit = async () => {
    if (!kycName || !kycPhone || !kycIdNumber) {
      showToast('warning', t('profile.kycTitle'), t('profile.kycAllFields'));
      return;
    }
    setKycLoading(true);
    try {
      await api.post('/auth/kyc', { name: kycName, phone: kycPhone, id_number: kycIdNumber });
      showToast('success', t('profile.kycTitle'), t('profile.kycSubmitted'));
      setShowKyc(false);
    } catch (err: any) {
      showToast('error', t('profile.kycFailed'), err.response?.data?.error || t('profile.kycRetry'));
    } finally {
      setKycLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
    showToast('info', t('profile.logoutMsg'), t('profile.logoutDesc'));
  };

  if (!user) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <User size={48} className="text-exchange-text-third mb-4" />
        <p className="text-exchange-text-secondary mb-4">{t('wallet.loginRequired')}</p>
        <Link to="/login" className="btn-primary px-6 py-2 rounded-lg">{t('nav.login')}</Link>
      </div>
    );
  }

  const kycStatus = user.kyc_status || 'none';
  const kycStatusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2; bg: string }> = {
    none: { label: t('profile.unverified'), color: 'text-exchange-text-third', icon: AlertCircle, bg: 'bg-exchange-hover/50' },
    pending: { label: t('profile.underReview'), color: 'text-exchange-yellow', icon: Clock, bg: 'bg-exchange-yellow/10' },
    approved: { label: t('profile.verified'), color: 'text-exchange-buy', icon: CheckCircle2, bg: 'bg-exchange-buy/10' },
    rejected: { label: t('profile.rejected'), color: 'text-exchange-sell', icon: XCircle, bg: 'bg-exchange-sell/10' },
  };
  const kyc = kycStatusConfig[kycStatus] || kycStatusConfig.none;
  const KycIcon = kyc.icon;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Profile Header */}
      <div className="bg-gradient-to-br from-exchange-card to-exchange-bg rounded-2xl border border-exchange-border p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-exchange-yellow/10 rounded-full flex items-center justify-center border-2 border-exchange-yellow/30">
            <User size={28} className="text-exchange-yellow" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-exchange-text">{user.nickname}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Mail size={13} className="text-exchange-text-third" />
              <span className="text-sm text-exchange-text-secondary">{user.email}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Clock size={13} className="text-exchange-text-third" />
              <span className="text-xs text-exchange-text-third">
                {t('profile.joinDate')}: {user.created_at ? new Date(user.created_at).toLocaleDateString('en-US') : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* KYC Status */}
      <div className="bg-exchange-card rounded-xl border border-exchange-border mb-4">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 ${kyc.bg} rounded-xl flex items-center justify-center`}>
                <Shield size={20} className={kyc.color} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-exchange-text">{t('profile.kycIdentity')}</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <KycIcon size={13} className={kyc.color} />
                  <span className={`text-xs font-medium ${kyc.color}`}>{kyc.label}</span>
                </div>
              </div>
            </div>
            {kycStatus === 'none' && (
              <button
                onClick={() => setShowKyc(!showKyc)}
                className="px-4 py-2 bg-exchange-yellow text-black rounded-lg text-xs font-semibold hover:bg-exchange-yellow/90 transition-colors"
              >
                {t('profile.verify')}
              </button>
            )}
          </div>

          {/* KYC Form */}
          {showKyc && (
            <div className="mt-4 pt-4 border-t border-exchange-border space-y-3">
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">{t('profile.kycName')}</label>
                <input
                  type="text"
                  value={kycName}
                  onChange={e => setKycName(e.target.value)}
                  placeholder={t('profile.namePlaceholder')}
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">{t('profile.kycPhone')}</label>
                <input
                  type="tel"
                  value={kycPhone}
                  onChange={e => setKycPhone(e.target.value)}
                  placeholder={t('profile.phonePlaceholder')}
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">{t('profile.idLabel')}</label>
                <input
                  type="text"
                  value={kycIdNumber}
                  onChange={e => setKycIdNumber(e.target.value)}
                  placeholder={t('profile.idPlaceholder')}
                  maxLength={6}
                  className="input-field text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleKycSubmit}
                  disabled={kycLoading}
                  className="btn-primary text-sm !py-2 disabled:opacity-50"
                >
                  {kycLoading ? t('wallet.processing') : t('profile.submit')}
                </button>
                <button
                  onClick={() => setShowKyc(false)}
                  className="px-4 py-2 rounded-lg text-sm text-exchange-text-secondary hover:text-exchange-text border border-exchange-border hover:bg-exchange-hover transition-colors"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Menu Items */}
      <div className="bg-exchange-card rounded-xl border border-exchange-border overflow-hidden mb-4">
        {([
          { icon: Lock, label: t('profile.security'), desc: t('profile.securityDesc'), path: '#' },
          { icon: FileText, label: t('profile.orderHistory'), desc: t('profile.orderHistoryDesc'), path: '/orders' },
          { icon: Smartphone, label: t('profile.apiManage'), desc: t('profile.apiManageDesc'), path: '#' },
          { icon: Settings, label: t('profile.settings'), desc: t('profile.settingsDesc'), path: '#' },
        ]).map(({ icon: Icon, label, desc, path }, i) => (
          <Link
            key={i}
            to={path}
            className="flex items-center gap-3 px-4 py-3.5 hover:bg-exchange-hover/30 border-b border-exchange-border/30 last:border-b-0 transition-colors"
          >
            <div className="w-9 h-9 bg-exchange-hover/50 rounded-lg flex items-center justify-center">
              <Icon size={17} className="text-exchange-text-secondary" />
            </div>
            <div className="flex-1">
              <span className="text-sm font-medium text-exchange-text">{label}</span>
              <p className="text-[11px] text-exchange-text-third">{desc}</p>
            </div>
            <ChevronRight size={16} className="text-exchange-text-third" />
          </Link>
        ))}
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-exchange-card rounded-xl border border-exchange-border text-exchange-sell text-sm font-medium hover:bg-exchange-sell/10 transition-colors"
      >
        <LogOut size={16} />
        {t('nav.logout')}
      </button>
    </div>
  );
}
