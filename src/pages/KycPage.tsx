import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';
import {
  Shield, ChevronLeft, CheckCircle2, Clock, AlertCircle, XCircle,
  Upload, FileText, MapPin, User as UserIcon, Phone, IdCard, ArrowRight,
} from 'lucide-react';

export default function KycPage() {
  const { t } = useI18n();
  const { user, setUser } = useStore();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    id_number: '',
    address: '',
    id_document_url: '',
    address_document_url: '',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load current KYC
    (async () => {
      try {
        const res = await api.get('/profile/kyc');
        setForm(f => ({
          ...f,
          name: res.data.kyc_name || '',
          phone: res.data.kyc_phone || '',
          address: res.data.kyc_address || '',
          id_document_url: res.data.kyc_id_document_url || '',
          address_document_url: res.data.kyc_address_document_url || '',
        }));
      } catch { /* ignore */ }
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

  const status = user.kyc_status || 'none';

  const statusBadge = () => {
    const cfg: Record<string, { icon: any; color: string; bg: string; label: string; desc: string }> = {
      none: { icon: AlertCircle, color: 'text-exchange-text-third', bg: 'bg-exchange-hover', label: t('profile.unverified'), desc: t('kyc.needsSubmit') },
      pending: { icon: Clock, color: 'text-exchange-yellow', bg: 'bg-exchange-yellow/10', label: t('profile.underReview'), desc: t('kyc.reviewInProgress') },
      approved: { icon: CheckCircle2, color: 'text-exchange-buy', bg: 'bg-exchange-buy/10', label: t('profile.verified'), desc: t('kyc.approvedDesc') },
      rejected: { icon: XCircle, color: 'text-exchange-sell', bg: 'bg-exchange-sell/10', label: t('profile.rejected'), desc: t('kyc.rejectedDesc') },
    };
    const c = cfg[status] || cfg.none;
    const Icon = c.icon;
    return (
      <div className={`${c.bg} rounded-xl p-4 mb-6 border border-exchange-border/30`}>
        <div className="flex items-start gap-3">
          <Icon size={24} className={c.color} />
          <div className="flex-1">
            <h3 className={`text-sm font-semibold ${c.color}`}>{c.label}</h3>
            <p className="text-xs text-exchange-text-secondary mt-1">{c.desc}</p>
          </div>
        </div>
      </div>
    );
  };

  const validateStep = (n: number) => {
    if (n === 1) return form.name.trim().length >= 2 && form.phone.trim().length >= 7 && form.id_number.trim().length >= 4;
    if (n === 2) return form.address.trim().length >= 5;
    return true;
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await api.post('/profile/kyc', form);
      if (user) setUser({ ...user, kyc_status: 'pending', kyc_name: form.name, kyc_phone: form.phone, kyc_address: form.address });
      showToast('success', t('kyc.title'), t('kyc.submitted'));
      navigate('/profile');
    } catch (err: any) {
      showToast('error', t('kyc.title'), err.response?.data?.error || t('profile.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Real file upload — streams the file to POST /api/profile/kyc/upload as
  // multipart/form-data. The server stores the blob in R2 (when the
  // KYC_BUCKET binding is configured) and returns a storage tag like
  //   'r2://kyc/<user_id>/<kind>/<hash>-<filename>'    (R2 backed)
  //   'kyc-doc:<sha256-prefix>:<size>:<filename>'      (fallback)
  // We put that tag into form state so the subsequent POST /api/profile/kyc
  // records it in users.kyc_*_document_url for the reviewer.
  //
  // Limits enforced both client-side (UX) and server-side (security):
  //   * 10 MB max
  //   * image/* or application/pdf only
  const handleFileSelect = async (
    field: 'id_document_url' | 'address_document_url',
    file: File | null,
  ) => {
    if (!file) return;
    if (!/^image\//.test(file.type) && file.type !== 'application/pdf') {
      showToast('error', t('kyc.invalidFile') || 'Invalid file', t('kyc.imageOrPdfOnly') || 'Image or PDF only');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('error', t('kyc.fileTooLarge') || 'File too large', '10MB max');
      return;
    }
    try {
      // Map UI field name -> server kind.
      const kind = field === 'id_document_url' ? 'id_document' : 'address_document';
      const fd = new FormData();
      fd.append('field', kind);
      fd.append('file', file);

      // Use axios `api` instance so the JWT auth header is attached. Browsers
      // set the multipart boundary automatically when we pass FormData.
      const res = await api.post('/profile/kyc/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // Allow large files without timeout escalation (default is fine for 10MB).
      });
      const tag = res.data?.storage_tag;
      if (!tag) throw new Error('Server did not return storage_tag');
      setForm(prev => ({ ...prev, [field]: tag }));
      const backend = res.data?.storage_backend === 'r2' ? ' (R2)' : '';
      showToast('success', t('kyc.fileUploaded') || 'Uploaded', file.name + backend);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'unknown';
      showToast('error', t('kyc.fileUploaded') || 'Upload failed', msg);
    }
  };

  // Editable when: never submitted OR rejected (allow resubmission)
  const editable: boolean = status === 'none' || status === 'rejected';
  const readOnly = !editable;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <button onClick={() => navigate('/profile')} className="flex items-center gap-1 text-sm text-exchange-text-secondary hover:text-exchange-text mb-4">
        <ChevronLeft size={16} /> {t('common.back')}
      </button>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 bg-exchange-yellow/10 rounded-xl flex items-center justify-center">
          <Shield size={22} className="text-exchange-yellow" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-exchange-text">{t('kyc.title')}</h1>
          <p className="text-xs text-exchange-text-third">{t('kyc.subtitle')}</p>
        </div>
      </div>

      {statusBadge()}

      {/* Stepper */}
      {!readOnly && (
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3].map(n => (
            <div key={n} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${step >= n ? 'bg-exchange-yellow text-black' : 'bg-exchange-hover text-exchange-text-third'}`}>
                {n}
              </div>
              {n < 3 && (
                <div className={`w-12 h-[2px] mx-1 ${step > n ? 'bg-exchange-yellow' : 'bg-exchange-hover'}`} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Step 1 — Personal Info */}
      {editable && step === 1 && (
        <div className="bg-exchange-card rounded-xl border border-exchange-border p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <UserIcon size={18} className="text-exchange-yellow" />
            <h2 className="text-sm font-semibold text-exchange-text">{t('kyc.step1')} — {t('kyc.personalInfo')}</h2>
          </div>
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">{t('profile.kycName')}</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t('profile.namePlaceholder')} className="input-field text-sm" />
          </div>
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">{t('profile.kycPhone')}</label>
            <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder={t('profile.phonePlaceholder')} className="input-field text-sm" />
          </div>
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">{t('profile.idLabel')}</label>
            <input type="text" value={form.id_number} onChange={e => setForm({ ...form, id_number: e.target.value })} placeholder={t('profile.idPlaceholder')} className="input-field text-sm" />
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={!validateStep(1)}
            className="btn-primary w-full text-sm !py-2.5 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {t('kyc.next')} <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* Step 2 — Address Info */}
      {editable && step === 2 && (
        <div className="bg-exchange-card rounded-xl border border-exchange-border p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <MapPin size={18} className="text-exchange-yellow" />
            <h2 className="text-sm font-semibold text-exchange-text">{t('kyc.step2')} — {t('kyc.addressInfo')}</h2>
          </div>
          <div>
            <label className="text-xs text-exchange-text-third mb-1 block">{t('kyc.fullAddress')}</label>
            <textarea
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
              placeholder={t('kyc.addressPlaceholder')}
              rows={3}
              className="input-field text-sm resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 px-4 py-2.5 rounded-lg text-sm text-exchange-text-secondary border border-exchange-border hover:bg-exchange-hover transition-colors">
              {t('common.back')}
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!validateStep(2)}
              className="flex-1 btn-primary text-sm !py-2.5 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {t('kyc.next')} <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Document Upload */}
      {editable && step === 3 && (
        <div className="bg-exchange-card rounded-xl border border-exchange-border p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText size={18} className="text-exchange-yellow" />
            <h2 className="text-sm font-semibold text-exchange-text">{t('kyc.step3')} — {t('kyc.documentUpload')}</h2>
          </div>

          {/* ID document upload */}
          <div className="border-2 border-dashed border-exchange-border rounded-lg p-4 hover:border-exchange-yellow/50 transition-colors">
            <div className="flex items-center gap-3">
              <IdCard size={24} className="text-exchange-text-secondary" />
              <div className="flex-1">
                <div className="text-sm font-medium text-exchange-text">{t('kyc.idDocument')}</div>
                <div className="text-[11px] text-exchange-text-third">{t('kyc.idDocumentDesc')}</div>
                {form.id_document_url && <div className="text-[10px] text-exchange-buy mt-1 truncate max-w-[280px]">✓ {form.id_document_url}</div>}
              </div>
              <label className="px-3 py-1.5 bg-exchange-yellow/10 hover:bg-exchange-yellow/20 text-exchange-yellow text-xs rounded-md flex items-center gap-1 cursor-pointer">
                <Upload size={12} /> {t('kyc.upload')}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={e => handleFileSelect('id_document_url', e.target.files?.[0] || null)}
                />
              </label>
            </div>
          </div>

          {/* Address document upload */}
          <div className="border-2 border-dashed border-exchange-border rounded-lg p-4 hover:border-exchange-yellow/50 transition-colors">
            <div className="flex items-center gap-3">
              <FileText size={24} className="text-exchange-text-secondary" />
              <div className="flex-1">
                <div className="text-sm font-medium text-exchange-text">{t('kyc.addressDocument')}</div>
                <div className="text-[11px] text-exchange-text-third">{t('kyc.addressDocumentDesc')}</div>
                {form.address_document_url && <div className="text-[10px] text-exchange-buy mt-1 truncate max-w-[280px]">✓ {form.address_document_url}</div>}
              </div>
              <label className="px-3 py-1.5 bg-exchange-yellow/10 hover:bg-exchange-yellow/20 text-exchange-yellow text-xs rounded-md flex items-center gap-1 cursor-pointer">
                <Upload size={12} /> {t('kyc.upload')}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={e => handleFileSelect('address_document_url', e.target.files?.[0] || null)}
                />
              </label>
            </div>
          </div>

          <div className="bg-exchange-yellow/5 border border-exchange-yellow/20 rounded-lg p-3">
            <p className="text-[11px] text-exchange-text-secondary leading-relaxed">
              <strong className="text-exchange-yellow">{t('kyc.noticeTitle')}:</strong> {t('kyc.noticeText')}
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="flex-1 px-4 py-2.5 rounded-lg text-sm text-exchange-text-secondary border border-exchange-border hover:bg-exchange-hover transition-colors">
              {t('common.back')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 btn-primary text-sm !py-2.5 disabled:opacity-50"
            >
              {loading ? t('wallet.processing') : t('kyc.submit')}
            </button>
          </div>
        </div>
      )}

      {/* Status view for approved/pending */}
      {readOnly && (
        <div className="bg-exchange-card rounded-xl border border-exchange-border p-5">
          <h3 className="text-sm font-semibold text-exchange-text mb-4">{t('kyc.submittedInfo')}</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-exchange-text-third flex items-center gap-2"><UserIcon size={13} /> {t('profile.kycName')}</dt>
              <dd className="text-exchange-text font-medium">{user.kyc_name || '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-exchange-text-third flex items-center gap-2"><Phone size={13} /> {t('profile.kycPhone')}</dt>
              <dd className="text-exchange-text font-medium">{user.kyc_phone || '-'}</dd>
            </div>
            {user.kyc_address && (
              <div className="flex justify-between">
                <dt className="text-exchange-text-third flex items-center gap-2"><MapPin size={13} /> {t('kyc.fullAddress')}</dt>
                <dd className="text-exchange-text font-medium text-right max-w-[60%] truncate">{user.kyc_address}</dd>
              </div>
            )}
            {user.kyc_submitted_at && (
              <div className="flex justify-between">
                <dt className="text-exchange-text-third flex items-center gap-2"><Clock size={13} /> {t('kyc.submittedAt')}</dt>
                <dd className="text-exchange-text font-medium">{new Date(user.kyc_submitted_at).toLocaleString()}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
