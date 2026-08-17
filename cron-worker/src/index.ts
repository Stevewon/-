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
 *
 * It also owns the CPU-heavy half of the QTA withdrawal pipeline: the Pages
 * app's admin-approve endpoint only moves a qta_withdrawals row to
 * 'broadcasting' (a queue state), because SPHINCS+ signing takes ~6-10 s and
 * must not run inside a user-facing request. processQtaWithdrawals() below
 * picks up those rows on the *\/5 tick, signs + broadcasts ONE per tick, and
 * advances it to 'confirmed' (real tx_hash) or 'failed'.
 */

import {
  deriveAccountFromMnemonic,
  isValidMnemonic,
  toChecksumAddress,
  signSphincsTx,
  verifyMnemonicMatchesHotWallet,
  type SphincsAccount,
} from './lib/qta-sphincs';
import {
  getNonce,
  suggestFees,
  encodeErc20Transfer,
  sendRawTransaction,
  getBlockNumber,
  type EvmRpcConfig,
} from './lib/qta-evm';
import {
  listInboundNativeTxs,
  listInboundTokenTransfers,
  type ExplorerConfig,
} from './lib/qta-explorer';

export interface Env {
  DB: D1Database;
  // Sprint 3+ #4: R2 bucket binding for daily D1 backups. Optional — if the
  // binding isn't present the backup cron logs a warning and no-ops.
  BACKUPS?: R2Bucket;
  BACKUP_RETENTION_DAYS?: string;
  // Sprint 4 Phase B — QTA native chain integration (mock by default)
  QTA_CHAIN_DRIVER?: string;
  QTA_NETWORK?: string;
  QTA_RPC_URL?: string;
  QTA_HOT_WALLET_PRIVATE_KEY?: string;
  // Real-adapter secrets (needed for async withdrawal sign+broadcast).
  QTA_CHAIN_ID?: string;
  QTA_HOT_WALLET_ADDRESS?: string;
  QTA_HD_WALLET_MNEMONIC?: string;
  // Blockscout v2 explorer base URL (deposit scanner reads normalised tx lists
  // from here rather than parsing SPHINCS+ blocks directly). Defaults to
  // https://scan.quantarium.io if unset.
  QTA_EXPLORER_URL?: string;
  QTA_TOKEN_QX_ADDRESS?: string;
  QTA_TOKEN_QX_DECIMALS?: string;
  QTA_TOKEN_QKEY_ADDRESS?: string;
  QTA_TOKEN_QKEY_DECIMALS?: string;
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

