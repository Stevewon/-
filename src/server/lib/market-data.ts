/**
 * External market-data provider for STANDARD (non-Quantarium) coins.
 *
 * QuantaEX shows two very different kinds of charts:
 *
 *   1. Standard global coins (BTC, ETH, BNB, SOL, ...) — these must track the
 *      REAL market, exactly like every other global exchange. We proxy their
 *      candles/tickers from a public spot-market API (OKX, with Coinbase as a
 *      fallback) so the graph is consistent with the rest of the world.
 *
 *   2. Quantarium-native assets (QTA, QX, QKEY) — these are OUR OWN coins that
 *      we handle ourselves. Their candles/tickers come from our D1 matching
 *      engine, NOT from any external exchange. (Handled in routes/market.ts,
 *      gated by isQuantariumAsset().)
 *
 * This module only deals with case (1). Nothing here should ever be asked for a
 * Quantarium asset — the caller decides via isQuantariumAsset() first.
 */

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  last: number;
  change: number; // 24h percent change
  volume: number; // 24h base volume
  high: number;
  low: number;
}

/**
 * Our internal interval string -> OKX `bar` string.
 * OKX uses capital H/D/W (e.g. 1H, 4H, 1D) and lowercase m for minutes.
 */
const OKX_BAR: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
  '1w': '1W',
};

/** Our interval string -> Coinbase granularity in seconds (fallback provider). */
const COINBASE_GRANULARITY: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 21600, // coinbase has no 4h; 6h is closest — we only use it as a fallback
  '1d': 86400,
};

/**
 * A standard coin's spot symbol quoted in USDT/USD.
 * Our DB stores markets like BTC-USDT; the base coin symbol maps 1:1 to the
 * global ticker (BTC -> BTCUSDT / BTC-USDT / BTC-USD). Stablecoins (USDT/USDC)
 * don't have a meaningful chart of their own.
 */
export function externalPairFor(base: string): { okx: string; coinbase: string } | null {
  const b = base.toUpperCase();
  if (b === 'USDT' || b === 'USDC' || b === 'USD') return null;
  return { okx: `${b}-USDT`, coinbase: `${b}-USD` };
}

const UA = 'Mozilla/5.0 (compatible; QuantaEX/1.0; +https://quantaex.pages.dev)';

/**
 * Fetch real candles for a standard coin. Returns oldest-first, matching the
 * shape our D1 `/candles` endpoint returns. Returns [] on any failure so the
 * caller can gracefully fall back.
 */
export async function fetchExternalCandles(
  base: string,
  interval: string,
  limit: number,
): Promise<Candle[]> {
  const pair = externalPairFor(base);
  if (!pair) return [];

  // ---- Primary: OKX ----
  try {
    const bar = OKX_BAR[interval] || '1H';
    const url = `https://www.okx.com/api/v5/market/candles?instId=${pair.okx}&bar=${bar}&limit=${Math.min(limit, 300)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const json: any = await res.json();
      if (json?.code === '0' && Array.isArray(json.data) && json.data.length) {
        // OKX rows: [ts_ms, o, h, l, c, vol, volCcy, volCcyQuote, confirm] newest-first
        const candles: Candle[] = json.data.map((r: any[]) => ({
          time: Math.floor(Number(r[0]) / 1000),
          open: Number(r[1]),
          high: Number(r[2]),
          low: Number(r[3]),
          close: Number(r[4]),
          volume: Number(r[5]),
        }));
        // oldest-first for the chart
        return candles.reverse();
      }
    }
  } catch {
    /* fall through to Coinbase */
  }

  // ---- Fallback: Coinbase ----
  try {
    const gran = COINBASE_GRANULARITY[interval] || 3600;
    const url = `https://api.exchange.coinbase.com/products/${pair.coinbase}/candles?granularity=${gran}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const rows: any[] = await res.json();
      if (Array.isArray(rows) && rows.length) {
        // Coinbase rows: [time_s, low, high, open, close, volume] newest-first
        const candles: Candle[] = rows.slice(0, limit).map((r: any[]) => ({
          time: Number(r[0]),
          low: Number(r[1]),
          high: Number(r[2]),
          open: Number(r[3]),
          close: Number(r[4]),
          volume: Number(r[5]),
        }));
        return candles.reverse();
      }
    }
  } catch {
    /* give up */
  }

  return [];
}

/**
 * Fetch a real 24h ticker for a standard coin. Returns null on failure.
 */
export async function fetchExternalTicker(base: string): Promise<Ticker | null> {
  const pair = externalPairFor(base);
  if (!pair) return null;

  // ---- Primary: OKX ----
  try {
    const url = `https://www.okx.com/api/v5/market/ticker?instId=${pair.okx}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const json: any = await res.json();
      const d = json?.data?.[0];
      if (json?.code === '0' && d) {
        const last = Number(d.last);
        const open24h = Number(d.open24h) || last;
        return {
          last,
          change: open24h ? ((last - open24h) / open24h) * 100 : 0,
          volume: Number(d.vol24h) || 0,
          high: Number(d.high24h) || last,
          low: Number(d.low24h) || last,
        };
      }
    }
  } catch {
    /* fall through */
  }

  // ---- Fallback: Coinbase ----
  try {
    const [statsRes, tickRes] = await Promise.all([
      fetch(`https://api.exchange.coinbase.com/products/${pair.coinbase}/stats`, { headers: { 'User-Agent': UA } }),
      fetch(`https://api.exchange.coinbase.com/products/${pair.coinbase}/ticker`, { headers: { 'User-Agent': UA } }),
    ]);
    if (statsRes.ok && tickRes.ok) {
      const stats: any = await statsRes.json();
      const tick: any = await tickRes.json();
      const last = Number(tick.price) || Number(stats.last);
      const open = Number(stats.open) || last;
      return {
        last,
        change: open ? ((last - open) / open) * 100 : 0,
        volume: Number(stats.volume) || 0,
        high: Number(stats.high) || last,
        low: Number(stats.low) || last,
      };
    }
  } catch {
    /* give up */
  }

  return null;
}

/**
 * Batch: fetch tickers for many standard coins from OKX.
 *
 * We deliberately do NOT use OKX's "whole spot market" endpoint
 * (/market/tickers?instType=SPOT) — its response is ~1300 rows / hundreds of
 * KB, which is slow/unreliable to fetch and parse inside a Cloudflare Worker
 * (subrequest size + CPU). Instead we fetch each wanted symbol individually in
 * parallel via the same lightweight single-symbol endpoint that /candles
 * already uses successfully in production. Returns a map keyed by BASE symbol
 * (e.g. "BTC"). Any symbol that fails is simply omitted so the caller falls
 * back to our own DB value for it.
 */
export async function fetchExternalTickersBatch(bases: string[]): Promise<Map<string, Ticker>> {
  const out = new Map<string, Ticker>();
  const uniqueBases = Array.from(new Set(bases.map((b) => b.toUpperCase())));

  await Promise.all(
    uniqueBases.map(async (base) => {
      const t = await fetchExternalTicker(base);
      if (t) out.set(base, t);
    }),
  );

  return out;
}
