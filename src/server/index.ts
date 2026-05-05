import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoutes from './routes/auth';
import marketRoutes from './routes/market';
import orderRoutes from './routes/order';
import walletRoutes from './routes/wallet';
import adminRoutes from './routes/admin';
import notificationRoutes from './routes/notifications';
import priceAlertRoutes from './routes/priceAlerts';
import profileRoutes from './routes/profile';
import chainRoutes from './routes/chain';
import riskRoutes from './routes/risk';
import bridgeRoutes from './routes/bridge';
import futuresRoutes from './routes/futures';
import marginRoutes from './routes/margin';
import v1Routes from './routes/v1';
import { installObservability, captureError } from './utils/observability';
import { geoBlock, geoStatusHandler } from './middleware/geo-block';

export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
  // Sprint 3+ observability (all optional)
  SENTRY_DSN?: string;
  LOGFLARE_API_KEY?: string;
  LOGFLARE_SOURCE?: string;
  ENVIRONMENT?: string;
  // Sprint 4 Phase B — QTA native chain integration (all optional, mock by default)
  QTA_CHAIN_DRIVER?: string;        // 'mock' | 'real'
  QTA_NETWORK?: string;             // 'qta-mainnet' | 'qta-testnet'
  QTA_RPC_URL?: string;
  QTA_HOT_WALLET_PRIVATE_KEY?: string;
  // Sprint 4 Phase G — QTA <-> ETH bridge (all optional, mock by default)
  BRIDGE_DRIVER?: string;           // 'mock' | 'real'
  BRIDGE_NETWORK?: string;          // 'mainnet' | 'sepolia'
  ETH_RPC_URL?: string;
  BRIDGE_PRIVATE_KEY?: string;      // bridge custodian wallet (signs mint/burn)
  QQTA_CONTRACT_ADDR?: string;
};

export type AppVars = {
  // JWT path sets the slim shape; api-key path sets the extended shape with
  // `via: 'api_key'`. Optional fields keep both call-sites compatible.
  user: {
    id: string;
    email: string;
    role: string;
    tv?: number;
    via?: 'jwt' | 'api_key';
    api_key_id?: string;
  };
  // Sprint 5 Phase I1 — set by src/server/middleware/api-key-auth.ts.
  apiKey?: import('./middleware/api-key-auth').ApiKeyRecord;
  apiKeyBody?: string;
};

export type AppEnv = { Bindings: Env; Variables: AppVars };

const app = new Hono<AppEnv>();

// Sprint 3+ #3: global error / 404 handler + Sentry/Logflare forwarding.
// Install FIRST so any middleware/route that throws is captured.
installObservability(app as any);

// CORS for API routes
app.use('/api/*', cors());

// Sprint 5 Phase G1 — Geo-blocking gate.
// Mounted directly after CORS so cross-origin preflight succeeds, but the
// gate runs before any route handler / auth / self-scheduler. KR/US/CN/JP
// + sanctioned countries get HTTP 451 with code GEO_BLOCKED.
// /api/health* and /api/geo-status are bypassed inside the middleware.
app.use('/api/*', geoBlock());

// Public country probe used by the SPA on first paint to decide whether to
// render the app or the "region blocked" splash. Always reachable.
app.get('/api/geo-status', geoStatusHandler());

// ============================================================================
// Self-scheduling price-alert check
// Runs (at most) once per SELF_SCHEDULE_INTERVAL_MS via waitUntil when an
// incoming API request detects that the last run is stale. This works even on
// Cloudflare Pages Functions (which doesn't support Cron Triggers) because
// each incoming request gets the chance to kick off a background check.
// ============================================================================
const SELF_SCHEDULE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// Sprint 5 Phase D3-α: nonce sweep cadence — hourly is plenty since the
// skew window caps at 600s and we delete rows older than 24h.
const NONCE_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
let lastSelfScheduleAttempt = 0;
let lastNonceSweepAttempt = 0;