  // Best-effort: write a marker row so the admin dashboard can show
  // "last backup at …". Falls through silently if the table doesn't exist.
  try {
    await env.DB.prepare(
      `INSERT INTO system_markers (key, value, updated_at)
       VALUES ('last_backup_at', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(now.toISOString(), now.toISOString()).run();
  } catch (e) {
    console.warn('[backup] marker write failed (table may be missing):', e);
  }

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
    if (url.pathname === '/qta/withdrawals') {
      const result = await processQtaWithdrawals(env);
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/qta/scan') {
      const result = await scanQtaDeposits(env);
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/qta/tick') {
      const result = await qtaChainTick(env);
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/qta/env-check') {
      // Read-only diagnostic: confirms the mnemonic secret is present and that
      // its index-0 derived address matches the configured hot wallet.
      // NEVER returns the mnemonic itself (or any private key material).
      const driver = (env.QTA_CHAIN_DRIVER || 'mock').toLowerCase();
      const mnemonic = env.QTA_HD_WALLET_MNEMONIC;
      const hotWallet = env.QTA_HOT_WALLET_ADDRESS
        ? toChecksumAddress(env.QTA_HOT_WALLET_ADDRESS)
        : null;
      const out: Record<string, unknown> = {
        driver,
        mnemonic_present: Boolean(mnemonic),
        mnemonic_valid: mnemonic ? isValidMnemonic(mnemonic) : false,
        hot_wallet_configured: hotWallet,
        index0_address: null as string | null,
        matches_hot_wallet: false,
        explorer_url: env.QTA_EXPLORER_URL || null,
        rpc_configured: Boolean(env.QTA_RPC_URL),
      };
      if (mnemonic && isValidMnemonic(mnemonic)) {
        try {
          const acct = deriveAccountFromMnemonic(mnemonic, 0);
          out.index0_address = acct.address;
          out.matches_hot_wallet = hotWallet
            ? acct.address.toLowerCase() === hotWallet.toLowerCase()
            : false;
          // Diagnostic scan: if index-0 does NOT match the configured hot
          // wallet, derive indices 0..N and report at which index (if any)
          // the hot wallet appears. Returns ONLY public addresses.
          // ?scan=<N> widens the range (default 20, capped 512). When N>50 we
          // omit the full address list and return only found/index to keep the
          // response small and the derivation fast.
          if (!out.matches_hot_wallet && hotWallet) {
            const reqUrl = new URL(url.toString());
            let n = parseInt(reqUrl.searchParams.get('scan') || '20', 10);
            if (!Number.isFinite(n) || n < 1) n = 20;
            if (n > 30) n = 30; // SPHINCS+ keygen is CPU-heavy; >30/req hits 1102
            let offset = parseInt(reqUrl.searchParams.get('offset') || '0', 10);
            if (!Number.isFinite(offset) || offset < 0) offset = 0;
            if (offset > 5000) offset = 5000;
            const scan: Array<{ index: number; address: string }> = [];
            let foundAt: number | null = null;
            for (let k = 0; k < n; k++) {
              const i = offset + k;
              const a = deriveAccountFromMnemonic(mnemonic, i);
              if (n <= 50) scan.push({ index: i, address: a.address });
              if (a.address.toLowerCase() === hotWallet.toLowerCase()) {
                foundAt = i;
                break;
              }
            }
            out.scan_offset = offset;
            out.scan_range = n;
            if (n <= 50) out.scan_indices = scan;
            out.hot_wallet_found_at_index = foundAt;
          }
        } catch (e: any) {
          out.derive_error = String(e?.message || e);
        }
      }
      return new Response(JSON.stringify(out, null, 2), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        service: 'quantaex-cron',
        schedules: ['*/5 * * * * (price-alert tick)', '0 3 * * * (daily D1 backup)'],
        endpoints: ['/run', '/backup', '/backup/prune', '/qta/withdrawals', '/qta/scan', '/qta/tick', '/qta/env-check'],
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

    // Default: price-alert tick (*/5) + QTA chain monitor tick
    ctx.waitUntil(
      checkPriceAlerts(env)
        .then((r) => console.log('[cron] price-alert check:', r))
        .catch((e) => console.error('[cron] price-alert check failed:', e))
    );
    // Deposit scanner FIRST (detect new inbound transfers → qta_deposits rows),
    // then the confirmation tick advances/credits them. They're independent
    // waitUntil tasks; even if scan and tick interleave across ticks, the
    // UNIQUE(tx_hash,address) + status-guarded credit keep everything idempotent.
    ctx.waitUntil(
      scanQtaDeposits(env)
        .then((r) => console.log('[cron] qta deposit scan:', r))
        .catch((e) => console.error('[cron] qta deposit scan failed:', e))
    );
    ctx.waitUntil(
      qtaChainTick(env)
        .then((r) => console.log('[cron] qta chain tick:', r))
        .catch((e) => console.error('[cron] qta chain tick failed:', e))
    );
    // Coin-family withdrawal broadcaster: sign + broadcast ONE Quantarium
    // withdrawal (QTA / QX / QKEY) per tick. SPHINCS+ signing is CPU-heavy so
    // this deliberately runs here (cron) and not in a request handler.
    ctx.waitUntil(
      processQtaWithdrawals(env)
        .then((r) => console.log('[cron] qta withdrawal broadcast:', r))
        .catch((e) => console.error('[cron] qta withdrawal broadcast failed:', e))
    );
  },
};

// ============================================================================
// Sprint 4 Phase B — QTA native chain monitor (stub)
// ----------------------------------------------------------------------------
// Each tick:
//   1. Refresh chain head + validators (mock: synthetic head from time)
//   2. Bump pending deposits' confirmations (head - tx block)
//   3. When a deposit reaches required_confs, mark credited and increment the
//      user's QTA wallet balance via a single atomic batch.
//   4. Persist tick metadata in qta_chain_state.
//
// Real adapter will replace getMockHead/listIncoming with HTTP RPC calls.
// ============================================================================

interface QtaChainState {
  network: string;
  last_scanned_block: number;
  head_block: number;
  required_confs: number;
  signature_scheme: string;
  block_time_ms: number;
}

// ============================================================================
// Deposit scanner — detect inbound on-chain transfers to user addresses.
// ----------------------------------------------------------------------------
// qtaChainTick() only ADVANCES deposits that already exist in qta_deposits
// (bumping confirmations and crediting the wallet once confirmed). Something
// has to CREATE those rows in the first place — that's this function.
//
// Approach: for every active per-user deposit address (qta_addresses), ask the
// Blockscout v2 explorer for inbound transfers (native QTA + ERC-20 QX/QKEY)
// and INSERT any we haven't seen yet as status='detected'. The UNIQUE(tx_hash,
// address) constraint on qta_deposits makes re-inserts a harmless no-op, so we
// can safely re-scan recent history every tick without double-crediting.
//
// We deliberately do NOT parse SPHINCS+ blocks ourselves — the explorer already
// normalises every tx (including 0x7f typed txs) into a stable JSON shape.
//
// amount is stored as a human-readable decimal string (e.g. "100000"), which
// is what qtaChainTick adds to wallets.available (a REAL column).
// ============================================================================

const DEPOSIT_SCAN_ADDRESS_LIMIT = 200; // addresses scanned per tick (bounded)

function weiToDecimalString(wei: string, decimals: number): string {
  let v: bigint;
  try {
    v = BigInt(wei);
  } catch {
    return '0';
  }
  if (v <= 0n) return '0';
  const base = 10n ** BigInt(decimals);
  const intPart = v / base;
  const frac = v % base;
  if (frac === 0n) return intPart.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${intPart.toString()}.${fracStr}`;
}

async function scanQtaDeposits(env: Env): Promise<{
  ok: boolean;
  addresses: number;
  detected: number;
  reason?: string;
}> {
  const driver = (env.QTA_CHAIN_DRIVER || 'mock').toLowerCase();
  if (driver !== 'real') {
    return { ok: true, addresses: 0, detected: 0, reason: 'driver_not_real' };
  }

  const network = env.QTA_NETWORK === 'qta-testnet' ? 'qta-testnet' : 'qta-mainnet';
  const explorerUrl = (env.QTA_EXPLORER_URL || 'https://scan.quantarium.io').replace(/\/+$/, '');
  const cfg: ExplorerConfig = { baseUrl: explorerUrl };

  // Which ERC-20 contracts we credit, keyed by lowercase contract address.
  const tokenMap = new Map<string, { symbol: string; decimals: number }>();
  if (env.QTA_TOKEN_QX_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(env.QTA_TOKEN_QX_ADDRESS)) {
    tokenMap.set(env.QTA_TOKEN_QX_ADDRESS.toLowerCase(), {
      symbol: 'QX',
      decimals: Number(env.QTA_TOKEN_QX_DECIMALS || '18') || 18,
    });
  }
  if (env.QTA_TOKEN_QKEY_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(env.QTA_TOKEN_QKEY_ADDRESS)) {
    tokenMap.set(env.QTA_TOKEN_QKEY_ADDRESS.toLowerCase(), {
      symbol: 'QKEY',
      decimals: Number(env.QTA_TOKEN_QKEY_DECIMALS || '18') || 18,
    });
  }

  // Load active per-user deposit addresses on this network.
  const { results: addrs } = await env.DB.prepare(
    `SELECT user_id, address
     FROM qta_addresses
     WHERE network = ? AND is_active = 1
     LIMIT ?`
  ).bind(network, DEPOSIT_SCAN_ADDRESS_LIMIT).all<{ user_id: string; address: string }>();

  if (!addrs || addrs.length === 0) {
    return { ok: true, addresses: 0, detected: 0 };
  }

  const requiredConfs = network === 'qta-testnet' ? 6 : 12;
  const nowIso = new Date().toISOString();
  let detected = 0;

  for (const a of addrs) {
    const userId = a.user_id;
    const address = a.address;

    // Gather all inbound transfers (native + tokens) for this address.
    let inbound: Awaited<ReturnType<typeof listInboundNativeTxs>> = [];
    try {
      const [nat, tok] = await Promise.all([
        listInboundNativeTxs(cfg, address),
        tokenMap.size > 0
          ? listInboundTokenTransfers(cfg, address, tokenMap)
          : Promise.resolve([]),
      ]);
      inbound = [...nat, ...tok];
    } catch (e) {
      console.warn(`[qta-scan] explorer read failed for ${address}:`, (e as any)?.message || e);
      continue; // skip this address this tick; retry next tick
    }

    const stmts: D1PreparedStatement[] = [];
    for (const t of inbound) {
      if (!t.ok) continue;             // skip reverted txs
      if (!t.hash) continue;
      const amountStr = weiToDecimalString(t.valueWei, t.decimals);
      if (amountStr === '0') continue; // dust / zero-value

      // INSERT OR IGNORE against UNIQUE(tx_hash, address) — re-scanning the
      // same tx on later ticks is a harmless no-op (no double credit).
      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO qta_deposits
             (id, user_id, address, tx_hash, block_height, amount, asset,
              confirmations, required_confs, status, network, raw_meta,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'detected', ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          userId,
          address,
          t.hash,
          t.blockNumber,
          amountStr,
          t.symbol,
          requiredConfs,
          network,
          JSON.stringify({ from: t.from, symbol: t.symbol, contract: t.tokenContract, ts: t.timestamp }),
          nowIso,
          nowIso,
        ),
      );
    }

    if (stmts.length > 0) {
      const CHUNK = 30;
      for (let i = 0; i < stmts.length; i += CHUNK) {
        const res = await env.DB.batch(stmts.slice(i, i + CHUNK));
        // Count rows that actually inserted (changes>0 means it was new).
        for (const r of res) {
          const changes = (r as any)?.meta?.changes ?? 0;
          if (changes > 0) detected++;
        }
      }
    }
  }

  return { ok: true, addresses: addrs.length, detected };
}

async function qtaChainTick(env: Env): Promise<{
  network: string;
  head: number;
  pending: number;
  credited: number;
  ok: boolean;
}> {
  const network = env.QTA_NETWORK === 'qta-testnet' ? 'qta-testnet' : 'qta-mainnet';

  // Load current chain state row (created by migration 0015)
  const state = await env.DB.prepare(
    `SELECT network, last_scanned_block, head_block, required_confs,
            signature_scheme, block_time_ms
     FROM qta_chain_state
     WHERE network = ?`
  ).bind(network).first<QtaChainState>();

  if (!state) {
    console.warn('[qta] chain state row missing — migration 0015 not applied?');
    return { network, head: 0, pending: 0, credited: 0, ok: false };
  }

  // Head block: real driver pulls the live chain head over RPC; mock derives a
  // synthetic head from wall-clock time (2s block time).
  const driver = (env.QTA_CHAIN_DRIVER || 'mock').toLowerCase();
  let head: number;
  if (driver === 'real') {
    const rpcUrl = env.QTA_RPC_URL;
    if (!rpcUrl) {
      console.warn('[qta] real driver but QTA_RPC_URL missing — keeping stale head');
      head = state.head_block;
    } else {
      try {
        const chainId = Number(env.QTA_CHAIN_ID || '60000') || 60000;
        head = await getBlockNumber({ rpcUrl, chainId });
      } catch (e) {
        console.error('[qta] getBlockNumber failed, keeping stale head:', e);
        head = state.head_block;
      }
    }
  } else {
    head = Math.floor(Date.now() / 1000 / 2);
  }

  // Bump confirmation counts on pending/confirming deposits. We also pull the
  // amount + user + asset so we can credit the wallet on the SAME tick a
  // deposit reaches the required confirmation count (a single atomic batch per
  // deposit: mark credited + increment wallet.available).
  const { results: pending } = await env.DB.prepare(
    `SELECT id, user_id, address, amount, asset, block_height, required_confs
     FROM qta_deposits
     WHERE network = ? AND status IN ('detected', 'confirming')`
  ).bind(network).all<{
    id: string;
    user_id: string;
    address: string;
    amount: string;
    asset: string | null;
    block_height: number | null;
    required_confs: number;
  }>();

  let credited = 0;
  const stmts: D1PreparedStatement[] = [];
  const nowIso = new Date().toISOString();

  for (const d of pending || []) {
    if (!d.block_height) continue;
    const confs = Math.max(0, head - d.block_height);
    const need = d.required_confs || state.required_confs || 12;

    if (confs >= need) {
      // Atomically flip to 'credited' AND increase the user's spendable
      // balance. The WHERE guard on status makes the credit idempotent — even
      // if two ticks race, only the one that actually transitions the row
      // 'detected/confirming' -> 'credited' will have its wallet update paired
      // with a real state change (the second UPDATE matches 0 rows).
      const asset = String(d.asset || 'QTA').toUpperCase();
      const amt = Number(d.amount || '0');
      stmts.push(
        env.DB.prepare(
          `UPDATE qta_deposits
           SET status = 'credited', confirmations = ?, credited_at = ?, updated_at = ?
           WHERE id = ? AND status IN ('detected', 'confirming')`
        ).bind(confs, nowIso, nowIso, d.id),
      );
      if (amt > 0) {
        // Ensure a wallet row exists, then credit available.
        stmts.push(
          env.DB.prepare(
            `INSERT INTO wallets (user_id, coin_symbol, available, locked)
             VALUES (?, ?, 0, 0)
             ON CONFLICT(user_id, coin_symbol) DO NOTHING`
          ).bind(d.user_id, asset),
        );
        stmts.push(
          env.DB.prepare(
            `UPDATE wallets SET available = available + ?
             WHERE user_id = ? AND coin_symbol = ?`
          ).bind(amt, d.user_id, asset),
        );
      }
      credited++;
    } else {
      stmts.push(
        env.DB.prepare(
          `UPDATE qta_deposits
           SET status = 'confirming', confirmations = ?, updated_at = ?
           WHERE id = ?`
        ).bind(confs, nowIso, d.id),
      );
    }
  }

  // Persist tick metadata
  stmts.push(
    env.DB.prepare(
      `UPDATE qta_chain_state
       SET head_block = ?, last_scanned_block = ?, last_tick_at = ?, updated_at = ?
       WHERE network = ?`
    ).bind(head, head, nowIso, nowIso, network),
  );

  const CHUNK = 30;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await env.DB.batch(stmts.slice(i, i + CHUNK));
  }

