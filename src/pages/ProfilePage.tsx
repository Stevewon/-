import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';
import {
  User, Shield, Mail, Clock, CheckCircle2, AlertCircle, XCircle,
  ChevronRight, LogOut, Lock, Smartphone, FileText, Key, Edit2,
  CheckCircle, Eye, EyeOff,
} from 'lucide-react';

export default function ProfilePage() {
  const { t } = useI18n();
  const { user, setUser, logout } = useStore();
  const navigate = useNavigate();

  // Nickname edit
  const [editNick, setEditNick] = useState(false);
  const [nickname, setNickname] = useState('');
  const [savingNick, setSavingNick] = useState(false);

  // Password change
  const [showPwModal, setShowPwModal] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (user) setNickname(user.nickname);
  }, [user?.nickname]);

  const handleNicknameSave = async () => {
    if (!nickname || nickname.length < 2 || nickname.length > 20) {
      showToast('warning', t('profile.nickname'), t('profile.nicknameLen'));
      return;
    }
    setSavingNick(true);
    try {
      await api.patch('/profile', { nickname });
      if (user) setUser({ ...user, nickname });
      showToast('success', t('profile.saved'), t('profile.nicknameUpdated'));
      setEditNick(false);
    } catch (err: any) {
      showToast('error', t('common.error'), err.response?.data?.error || t('profile.saveFailed'));
    } finally {
      setSavingNick(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!curPw || !newPw || !confirmPw) {
      showToast('warning', t('profile.password'), t('profile.allFieldsRequired'));
      return;
    }
    if (newPw !== confirmPw) {
      showToast('error', t('profile.password'), t('profile.pwMismatch'));
      return;
    }
    if (newPw.length < 8) {
      showToast('warning', t('profile.password'), t('profile.pwTooShort'));
      return;
    }
    setSavingPw(true);
    try {
      await api.post('/profile/password', { current_password: curPw, new_password: newPw });
      showToast('success', t('profile.saved'), t('profile.pwChanged'));
      setShowPwModal(false);
      setCurPw(''); setNewPw(''); setConfirmPw('');
    } catch (err: any) {
      showToast('error', t('common.error'), err.response?.data?.error || t('profile.saveFailed'));
    } finally {
      setSavingPw(false);
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

  const menuItems = [
    { icon: Shield, label: t('profile.kyc'), desc: t('profile.kycDesc'), path: '/profile/kyc', badge: kyc.label, badgeColor: kyc.color },
    { icon: Lock, label: t('profile.security'), desc: t('profile.securityDesc'), path: '/profile/security' },
    { icon: Smartphone, label: t('profile.twoFactor'), desc: t('profile.twoFactorDesc'), path: '/profile/security', badge: user.two_factor_enabled ? t('profile.enabled') : t('profile.disabled'), badgeColor: user.two_factor_enabled ? 'text-exchange-buy' : 'text-exchange-text-third' },
    { icon: Key, label: t('profile.apiManage'), desc: t('profile.apiManageDesc'), path: '/profile/api-keys' },
    { icon: FileText, label: t('profile.orderHistory'), desc: t('profile.orderHistoryDesc'), path: '/orders' },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Profile Header */}
      <div className="bg-gradient-to-br from-exchange-card to-exchange-bg rounded-2xl border border-exchange-border p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-exchange-yellow/10 rounded-full flex items-center justify-center border-2 border-exchange-yellow/30">
            <User size={28} className="text-exchange-yellow" />
          </div>
          <div className="flex-1 min-w-0">
            {editNick ? (
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  className="input-field text-sm flex-1"
                  maxLength={20}
                  autoFocus
                />
                <button onClick={handleNicknameSave} disabled={savingNick} className="btn-primary !py-1.5 !px-3 text-xs">
                  {savingNick ? '...' : t('common.save')}
                </button>
                <button onClick={() => { setEditNick(false); setNickname(user.nickname); }} className="text-xs text-exchange-text-third hover:text-exchange-text px-2">
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-exchange-text truncate">{user.nickname}</h2>
                <button onClick={() => setEditNick(true)} className="text-exchange-text-third hover:text-exchange-yellow transition-colors">
                  <Edit2 size={14} />
                </button>
              </div>
            )}
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

        {/* Status badges */}
        <div className="flex flex-wrap gap-2 mt-4">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${kyc.bg} ${kyc.color}`}>
            <KycIcon size={12} />
            KYC: {kyc.label}
          </span>
          {user.two_factor_enabled ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-exchange-buy/10 text-exchange-buy">
              <CheckCircle size={12} />
              2FA: {t('profile.enabled')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-exchange-hover/50 text-exchange-text-third">
              <AlertCircle size={12} />
              2FA: {t('profile.disabled')}
            </span>
          )}
        </div>
      </div>

      {/* Quick Actions: Change Password */}
      <div className="bg-exchange-card rounded-xl border border-exchange-border p-4 mb-4">
        <button
          onClick={() => setShowPwModal(true)}
          className="w-full flex items-center gap-3 hover:bg-exchange-hover/30 -mx-4 -my-4 px-4 py-4 rounded-xl transition-colors"
        >
          <div className="w-9 h-9 bg-exchange-yellow/10 rounded-lg flex items-center justify-center">
            <Lock size={17} className="text-exchange-yellow" />
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-exchange-text">{t('profile.changePassword')}</div>
            <div className="text-[11px] text-exchange-text-third">{t('profile.changePasswordDesc')}</div>
          </div>
          <ChevronRight size={16} className="text-exchange-text-third" />
        </button>
      </div>

      {/* Menu Items */}
      <div className="bg-exchange-card rounded-xl border border-exchange-border overflow-hidden mb-4">
        {menuItems.map(({ icon: Icon, label, desc, path, badge, badgeColor }, i) => (
          <Link
            key={i}
            to={path}
            className="flex items-center gap-3 px-4 py-3.5 hover:bg-exchange-hover/30 border-b border-exchange-border/30 last:border-b-0 transition-colors"
          >
            <div className="w-9 h-9 bg-exchange-hover/50 rounded-lg flex items-center justify-center">
              <Icon size={17} className="text-exchange-text-secondary" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-exchange-text">{label}</span>
              <p className="text-[11px] text-exchange-text-third truncate">{desc}</p>
            </div>
            {badge && (
              <span className={`text-[10px] font-medium mr-2 ${badgeColor || 'text-exchange-text-third'}`}>
                {badge}
              </span>
            )}
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

      {/* Password Change Modal */}
      {showPwModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowPwModal(false)}>
          <div className="bg-exchange-card rounded-xl border border-exchange-border w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Lock size={20} className="text-exchange-yellow" />
              <h3 className="text-lg font-semibold text-exchange-text">{t('profile.changePassword')}</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">{t('profile.currentPassword')}</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={curPw}
                    onChange={e => setCurPw(e.target.value)}
                    className="input-field text-sm pr-10"
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-exchange-text-third">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">{t('profile.newPassword')}</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  className="input-field text-sm"
                  placeholder={t('profile.pwMinLen')}
                />
              </div>
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">{t('profile.confirmPassword')}</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  className="input-field text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowPwModal(false)}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm text-exchange-text-secondary border border-exchange-border hover:bg-exchange-hover transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handlePasswordChange}
                disabled={savingPw}
                className="flex-1 btn-primary text-sm !py-2.5 disabled:opacity-50"
              >
                {savingPw ? t('wallet.processing') : t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