app.use('/api/*', async (c, next) => {
  // Fast path: skip the DB lookup on every request by using an in-memory
  // throttle first (60s). Multiple isolates may race; the DB check is the
  // authoritative guard.
  const now = Date.now();
  if (now - lastSelfScheduleAttempt > 60_000) {
    lastSelfScheduleAttempt = now;

    // Fire-and-forget via ctx.waitUntil so it never blocks the response
    const ctx = c.executionCtx as any;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          try {
            const row = await c.env.DB.prepare(
              "SELECT value FROM system_state WHERE key = 'price_alert_last_run'"
            ).first<{ value: string }>();

            // Auto-seed if the marker row doesn't exist (e.g., fresh DB)
            if (!row) {
              await c.env.DB.prepare(
                "INSERT OR IGNORE INTO system_state (key, value) VALUES ('price_alert_last_run', '0')"
              ).run();
            }

            const last = row ? parseInt(row.value || '0', 10) : 0;
            if (now - last < SELF_SCHEDULE_INTERVAL_MS) return;

            // Optimistic lock: only proceed if we successfully move the
            // marker forward. Other isolates racing will see the already-
            // incremented value and back off.
            const upd = await c.env.DB.prepare(
              `UPDATE system_state SET value = ?, updated_at = CURRENT_TIMESTAMP
               WHERE key = 'price_alert_last_run' AND CAST(value AS INTEGER) = ?`
            ).bind(String(now), last).run();

            // If no row was updated we lost the race
            if (!upd.meta || upd.meta.changes === 0) return;

            const result = await checkPriceAlerts(c.env);
            console.log('[self-scheduler] price-alert check:', result);
          } catch (e) {
            captureError(c as any, e, { where: 'self-scheduler' });
            // On failure, allow next request to retry sooner by rolling
            // back the in-memory throttle
            lastSelfScheduleAttempt = 0;
          }
        })()
      );
    }
  }

  // Sprint 5 Phase D3-α: piggy-back nonce sweep on incoming traffic.
  // Cloudflare Pages does not expose cron triggers, so we reuse the proven
  // self-scheduler pattern with its own marker (last_nonce_sweep_at) and
  // a longer 60-minute cadence so we don't crowd the price-alert tick.
  if (now - lastNonceSweepAttempt > 5 * 60_000) {
    lastNonceSweepAttempt = now;
    const ctx = c.executionCtx as any;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          try {
            const row = await c.env.DB.prepare(
              "SELECT value FROM system_state WHERE key = 'last_nonce_sweep_at'",
            ).first<{ value: string }>();

            if (!row) {
              await c.env.DB.prepare(
                "INSERT OR IGNORE INTO system_state (key, value) VALUES ('last_nonce_sweep_at', '0')",
              ).run();
            }

            const last = row ? parseInt(row.value || '0', 10) : 0;
            if (now - last < NONCE_SWEEP_INTERVAL_MS) return;

            const upd = await c.env.DB.prepare(
              `UPDATE system_state SET value = ?, updated_at = CURRENT_TIMESTAMP
               WHERE key = 'last_nonce_sweep_at' AND CAST(value AS INTEGER) = ?`,
            ).bind(String(now), last).run();

            if (!upd.meta || upd.meta.changes === 0) return;

            const { sweepExpiredNonces } = await import('./lib/nonce-sweep');
            const result = await sweepExpiredNonces(c.env);
            console.log('[self-scheduler] nonce sweep:', result);
          } catch (e) {
            captureError(c as any, e, { where: 'self-scheduler-nonce' });
            lastNonceSweepAttempt = 0;
          }
        })(),
      );
    }
  }

  await next();
});