  return {
    network,
    head,
    pending: (pending || []).length,
    credited,
    ok: true,
  };
}

// ============================================================================
// Coin-family withdrawal broadcaster — Quantarium-native assets only.
// ----------------------------------------------------------------------------
// The Pages app's /wallet/withdraw and /chain/qta admin approve endpoints only
// ENQUEUE a qta_withdrawals row and move it to 'broadcasting'. They must NOT
// sign, because SPHINCS+ (SLH-DSA-SHA2-128s) signing costs ~6-10 s of CPU per
// signature — far beyond a Cloudflare request's CPU budget.
//
// This function is the CPU-heavy half. Each */5 tick it picks ONE
// 'broadcasting' row, derives the exchange hot wallet (HD index 0) from the
// mnemonic, builds the right transaction for the asset family:
//     • QTA  → native value transfer (to = user, value = amountWei, data 0x)
//     • QX / QKEY → ERC-20 transfer() calldata to the token contract
// signs it (0x7f typed tx), broadcasts via eth_sendRawTransaction, and moves
// the row to 'confirmed' (real tx_hash) or 'failed'. On confirm it finalizes
// the user's locked balance (locked was set at enqueue time); on failure it
// refunds locked → available.
//
// ONE row per tick keeps the worker well within CPU limits and makes nonce
// management trivially serial for the single hot wallet.
// ============================================================================

