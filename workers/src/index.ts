import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoutes from './routes/auth';
import marketRoutes from './routes/market';
import orderRoutes from './routes/order';
import walletRoutes from './routes/wallet';
import adminRoutes from './routes/admin';

export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
};

export type AppVars = {
  user: { id: string; email: string; role: string };
};

export type AppEnv = { Bindings: Env; Variables: AppVars };

const app = new Hono<AppEnv>();

// CORS
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: [c.env.CORS_ORIGIN, 'http://localhost:5173'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
  return corsMiddleware(c, next);
});

// Routes
app.route('/api/auth', authRoutes);
app.route('/api/market', marketRoutes);
app.route('/api/orders', orderRoutes);
app.route('/api/wallet', walletRoutes);
app.route('/api/admin', adminRoutes);

// Health
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// SSE ticker endpoint (real-time price updates)
app.get('/api/stream/ticker', async (c) => {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (data: any) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch { /* client disconnected */ }
  };

  // Send initial tickers
  const markets = await c.env.DB.prepare(
    `SELECT m.id, m.base_coin, m.quote_coin, c.price_usd, c.change_24h, c.volume_24h
     FROM markets m JOIN coins c ON c.symbol = m.base_coin WHERE m.is_active = 1`
  ).all();

  const tickers: Record<string, any> = {};
  for (const m of markets.results) {
    const sym = `${m.base_coin}-${m.quote_coin}`;
    const basePrice = m.quote_coin === 'KRW' ? (m.price_usd as number) * 1350 : m.price_usd;
    tickers[sym] = {
      last: basePrice,
      change: m.change_24h || (Math.random() - 0.5) * 5,
      volume: m.volume_24h || Math.random() * 100000,
      high: (basePrice as number) * 1.02,
      low: (basePrice as number) * 0.98,
    };
  }
  await sendEvent({ type: 'tickers', data: tickers });

  // Simulate price updates (Workers have 30s limit)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const updates: Record<string, any> = {};
    for (const m of markets.results) {
      const sym = `${m.base_coin}-${m.quote_coin}`;
      const prev = tickers[sym];
      if (!prev) continue;
      const vol = 0.002;
      const change = (Math.random() - 0.48) * vol;
      const newPrice = prev.last * (1 + change);
      prev.last = newPrice;
      updates[sym] = { ...prev, last: newPrice };
    }
    await sendEvent({ type: 'tickers', data: updates });
  }

  await writer.close();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

// Seed candle data endpoint (call once after DB migration)
app.get('/api/admin/seed-candles', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Auth required' }, 401);

  // Verify admin
  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const coins: Record<string, number> = {
    BTC: 67250, ETH: 3450, BNB: 605, SOL: 172.5, XRP: 0.625,
    ADA: 0.452, DOGE: 0.0845, DOT: 7.25, AVAX: 38.75, MATIC: 0.865, QTA: 0.0125,
  };

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

  for (const [symbol, basePrice] of Object.entries(coins)) {
    for (const quote of ['USDT', 'KRW']) {
      const marketId = `m-${symbol.toLowerCase()}-${quote.toLowerCase()}`;
      const price = quote === 'KRW' ? basePrice * 1350 : basePrice;

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

export default app;