// Routes
app.route('/api/auth', authRoutes);
app.route('/api/market', marketRoutes);
app.route('/api/orders', orderRoutes);
app.route('/api/wallet', walletRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/price-alerts', priceAlertRoutes);
app.route('/api/profile', profileRoutes);
app.route('/api/chain', chainRoutes);
app.route('/api/risk', riskRoutes);
app.route('/api/bridge', bridgeRoutes);
app.route('/api/futures', futuresRoutes);
app.route('/api/margin', marginRoutes);
app.route('/api/v1', v1Routes);

// ============================================================================
// Health checks (Sprint 3+ #3)
// ----------------------------------------------------------------------------
// /api/health         — liveness: fast, no dependencies, always 200 when up.
// /api/health/ready   — readiness: pings D1 + reports the most recent
//                       price-alert cron tick so monitors can alarm on stale
//                       workers. Returns 503 if DB is unreachable.
// ============================================================================
app.get('/api/health', (c) => c.json({
  status: 'ok',
  service: 'quantaex-api',
  environment: (c.env as any).ENVIRONMENT || 'production',
  timestamp: new Date().toISOString(),
}));

app.get('/api/health/ready', async (c) => {
  const started = Date.now();
  const report: any = {
    status: 'ok',
    service: 'quantaex-api',
    environment: (c.env as any).ENVIRONMENT || 'production',
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, any>,
  };
  // 1. D1 ping — read a single row from system_state (cheap, indexed by PK).
  try {
    const row = await c.env.DB.prepare(
      "SELECT value FROM system_state WHERE key = 'price_alert_last_run'"
    ).first<{ value: string }>();
    report.checks.db = { ok: true, last_cron: row?.value || null };
  } catch (e: any) {
    report.status = 'degraded';
    report.checks.db = { ok: false, error: String(e?.message || e) };
  }
  // 2. Observability sinks configured?
  report.checks.sentry = !!(c.env as any).SENTRY_DSN ? 'configured' : 'disabled';
  report.checks.logflare = !!(c.env as any).LOGFLARE_API_KEY ? 'configured' : 'disabled';
  report.checks.mailer = !!(c.env as any).RESEND_API_KEY ? 'configured' : 'disabled';

  report.elapsed_ms = Date.now() - started;
  return c.json(report, report.status === 'ok' ? 200 : 503);
});

// ===== COIN BASE PRICES (source of truth) =====
const COIN_PRICES: Record<string, number> = {
  BTC: 67250, ETH: 3450, BNB: 605, SOL: 172.5, XRP: 0.625,
  ADA: 0.452, DOGE: 0.0845, DOT: 7.25, AVAX: 38.75, MATIC: 0.865, QTA: 0.0125,
};

// Per-symbol persistent price state
const priceState: Record<string, {
  price: number;
  change24h: number;
  high: number;
  low: number;
  volume: number;
  prevPrice: number;
  trend: number; // -1 to 1, drift bias
  trendDuration: number;
}> = {};

function initPriceState(symbol: string, basePrice: number, quote: string) {
  const key = `${symbol}-${quote}`;
  if (!priceState[key]) {
    // USDT and USDC both peg to ~$1, so the base USD price applies as-is.
    const p = basePrice;
    const jitter = 1 + (Math.random() - 0.5) * 0.02;
    const price = p * jitter;
    priceState[key] = {
      price,
      prevPrice: price,
      change24h: (Math.random() - 0.4) * 6,
      high: price * (1 + Math.random() * 0.03),
      low: price * (1 - Math.random() * 0.03),
      volume: basePrice > 100 ? Math.random() * 8000 + 2000 : Math.random() * 800000 + 100000,
      trend: (Math.random() - 0.5) * 0.6,
      trendDuration: Math.floor(Math.random() * 20) + 5,
    };
  }
  return priceState[key];
}

function tickPrice(key: string) {
  const s = priceState[key];
  if (!s) return;

  s.prevPrice = s.price;

  // Occasionally shift trend direction (market regime change)
  s.trendDuration--;
  if (s.trendDuration <= 0) {
    s.trend = (Math.random() - 0.5) * 0.8;
    s.trendDuration = Math.floor(Math.random() * 30) + 5;
  }

  // Random walk with trend bias, +-0.05% base volatility
  const volatility = 0.0005 + Math.random() * 0.0003;
  const drift = s.trend * 0.0002 + (Math.random() - 0.5) * volatility;

  // Occasional larger moves (1% chance of 0.1-0.3% spike)
  const spike = Math.random() < 0.01 ? (Math.random() - 0.5) * 0.003 : 0;

  s.price *= (1 + drift + spike);
  if (s.price > s.high) s.high = s.price;
  if (s.price < s.low) s.low = s.price;

  // Volume tick
  const baseVol = s.price > 1000 ? 2 + Math.random() * 8 : 1000 + Math.random() * 5000;
  s.volume += baseVol;

  // 24h change drift
  s.change24h += (Math.random() - 0.5) * 0.04 + s.trend * 0.01;
  s.change24h = Math.max(-15, Math.min(15, s.change24h));
}

// Generate realistic orderbook around a price
function generateOrderbook(price: number, _symbol: string) {
  const spread = price * 0.00015; // 0.015% spread (tight)
  const bids: { price: number; amount: number }[] = [];
  const asks: { price: number; amount: number }[] = [];

  const baseAmount = price > 10000 ? 0.2 : price > 1000 ? 1 : price > 100 ? 10 : price > 1 ? 500 : price > 0.01 ? 50000 : 5000000;

  for (let i = 0; i < 25; i++) {
    // Cluster orders near the spread, thin out further away
    const distFactor = 1 + i * 0.3 + Math.random() * 0.2;
    const bidPrice = price - spread * distFactor;
    const askPrice = price + spread * distFactor;

    // Larger orders further from spread (wall-like behavior)
    const sizeMultiplier = 0.2 + Math.random() * 1.8 + (i > 15 ? Math.random() * 3 : 0);
    const bidAmt = baseAmount * sizeMultiplier;
    const askAmt = baseAmount * (0.2 + Math.random() * 1.8 + (i > 15 ? Math.random() * 3 : 0));

    bids.push({
      price: +bidPrice.toPrecision(price > 100 ? 7 : 6),
      amount: +bidAmt.toPrecision(5),
    });
    asks.push({
      price: +askPrice.toPrecision(price > 100 ? 7 : 6),
      amount: +askAmt.toPrecision(5),
    });
  }

  return { bids, asks };
}

// Incrementally update orderbook (small changes each tick)
function tickOrderbook(prevBook: { bids: any[]; asks: any[] }, price: number, _symbol: string) {
  const mutate = (entries: any[], isBid: boolean) => {
    return entries.map((entry) => {
      // 30% chance to adjust amount
      if (Math.random() < 0.3) {
        const change = entry.amount * (Math.random() * 0.2 - 0.1);
        const newAmt = Math.max(entry.amount * 0.1, entry.amount + change);
        return { price: entry.price, amount: +newAmt.toPrecision(5) };
      }
      return entry;
    });
  };

  return {
    bids: mutate(prevBook.bids, true),
    asks: mutate(prevBook.asks, false),
  };
}

// Generate simulated recent trades
function generateRecentTrades(price: number, _symbol: string, count = 30) {
  const trades: any[] = [];
  const baseAmount = price > 10000 ? 0.05 : price > 1000 ? 0.5 : price > 100 ? 5 : price > 1 ? 200 : price > 0.01 ? 20000 : 2000000;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const tradePrice = price * (1 + (Math.random() - 0.5) * 0.001);
    const amount = baseAmount * (0.05 + Math.random() * 2.5);
    const side = Math.random() > 0.47 ? 'buy' : 'sell';
    trades.push({
      id: `sim-${now}-${i}`,
      price: +tradePrice.toPrecision(price > 100 ? 7 : 6),
      amount: +amount.toPrecision(5),
      total: +(tradePrice * amount).toPrecision(7),
      side,
      time: new Date(now - i * (500 + Math.random() * 4000)).toISOString(),
    });
  }
  return trades;
}