const QTA_DECIMALS = 18;
const TOKEN_DECIMALS: Record<string, number> = { QX: 18, QKEY: 18 };

function decimalStringToWei(s: string, decimals: number): bigint {
  if (typeof s !== 'string') throw new Error('amount must be string');
  const trimmed = s.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`invalid amount: ${s}`);
  const [intPart, fracRaw = ''] = trimmed.split('.');
  if (fracRaw.length > decimals) throw new Error(`amount has more than ${decimals} decimals`);
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

interface QtaWithdrawalRow {
  id: string;
  user_id: string;
  to_address: string;
  amount: string;
  fee: string;
  asset: string | null;
  status: string;
}

async function processQtaWithdrawals(env: Env): Promise<{
  ok: boolean;
  picked: number;
  status?: string;
  id?: string;
  tx_hash?: string | null;
  reason?: string;
}> {
  const driver = (env.QTA_CHAIN_DRIVER || 'mock').toLowerCase();
  if (driver !== 'real') {
    return { ok: true, picked: 0, reason: 'driver_not_real' };
  }

  const rpcUrl = env.QTA_RPC_URL;
  const mnemonic = env.QTA_HD_WALLET_MNEMONIC;
  const hotWallet = env.QTA_HOT_WALLET_ADDRESS;
  if (!rpcUrl || !mnemonic || !hotWallet) {
    return { ok: false, picked: 0, reason: 'missing_env' };
  }
  if (!isValidMnemonic(mnemonic)) {
    return { ok: false, picked: 0, reason: 'invalid_mnemonic' };
  }

  // Pick exactly ONE broadcasting row (oldest first).
  const row = await env.DB.prepare(
    `SELECT id, user_id, to_address, amount, fee, asset, status
     FROM qta_withdrawals
     WHERE status = 'broadcasting'
     ORDER BY created_at ASC
     LIMIT 1`
  ).first<QtaWithdrawalRow>();
  if (!row) return { ok: true, picked: 0 };

  const asset = String(row.asset || 'QTA').toUpperCase();
  const nowIso = new Date().toISOString();

  // Guard: hot wallet must match the mnemonic's index-0 address, else abort
  // to avoid signing with the wrong key (nonce/funds mismatch).
  if (!verifyMnemonicMatchesHotWallet(mnemonic, hotWallet)) {
    await env.DB.prepare(
      `UPDATE qta_withdrawals
       SET status = 'failed', rejected_reason = 'hot_wallet_mnemonic_mismatch', updated_at = ?
       WHERE id = ? AND status = 'broadcasting'`
    ).bind(nowIso, row.id).run();
    // Refund the locked balance back to available (see finalize helper below).
    await refundQtaWithdrawal(env, row, asset);
    return { ok: false, picked: 1, id: row.id, status: 'failed', reason: 'hot_wallet_mnemonic_mismatch' };
  }

  const chainId = Number(env.QTA_CHAIN_ID || '60000') || 60000;
  const cfg: EvmRpcConfig = { rpcUrl, chainId };

  let hot: SphincsAccount;
  try {
    hot = deriveAccountFromMnemonic(mnemonic, 0);
  } catch (e) {
    console.error('[qta-withdraw] derive hot account failed:', e);
    return { ok: false, picked: 1, id: row.id, reason: 'derive_failed' };
  }

  try {
    const [nonce, fees] = await Promise.all([getNonce(cfg, hotWallet), suggestFees(cfg)]);

    let txHash: string;
    if (asset === 'QTA') {
      // Native QTA value transfer.
      const amountWei = decimalStringToWei(row.amount, QTA_DECIMALS);
      if (amountWei <= 0n) throw new Error('amount must be > 0');
      const { rawTx } = signSphincsTx(
        {
          chainId, nonce,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
          maxFeePerGas: fees.maxFeePerGas,
          gasLimit: 100_000n,
          to: toChecksumAddress(row.to_address),
          value: amountWei,
          data: '0x',
        },
        hot.publicKey, hot.secretKey,
      );
      txHash = await sendRawTransaction(cfg, rawTx);
    } else if (asset === 'QX' || asset === 'QKEY') {
      // ERC-20 transfer() to the token contract.
      const tokenAddr = asset === 'QX' ? env.QTA_TOKEN_QX_ADDRESS : env.QTA_TOKEN_QKEY_ADDRESS;
      const decimals = Number(
        (asset === 'QX' ? env.QTA_TOKEN_QX_DECIMALS : env.QTA_TOKEN_QKEY_DECIMALS) || TOKEN_DECIMALS[asset],
      ) || TOKEN_DECIMALS[asset];
      if (!tokenAddr || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddr)) {
        throw new Error(`${asset} token contract address not configured`);
      }
      const amountWei = decimalStringToWei(row.amount, decimals);
      if (amountWei <= 0n) throw new Error('amount must be > 0');
      const data = encodeErc20Transfer(toChecksumAddress(row.to_address), amountWei);
      const { rawTx } = signSphincsTx(
        {
          chainId, nonce,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
          maxFeePerGas: fees.maxFeePerGas,
          gasLimit: 200_000n,
          to: toChecksumAddress(tokenAddr),
          value: 0n,
          data,
        },
        hot.publicKey, hot.secretKey,
      );
      txHash = await sendRawTransaction(cfg, rawTx);
    } else {
      throw new Error(`unsupported asset for Quantarium wallet: ${asset}`);
    }

    // Success: record tx_hash + confirmed and finalize the locked balance
    // (funds have left the exchange, so drop them out of `locked`).
    await env.DB.prepare(
      `UPDATE qta_withdrawals
       SET status = 'confirmed', tx_hash = ?, broadcast_at = ?, confirmed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'broadcasting'`
    ).bind(txHash, nowIso, nowIso, nowIso, row.id).run();
    await finalizeQtaWithdrawal(env, row, asset);

    console.log(`[qta-withdraw] broadcast ok id=${row.id} asset=${asset} tx=${txHash}`);
    return { ok: true, picked: 1, id: row.id, status: 'confirmed', tx_hash: txHash };
  } catch (e: any) {
    const reason = String(e?.message || e).slice(0, 200);
    console.error(`[qta-withdraw] broadcast failed id=${row.id}:`, reason);
    await env.DB.prepare(
      `UPDATE qta_withdrawals
       SET status = 'failed', rejected_reason = ?, updated_at = ?
       WHERE id = ? AND status = 'broadcasting'`
    ).bind(reason, nowIso, row.id).run();
    await refundQtaWithdrawal(env, row, asset);
    return { ok: false, picked: 1, id: row.id, status: 'failed', reason };
  }
}

