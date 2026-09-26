// ============================================================================
// Convert — Bybit-style instant QTA → USDT swap (OWNER_RULES §14)
// ----------------------------------------------------------------------------
// UX mirrors Bybit Convert › Instant:
//   From [QTA ▾] [amount ……… Max]   Available balance
//        (⇅)
//   To   [USDT ▾]  ≈ received
//   [ Quote ]  → price + 10 s countdown → [ Confirm ]  (zero fee, no slippage)
// The fill is OTC against the company treasury: it never touches the spot
// order book / tape / chart. Same §12 approval + §6 daily cap as spot sells.
// Member-facing strings: English via i18n.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownUp, ChevronRight, Clock, Info, RefreshCw } from 'lucide-react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { formatAmount } from '../utils/format';
import CoinIcon from '../components/common/CoinIcon';
import DesktopPageLayout from '../components/common/DesktopPageLayout';
import { showToast } from '../components/common/Toast';

type Status = {
  enabled: boolean; approved: boolean; approval_source: string | null;
  qta_available: number; ref_price: number; price: number; spread_bps: number; quote_ttl_sec: number;
  min_to_amount: number; cap_krw: number; cap_usdt: number; usdt_krw_rate: number;
  today_sold_usdt: number; today_convert_usdt: number; today_spot_usdt: number;
  remaining_usdt: number | null; remaining_krw: number | null; remaining_qta: number | null;
  total_sold_usdt: number; total_sold_qta: number; total_fills: number; resets_at: string;
};
type Quote = {
  quote_id: string; from_amount: number; to_amount: number; price: number; inverse_price: number;
  clamped_to_daily_cap: boolean; expires_at: string; ttl_sec: number;
};
type Hist = { id: string; from_amount: number; to_amount: number; price: number; status: string; filled_at: string | null; created_at: string; error?: string | null };

function fmtUsdt(n: number, d = 4) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: d }); }
function fmtPx(n: number) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 }); }

