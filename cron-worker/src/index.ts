/**
 * QuantaEX Cron Worker
 *
 * Runs on the schedule defined in wrangler.jsonc (*\/5 * * * *).
 * Checks all active price alerts against current coin prices and
 * fires notifications when targets are hit.
 *
 * This Worker binds directly to the same D1 database as the Pages app
 * so it can read price_alerts / coins and insert into notifications
 * without going through the HTTP API.
 */

export interface Env {
  DB: D1Database;
}

interface PriceAlert {
  id: string;
  user_id: string;
  symbol: string;
  direction: 'above' | 'below';
  target_price: number;
  note: string | null;
}

interface Coin {
  symbol: string;
  price_usd: number;
}

async function checkPriceAlerts(env: Env): Promise<{ checked: number; triggered: number }> {
  const { results: alerts } = await env.DB.prepare(
    `SELECT id, user_id, symbol, direction, target_price, note
     FROM price_alerts WHERE is_active = 1 AND triggered_at IS NULL LIMIT 500`
  ).all<PriceAlert>();

  if (!alerts || alerts.length === 0) {
    return { checked: 0, triggered: 0 };
  }

  const { results: coins } = await env.DB.prepare(
    'SELECT symbol, price_usd FROM coins WHERE is_active = 1'
  ).all<Coin>();

  const priceMap: Record<string, number> = {};
  for (const c of coins || []) priceMap[c.symbol] = c.price_usd;

  const triggeredAt = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  let triggered = 0;

  for (const a of alerts) {
    const currentPrice = priceMap[a.symbol];
    if (!(currentPrice > 0)) continue;

    const hit =
      (a.direction === 'above' && currentPrice >= a.target_price) ||
      (a.direction === 'below' && currentPrice <= a.target_price);
    if (!hit) continue;

    triggered++;
    const arrow = a.direction === 'above' ? '↑' : '↓';
    const title = `Price Alert: ${a.symbol} ${arrow} ${a.target_price}`;
    const msg = `${a.symbol} is now ${currentPrice} USD (target ${a.direction} ${a.target_price})${a.note ? ` — ${a.note}` : ''}.`;

    stmts.push(
      env.DB.prepare(
        `INSERT INTO notifications (id, user_id, type, title, message, data)
         VALUES (?, ?, 'price_alert', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
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
    stmts.push(
      env.DB.prepare(
        'UPDATE price_alerts SET triggered_at = ?, is_active = 0 WHERE id = ?'
      ).bind(triggeredAt, a.id)
    );
  }

  // Batch in chunks of ~30 statements
  const CHUNK = 30;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await env.DB.batch(stmts.slice(i, i + CHUNK));
  }

  return { checked: alerts.length, triggered };
}

export default {
  // Optional HTTP endpoint for manual runs (useful for debugging)
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const result = await checkPriceAlerts(env);
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        service: 'quantaex-cron',
        schedule: '*/5 * * * * (every 5 minutes)',
        endpoints: ['/run (manual trigger)'],
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      checkPriceAlerts(env)
        .then((r) => console.log('[cron] price-alert check:', r))
        .catch((e) => console.error('[cron] price-alert check failed:', e))
    );
  },
};