/**
 * Finalize a confirmed withdrawal: the amount+fee was moved to `locked` at
 * enqueue time. The net amount left the exchange, so remove it from `locked`.
 * `row.amount` is the net (post-fee) amount; `row.fee` the fee — both were
 * locked. We simply clear the full locked-out amount (net + fee).
 */
async function finalizeQtaWithdrawal(env: Env, row: QtaWithdrawalRow, asset: string): Promise<void> {
  const net = Number(row.amount || '0');
  const fee = Number(row.fee || '0');
  const total = net + fee;
  if (!(total > 0)) return;
  try {
    await env.DB.prepare(
      `UPDATE wallets SET locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?`
    ).bind(total, row.user_id, asset).run();
  } catch (e) {
    console.error('[qta-withdraw] finalize balance update failed:', e);
  }
}

/**
 * Refund a failed withdrawal: return the locked amount (net + fee) to
 * `available` so the user isn't left short.
 */
async function refundQtaWithdrawal(env: Env, row: QtaWithdrawalRow, asset: string): Promise<void> {
  const net = Number(row.amount || '0');
  const fee = Number(row.fee || '0');
  const total = net + fee;
  if (!(total > 0)) return;
  try {
    await env.DB.prepare(
      `UPDATE wallets SET locked = MAX(0, locked - ?), available = available + ?
       WHERE user_id = ? AND coin_symbol = ?`
    ).bind(total, total, row.user_id, asset).run();
  } catch (e) {
    console.error('[qta-withdraw] refund balance update failed:', e);
  }
}