// Generate new trades per tick (1-3 trades)
function generateTickTrades(price: number, _symbol: string) {
  const count = Math.random() < 0.3 ? 3 : Math.random() < 0.5 ? 2 : 1;
  const baseAmount = price > 10000 ? 0.05 : price > 1000 ? 0.5 : price > 100 ? 5 : price > 1 ? 200 : price > 0.01 ? 20000 : 2000000;
  const trades: any[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const tradePrice = price * (1 + (Math.random() - 0.5) * 0.0008);
    const amount = baseAmount * (0.01 + Math.random() * 1.5);
    const side = Math.random() > 0.47 ? 'buy' : 'sell';
    trades.push({
      id: `sim-${now}-${Math.random().toString(36).slice(2, 8)}`,
      price: +tradePrice.toPrecision(price > 100 ? 7 : 6),
      amount: +amount.toPrecision(5),
      total: +(tradePrice * amount).toPrecision(7),
      side,
      time: new Date(now - i * 200).toISOString(),
    });
  }
  return trades;
}

// Per-market orderbook/trades cache
const marketCache: Record<string, { orderbook: any; trades: any[] }> = {};

function getMarketCache(key: string, price: number) {
  if (!marketCache[key]) {
    marketCache[key] = {
      orderbook: generateOrderbook(price, key),
      trades: generateRecentTrades(price, key),
    };
  }
  return marketCache[key];
}

