/**
 * Sprint 4 Phase H1-B — User Futures page.
 * ----------------------------------------------------------------------------
 * Wires the public + authenticated futures endpoints from Phase H1-A:
 *   GET  /api/futures/contracts              -> contract selector
 *   GET  /api/futures/state                  -> shows "paused" banner if on
 *   GET  /api/futures/positions?status=open  -> my open positions
 *   POST /api/futures/positions              -> open new position
 *   POST /api/futures/positions/:id/close    -> close
 *   POST /api/futures/positions/:id/leverage -> change leverage
 *
 * Liquidation price preview is computed client-side using the same formula
 * as src/server/lib/liquidation-engine.ts so the user sees the same number
 * the backend will store.
 */

import { useEffect, useMemo, useState } from 'react';
import useStore from '../store/useStore';
import { useI18n } from '../i18n';
import api from '../utils/api';
import { showToast } from '../components/common/Toast';
import {
  TrendingUp, TrendingDown, Layers, Activity, AlertTriangle, RefreshCw,
} from 'lucide-react';

interface Contract {
  symbol: string;
  base_asset: string;
  quote_asset: string;
  max_leverage: number;
  maintenance_margin_bps: number;
  initial_margin_bps: number;
  funding_interval_sec: number;
  is_active: number;
}

interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  size: string;
  entry_price: string;
  mark_price: string;
  leverage: number;
  margin_mode: 'cross' | 'isolated';
  unrealized_pnl: string;
  realized_pnl: string;
  liquidation_price: string | null;
  status: string;
  opened_at: string;
}

// Mirror of src/server/lib/liquidation-engine.ts → calcLiquidationPrice
function calcLiqPrice(
  side: 'long' | 'short',
  entry: number,
  leverage: number,
  mmBps: number
): number {
  if (!isFinite(entry) || entry <= 0 || leverage <= 0) return 0;
  const mm = mmBps / 10000;
  const inv = 1 / leverage;
  return side === 'long' ? entry * (1 - inv + mm) : entry * (1 + inv - mm);
}

function calcInitialMargin(size: number, entry: number, leverage: number): number {
  if (!isFinite(size) || !isFinite(entry) || size <= 0 || entry <= 0) return 0;
  if (leverage <= 0) return 0;
  return (entry * size) / leverage;
}

