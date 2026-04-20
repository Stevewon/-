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
      showToast('warning', 'KYC 인증', '모든 항목을 입력해주세요');
      return;
    }
    setKycLoading(true);
    try {
      await api.post('/auth/kyc', { name: kycName, phone: kycPhone, id_number: kycIdNumber });
      showToast('success', 'KYC 인증', 'KYC 인증 신청이 완료되었습니다');
      setShowKyc(false);
    } catch (err: any) {
      showToast('error', 'KYC 인증 실패', err.response?.data?.error || '다시 시도해주세요');
    } finally {
      setKycLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
    showToast('info', '로그아웃', '안전하게 로그아웃되었습니다');
  };

  if (!user) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <User size={48} className="text-exchange-text-third mb-4" />
        <p className="text-exchange-text-secondary mb-4">로그인이 필요합니다</p>
        <Link to="/login" className="btn-primary px-6 py-2 rounded-lg">{t('nav.login')}</Link>
      </div>
    );
  }

  const kycStatus = user.kyc_status || 'none';
  const kycStatusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2; bg: string }> = {
    none: { label: '미인증', color: 'text-exchange-text-third', icon: AlertCircle, bg: 'bg-exchange-hover/50' },
    pending: { label: '심사중', color: 'text-exchange-yellow', icon: Clock, bg: 'bg-exchange-yellow/10' },
    approved: { label: '인증완료', color: 'text-exchange-buy', icon: CheckCircle2, bg: 'bg-exchange-buy/10' },
    rejected: { label: '반려', color: 'text-exchange-sell', icon: XCircle, bg: 'bg-exchange-sell/10' },
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
                가입일: {user.created_at ? new Date(user.created_at).toLocaleDateString('ko-KR') : '-'}
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
                <h3 className="text-sm font-semibold text-exchange-text">본인인증 (KYC)</h3>
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
                인증하기
              </button>
            )}
          </div>

          {/* KYC Form */}
          {showKyc && (
            <div className="mt-4 pt-4 border-t border-exchange-border space-y-3">
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">이름 (실명)</label>
                <input
                  type="text"
                  value={kycName}
                  onChange={e => setKycName(e.target.value)}
                  placeholder="홍길동"
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">전화번호</label>
                <input
                  type="tel"
                  value={kycPhone}
                  onChange={e => setKycPhone(e.target.value)}
                  placeholder="010-0000-0000"
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">주민등록번호 (앞자리)</label>
                <input
                  type="text"
                  value={kycIdNumber}
                  onChange={e => setKycIdNumber(e.target.value)}
                  placeholder="000000"
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
                  {kycLoading ? '처리중...' : '인증 신청'}
                </button>
                <button
                  onClick={() => setShowKyc(false)}
                  className="px-4 py-2 rounded-lg text-sm text-exchange-text-secondary hover:text-exchange-text border border-exchange-border hover:bg-exchange-hover transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Menu Items */}
      <div className="bg-exchange-card rounded-xl border border-exchange-border overflow-hidden mb-4">
        {([
          { icon: Lock, label: '보안 설정', desc: '비밀번호 변경, 2FA 설정', path: '#' },
          { icon: FileText, label: '주문 내역', desc: '주문 및 체결 기록 확인', path: '/orders' },
          { icon: Smartphone, label: 'API 관리', desc: 'API 키 발급 및 관리', path: '#' },
          { icon: Settings, label: '환경 설정', desc: '알림, 화폐 단위 설정', path: '#' },
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
        로그아웃
      </button>
    </div>
  );
}