// ===== TRUE SSE STREAMING: COMBINED TICKER + MARKET DATA =====
app.get('/api/stream/ticker', async (c) => {
  // Initialize all price states
  for (const [symbol, basePrice] of Object.entries(COIN_PRICES)) {
    initPriceState(symbol, basePrice, 'USDT');
    initPriceState(symbol, basePrice, 'USDC');
  }

  // Get optional market subscription
  const subscribedMarket = c.req.query('market') || '';
  // ?mock=1 allows simulated orderbook/trades to be emitted over SSE
  // (used ONLY by the landing/marketing page for a decorative feed).
  // Real trade page MUST NOT pass mock=1.
  const allowMock = c.req.query('mock') === '1';

  // Try to blend with real DB data (non-blocking)
  try {
    const markets = await c.env.DB.prepare(
      `SELECT m.base_coin, m.quote_coin, c.price_usd FROM markets m JOIN coins c ON c.symbol = m.base_coin WHERE m.is_active = 1`
    ).all();
    for (const m of markets.results as any[]) {
      const key = `${m.base_coin}-${m.quote_coin}`;
      if (priceState[key] && m.price_usd > 0) {
        // USDT/USDC are both ~$1, no FX conversion needed.
        priceState[key].price = priceState[key].price * 0.95 + m.price_usd * 0.05;
      }
    }
  } catch { /* DB might not be available */ }

  // Use ReadableStream with pull-based controller for CF Workers compatibility
  let tickCount = 0;
  const maxTicks = 18;
  const encoder = new TextEncoder();

  const formatEvent = (eventType: string, data: any) => {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  };

  const buildTickers = () => {
    const tickers: Record<string, any> = {};
    for (const [symbol] of Object.entries(COIN_PRICES)) {
      for (const quote of ['USDT', 'USDC']) {
        const key = `${symbol}-${quote}`;
        tickPrice(key);
        const s = priceState[key];
        tickers[key] = {
          last: +s.price.toPrecision(8),
          change: +s.change24h.toFixed(2),
          volume: +s.volume.toFixed(2),
          high: +s.high.toPrecision(8),
          low: +s.low.toPrecision(8),
        };
      }
    }
    return tickers;
  };

  // Fetch real orderbook/trades from D1 for the subscribed market.
  // Returns { bids, asks, trades } or null if market is unknown / DB fails.
  const fetchRealMarketData = async (sym: string) => {
    const [base, quote] = sym.split('-');
    try {
      const market = await c.env.DB.prepare(
        'SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?'
      ).bind(base, quote).first() as any;
      if (!market) return null;
      const { results: bids } = await c.env.DB.prepare(
        `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'buy' AND status IN ('open','partial') GROUP BY price ORDER BY price DESC LIMIT 25`
      ).bind(market.id).all();
      const { results: asks } = await c.env.DB.prepare(
        `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'sell' AND status IN ('open','partial') GROUP BY price ORDER BY price ASC LIMIT 25`
      ).bind(market.id).all();
      const { results: trades } = await c.env.DB.prepare(`
        SELECT t.id, t.price, t.amount, t.total, t.created_at as time,
          CASE WHEN o.side = 'buy' THEN 'buy' ELSE 'sell' END as side
        FROM trades t JOIN orders o ON o.id = t.buy_order_id
        WHERE t.market_id = ? ORDER BY t.created_at DESC LIMIT 50
      `).bind(market.id).all();
      return {
        bids: (bids as any[]) ?? [],
        asks: (asks as any[]) ?? [],
        trades: (trades as any[]) ?? [],
      };
    } catch {
      return null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      // Send initial ticker data
      const tickers = buildTickers();
      controller.enqueue(encoder.encode(formatEvent('tickers', tickers)));

      // Send initial orderbook & trades if subscribed
      if (subscribedMarket) {
        (async () => {
          const real = await fetchRealMarketData(subscribedMarket);
          if (real) {
            controller.enqueue(encoder.encode(formatEvent('orderbook', { bids: real.bids, asks: real.asks, simulated: false })));
            controller.enqueue(encoder.encode(formatEvent('trades', real.trades)));
          } else if (allowMock) {
            const [base, quote] = subscribedMarket.split('-');
            const key = `${base}-${quote}`;
            const state = priceState[key];
            if (state) {
              const cache = getMarketCache(key, state.price);
              controller.enqueue(encoder.encode(formatEvent('orderbook', { ...cache.orderbook, simulated: true })));
              controller.enqueue(encoder.encode(formatEvent('trades', cache.trades)));
            }
          } else {
            // Truthful empty state
            controller.enqueue(encoder.encode(formatEvent('orderbook', { bids: [], asks: [], simulated: false })));
            controller.enqueue(encoder.encode(formatEvent('trades', [])));
          }
        })();
      }

      // Stream loop
      const interval = setInterval(() => {
        tickCount++;
        if (tickCount > maxTicks) {
          clearInterval(interval);
          controller.close();
          return;
        }

        try {
          const tickers = buildTickers();
          controller.enqueue(encoder.encode(formatEvent('tickers', tickers)));

          if (subscribedMarket) {
            (async () => {
              const real = await fetchRealMarketData(subscribedMarket);
              if (real) {
                controller.enqueue(encoder.encode(formatEvent('orderbook', { bids: real.bids, asks: real.asks, simulated: false })));
                // Only push trades delta: since last tick. Simpler: push last 10.
                controller.enqueue(encoder.encode(formatEvent('trades', real.trades.slice(0, 10))));
              } else if (allowMock) {
                const [base, quote] = subscribedMarket.split('-');
                const key = `${base}-${quote}`;
                const state = priceState[key];
                if (state) {
                  const cache = getMarketCache(key, state.price);
                  cache.orderbook = tickCount % 5 === 0
                    ? generateOrderbook(state.price, key)
                    : tickOrderbook(cache.orderbook, state.price, key);
                  const newTrades = generateTickTrades(state.price, key);
                  cache.trades = [...newTrades, ...cache.trades].slice(0, 50);
                  controller.enqueue(encoder.encode(formatEvent('orderbook', { ...cache.orderbook, simulated: true })));
                  controller.enqueue(encoder.encode(formatEvent('trades', newTrades)));
                }
              }
              // If no real data and mock disabled, stay silent — client keeps
              // whatever empty state it started with.
            })().catch(() => {});
          }
        } catch {
          clearInterval(interval);
          try { controller.close(); } catch {}
        }
      }, 1500);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

// ===== ORDERBOOK ENDPOINT =====
// Returns REAL orderbook from DB only.
// Opt-in simulated fallback available via ?mock=1 (landing-page marketing use only).
// Never returns simulated data to the trade UI — empty book is a truthful state
// when there is no real liquidity.
app.get('/api/stream/orderbook/:symbol', async (c) => {
  const symbol = c.req.param('symbol');
  const [base, quote] = symbol.split('-');
  const key = `${base}-${quote}`;
  const allowMock = c.req.query('mock') === '1';

  try {
    const market = await c.env.DB.prepare('SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?').bind(base, quote).first() as any;
    if (market) {
      const { results: realBids } = await c.env.DB.prepare(
        `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'buy' AND status IN ('open','partial') GROUP BY price ORDER BY price DESC LIMIT 25`
      ).bind(market.id).all();
      const { results: realAsks } = await c.env.DB.prepare(
        `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'sell' AND status IN ('open','partial') GROUP BY price ORDER BY price ASC LIMIT 25`
      ).bind(market.id).all();
      return c.json({ bids: realBids ?? [], asks: realAsks ?? [], simulated: false });
    }
  } catch (e) {
    // DB hiccup — fall through
  }

  // Market not found OR DB failure
  if (!allowMock) {
    return c.json({ bids: [], asks: [], simulated: false });
  }

  // Opt-in: landing/marketing page asks for decorative book
  const basePrice = COIN_PRICES[base];
  if (basePrice) initPriceState(base, basePrice, quote);
  const state = priceState[key];
  if (!state) return c.json({ bids: [], asks: [], simulated: false });
  const cache = getMarketCache(key, state.price);
  return c.json({ ...cache.orderbook, simulated: true });
});

// ===== RECENT TRADES ENDPOINT =====
// Returns REAL trades from DB only. Same mock opt-in as above.
app.get('/api/stream/trades/:symbol', async (c) => {
  const symbol = c.req.param('symbol');
  const [base, quote] = symbol.split('-');
  const key = `${base}-${quote}`;
  const allowMock = c.req.query('mock') === '1';

  try {
    const market = await c.env.DB.prepare('SELECT id FROM markets WHERE base_coin = ? AND quote_coin = ?').bind(base, quote).first() as any;
    if (market) {
      const { results: realTrades } = await c.env.DB.prepare(`
        SELECT t.id, t.price, t.amount, t.total, t.created_at as time,
          CASE WHEN o.side = 'buy' THEN 'buy' ELSE 'sell' END as side
        FROM trades t JOIN orders o ON o.id = t.buy_order_id
        WHERE t.market_id = ? ORDER BY t.created_at DESC LIMIT 50
      `).bind(market.id).all();
      return c.json(realTrades ?? []);
    }
  } catch (e) {
    // fall through
  }

  if (!allowMock) return c.json([]);

  const basePrice = COIN_PRICES[base];
  if (basePrice) initPriceState(base, basePrice, quote);
  const state = priceState[key];
  if (!state) return c.json([]);
  const cache = getMarketCache(key, state.price);
  return c.json(cache.trades);
});

// Candle seed endpoint
app.get('/api/admin/seed-candles', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Auth required' }, 401);

  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const intervals: Record<string, { seconds: number; count: number }> = {
    '1m': { seconds: 60, count: 500 },
    '5m': { seconds: 300, count: 300 },
    '15m': { seconds: 900, count: 200 },
    '1h': { seconds: 3600, count: 200 },
    '4h': { seconds: 14400, count: 100 },
    '1d': { seconds: 86400, count: 90 },
  };

  const now = Math.floor(Date.now() / 1000);
  let insertCount = 0;

  for (const [symbol, basePrice] of Object.entries(COIN_PRICES)) {
    for (const quote of ['USDT', 'USDC']) {
      const marketId = `m-${symbol.toLowerCase()}-${quote.toLowerCase()}`;
      // USDT and USDC both peg to ~$1
      const price = basePrice;

      for (const [interval, cfg] of Object.entries(intervals)) {
        let currentPrice = price * (0.9 + Math.random() * 0.1);

        for (let i = cfg.count; i >= 0; i--) {
          const openTime = Math.floor((now - i * cfg.seconds) / cfg.seconds) * cfg.seconds;
          const volatility = 0.015;
          const open = currentPrice;
          const changePercent = (Math.random() - 0.48) * volatility;
          const close = open * (1 + changePercent);
          const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.5);
          const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.5);
          const volume = Math.random() * (basePrice > 100 ? 50 : 100000);

          await c.env.DB.prepare(
            'INSERT OR REPLACE INTO candles (market_id, interval, open_time, open, high, low, close, volume) VALUES (?,?,?,?,?,?,?,?)'
          ).bind(marketId, interval, openTime, open, high, low, close, volume).run();

          currentPrice = close;
          insertCount++;
        }
      }
    }
  }

  return c.json({ message: 'Candle data seeded', count: insertCount });
});

async function verifyToken(token: string, secret: string): Promise<any> {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) throw new Error('Invalid token');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBuf = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBuf, new TextEncoder().encode(`${header}.${body}`));
  if (!valid) throw new Error('Invalid signature');
  const payload = JSON.parse(atob(body));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