export default function ConvertPage() {
  const { t } = useI18n();
  const { user, fetchWallets } = useStore() as any;
  const [status, setStatus] = useState<Status | null>(null);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState<'quote' | 'accept' | null>(null);
  const [history, setHistory] = useState<Hist[]>([]);
  const timer = useRef<number | null>(null);

  const loadStatus = useCallback(async () => {
    try { const r = await api.get('/convert/status'); setStatus(r.data); } catch { /* ignore */ }
  }, []);
  const loadHistory = useCallback(async () => {
    try { const r = await api.get('/convert/history?limit=30'); setHistory(r.data || []); } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadStatus(); loadHistory(); const iv = window.setInterval(loadStatus, 15000); return () => window.clearInterval(iv); }, [loadStatus, loadHistory]);

  // Quote countdown (Bybit: quote valid ~10 s, then "Refresh quote").
  useEffect(() => {
    if (timer.current) { window.clearInterval(timer.current); timer.current = null; }
    if (!quote) { setSecondsLeft(0); return; }
    const tick = () => {
      const left = Math.max(0, Math.ceil((new Date(quote.expires_at).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0 && timer.current) { window.clearInterval(timer.current); timer.current = null; }
    };
    tick();
    timer.current = window.setInterval(tick, 250);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [quote]);

  const amt = Number(amount) || 0;
  const estOut = status && status.price > 0 ? amt * status.price : 0;
  const expired = !!quote && secondsLeft <= 0;
  const disabledReason = !status ? null
    : !status.enabled ? t('convert.disabled')
    : !status.approved ? t('trade.sellNotApproved')
    : status.remaining_usdt != null && status.remaining_usdt < status.min_to_amount ? t('trade.sellCapReached')
    : null;

  const setMax = () => {
    if (!status) return;
    let q = status.qta_available;
    if (status.remaining_qta != null) q = Math.min(q, status.remaining_qta);
    setAmount(String(Math.max(0, Math.floor(q * 1e4) / 1e4)));
    setQuote(null);
  };

  const getQuote = async () => {
    if (!(amt > 0)) return;
    setBusy('quote');
    try {
      const r = await api.post('/convert/quote', { from_coin: 'QTA', to_coin: 'USDT', from_amount: amt });
      setQuote(r.data);
      if (r.data.clamped_to_daily_cap) showToast('info', t('convert.clampedTitle'), t('convert.clampedBody'));
    } catch (e: any) {
      const code = e?.response?.data?.error;
      const msg = code === 'SELL_NOT_APPROVED' ? t('trade.sellNotApproved')
        : code === 'DAILY_SELL_CAP_REACHED' ? t('trade.sellCapReached')
        : code === 'INSUFFICIENT_BALANCE' ? t('convert.insufficient')
        : code === 'BELOW_MINIMUM' ? t('convert.belowMin').replace('{min}', String(status?.min_to_amount ?? 1))
        : code === 'CONVERT_DISABLED' ? t('convert.disabled')
        : (e?.response?.data?.message || t('common.error'));
      showToast('error', t('convert.quoteFailed'), msg);
    } finally { setBusy(null); }
  };

  const confirm = async () => {
    if (!quote || expired) return;
    setBusy('accept');
    try {
      const r = await api.post('/convert/accept', { quote_id: quote.quote_id });
      showToast('success', t('convert.done'), `${formatAmount(r.data.from_amount)} QTA → ${fmtUsdt(r.data.to_amount)} USDT`);
      setQuote(null); setAmount('');
      await Promise.all([loadStatus(), loadHistory()]);
      if (typeof fetchWallets === 'function') fetchWallets().catch?.(() => {});
    } catch (e: any) {
      const code = e?.response?.data?.error;
      const msg = code === 'QUOTE_EXPIRED' ? t('convert.expired')
        : code === 'SELL_NOT_APPROVED' ? t('trade.sellNotApproved')
        : code === 'DAILY_SELL_CAP_REACHED' ? t('trade.sellCapReached')
        : code === 'INSUFFICIENT_BALANCE' ? t('convert.insufficient')
        : code === 'LIQUIDITY_UNAVAILABLE' ? t('convert.liquidity')
        : (e?.response?.data?.message || t('common.error'));
      showToast('error', t('convert.failed'), msg);
      if (code === 'QUOTE_EXPIRED' || code === 'QUOTE_ALREADY_USED') setQuote(null);
      loadStatus();
    } finally { setBusy(null); }
  };

  if (!user) {
    return (
      <DesktopPageLayout>
        <div className="card p-8 text-center text-exchange-text-secondary">
          <Link to="/login" className="text-exchange-yellow underline">{t('nav.login')}</Link>
        </div>
      </DesktopPageLayout>
    );
  }

  return (
    <DesktopPageLayout>
      <div className="max-w-xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-exchange-text">{t('convert.title')}</h1>
            <p className="text-xs text-exchange-text-secondary mt-0.5">{t('convert.subtitle')}</p>
          </div>
          <Link to="/trade/QTA-USDT" className="text-xs text-exchange-text-third hover:text-exchange-text inline-flex items-center gap-0.5">{t('nav.trade')} <ChevronRight size={12} /></Link>
        </div>

        {/* Card */}
        <div className="card p-4 space-y-3">
          {/* From */}
          <div className="rounded-xl border border-exchange-border bg-exchange-input/40 p-3">
            <div className="flex items-center justify-between text-xs text-exchange-text-third mb-2">
              <span>{t('convert.from')}</span>
              <button type="button" onClick={setMax} className="inline-flex items-center gap-1 hover:text-exchange-text">
                {t('convert.available')}: <span className="tabular-nums text-exchange-text">{formatAmount(status?.qta_available ?? 0)}</span> <ChevronRight size={12} />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-2 font-semibold shrink-0"><CoinIcon symbol="QTA" size={22} /> QTA</div>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setQuote(null); }}
                placeholder={status?.remaining_qta != null ? `0 – ${formatAmount(Math.min(status.qta_available, status.remaining_qta))}` : '0.00'}
                className="flex-1 bg-transparent text-right text-lg font-semibold tabular-nums outline-none placeholder:text-exchange-text-third"
              />
              <button type="button" onClick={setMax} className="text-exchange-yellow text-sm font-semibold shrink-0">Max</button>
            </div>
          </div>

          <div className="flex justify-center -my-1">
            <div className="w-8 h-8 rounded-full border border-exchange-border bg-exchange-card flex items-center justify-center text-exchange-text-secondary"><ArrowDownUp size={14} /></div>
          </div>

          {/* To */}
          <div className="rounded-xl border border-exchange-border bg-exchange-input/40 p-3">
            <div className="text-xs text-exchange-text-third mb-2">{t('convert.to')}</div>
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-2 font-semibold shrink-0"><CoinIcon symbol="USDT" size={22} /> USDT</div>
              <div className="flex-1 text-right text-lg font-semibold tabular-nums text-exchange-text">
                {quote ? fmtUsdt(quote.to_amount) : amt > 0 && estOut > 0 ? <span className="text-exchange-text-secondary">≈ {fmtUsdt(estOut)}</span> : <span className="text-exchange-text-third">--</span>}
              </div>
            </div>
          </div>

          {/* Price line */}
          <div className="text-xs text-exchange-text-secondary flex items-center justify-between px-1">
            <span>{t('convert.rate')}</span>
            <span className="tabular-nums">
              {quote ? `1 QTA = ${fmtPx(quote.price)} USDT` : status && status.price > 0 ? `1 QTA ≈ ${fmtPx(status.price)} USDT` : '--'}
            </span>
          </div>
          <div className="text-xs text-exchange-text-secondary flex items-center justify-between px-1">
            <span>{t('convert.fee')}</span>
            <span className="text-exchange-buy font-medium">{t('convert.zeroFee')}</span>
          </div>

          {/* Blocked notice */}
          {disabledReason && (
            <div className="rounded-lg border border-exchange-sell/40 bg-exchange-sell/10 px-3 py-2 text-xs text-exchange-sell leading-relaxed">{disabledReason}</div>
          )}

          {/* CTA */}
          {!quote || expired ? (
            <button
              type="button"
              disabled={!!disabledReason || !(amt > 0) || busy !== null || !status}
              onClick={getQuote}
              className="w-full rounded-full py-3 font-semibold text-black bg-exchange-yellow hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {busy === 'quote' ? <RefreshCw size={16} className="animate-spin" /> : null}
              {expired ? t('convert.refreshQuote') : t('convert.quote')}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={confirm}
              className="w-full rounded-full py-3 font-semibold text-black bg-exchange-buy hover:brightness-110 disabled:opacity-40 inline-flex items-center justify-center gap-2"
            >
              {busy === 'accept' ? <RefreshCw size={16} className="animate-spin" /> : <Clock size={16} />}
              {t('convert.confirm')} ({secondsLeft}s)
            </button>
          )}
          {quote && !expired && (
            <div className="text-[11px] text-exchange-text-third text-center">{t('convert.quoteValid').replace('{s}', String(quote.ttl_sec))}</div>
          )}
        </div>

        {/* Daily cap widget (same numbers as the trade screen) */}
        {status && status.approved && (
          <div className="card p-4 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-exchange-text-third">{t('trade.sellCapTitle')}</span>
              <span className="tabular-nums font-semibold">{Number(status.cap_usdt).toFixed(2)} USDT <span className="text-exchange-text-third font-normal">/ KRW {Number(status.cap_krw).toLocaleString('en-US')}</span></span>
            </div>
            <div className="h-1.5 rounded bg-exchange-border overflow-hidden">
              <div className="h-full bg-exchange-yellow" style={{ width: `${Math.min(100, (Number(status.today_sold_usdt) / Math.max(1e-9, Number(status.cap_usdt))) * 100)}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-exchange-text-third">{t('trade.sellToday')}</span>
              <span className="tabular-nums"><span className="font-semibold">{fmtUsdt(status.today_sold_usdt)} USDT</span> <span className="text-exchange-text-third">({t('convert.viaConvert')} {fmtUsdt(status.today_convert_usdt, 2)} · {t('convert.viaSpot')} {fmtUsdt(status.today_spot_usdt, 2)})</span></span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-exchange-text-third">{t('trade.sellRemaining')}</span>
              <span className="tabular-nums font-semibold text-exchange-buy">{fmtUsdt(status.remaining_usdt ?? 0)} USDT{status.remaining_qta != null ? <span className="text-exchange-text-third font-normal"> ≈ {formatAmount(status.remaining_qta)} QTA</span> : null}</span>
            </div>
            <div className="flex items-center justify-between border-t border-exchange-border/60 pt-1.5">
              <span className="text-exchange-text-third">{t('trade.sellTotal')}</span>
              <span className="tabular-nums">{fmtUsdt(status.total_sold_usdt)} USDT <span className="text-exchange-text-third">({formatAmount(status.total_sold_qta)} QTA · {status.total_fills})</span></span>
            </div>
            <div className="text-[10px] text-exchange-text-third">{t('trade.sellResetNote')}{status.approval_source === 'shareholder' ? ` · ${t('trade.sellApprovedShareholder')}` : ''}</div>
          </div>
        )}

        {/* How it works */}
        <div className="card p-4 text-xs text-exchange-text-secondary space-y-1.5">
          <div className="flex items-center gap-1.5 text-exchange-text font-semibold"><Info size={14} /> {t('convert.howTitle')}</div>
          <ul className="list-disc pl-5 space-y-1 leading-relaxed">
            <li>{t('convert.how1')}</li>
            <li>{t('convert.how2')}</li>
            <li>{t('convert.how3')}</li>
            <li>{t('convert.how4')}</li>
          </ul>
        </div>

        {/* History */}
        <div className="card p-4">
          <div className="text-sm font-semibold mb-2">{t('convert.history')}</div>
          {history.length === 0 ? (
            <div className="text-xs text-exchange-text-third py-4 text-center">{t('common.noData')}</div>
          ) : (
            <div className="divide-y divide-exchange-border/60">
              {history.map((h) => (
                <div key={h.id} className="py-2 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-medium tabular-nums">{formatAmount(h.from_amount)} QTA → {fmtUsdt(h.to_amount)} USDT</div>
                    <div className="text-exchange-text-third">@ {fmtPx(h.price)} · {new Date((h.filled_at || h.created_at).replace(' ', 'T') + 'Z').toLocaleString('en-US', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} KST</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${h.status === 'filled' ? 'bg-exchange-buy/15 text-exchange-buy' : 'bg-exchange-sell/15 text-exchange-sell'}`}>{h.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DesktopPageLayout>
  );
}
