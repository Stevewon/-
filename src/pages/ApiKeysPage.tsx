import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';
import {
  Key, ChevronLeft, Plus, Trash2, Copy, Eye, EyeOff,
  AlertTriangle, Clock, Shield, Globe, CheckCircle2,
  Download, Sparkles, Lock,
} from 'lucide-react';
import type { ApiKey, ApiKeySignatureAlg } from '../types';
import {
  generateDilithium2KeyPair,
  buildPqKeyDownload,
  triggerDownload,
  publicKeyFingerprint,
  type PqKeyPair,
} from '../utils/pq-client';

export default function ApiKeysPage() {
  const { t } = useI18n();
  const { user } = useStore();
  const navigate = useNavigate();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Form
  const [label, setLabel] = useState('');
  const [perms, setPerms] = useState<Record<string, boolean>>({ read: true, trade: false, withdraw: false });
  const [ipWhitelist, setIpWhitelist] = useState('');
  const [signatureAlg, setSignatureAlg] = useState<ApiKeySignatureAlg>('hmac-sha256');
  const [creating, setCreating] = useState(false);

  // New key secret display (Phase H2: now also carries optional PQ secret-key payload)
  const [newKey, setNewKey] = useState<
    | {
        id: string;
        api_key: string;
        api_secret: string | null;
        label: string;
        signature_alg: ApiKeySignatureAlg;
        pq?: PqKeyPair;
      }
    | null
  >(null);
  const [showSecret, setShowSecret] = useState(false);
  const [downloadedOnce, setDownloadedOnce] = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const res = await api.get('/profile/api-keys');
      setKeys(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchKeys();
  }, [user?.id]);

  if (!user) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <p className="text-exchange-text-secondary mb-4">{t('wallet.loginRequired')}</p>
        <Link to="/login" className="btn-primary px-6 py-2 rounded-lg">{t('nav.login')}</Link>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!label || label.length < 2) {
      showToast('warning', t('apikey.title'), t('apikey.labelRequired'));
      return;
    }
    const activePerms = Object.entries(perms).filter(([, v]) => v).map(([k]) => k);
    if (activePerms.length === 0) {
      showToast('warning', t('apikey.title'), t('apikey.permRequired'));
      return;
    }

    setCreating(true);
    try {
      // For PQ / hybrid keys we generate the key pair client-side and send
      // ONLY the public key. The secret key never leaves this browser.
      let pqKeyPair: PqKeyPair | undefined;
      const payload: Record<string, unknown> = {
        label,
        permissions: activePerms.join(','),
        ip_whitelist: ipWhitelist || undefined,
        signature_alg: signatureAlg,
      };
      if (signatureAlg !== 'hmac-sha256') {
        pqKeyPair = generateDilithium2KeyPair();
        payload.public_key = pqKeyPair.publicKey;
      }

      const res = await api.post('/profile/api-keys', payload);
      setNewKey({
        id: res.data.id,
        api_key: res.data.api_key,
        api_secret: res.data.api_secret ?? null,
        label: res.data.label,
        signature_alg: (res.data.signature_alg as ApiKeySignatureAlg) || signatureAlg,
        pq: pqKeyPair,
      });
      setDownloadedOnce(false);
      // Reset form
      setLabel(''); setPerms({ read: true, trade: false, withdraw: false }); setIpWhitelist('');
      setSignatureAlg('hmac-sha256');
      setShowCreate(false);
      fetchKeys();
    } catch (err: any) {
      showToast('error', t('apikey.title'), err.response?.data?.error || t('profile.saveFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleDownloadPq = () => {
    if (!newKey || !newKey.pq) return;
    const file = buildPqKeyDownload({
      apiKeyId: newKey.id,
      apiKey: newKey.api_key,
      label: newKey.label,
      keyPair: newKey.pq,
    });
    triggerDownload(file);
    setDownloadedOnce(true);
    showToast('success', t('apikey.title'), t('apikey.pqDownloaded'));
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/profile/api-keys/${id}`);
      setKeys(keys.filter(k => k.id !== id));
      showToast('success', t('apikey.title'), t('apikey.deleted'));
    } catch (err: any) {
      showToast('error', t('apikey.title'), err.response?.data?.error || t('profile.saveFailed'));
    }
    setDeleteId(null);
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('success', t('common.copied'), text.slice(0, 20) + '...');
  };

  const permBadge = (p: string) => {
    const colors: Record<string, string> = {
      read: 'bg-exchange-buy/10 text-exchange-buy border-exchange-buy/30',
      trade: 'bg-exchange-yellow/10 text-exchange-yellow border-exchange-yellow/30',
      withdraw: 'bg-exchange-sell/10 text-exchange-sell border-exchange-sell/30',
    };
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[p] || 'bg-exchange-hover text-exchange-text-third border-exchange-border'}`}>
        {t(`apikey.perm_${p}`)}
      </span>
    );
  };

  const algBadge = (alg: ApiKeySignatureAlg | undefined) => {
    const a = alg || 'hmac-sha256';
    const styles: Record<ApiKeySignatureAlg, string> = {
      'hmac-sha256': 'bg-exchange-hover text-exchange-text-secondary border-exchange-border',
      'dilithium2': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      'hybrid': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    };
    const labels: Record<ApiKeySignatureAlg, string> = {
      'hmac-sha256': t('apikey.alg_hmac_short'),
      'dilithium2': t('apikey.alg_pq_short'),
      'hybrid': t('apikey.alg_hybrid_short'),
    };
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold flex items-center gap-1 ${styles[a]}`}>
        {a !== 'hmac-sha256' && <Sparkles size={9} />}
        {labels[a]}
      </span>
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button onClick={() => navigate('/profile')} className="flex items-center gap-1 text-sm text-exchange-text-secondary hover:text-exchange-text mb-4">
        <ChevronLeft size={16} /> {t('common.back')}
      </button>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-exchange-yellow/10 rounded-xl flex items-center justify-center">
            <Key size={22} className="text-exchange-yellow" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-exchange-text">{t('apikey.title')}</h1>
            <p className="text-xs text-exchange-text-third">{t('apikey.subtitle')}</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm !py-2 flex items-center gap-1.5">
          <Plus size={14} /> {t('apikey.create')}
        </button>
      </div>

      {/* Warning */}
      <div className="bg-exchange-yellow/5 border border-exchange-yellow/20 rounded-lg p-3 mb-4 flex items-start gap-2">
        <AlertTriangle size={16} className="text-exchange-yellow shrink-0 mt-0.5" />
        <p className="text-[11px] text-exchange-text-secondary leading-relaxed">
          <strong className="text-exchange-yellow">{t('apikey.securityTitle')}:</strong> {t('apikey.securityNote')}
        </p>
      </div>

      {/* New key reveal */}
      {newKey && (
        <div className="bg-exchange-buy/5 border border-exchange-buy/30 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} className="text-exchange-buy" />
            <h3 className="text-sm font-semibold text-exchange-text flex items-center gap-2">
              {t('apikey.newKeyCreated')}: {newKey.label}
              {algBadge(newKey.signature_alg)}
            </h3>
          </div>
          <p className="text-[11px] text-exchange-sell mb-3">
            ⚠ {newKey.pq ? t('apikey.pqDownloadOnce') : t('apikey.saveNow')}
          </p>

          <div className="space-y-2">
            <div>
              <div className="text-[10px] text-exchange-text-third mb-1">API Key</div>
              <div className="bg-exchange-card rounded px-3 py-2 flex items-center gap-2">
                <code className="flex-1 text-[11px] text-exchange-text-secondary font-mono break-all">{newKey.api_key}</code>
                <button onClick={() => copy(newKey.api_key)} className="text-exchange-text-third hover:text-exchange-yellow"><Copy size={14} /></button>
              </div>
            </div>
            {/* HMAC secret (only when alg is hmac-sha256 or hybrid) */}
            {newKey.api_secret && (
              <div>
                <div className="text-[10px] text-exchange-text-third mb-1">API Secret</div>
                <div className="bg-exchange-card rounded px-3 py-2 flex items-center gap-2">
                  <code className="flex-1 text-[11px] text-exchange-text-secondary font-mono break-all">
                    {showSecret ? newKey.api_secret : '•'.repeat(40)}
                  </code>
                  <button onClick={() => setShowSecret(!showSecret)} className="text-exchange-text-third hover:text-exchange-yellow">
                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button onClick={() => copy(newKey.api_secret!)} className="text-exchange-text-third hover:text-exchange-yellow"><Copy size={14} /></button>
                </div>
              </div>
            )}
            {/* PQ private key block */}
            {newKey.pq && (
              <div className="bg-purple-500/5 border border-purple-500/30 rounded-lg p-3 mt-2">
                <div className="flex items-center gap-2 mb-2">
                  <Lock size={14} className="text-purple-400" />
                  <span className="text-[11px] font-semibold text-purple-300">
                    {t('apikey.pqPrivateKey')}
                  </span>
                </div>
                <p className="text-[10px] text-exchange-text-secondary leading-relaxed mb-2">
                  {t('apikey.pqPrivateKeyDesc')}
                </p>
                <button
                  onClick={handleDownloadPq}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/40 transition-colors"
                >
                  <Download size={14} />
                  {downloadedOnce ? t('apikey.pqDownloadAgain') : t('apikey.pqDownload')}
                </button>
                {downloadedOnce && (
                  <p className="text-[10px] text-purple-300/80 mt-2">
                    {t('apikey.pqDownloadedHint')}
                  </p>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              if (newKey.pq && !downloadedOnce) {
                if (!confirm(t('apikey.pqDismissWarn'))) return;
              }
              setNewKey(null); setShowSecret(false); setDownloadedOnce(false);
            }}
            className="mt-3 px-3 py-1.5 text-xs text-exchange-text-secondary hover:text-exchange-text"
          >
            {t('apikey.dismiss')}
          </button>
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <div className="text-center py-10 text-xs text-exchange-text-third">{t('common.loading')}</div>
      ) : keys.length === 0 ? (
        <div className="bg-exchange-card rounded-xl border border-exchange-border p-10 text-center">
          <Key size={32} className="mx-auto mb-3 text-exchange-text-third" />
          <p className="text-sm text-exchange-text-secondary mb-1">{t('apikey.none')}</p>
          <p className="text-xs text-exchange-text-third">{t('apikey.noneDesc')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map(k => (
            <div key={k.id} className="bg-exchange-card rounded-xl border border-exchange-border p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h4 className="text-sm font-semibold text-exchange-text truncate">{k.label}</h4>
                    {algBadge(k.signature_alg)}
                  </div>
                  <code className="text-[11px] text-exchange-text-third font-mono block truncate mt-0.5">{k.api_key}</code>
                </div>
                <button onClick={() => setDeleteId(k.id)} className="text-exchange-text-third hover:text-exchange-sell p-1">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-2">
                {k.permissions.split(',').map(p => <div key={p}>{permBadge(p.trim())}</div>)}
              </div>

              <div className="flex items-center gap-3 text-[10px] text-exchange-text-third flex-wrap">
                <span className="flex items-center gap-1"><Clock size={10} />{t('apikey.created')}: {new Date(k.created_at).toLocaleDateString()}</span>
                {k.ip_whitelist && <span className="flex items-center gap-1"><Globe size={10} />{k.ip_whitelist}</span>}
                {k.last_used_at && <span>{t('apikey.lastUsed')}: {new Date(k.last_used_at).toLocaleDateString()}</span>}
                {k.public_key && <PqFingerprint publicKey={k.public_key} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-exchange-card rounded-xl border border-exchange-border w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Plus size={20} className="text-exchange-yellow" />
              <h3 className="text-lg font-semibold text-exchange-text">{t('apikey.createNew')}</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-exchange-text-third mb-1 block">{t('apikey.label')}</label>
                <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder={t('apikey.labelPlaceholder')} maxLength={30} className="input-field text-sm" />
              </div>

              <div>
                <label className="text-xs text-exchange-text-third mb-2 block">{t('apikey.permissions')}</label>
                <div className="space-y-2">
                  {(['read', 'trade', 'withdraw'] as const).map(p => (
                    <label key={p} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${perms[p] ? 'border-exchange-yellow/50 bg-exchange-yellow/5' : 'border-exchange-border hover:bg-exchange-hover/30'}`}>
                      <input type="checkbox" checked={perms[p]} onChange={e => setPerms({ ...perms, [p]: e.target.checked })} className="accent-exchange-yellow" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-exchange-text flex items-center gap-2">
                          {t(`apikey.perm_${p}`)}
                          {p === 'withdraw' && <Shield size={12} className="text-exchange-sell" />}
                        </div>
                        <div className="text-[11px] text-exchange-text-third">{t(`apikey.perm_${p}_desc`)}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-exchange-text-third mb-1 block flex items-center gap-1">
                  <Globe size={12} /> {t('apikey.ipWhitelist')} ({t('common.optional')})
                </label>
                <input type="text" value={ipWhitelist} onChange={e => setIpWhitelist(e.target.value)} placeholder="192.168.1.1, 10.0.0.1" className="input-field text-sm" />
                <p className="text-[10px] text-exchange-text-third mt-1">{t('apikey.ipWhitelistDesc')}</p>
              </div>

              {/* Phase H2 — algorithm selection */}
              <div>
                <label className="text-xs text-exchange-text-third mb-2 block flex items-center gap-1">
                  <Sparkles size={12} className="text-purple-400" /> {t('apikey.signatureAlg')}
                </label>
                <div className="space-y-2">
                  {(['hmac-sha256', 'dilithium2', 'hybrid'] as ApiKeySignatureAlg[]).map(alg => (
                    <label
                      key={alg}
                      className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        signatureAlg === alg
                          ? 'border-exchange-yellow/50 bg-exchange-yellow/5'
                          : 'border-exchange-border hover:bg-exchange-hover/30'
                      }`}
                    >
                      <input
                        type="radio"
                        name="signature_alg"
                        value={alg}
                        checked={signatureAlg === alg}
                        onChange={() => setSignatureAlg(alg)}
                        className="accent-exchange-yellow mt-1"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-exchange-text flex items-center gap-2">
                          {t(`apikey.alg_${alg.replace('-', '_')}`)}
                          {alg !== 'hmac-sha256' && <Sparkles size={11} className="text-purple-400" />}
                        </div>
                        <div className="text-[11px] text-exchange-text-third">
                          {t(`apikey.alg_${alg.replace('-', '_')}_desc`)}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                {signatureAlg !== 'hmac-sha256' && (
                  <p className="text-[10px] text-purple-300/80 mt-2 leading-relaxed">
                    {t('apikey.alg_pq_warn')}
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 rounded-lg text-sm text-exchange-text-secondary border border-exchange-border hover:bg-exchange-hover">
                {t('common.cancel')}
              </button>
              <button onClick={handleCreate} disabled={creating} className="flex-1 btn-primary text-sm !py-2.5 disabled:opacity-50">
                {creating ? t('wallet.processing') : t('apikey.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {/* end of create modal */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setDeleteId(null)}>
          <div className="bg-exchange-card rounded-xl border border-exchange-border w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={20} className="text-exchange-sell" />
              <h3 className="text-lg font-semibold text-exchange-text">{t('apikey.deleteConfirm')}</h3>
            </div>
            <p className="text-sm text-exchange-text-secondary mb-4">{t('apikey.deleteWarning')}</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)} className="flex-1 px-4 py-2.5 rounded-lg text-sm text-exchange-text-secondary border border-exchange-border hover:bg-exchange-hover">
                {t('common.cancel')}
              </button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 px-4 py-2.5 rounded-lg text-sm bg-exchange-sell hover:bg-exchange-sell/90 text-white">
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PqFingerprint — small async helper that renders a 16-char SHA-256 prefix
// of a Dilithium2 public key, so users can visually confirm which PQ key a
// row corresponds to (matches the fingerprint embedded in the downloaded
// secret-key file).
// ---------------------------------------------------------------------------
function PqFingerprint({ publicKey }: { publicKey: string }) {
  const [fp, setFp] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    publicKeyFingerprint(publicKey).then((s) => {
      if (!cancelled) setFp(s);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);
  if (!fp) return null;
  return (
    <span className="flex items-center gap-1 text-purple-300/80">
      <Lock size={10} />
      <code className="font-mono">{fp}</code>
    </span>
  );
}