// ============================================================================
// Scheduled handler: check price alerts (runs via CF cron trigger)
// ============================================================================
export async function checkPriceAlerts(env: Env): Promise<{ checked: number; triggered: number }> {
  // Load active alerts
  const { results: alerts } = await env.DB.prepare(
    `SELECT id, user_id, symbol, direction, target_price, note
     FROM price_alerts WHERE is_active = 1 AND triggered_at IS NULL LIMIT 500`
  ).all<any>();

  if (!alerts || alerts.length === 0) {
    return { checked: 0, triggered: 0 };
  }

  // Load current prices from coins table
  const { results: coins } = await env.DB.prepare(
    'SELECT symbol, price_usd FROM coins WHERE is_active = 1'
  ).all<{ symbol: string; price_usd: number }>();
  const priceMap: Record<string, number> = {};
  for (const c of coins || []) priceMap[c.symbol] = c.price_usd;

  let triggered = 0;
  const notifStmts: D1PreparedStatement[] = [];
  const updateStmts: D1PreparedStatement[] = [];
  const triggeredAt = new Date().toISOString();

  for (const a of alerts) {
    const currentPrice = priceMap[a.symbol];
    if (!(currentPrice > 0)) continue;

    const hit =
      (a.direction === 'above' && currentPrice >= a.target_price) ||
      (a.direction === 'below' && currentPrice <= a.target_price);

    if (!hit) continue;

    triggered++;
    const nid = crypto.randomUUID();
    const arrow = a.direction === 'above' ? '↑' : '↓';
    const title = `Price Alert: ${a.symbol} ${arrow} ${a.target_price}`;
    const msg = `${a.symbol} is now ${currentPrice} USD (target ${a.direction} ${a.target_price})${a.note ? ` — ${a.note}` : ''}.`;

    notifStmts.push(
      env.DB.prepare(
        `INSERT INTO notifications (id, user_id, type, title, message, data)
         VALUES (?, ?, 'price_alert', ?, ?, ?)`
      ).bind(
        nid,
        a.user_id,
        title,
        msg,
        JSON.stringify({
          alert_id: a.id,
          symbol: a.symbol,
          direction: a.direction,
          target_price: a.target_price,
          current_price: currentPrice,
        })
      )
    );

    updateStmts.push(
      env.DB.prepare(
        'UPDATE price_alerts SET triggered_at = ?, is_active = 0 WHERE id = ?'
      ).bind(triggeredAt, a.id)
    );
  }

  if (notifStmts.length > 0) {
    // Batch in chunks
    const all = [...notifStmts, ...updateStmts];
    const CHUNK = 30;
    for (let i = 0; i < all.length; i += CHUNK) {
      await env.DB.batch(all.slice(i, i + CHUNK));
    }
  }

  return { checked: alerts.length, triggered };
}

