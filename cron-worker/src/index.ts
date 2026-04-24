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
  // Sprint 3+ #4: R2 bucket binding for daily D1 backups. Optional — if the
  // binding isn't present the backup cron logs a warning and no-ops.
  BACKUPS?: R2Bucket;
  BACKUP_RETENTION_DAYS?: string;
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

// ============================================================================
// Sprint 3+ #4: Daily D1 backup to R2
// ----------------------------------------------------------------------------
// Exports a whitelisted set of tables as JSON Lines, concatenates into a
// single document, gzip-compresses with the runtime's CompressionStream,
// and PUTs to R2 at backups/YYYY-MM-DD/quantaex-<timestamp>.jsonl.gz.
//
// Followed by a retention sweep: delete objects older than BACKUP_RETENTION_DAYS.
//
// D1 has no native export API over the binding; we instead snapshot each
// table with SELECT * ... LIMIT. Page size is tuned at 2000 rows/query, which
// stays inside the 50 MB / 1 s D1 soft limits for our current workload.
// ============================================================================

// Tables to include in the backup. Ordered for readability.
const BACKUP_TABLES = [
  'users',
  'wallets',
  'markets',
  'coins',
  'orders',
  'trades',
  'deposits',
  'withdrawals',
  'withdraw_whitelist',
  'login_history',
  'price_alerts',
  'notifications',
  'email_verifications',
  'password_resets',
  'fee_tiers',
  'fee_ledger',
  'admin_audit_logs',
  'system_state',
] as const;

const PAGE_SIZE = 2000;

async function dumpTable(env: Env, table: string): Promise<string> {
  // Paged dump. ORDER BY 1 (first column) gives a stable (though arbitrary)
  // order without needing a known PK per table.
  const lines: string[] = [];
  let offset = 0;
  for (;;) {
    let rows: any[] = [];
    try {
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${table} ORDER BY 1 LIMIT ? OFFSET ?`
      ).bind(PAGE_SIZE, offset).all<any>();
      rows = (results || []) as any[];
    } catch (e: any) {
      // Table may not exist on this DB (e.g. migration not applied); skip it
      // with an informative log line rather than failing the whole backup.
      console.warn(`[backup] skip ${table}: ${e?.message || e}`);
      return `{"__table":"${table}","__skipped":true,"reason":"${String(e?.message || e).replace(/"/g, '\\"')}"}\n`;
    }
    if (rows.length === 0) break;
    for (const r of rows) lines.push(JSON.stringify({ __table: table, ...r }));
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    // Hard safety cap — one table cannot exceed 500k rows per backup.
    if (offset >= 500_000) {
      console.warn(`[backup] ${table} exceeded 500k rows cap, truncating dump`);
      break;
    }
  }
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

async function gzipString(data: string): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function backupD1ToR2(env: Env): Promise<{
  ok: boolean;
  tables: number;
  bytes: number;
  key?: string;
  error?: string;
}> {
  if (!env.BACKUPS) {
    console.warn('[backup] BACKUPS R2 binding missing, skipping');
    return { ok: false, tables: 0, bytes: 0, error: 'no_r2_binding' };
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);           // YYYY-MM-DD
  const ts = now.toISOString().replace(/[:.]/g, '-');   // safe for object key
  const key = `backups/${day}/quantaex-${ts}.jsonl.gz`;

  // Concatenate all tables into a single JSONL string.
  const parts: string[] = [];
  parts.push(JSON.stringify({
    __meta: true,
    created_at: now.toISOString(),
    database: 'quantaex-production',
    tables: BACKUP_TABLES,
  }) + '\n');

  let dumped = 0;
  for (const table of BACKUP_TABLES) {
    const chunk = await dumpTable(env, table);
    if (chunk.length > 0) {
      parts.push(chunk);
      dumped++;
    }
  }
  const raw = parts.join('');
  const gz = await gzipString(raw);

  await env.BACKUPS.put(key, gz, {
    httpMetadata: { contentType: 'application/gzip', contentEncoding: 'gzip' },
    customMetadata: {
      created_at: now.toISOString(),
      database: 'quantaex-production',
      tables_dumped: String(dumped),
      raw_bytes: String(raw.length),
      compressed_bytes: String(gz.length),
    },
  });

  return { ok: true, tables: dumped, bytes: gz.length, key };
}

async function pruneOldBackups(env: Env): Promise<{ pruned: number }> {
  if (!env.BACKUPS) return { pruned: 0 };
  const days = Math.max(1, parseInt(env.BACKUP_RETENTION_DAYS || '30', 10) || 30);
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  let pruned = 0;
  let cursor: string | undefined;
  do {
    const list = await env.BACKUPS.list({ prefix: 'backups/', cursor, limit: 1000 });
    for (const obj of list.objects) {
      const uploaded = obj.uploaded?.getTime?.() ?? 0;
      if (uploaded && uploaded < cutoff) {
        try {
          await env.BACKUPS.delete(obj.key);
          pruned++;
        } catch (e) {
          console.warn('[backup] prune delete failed:', obj.key, e);
        }
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return { pruned };
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
    if (url.pathname === '/backup') {
      const result = await backupD1ToR2(env);
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/backup/prune') {
      const result = await pruneOldBackups(env);
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        service: 'quantaex-cron',
        schedules: ['*/5 * * * * (price-alert tick)', '0 3 * * * (daily D1 backup)'],
        endpoints: ['/run', '/backup', '/backup/prune'],
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Cloudflare passes the matched cron expression in event.cron so we can
    // route to the right job. Default (every 5 min) runs price alerts.
    const cron = (event as any).cron as string | undefined;

    if (cron === '0 3 * * *') {
      ctx.waitUntil(
        (async () => {
          try {
            const r = await backupD1ToR2(env);
            console.log('[cron] d1 backup:', r);
            const p = await pruneOldBackups(env);
            console.log('[cron] backup prune:', p);
          } catch (e) {
            console.error('[cron] d1 backup failed:', e);
          }
        })(),
      );
      return;
    }

    // Default: price-alert tick (*/5)
    ctx.waitUntil(
      checkPriceAlerts(env)
        .then((r) => console.log('[cron] price-alert check:', r))
        .catch((e) => console.error('[cron] price-alert check failed:', e))
    );
  },
};