export default function FuturesPage() {
  const { t } = useI18n();
  const { user } = useStore();

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [paused, setPaused] = useState(false);
  const [symbol, setSymbol] = useState<string>('BTC-PERP');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>('cross');
  const [leverage, setLeverage] = useState<number>(10);
  const [size, setSize] = useState<string>('');
  const [entryPrice, setEntryPrice] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(true);

  const contract = useMemo(
    () => contracts.find((c) => c.symbol === symbol) || null,
    [contracts, symbol]
  );

  // Clamp leverage when contract or its max changes
  useEffect(() => {
    if (contract && leverage > contract.max_leverage) {
      setLeverage(contract.max_leverage);
    }
  }, [contract]);

  async function loadContracts() {
    try {
      const [r1, r2] = await Promise.all([
        api.get('/futures/contracts'),
        api.get('/futures/state'),
      ]);
      setContracts(r1?.data?.contracts || []);
      setPaused(!!r2?.data?.state?.paused);
      if (!symbol && r1?.data?.contracts?.length) {
        setSymbol(r1.data.contracts[0].symbol);
      }
    } catch {
      /* ignore */
    }
  }

  async function loadPositions() {
    if (!user) {
      setPositions([]);
      setLoadingPositions(false);
      return;
    }
    try {
      const r = await api.get('/futures/positions', { params: { status: 'open' } });
      setPositions(r?.data?.positions || []);
    } catch {
      /* ignore */
    }
    setLoadingPositions(false);
  }

  useEffect(() => {
    loadContracts();
    const id = setInterval(loadContracts, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    loadPositions();
    const id = setInterval(loadPositions, 10_000);
    return () => clearInterval(id);
  }, [user]);

  const liqPreview = useMemo(() => {
    if (!contract) return 0;
    const e = Number(entryPrice);
    if (!isFinite(e) || e <= 0) return 0;
    return calcLiqPrice(side, e, leverage, contract.maintenance_margin_bps);
  }, [contract, entryPrice, leverage, side]);

  const requiredMargin = useMemo(() => {
    const s = Number(size);
    const e = Number(entryPrice);
    if (!isFinite(s) || !isFinite(e)) return 0;
    return calcInitialMargin(s, e, leverage);
  }, [size, entryPrice, leverage]);

  async function handleOpen() {
    if (!user) {
      showToast('error', t('common.loginRequired') || 'Login required');
      return;
    }
    if (paused) {
      showToast('error', t('admin.futuresPaused') || 'Paused');
      return;
    }
    if (!contract) return;
    const s = Number(size);
    const e = Number(entryPrice);
    if (!isFinite(s) || s <= 0 || !isFinite(e) || e <= 0) {
      showToast('error', 'size & entry_price required');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/futures/positions', {
        symbol,
        side,
        size,
        entry_price: entryPrice,
        leverage,
        margin_mode: marginMode,
      });
      showToast('success', t('futures.openPosition') || 'Position opened');
      setSize('');
      loadPositions();
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed';
      const reason = err?.response?.data?.reason;
      showToast('error', reason ? `${msg}: ${reason}` : msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClose(p: Position) {
    const closePrice = window.prompt(
      `${t('futures.closePosition') || 'Close'} ${p.symbol} @ ?`,
      p.mark_price || p.entry_price
    );
    if (!closePrice) return;
    try {
      await api.post(`/futures/positions/${p.id}/close`, { close_price: closePrice });
      showToast('success', 'OK');
      loadPositions();
    } catch (err: any) {
      showToast('error', err?.response?.data?.error || 'Failed');
    }
  }

  async function handleChangeLeverage(p: Position) {
    const lev = window.prompt(
      `${t('futures.changeLeverage') || 'Leverage'} (1-${contracts.find((c) => c.symbol === p.symbol)?.max_leverage || 100})`,
      String(p.leverage)
    );
    if (!lev) return;
    try {
      await api.post(`/futures/positions/${p.id}/leverage`, {
        leverage: Math.max(1, Math.floor(Number(lev) || 1)),
      });
      showToast('success', 'OK');
      loadPositions();
    } catch (err: any) {
      showToast('error', err?.response?.data?.error || 'Failed');
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-exchange-yellow" />
          <h1 className="text-xl font-bold">{t('futures.title') || 'Futures'}</h1>
        </div>
        <button
          onClick={() => { loadContracts(); loadPositions(); }}
          className="p-2 rounded-lg bg-exchange-card border border-exchange-border text-exchange-text-second hover:text-exchange-text"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {paused && (
        <div className="rounded-xl border border-exchange-sell/40 bg-exchange-sell/10 p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-exchange-sell" />
          <span className="text-sm text-exchange-sell">{t('admin.futuresPaused') || 'Futures trading is paused'}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Order panel */}
        <div className="lg:col-span-1 rounded-xl border border-exchange-border bg-exchange-card p-5 space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-exchange-text-third">
              {t('admin.contractSymbol') || 'Symbol'}
            </label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm font-mono"
            >
              {contracts.map((c) => (
                <option key={c.symbol} value={c.symbol}>
                  {c.symbol} (max {c.max_leverage}x)
                </option>
              ))}
            </select>
          </div>

          {/* Side toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSide('long')}
              className={`py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-1 ${
                side === 'long'
                  ? 'bg-exchange-buy text-white'
                  : 'bg-exchange-bg border border-exchange-border text-exchange-text-second'
              }`}
            >
              <TrendingUp className="w-4 h-4" /> {t('futures.long') || 'Long'}
            </button>
            <button
              onClick={() => setSide('short')}
              className={`py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-1 ${
                side === 'short'
                  ? 'bg-exchange-sell text-white'
                  : 'bg-exchange-bg border border-exchange-border text-exchange-text-second'
              }`}
            >
              <TrendingDown className="w-4 h-4" /> {t('futures.short') || 'Short'}
            </button>
          </div>

          {/* Margin mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setMarginMode('cross')}
              className={`py-1.5 rounded-lg text-xs font-semibold ${
                marginMode === 'cross'
                  ? 'bg-exchange-yellow/15 text-exchange-yellow'
                  : 'bg-exchange-bg border border-exchange-border text-exchange-text-second'
              }`}
            >
              {t('futures.cross') || 'Cross'}
            </button>
            <button
              onClick={() => setMarginMode('isolated')}
              className={`py-1.5 rounded-lg text-xs font-semibold ${
                marginMode === 'isolated'
                  ? 'bg-exchange-yellow/15 text-exchange-yellow'
                  : 'bg-exchange-bg border border-exchange-border text-exchange-text-second'
              }`}
            >
              {t('futures.isolated') || 'Isolated'}
            </button>
          </div>

          {/* Leverage slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] uppercase tracking-wider text-exchange-text-third">
                {(t('futures.leverageHint') || 'Leverage ({n}x)').replace('{n}', String(leverage))}
              </label>
              <span className="text-xs font-mono text-exchange-yellow">
                {leverage}x
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={contract?.max_leverage || 100}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-exchange-text-third mt-1">
              <span>1x</span>
              <span>{Math.floor((contract?.max_leverage || 100) / 2)}x</span>
              <span>{contract?.max_leverage || 100}x</span>
            </div>
          </div>

          {/* Size + entry price */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-exchange-text-third">
              {t('futures.size') || 'Size'}
            </label>
            <input
              type="number"
              step="any"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="0.00"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-exchange-text-third">
              {t('admin.entryPrice') || 'Entry'}
            </label>
            <input
              type="number"
              step="any"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              placeholder="0.00"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-exchange-bg border border-exchange-border text-sm font-mono"
            />
          </div>

          {/* Liq preview + required margin */}
          <div className="rounded-lg bg-exchange-bg border border-exchange-border p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-exchange-text-third">{t('futures.liqPreview') || 'Est. liq. price'}</span>
              <span className={`font-mono font-bold ${liqPreview > 0 ? 'text-exchange-sell' : 'text-exchange-text-third'}`}>
                {liqPreview > 0 ? liqPreview.toFixed(4) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-exchange-text-third">{t('futures.requiredMargin') || 'Required margin'}</span>
              <span className="font-mono">
                {requiredMargin > 0 ? requiredMargin.toFixed(4) : '—'} {contract?.quote_asset || ''}
              </span>
            </div>
          </div>

          <button
            disabled={submitting || paused}
            onClick={handleOpen}
            className={`w-full py-2.5 rounded-lg text-sm font-bold ${
              side === 'long' ? 'bg-exchange-buy' : 'bg-exchange-sell'
            } text-white disabled:opacity-50`}
          >
            {submitting ? '…' : t('futures.openPosition') || 'Open position'}
          </button>
        </div>

        {/* Contract info + positions */}
        <div className="lg:col-span-2 space-y-6">
          {contract && (
            <div className="rounded-xl border border-exchange-border bg-exchange-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-exchange-yellow" />
                <h2 className="text-sm font-bold">{t('futures.contractInfo') || 'Contract info'}</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Stat label={t('admin.maxLeverage') || 'Max leverage'} value={`${contract.max_leverage}x`} />
                <Stat
                  label={t('admin.maintenanceMargin') || 'Maint. margin'}
                  value={`${(contract.maintenance_margin_bps / 100).toFixed(2)}%`}
                />
                <Stat
                  label={t('admin.initialMargin') || 'Initial margin'}
                  value={`${(contract.initial_margin_bps / 100).toFixed(2)}%`}
                />
                <Stat
                  label={t('admin.fundingInterval') || 'Funding interval'}
                  value={`${Math.floor(contract.funding_interval_sec / 3600)}h`}
                />
              </div>
            </div>
          )}

          <div className="rounded-xl border border-exchange-border bg-exchange-card overflow-x-auto">
            <div className="flex items-center justify-between px-5 pt-4">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-exchange-yellow" />
                <h2 className="text-sm font-bold">{t('futures.myPositions') || 'My positions'}</h2>
              </div>
              <span className="text-[11px] text-exchange-text-third">{positions.length}</span>
            </div>
            <table className="w-full text-xs mt-3">
              <thead className="text-[10px] uppercase tracking-wider text-exchange-text-third">
                <tr>
                  <th className="text-left px-4 py-2">{t('admin.contractSymbol') || 'Symbol'}</th>
                  <th className="text-left px-4 py-2">Side</th>
                  <th className="text-right px-4 py-2">{t('admin.amount') || 'Size'}</th>
                  <th className="text-right px-4 py-2">{t('admin.entryPrice') || 'Entry'}</th>
                  <th className="text-right px-4 py-2">{t('admin.markPrice') || 'Mark'}</th>
                  <th className="text-right px-4 py-2">{t('admin.leverage') || 'Lev'}</th>
                  <th className="text-right px-4 py-2">{t('admin.liquidationPrice') || 'Liq'}</th>
                  <th className="text-right px-4 py-2">{t('admin.unrealizedPnl') || 'PnL'}</th>
                  <th className="text-right px-4 py-2">{t('admin.actions') || 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {loadingPositions && (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-exchange-text-third">…</td>
                  </tr>
                )}
                {!loadingPositions && positions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-exchange-text-third">
                      {t('futures.noPositions') || 'No open positions.'}
                    </td>
                  </tr>
                )}
                {positions.map((p) => (
                  <tr key={p.id} className="border-t border-exchange-border">
                    <td className="px-4 py-2 font-mono">{p.symbol}</td>
                    <td className={`px-4 py-2 font-semibold ${p.side === 'long' ? 'text-exchange-buy' : 'text-exchange-sell'}`}>
                      {p.side}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{p.size}</td>
                    <td className="px-4 py-2 text-right font-mono">{p.entry_price}</td>
                    <td className="px-4 py-2 text-right font-mono">{p.mark_price}</td>
                    <td className="px-4 py-2 text-right">{p.leverage}x</td>
                    <td className="px-4 py-2 text-right font-mono text-exchange-sell">
                      {p.liquidation_price || '—'}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono ${
                      Number(p.unrealized_pnl) >= 0 ? 'text-exchange-buy' : 'text-exchange-sell'
                    }`}>
                      {p.unrealized_pnl}
                    </td>
                    <td className="px-4 py-2 text-right space-x-1">
                      <button
                        onClick={() => handleChangeLeverage(p)}
                        className="px-2 py-1 rounded-md text-[10px] font-semibold bg-exchange-yellow/15 text-exchange-yellow"
                      >
                        {t('futures.changeLeverage') || 'Lev'}
                      </button>
                      <button
                        onClick={() => handleClose(p)}
                        className="px-2 py-1 rounded-md text-[10px] font-semibold bg-exchange-card border border-exchange-border text-exchange-text-second"
                      >
                        {t('futures.closePosition') || 'Close'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-exchange-bg border border-exchange-border p-2">
      <div className="text-[10px] uppercase tracking-wider text-exchange-text-third">{label}</div>
      <div className="mt-1 text-sm font-bold font-mono">{value}</div>
    </div>
  );
}