// Admin-only manual trigger (useful for testing/emergency runs)
app.post('/api/admin/run-price-alert-check', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Auth required' }, 401);
  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
  const result = await checkPriceAlerts(c.env);
  return c.json(result);
});

// Admin: inspect the self-scheduler state
app.get('/api/admin/scheduler-status', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Auth required' }, 401);
  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const row = await c.env.DB.prepare(
    "SELECT value, updated_at FROM system_state WHERE key = 'price_alert_last_run'"
  ).first<{ value: string; updated_at: string }>();

  const activeAlerts = await c.env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM price_alerts WHERE is_active = 1 AND triggered_at IS NULL'
  ).first<{ cnt: number }>();

  const last = row ? parseInt(row.value || '0', 10) : 0;
  const now = Date.now();
  return c.json({
    last_run_ms: last,
    last_run_iso: last > 0 ? new Date(last).toISOString() : null,
    last_updated_at: row?.updated_at || null,
    seconds_since_last_run: last > 0 ? Math.floor((now - last) / 1000) : null,
    interval_seconds: Math.floor(SELF_SCHEDULE_INTERVAL_MS / 1000),
    next_run_due_seconds: last > 0 ? Math.max(0, Math.floor((last + SELF_SCHEDULE_INTERVAL_MS - now) / 1000)) : 0,
    active_alerts: activeAlerts?.cnt || 0,
    server_time: new Date().toISOString(),
  });
});

// SPA fallback (must be registered AFTER all API routes so Hono matches
// specific API paths first and falls through to asset serving only for
// non-API requests)
app.get('*', async (c) => {
  try {
    const env = c.env as any;
    if (env.ASSETS) {
      const url = new URL(c.req.url);
      url.pathname = '/index.html';
      return env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
    }
    return c.text('Not Found', 404);
  } catch {
    return c.text('Not Found', 404);
  }
});

// CF Pages Functions + Workers unified export
export default {
  fetch: app.fetch,
  async scheduled(_event: any, env: Env, ctx: any) {
    // Cloudflare Pages projects manage cron schedules via the dashboard
    // (Settings > Functions > Cron Triggers), so we cannot declare them
    // in wrangler.jsonc. Every tick runs BOTH workloads — price-alert
    // checks (cheap, idempotent) and the nonce sweep (deletes rows older
    // than 24h, no-op when there is nothing to prune). Frequency is
    // therefore controlled by whatever cron schedule the dashboard has
    // registered; the recommended cadence is */15 * * * *.
    ctx.waitUntil(
      checkPriceAlerts(env)
        .then((r) => console.log('[cron] price-alert check:', r))
        .catch((e) => console.error('[cron] price-alert check failed:', e)),
    );
    ctx.waitUntil(
      import('./lib/nonce-sweep')
        .then(({ sweepExpiredNonces }) => sweepExpiredNonces(env))
        .then((r) => console.log('[cron] nonce sweep:', r))
        .catch((e) => console.error('[cron] nonce sweep failed:', e)),
    );
  },
};
