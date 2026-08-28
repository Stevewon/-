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
  toHex,
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
  getNativeBalance,
  erc20BalanceOf,
  type EvmRpcConfig,
} from './lib/qta-evm';
import {
  // listInboundNativeTxs intentionally NOT imported: QTA is withdraw-only, so
  // native QTA deposits are never scanned/credited (owner rule 2026-08-28).
  listInboundTokenTransfers,
  type ExplorerConfig,
} from './lib/qta-explorer';
// Standard Ethereum BIP-32/BIP-44 (secp256k1) derivation — used ONLY by the
// /qta/env-check diagnostic to test whether the Quantarium wallet app derives
// addresses the standard EVM way (m/44'/60'/0'/0/i) rather than our SPHINCS+ HD.
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 as _keccak256 } from '@noble/hashes/sha3.js';
import { runMigrations } from './migrate';
import { binaryMatchingTick } from './binary-matching';
import { scanExtDeposits, extDepositTick } from './ext-watcher';
import { sweepExtDeposits } from './ext-sweep';
import { deriveEvmAccount, evmAddressIsValid } from './lib/ext-evm-signer';
import { validateMnemonic as validateBip39 } from '@scure/bip39';
import { wordlist as bip39Wordlist } from '@scure/bip39/wordlists/english.js';

function ethAddressFromBip44(mnemonic: string, index: number, account = 0, change = 0): string {
  const seed = mnemonicToSeedSync(mnemonic.trim());
  const master = HDKey.fromMasterSeed(seed);
  const node = master.derive(`m/44'/60'/${account}'/${change}/${index}`);
  if (!node.privateKey) throw new Error('no privkey');
  const pub = secp256k1.getPublicKey(node.privateKey, false); // uncompressed 65B
  const hash = _keccak256(pub.slice(1)); // drop 0x04
  return toChecksumAddress('0x' + Array.from(hash.slice(-20)).map((b) => b.toString(16).padStart(2, '0')).join(''));
}

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
  // Manual withdrawal mode: when not 'false', the cron worker does NOT
  // auto-sign/broadcast withdrawals — a human operator pays out by hand.
  QTA_MANUAL_WITHDRAWALS?: string;
  // Blockscout v2 explorer base URL (deposit scanner reads normalised tx lists
  // from here rather than parsing SPHINCS+ blocks directly). Defaults to
  // https://scan.quantarium.io if unset.
  QTA_EXPLORER_URL?: string;
  QTA_TOKEN_QX_ADDRESS?: string;
  QTA_TOKEN_QX_DECIMALS?: string;
  QTA_TOKEN_QKEY_ADDRESS?: string;
  QTA_TOKEN_QKEY_DECIMALS?: string;
  // Deposit-sweep: forward credited QX/QKEY out of per-user deposit addresses
  // into the main wallet. Disabled with QTA_SWEEP_ENABLED='false'. Destination
  // priority: QTA_SWEEP_DESTINATION → QTA_MAIN_PAYOUT_WALLET → HD index 0.
  QTA_SWEEP_ENABLED?: string;
  QTA_SWEEP_DESTINATION?: string;
  QTA_MAIN_PAYOUT_WALLET?: string;

  // ── External (non-Quantarium) deposits — Phase B ─────────────────────────
  // Master switch. Watcher + sweep no-op unless 'true'.
  EXT_DEPOSITS_ENABLED?: string;
  // The exchange HD mnemonic used to derive per-user deposit addresses AND to
  // sign sweep transactions. Index 0 = hot wallet (sweep destination).
  EXT_HD_WALLET_MNEMONIC?: string;
  // Ethereum (ERC-20 USDT)
  EXT_ETH_RPC_URL?: string;
  EXT_ETH_EXPLORER_URL?: string;
  EXT_ETH_EXPLORER_FLAVOUR?: string;
  EXT_ETH_EXPLORER_API_KEY?: string;
  EXT_ETH_USDT_CONTRACT?: string;
  EXT_ETH_USDT_DECIMALS?: string;
  EXT_ETH_REQUIRED_CONFS?: string;
  // BSC (BEP-20 USDT)
  EXT_BSC_RPC_URL?: string;
  EXT_BSC_EXPLORER_URL?: string;
  EXT_BSC_EXPLORER_FLAVOUR?: string;
  EXT_BSC_EXPLORER_API_KEY?: string;
  EXT_BSC_USDT_CONTRACT?: string;
  EXT_BSC_USDT_DECIMALS?: string;
  EXT_BSC_REQUIRED_CONFS?: string;
  // Sweep tuning (optional)
  EXT_SWEEP_MIN_USDT?: string;         // don't sweep dust below this
  EXT_SWEEP_GAS_TOPUP_WEI?: string;    // (legacy/global) native gas to send a per-user addr before token sweep
  // Optional override receiving address for sweeps. Default = HD index 0 (the
  // exchange hot wallet derived from EXT_HD_WALLET_MNEMONIC). Set this to route
  // swept funds to an existing exchange/Binance deposit address instead.
  EXT_SWEEP_DESTINATION?: string;
  // Per-network native gas top-up (wei) sent to a user address before its
  // ERC-20 sweep transfer (covers the token transfer's gas).
  EXT_ETH_GAS_TOPUP_WEI?: string;
  EXT_BSC_GAS_TOPUP_WEI?: string;
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
    if (url.pathname === '/migrate') {
      // Manually trigger the auto-migrator (also runs on every /5 tick).
      // ?force=1 re-runs re-runnable seed migrations.
      const force = url.searchParams.get('force') === '1';
      const result = await runMigrations(env, force);
      return new Response(JSON.stringify(result, null, 2), {
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
    if (url.pathname === '/qta/sweep') {
      // Manual QX/QKEY deposit sweep → main wallet (also runs on every /5 tick).
      // ONE token move per call (SPHINCS+ signing is CPU-heavy); call repeatedly
      // to drain multiple addresses.
      const result = await sweepQtaDeposits(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/qta/reissue-address') {
      // Re-issue a user's QX/QKEY deposit address onto a FRESH, recoverable HD
      // index (current mnemonic). Fixes users whose old address was derived
      // under a since-changed mnemonic (unsweepable). Usage:
      //   /qta/reissue-address?user=<uuid>[&force=1]
      // Safe by default: refuses if the user's current index already matches
      // the live mnemonic (nothing to fix) unless force=1 is passed.
      const userId = (url.searchParams.get('user') || '').trim();
      const force = url.searchParams.get('force') === '1';
      const result = await reissueQtaDepositAddress(env, userId, force);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'content-type': 'application/json' },
        status: result.ok ? 200 : 400,
      });
    }
    if (url.pathname === '/ext/scan') {
      // Manual external-deposit scan (also runs on every /5 tick).
      const result = await scanExtDeposits(env as any);
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/ext/tick') {
      // Manual external-deposit confirmation/credit tick.
      const result = await extDepositTick(env as any);
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/ext/sweep') {
      // Manual external-deposit sweep (gas-fund → forward to hot wallet).
      const result = await sweepExtDeposits(env as any);
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/ext/env-check') {
      // Read-only diagnostic for external (BSC/BEP-20) deposits. Confirms the
      // secrets landed and shows the derived deposit-address samples + sweep
      // destination. NEVER returns the mnemonic or any private-key material.
      const e = env as any;
      const mnemonic: string | undefined = e.EXT_HD_WALLET_MNEMONIC;
      const mnemonicValid = mnemonic
        ? (() => { try { return validateBip39(mnemonic.trim(), bip39Wordlist); } catch { return false; } })()
        : false;
      const enabled = String(e.EXT_DEPOSITS_ENABLED || '').toLowerCase() === 'true';
      const out: Record<string, unknown> = {
        ext_deposits_enabled: enabled,
        mnemonic_present: Boolean(mnemonic),
        mnemonic_valid: mnemonicValid,
        activated: enabled && mnemonicValid,
        bsc: {
          rpc_configured: Boolean(e.EXT_BSC_RPC_URL),
          explorer_configured: Boolean(e.EXT_BSC_EXPLORER_URL),
          explorer_api_key_present: Boolean(e.EXT_BSC_EXPLORER_API_KEY),
          usdt_contract: e.EXT_BSC_USDT_CONTRACT || null,
          usdt_decimals: e.EXT_BSC_USDT_DECIMALS || null,
          required_confs: e.EXT_BSC_REQUIRED_CONFS || null,
        },
        eth_erc20_configured: Boolean(e.EXT_ETH_RPC_URL && e.EXT_ETH_USDT_CONTRACT), // expected false (BSC-only)
        sweep_destination_config: e.EXT_SWEEP_DESTINATION || null,
        sweep_destination_valid: evmAddressIsValid(e.EXT_SWEEP_DESTINATION),
        sample_deposit_addresses: null as unknown,
        index0_address: null as string | null,
        effective_destination: null as string | null,
      };
      if (mnemonic && mnemonicValid) {
        try {
          const idx0 = deriveEvmAccount(mnemonic.trim(), 0).address;
          out.index0_address = idx0;
          out.effective_destination = evmAddressIsValid(e.EXT_SWEEP_DESTINATION)
            ? e.EXT_SWEEP_DESTINATION
            : idx0;
          out.sample_deposit_addresses = [1, 2, 3].map((i) => ({
            index: i,
            address: deriveEvmAccount(mnemonic.trim(), i).address,
          }));
        } catch (err: any) {
          out.derive_error = String(err?.message || err);
        }
      }
      return new Response(JSON.stringify(out, null, 2), {
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
        manual_withdrawal_mode:
          String(env.QTA_MANUAL_WITHDRAWALS ?? 'true').toLowerCase() !== 'false',
        // ★ Deposit-detection gate: scanQtaDeposits credits NOTHING unless at
        //   least one of these ERC-20 contract addresses is set + valid. We
        //   only expose presence/validity + a masked preview, never the full
        //   value, so this diagnostic is safe to call from a browser.
        deposit_scan_ready: false,
        token_qx_configured: false,
        token_qx_valid: false,
        token_qx_preview: null as string | null,
        token_qkey_configured: false,
        token_qkey_valid: false,
        token_qkey_preview: null as string | null,
      };
      {
        const qx = env.QTA_TOKEN_QX_ADDRESS;
        const qkey = env.QTA_TOKEN_QKEY_ADDRESS;
        const addrRe = /^0x[0-9a-fA-F]{40}$/;
        const mask = (v?: string) =>
          v && v.length >= 10 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v || null;
        out.token_qx_configured = Boolean(qx);
        out.token_qx_valid = Boolean(qx && addrRe.test(qx));
        out.token_qx_preview = out.token_qx_valid ? mask(qx) : null;
        out.token_qkey_configured = Boolean(qkey);
        out.token_qkey_valid = Boolean(qkey && addrRe.test(qkey));
        out.token_qkey_preview = out.token_qkey_valid ? mask(qkey) : null;
        // Deposits can only be detected+credited when the driver is real AND
        // at least one valid token contract is configured.
        out.deposit_scan_ready =
          driver === 'real' && (out.token_qx_valid || out.token_qkey_valid);
      }
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

            // ALSO test the STANDARD Ethereum BIP-44 (secp256k1/ECDSA) path.
            // If the Quantarium wallet app derives addresses the normal EVM
            // way, the hot wallet will appear here even though it never shows
            // up in our SPHINCS+ HD tree. Try common path variants, i=0..9.
            try {
              const ecdsa: Array<{ path: string; index: number; address: string }> = [];
              let ecdsaFoundPath: string | null = null;
              const variants: Array<[number, number, string]> = [
                [0, 0, "m/44'/60'/0'/0/{i}"],   // standard MetaMask
                [0, 1, "m/44'/60'/0'/1/{i}"],   // change chain
              ];
              // Also account-indexed: m/44'/60'/{i}'/0/0 (Ledger-style)
              for (let i = 0; i < 10; i++) {
                for (const [acct, change, tmpl] of variants) {
                  const addr = ethAddressFromBip44(mnemonic, i, acct, change);
                  if (i < 5) ecdsa.push({ path: tmpl.replace('{i}', String(i)), index: i, address: addr });
                  if (addr.toLowerCase() === hotWallet.toLowerCase()) {
                    ecdsaFoundPath = tmpl.replace('{i}', String(i));
                    break;
                  }
                }
                if (ecdsaFoundPath) break;
              }
              // Ledger-style account index
              if (!ecdsaFoundPath) {
                for (let a = 0; a < 10; a++) {
                  const addr = ethAddressFromBip44(mnemonic, 0, a, 0);
                  if (addr.toLowerCase() === hotWallet.toLowerCase()) {
                    ecdsaFoundPath = `m/44'/60'/${a}'/0/0`;
                    break;
                  }
                }
              }
              out.ecdsa_bip44_samples = ecdsa;
              out.ecdsa_bip44_index0 = ethAddressFromBip44(mnemonic, 0);
              out.ecdsa_bip44_found_path = ecdsaFoundPath;
              out.ecdsa_bip44_matches = Boolean(ecdsaFoundPath);
            } catch (ee: any) {
              out.ecdsa_error = String(ee?.message || ee);
            }
          }
        } catch (e: any) {
          out.derive_error = String(e?.message || e);
        }
      }
      return new Response(JSON.stringify(out, null, 2), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/binary-debug') {
      // Read-only diagnostic for the binary (Community Team Volume) tree.
      // ?q=<nickname-or-userid substring> to filter (repeatable via comma).
      // Shows each matched user's placement (binary_parent_id, binary_leg),
      // their binary_volume row, and their staking self total — so we can see
      // WHY a downline stake did/didn't roll up (leg NULL => no roll-up).
      const q = (url.searchParams.get('q') || '').trim();
      const dbg: any = { note: 'binary tree diagnostic (read-only)' };
      try {
        // Resolve candidate users by nickname/email/id substring.
        let users: any[] = [];
        if (q) {
          const terms = q.split(',').map(s => s.trim()).filter(Boolean);
          const seen = new Set<string>();
          for (const term of terms) {
            const like = `%${term}%`;
            const { results } = await env.DB.prepare(
              `SELECT id, nickname, email, referral_code,
                      binary_parent_id, binary_leg
                 FROM users
                WHERE nickname LIKE ? OR email LIKE ? OR id LIKE ? OR referral_code LIKE ?
                LIMIT 20`,
            ).bind(like, like, like, like).all<any>();
            for (const r of (results || [])) {
              if (!seen.has(r.id)) { seen.add(r.id); users.push(r); }
            }
          }
        } else {
          const { results } = await env.DB.prepare(
            `SELECT id, nickname, email, referral_code,
                    binary_parent_id, binary_leg
               FROM users
              WHERE binary_parent_id IS NOT NULL OR binary_leg IS NOT NULL
              LIMIT 40`,
          ).all<any>();
          users = results || [];
        }

        const rows: any[] = [];
        for (const u of users) {
          const vol = await env.DB.prepare(
            `SELECT left_usd, right_usd, matched_usd, self_usd, updated_at
               FROM binary_volume WHERE user_id = ?`,
          ).bind(u.id).first<any>();
          // Sum of this user's own staking (what SHOULD become self_usd).
          const stake = await env.DB.prepare(
            `SELECT COUNT(*) AS n,
                    COALESCE(SUM(principal_usd), 0) AS principal_usd,
                    COALESCE(SUM(CASE WHEN binary_counted_at IS NULL THEN 1 ELSE 0 END), 0) AS uncounted
               FROM staking_positions WHERE user_id = ?`,
          ).bind(u.id).first<any>().catch(() => null);
          // Parent nickname for readability.
          let parentNick: string | null = null;
          if (u.binary_parent_id) {
            const p = await env.DB.prepare(
              `SELECT nickname, email FROM users WHERE id = ?`,
            ).bind(u.binary_parent_id).first<any>();
            parentNick = p ? (p.nickname || p.email || null) : null;
          }
          // Referral (sponsor) relationship — the L1 referrer who invited this
          // user. This is what SHOULD have driven placeInBinaryTree at signup.
          let referrer: any = null;
          try {
            const rf = await env.DB.prepare(
              `SELECT referrer_id FROM referrals WHERE referred_id = ? AND level = 1 LIMIT 1`,
            ).bind(u.id).first<any>();
            if (rf?.referrer_id) {
              const rn = await env.DB.prepare(
                `SELECT nickname, email FROM users WHERE id = ?`,
              ).bind(rf.referrer_id).first<any>();
              referrer = { id: rf.referrer_id, nickname: rn?.nickname || null, email: rn?.email || null };
            }
          } catch (_e) { /* referrals table shape */ }
          rows.push({
            id: u.id,
            nickname: u.nickname,
            email: u.email,
            referral_code: u.referral_code,
            referrer_l1: referrer, // ← who invited them (should drive binary parent)
            binary_parent_id: u.binary_parent_id,
            binary_parent_nick: parentNick,
            binary_leg: u.binary_leg, // ← NULL means volume does NOT roll up to parent
            leg_assigned: u.binary_leg === 'L' || u.binary_leg === 'R',
            binary_volume: vol || null,
            staking: stake || null,
          });
        }
        dbg.count = rows.length;
        dbg.rows = rows;
      } catch (e: any) {
        dbg.error = String(e?.message || e);
      }
      return new Response(JSON.stringify(dbg, null, 2), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // ------------------------------------------------------------------------
    // /binary-reset — clear WRONG binary-tree links created by the OLD policy
    //   (signup referral was force-used as the binary parent). Owner rule
    //   (2026-08-28): the staking binary tree is SEPARATE from signup referral
    //   and its sponsor is chosen ONCE on the member's FIRST stake. So all the
    //   auto-linked binary_parent_id / binary_leg rows must be cleared, letting
    //   members re-choose their sponsor via the staking screen.
    //
    //   IMPORTANT: self_usd (몸값 — already-staked value) is PRESERVED. Only the
    //   parent link, the leg, and the rolled-up left/right/matched are reset.
    //
    //   Safety:
    //     • dry-run by default — shows what WOULD change. Pass
    //       ?confirm=RESET_ALL_BINARY to actually write.
    //     • ?user=<id> limits the reset to a single user (still needs confirm).
    // ------------------------------------------------------------------------
    if (url.pathname === '/binary-reset') {
      const confirm = url.searchParams.get('confirm') === 'RESET_ALL_BINARY';
      const onlyUser = (url.searchParams.get('user') || '').trim();
      const out: any = { note: 'binary tree reset (signup-referral links cleared; self_usd preserved)', dry_run: !confirm };
      try {
        // Candidates = users currently linked into the binary tree.
        const where = onlyUser
          ? `id = ?`
          : `binary_parent_id IS NOT NULL OR binary_leg IS NOT NULL`;
        const stmt = onlyUser
          ? env.DB.prepare(`SELECT id, nickname, binary_parent_id, binary_leg FROM users WHERE ${where}`).bind(onlyUser)
          : env.DB.prepare(`SELECT id, nickname, binary_parent_id, binary_leg FROM users WHERE ${where} LIMIT 500`);
        const { results } = await stmt.all<any>();
        const targets = results || [];
        out.affected_count = targets.length;
        out.affected = targets.map((t: any) => ({ id: t.id, nickname: t.nickname, was_parent: t.binary_parent_id, was_leg: t.binary_leg }));

        if (confirm && targets.length > 0) {
          const batch: any[] = [];
          for (const t of targets) {
            // Clear the user's parent link + leg.
            batch.push(
              env.DB.prepare(
                `UPDATE users SET binary_parent_id = NULL, binary_leg = NULL WHERE id = ?`,
              ).bind(t.id),
            );
            // Zero the rolled-up downline volume but KEEP self_usd (몸값).
            batch.push(
              env.DB.prepare(
                `UPDATE binary_volume
                    SET left_usd = 0, right_usd = 0, matched_usd = 0,
                        updated_at = datetime('now')
                  WHERE user_id = ?`,
              ).bind(t.id),
            );
          }
          // Also zero the rolled-up left/right/matched for EVERY parent that had
          // downline volume attributed (self_usd preserved), so stale sponsor
          // totals don't linger. Simplest safe approach: zero all left/right/
          // matched across binary_volume (self_usd untouched); real volume will
          // rebuild as members re-pick sponsors and legs get assigned.
          if (!onlyUser) {
            batch.push(
              env.DB.prepare(
                `UPDATE binary_volume
                    SET left_usd = 0, right_usd = 0, matched_usd = 0,
                        updated_at = datetime('now')`,
              ),
            );
          }
          await env.DB.batch(batch);
          out.written = true;
        } else {
          out.written = false;
          if (!confirm) out.hint = 'Add &confirm=RESET_ALL_BINARY to apply.';
        }
      } catch (e: any) {
        out.error = String(e?.message || e);
      }
      return new Response(JSON.stringify(out, null, 2), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // Read-only deposit diagnostic: latest qta_deposits rows + status counts,
    // plus (optionally) a LIVE explorer read for one address so we can see
    // whether a specific inbound transfer is on-chain but not yet detected.
    // ?address=0x…  → live-scans that address against the QX/QKEY token map.
    // NEVER exposes secrets. Safe to call from a browser.
    if (url.pathname === '/qta/deposits-debug') {
      const network = env.QTA_NETWORK === 'qta-testnet' ? 'qta-testnet' : 'qta-mainnet';
      const dbg: Record<string, unknown> = { network };
      try {
        const { results: rows } = await env.DB.prepare(
          `SELECT id, user_id, asset, amount, confirmations, required_confs,
                  status, block_height, tx_hash, address, created_at, credited_at
           FROM qta_deposits
           WHERE network = ?
           ORDER BY created_at DESC
           LIMIT 30`
        ).bind(network).all<any>();
        dbg.recent = rows || [];
        const { results: counts } = await env.DB.prepare(
          `SELECT status, COUNT(*) n, COALESCE(SUM(CAST(amount AS REAL)),0) total
           FROM qta_deposits WHERE network = ? GROUP BY status`
        ).bind(network).all<any>();
        dbg.status_counts = counts || [];
        const { results: addrs } = await env.DB.prepare(
          `SELECT user_id, address FROM qta_addresses WHERE network = ? AND is_active = 1 LIMIT 100`
        ).bind(network).all<any>();
        dbg.active_addresses = (addrs || []).length;
        dbg.addresses = addrs || [];

        // Sweep candidate diagnostics: why is/ isn't an address picked?
        const { results: hd } = await env.DB.prepare(
          `SELECT user_id, address_index FROM qta_hd_indexes LIMIT 100`
        ).bind().all<any>().catch(() => ({ results: [] as any[] }));
        dbg.hd_indexes = hd || [];

        // Derivation audit: for every stored deposit address, check whether the
        // CURRENT mnemonic reproduces it (→ we can sign/sweep) or not (→ issued
        // under an old mnemonic; funds on-chain are unrecoverable by this server).
        const mnem = env.QTA_HD_WALLET_MNEMONIC;
        if (mnem) {
          const addrByUser: Record<string, string> = {};
          for (const a of (addrs || []) as any[]) addrByUser[a.user_id] = a.address;
          const audit: Array<{ user_id: string; idx: number; stored: string; derived: string; match: boolean }> = [];
          let matchN = 0, mismatchN = 0;
          for (const h of (hd || []) as any[]) {
            const ix = Number(h.address_index);
            const stored = addrByUser[h.user_id];
            if (!stored || !Number.isInteger(ix)) continue;
            let derived = '';
            try { derived = deriveAccountFromMnemonic(mnem, ix).address; } catch { derived = 'ERR'; }
            const m = derived.toLowerCase() === stored.toLowerCase();
            if (m) matchN++; else mismatchN++;
            audit.push({ user_id: h.user_id, idx: ix, stored, derived, match: m });
          }
          audit.sort((a, b) => a.idx - b.idx);
          dbg.derivation_audit = audit;
          dbg.derivation_match_count = matchN;
          dbg.derivation_mismatch_count = mismatchN;
          const firstMatch = audit.find(a => a.match);
          dbg.first_recoverable_index = firstMatch ? firstMatch.idx : null;
        }

        const { results: sweepCands } = await env.DB.prepare(
          `SELECT DISTINCT a.address, a.user_id, h.address_index AS idx
             FROM qta_addresses a
             JOIN qta_hd_indexes h ON h.user_id = a.user_id
             JOIN qta_deposits d ON d.address = a.address AND d.network = a.network
            WHERE a.network = ? AND a.is_active = 1
              AND d.status = 'credited' AND d.asset IN ('QX','QKEY')
            ORDER BY h.address_index ASC LIMIT 50`
        ).bind(network).all<any>().catch((e: any) => ({ results: [{ error: String(e?.message || e) }] }));
        dbg.sweep_candidates = sweepCands || [];
      } catch (e: any) {
        dbg.db_error = String(e?.message || e);
      }

      // Optional: inspect ONE user's wallet balances (to confirm a credited
      // deposit actually landed in that user's spendable balance).
      const reqUrl0 = new URL(url.toString());
      const probeUser = reqUrl0.searchParams.get('user');
      if (probeUser) {
        try {
          const { results: wr } = await env.DB.prepare(
            `SELECT coin_symbol, available, locked FROM wallets
             WHERE user_id = ? AND coin_symbol IN ('QX','QKEY','QTA','USDT')`
          ).bind(probeUser).all<any>();
          const ur = await env.DB.prepare(
            `SELECT id, email, username FROM users WHERE id = ?`
          ).bind(probeUser).first<any>().catch(() => null);
          dbg.probe_user = probeUser;
          dbg.probe_user_info = ur || null;
          dbg.probe_user_wallets = wr || [];
        } catch (e: any) {
          dbg.probe_user_error = String(e?.message || e);
        }
      }

      // Optional live explorer read for one address.
      const reqUrl = new URL(url.toString());
      const probe = reqUrl.searchParams.get('address');
      if (probe && /^0x[0-9a-fA-F]{40}$/.test(probe)) {
        try {
          const explorerUrl = (env.QTA_EXPLORER_URL || 'https://scan.quantarium.io').replace(/\/+$/, '');
          const cfg: ExplorerConfig = { baseUrl: explorerUrl };
          const tokenMap = new Map<string, { symbol: string; decimals: number }>();
          if (env.QTA_TOKEN_QX_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(env.QTA_TOKEN_QX_ADDRESS)) {
            tokenMap.set(env.QTA_TOKEN_QX_ADDRESS.toLowerCase(), { symbol: 'QX', decimals: Number(env.QTA_TOKEN_QX_DECIMALS || '18') || 18 });
          }
          if (env.QTA_TOKEN_QKEY_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(env.QTA_TOKEN_QKEY_ADDRESS)) {
            tokenMap.set(env.QTA_TOKEN_QKEY_ADDRESS.toLowerCase(), { symbol: 'QKEY', decimals: Number(env.QTA_TOKEN_QKEY_DECIMALS || '18') || 18 });
          }
          const inbound = await listInboundTokenTransfers(cfg, probe, tokenMap);
          dbg.probe_address = probe;
          dbg.probe_token_map = Array.from(tokenMap.entries()).map(([addr, v]) => ({ contract: addr, ...v }));
          dbg.probe_inbound = inbound;
        } catch (e: any) {
          dbg.probe_error = String(e?.message || e);
        }
      }
      return new Response(JSON.stringify(dbg, null, 2), {
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        service: 'quantaex-cron',
        schedules: ['*/5 * * * * (price-alert tick)', '0 3 * * * (daily D1 backup)'],
        endpoints: ['/run', '/migrate', '/backup', '/backup/prune', '/qta/withdrawals', '/qta/scan', '/qta/tick', '/qta/sweep', '/qta/reissue-address', '/qta/env-check', '/qta/deposits-debug', '/binary-debug', '/binary-reset', '/ext/scan', '/ext/tick', '/ext/sweep', '/ext/env-check'],
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

    // Auto-apply any pending D1 migrations FIRST (cheap no-op once done). This
    // is how new migrations reach prod without a manual wrangler step or a
    // workflow edit — the worker owns migration application.
    ctx.waitUntil(
      runMigrations(env)
        .then((r) => {
          if (r.applied.length) console.log('[cron] migrations applied:', r.applied);
          if (r.errors.length) console.error('[cron] migration errors:', r.errors);
        })
        .catch((e) => console.error('[cron] migration run failed:', e))
    );

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
    // Deposit SWEEP: forward credited QX/QKEY out of per-user deposit addresses
    // into the exchange MAIN wallet. ONE token move per tick (SPHINCS+ signing
    // is CPU-heavy). No-op unless the chain is live + mnemonic/RPC/tokens set.
    ctx.waitUntil(
      sweepQtaDeposits(env)
        .then((r) => console.log('[cron] qta deposit sweep:', r))
        .catch((e) => console.error('[cron] qta deposit sweep failed:', e))
    );
    // Coin-family withdrawal broadcaster: sign + broadcast ONE Quantarium
    // withdrawal (QTA / QX / QKEY) per tick. SPHINCS+ signing is CPU-heavy so
    // this deliberately runs here (cron) and not in a request handler.
    ctx.waitUntil(
      processQtaWithdrawals(env)
        .then((r) => console.log('[cron] qta withdrawal broadcast:', r))
        .catch((e) => console.error('[cron] qta withdrawal broadcast failed:', e))
    );

    // External (non-Quantarium) deposit watcher — Phase B. Both no-op unless
    // EXT_DEPOSITS_ENABLED='true' AND a network is fully configured. Scan first
    // (detect inbound → ext_deposits), then the tick advances/credits them.
    // Idempotent via UNIQUE(chain,tx_hash,log_index,address) + status-guarded
    // credit — same safety model as the QTA watcher.
    ctx.waitUntil(
      scanExtDeposits(env as any)
        .then((r) => console.log('[cron] ext deposit scan:', r))
        .catch((e) => console.error('[cron] ext deposit scan failed:', e))
    );
    ctx.waitUntil(
      extDepositTick(env as any)
        .then((r) => console.log('[cron] ext deposit tick:', r))
        .catch((e) => console.error('[cron] ext deposit tick failed:', e))
    );
    // Binary left/right matching: roll credited deposit USD up the binary
    // ancestry and pay tiered matching bonuses in QTA. Idempotent via
    // `binary_counted_at`. No-op until migration 0048 is applied.
    ctx.waitUntil(
      binaryMatchingTick(env as any)
        .then((r) => console.log('[cron] binary matching tick:', r))
        .catch((e) => console.error('[cron] binary matching tick failed:', e))
    );
    // Sweep/forwarding: move ONE credited per-user address's funds to the hot
    // wallet (or EXT_SWEEP_DESTINATION) per tick. Two-step gas-fund → sweep.
    // No-op unless EXT_DEPOSITS_ENABLED='true' + mnemonic + network config.
    ctx.waitUntil(
      sweepExtDeposits(env as any)
        .then((r) => console.log('[cron] ext sweep:', r))
        .catch((e) => console.error('[cron] ext sweep failed:', e))
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

    // ★★★ OWNER RULE (2026-08-28): QTA is WITHDRAW-ONLY — it can NEVER be
    //     deposited on-chain (the only way to get QTA is to deposit USDT and
    //     buy it). So we DELIBERATELY do NOT scan native QTA transfers here;
    //     we only credit QX / QKEY ERC-20 token deposits. Any native QTA sent
    //     to a deposit address is intentionally ignored (never credited).
    let inbound: Awaited<ReturnType<typeof listInboundTokenTransfers>> = [];
    if (tokenMap.size === 0) {
      // No QX/QKEY contracts configured → nothing depositable to scan.
      continue;
    }
    try {
      inbound = await listInboundTokenTransfers(cfg, address, tokenMap);
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
      if (amt > 0) {
        // Ensure a wallet row exists FIRST (harmless no-op if present).
        stmts.push(
          env.DB.prepare(
            `INSERT INTO wallets (user_id, coin_symbol, available, locked)
             VALUES (?, ?, 0, 0)
             ON CONFLICT(user_id, coin_symbol) DO NOTHING`
          ).bind(d.user_id, asset),
        );
        // ★ A3 fix: credit ONLY while this deposit row is still un-credited.
        //   The wallet UPDATE is now GUARDED by a correlated EXISTS on the
        //   deposit's status, so a duplicate/racing tick (deposit already
        //   'credited') matches 0 rows and cannot double-credit. Previously
        //   the wallet UPDATE had no status guard, so a second batch would
        //   re-add the amount even though the status flip itself no-op'd.
        stmts.push(
          env.DB.prepare(
            `UPDATE wallets SET available = available + ?
             WHERE user_id = ? AND coin_symbol = ?
               AND EXISTS (
                 SELECT 1 FROM qta_deposits
                 WHERE id = ? AND status IN ('detected','confirming')
               )`
          ).bind(amt, d.user_id, asset, d.id),
        );
      }
      // Flip status AFTER the guarded credit (statements in a D1 batch run
      // sequentially, so the EXISTS above still sees the pre-flip status). The
      // flip then closes the row so any later batch/tick is a safe no-op.
      stmts.push(
        env.DB.prepare(
          `UPDATE qta_deposits
           SET status = 'credited', confirmations = ?, credited_at = ?, updated_at = ?
           WHERE id = ? AND status IN ('detected', 'confirming')`
        ).bind(confs, nowIso, nowIso, d.id),
      );
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

// ============================================================================
// QTA DEPOSIT SWEEP (forwarding) — move credited QX / QKEY sitting in per-user
// deposit addresses into the exchange MAIN wallet (hot wallet = HD index 0, or
// QTA_MAIN_PAYOUT_WALLET / QTA_SWEEP_DESTINATION override).
// ----------------------------------------------------------------------------
// This is the QTA-chain analogue of ext-sweep.ts. Because Quantarium is an EVM
// chain (chain_id 60000) that uses SPHINCS+ typed tx 0x7f, we reuse the SAME
// signer (signSphincsTx) that already powers withdrawals. Each per-user deposit
// address is derived from the SAME mnemonic (via qta_hd_indexes.address_index),
// so the worker can sign a transfer OUT of it.
//
// Two-step gas dance (identical constraint to ERC-20 sweeps): a fresh deposit
// address holds QX but ZERO native QTA, so it cannot pay gas. So:
//   STEP 1 — gas fund: hot wallet sends a little native QTA to the user addr.
//   STEP 2 — sweep:    user addr signs an ERC-20 transfer of its ENTIRE QX
//                      (and separately QKEY) balance to the main wallet.
// ONE token move per tick keeps us well within CPU limits (SPHINCS+ signing is
// ~6-10s). Idempotent: we read LIVE on-chain balances each tick and only act
// when there's a real balance to move, so re-runs are safe.
//
// GATING: no-op unless QTA_CHAIN_DRIVER==='real' AND the mnemonic + RPC + at
// least one token contract are configured. Disabled entirely if
// QTA_SWEEP_ENABLED==='false' (default ON once the chain is live).
// ============================================================================

interface QtaSweepResult {
  ok: boolean;
  action?: string;
  asset?: string;
  address?: string;
  amount?: string;
  txHash?: string;
  reason?: string;
}

function qtaSweepEnabled(env: Env): boolean {
  const driver = (env.QTA_CHAIN_DRIVER || 'mock').toLowerCase();
  if (driver !== 'real' && driver !== 'live') return false;
  if (String(env.QTA_SWEEP_ENABLED ?? 'true').toLowerCase() === 'false') return false;
  return Boolean(env.QTA_HD_WALLET_MNEMONIC && env.QTA_RPC_URL);
}

interface QtaReissueResult {
  ok: boolean;
  reason?: string;
  user_id?: string;
  network?: string;
  old_index?: number | null;
  old_address?: string | null;
  new_index?: number;
  new_address?: string;
  matched_before?: boolean; // did the OLD index already match the live mnemonic?
  forced?: boolean;
}

/**
 * Re-issue a user's QX/QKEY deposit address on a FRESH HD index derived from
 * the CURRENT mnemonic, so future deposits land in a recoverable (sweepable)
 * address. Fixes users stranded on an old (since-rotated) mnemonic index.
 *
 * Steps (atomic via D1 batch):
 *   1. Look up the user's current qta_hd_indexes row + active qta_addresses row.
 *   2. Re-derive the current index under the live mnemonic. If it already
 *      matches the stored address, the user is fine — refuse unless force=1.
 *   3. Allocate a NEW monotonic index (MAX+1), derive it, HARD-verify the
 *      derived address (must be a fresh 0x…), then:
 *        - UPDATE qta_hd_indexes SET address_index=new, address=newAddr
 *        - UPDATE qta_addresses SET is_active=0 for the old active row(s)
 *        - INSERT a new active qta_addresses row for the new address
 *
 * On-chain funds already sitting in the OLD address are NOT moved by this call
 * (they may be unrecoverable if the old index was on a lost mnemonic). This
 * only fixes the GO-FORWARD deposit address.
 */
async function reissueQtaDepositAddress(
  env: Env,
  userId: string,
  force: boolean,
): Promise<QtaReissueResult> {
  const network = (env.QTA_NETWORK || 'qta-mainnet').trim() || 'qta-mainnet';
  if (!/^[0-9a-fA-F-]{36}$/.test(userId)) {
    return { ok: false, reason: 'invalid_user_id (expected uuid via ?user=)' };
  }
  const mnemonic = String(env.QTA_HD_WALLET_MNEMONIC || '').trim();
  if (!mnemonic || !isValidMnemonic(mnemonic)) {
    return { ok: false, reason: 'mnemonic_missing_or_invalid' };
  }

  // 1. Current index + active address.
  const idxRow = await env.DB.prepare(
    'SELECT address_index FROM qta_hd_indexes WHERE user_id = ?',
  ).bind(userId).first<{ address_index: number }>();
  const oldIndex = idxRow && Number.isInteger(idxRow.address_index)
    ? Number(idxRow.address_index)
    : null;

  const activeAddrRow = await env.DB.prepare(
    `SELECT id, address FROM qta_addresses
     WHERE user_id = ? AND network = ? AND is_active = 1
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(userId, network).first<{ id: string; address: string }>();
  const oldAddress = activeAddrRow?.address ?? null;

  // 2. Does the OLD index already reproduce under the live mnemonic?
  let matchedBefore = false;
  if (oldIndex !== null && oldAddress) {
    try {
      const chk = deriveAccountFromMnemonic(mnemonic, oldIndex);
      matchedBefore = chk.address.toLowerCase() === oldAddress.toLowerCase();
    } catch { matchedBefore = false; }
  }
  if (matchedBefore && !force) {
    return {
      ok: false,
      reason: 'already_recoverable (current index matches live mnemonic; pass &force=1 to reissue anyway)',
      user_id: userId,
      network,
      old_index: oldIndex,
      old_address: oldAddress,
      matched_before: true,
    };
  }

  // 3. Allocate a fresh monotonic index (MAX+1, >=1) and derive it.
  const maxRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(address_index), 0) AS mx FROM qta_hd_indexes',
  ).first<{ mx: number }>();
  const newIndex = Math.max(1, Number(maxRow?.mx ?? 0) + 1);

  let newAcct: SphincsAccount;
  try {
    newAcct = deriveAccountFromMnemonic(mnemonic, newIndex);
  } catch (e) {
    return { ok: false, reason: 'derivation_failed: ' + String((e as Error)?.message || e) };
  }
  const newAddress = newAcct.address;
  // HARD-verify the new address is a well-formed, distinct 0x…40hex address.
  if (!/^0x[0-9a-fA-F]{40}$/.test(newAddress)) {
    return { ok: false, reason: 'derived_address_malformed', new_index: newIndex };
  }
  if (oldAddress && newAddress.toLowerCase() === oldAddress.toLowerCase()) {
    return { ok: false, reason: 'derived_same_address (unexpected)', new_index: newIndex };
  }
  const newPubkey = '0x' + toHex(newAcct.publicKey);
  const newAddrRowId = crypto.randomUUID();

  // Atomic swap: update index row, deactivate old address rows, insert new one.
  const stmts = [
    env.DB.prepare(
      `INSERT INTO qta_hd_indexes (user_id, address_index, address, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET address_index = excluded.address_index,
                                          address       = excluded.address`,
    ).bind(userId, newIndex, newAddress),
    env.DB.prepare(
      `UPDATE qta_addresses SET is_active = 0
       WHERE user_id = ? AND network = ? AND is_active = 1`,
    ).bind(userId, network),
    env.DB.prepare(
      `INSERT INTO qta_addresses (id, user_id, address, pubkey, derivation, network, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).bind(newAddrRowId, userId, newAddress, newPubkey, `sphincs-hd-wallet-v1/${newIndex}`, network),
  ];
  await env.DB.batch(stmts);

  return {
    ok: true,
    user_id: userId,
    network,
    old_index: oldIndex,
    old_address: oldAddress,
    new_index: newIndex,
    new_address: newAddress,
    matched_before: matchedBefore,
    forced: force,
  };
}

// The MAIN wallet every deposit must ultimately land in. Priority:
//   QTA_SWEEP_DESTINATION → QTA_MAIN_PAYOUT_WALLET → QTA_HOT_WALLET_ADDRESS →
//   HD index-0 derived address. Returns checksummed 0x… or ''.
function qtaSweepDestination(env: Env, mnemonic: string): string {
  const cand = String(
    env.QTA_SWEEP_DESTINATION ||
    env.QTA_MAIN_PAYOUT_WALLET ||
    env.QTA_HOT_WALLET_ADDRESS ||
    ''
  ).trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(cand)) return toChecksumAddress(cand);
  try {
    return deriveAccountFromMnemonic(mnemonic, 0).address;
  } catch {
    return '';
  }
}

async function sweepQtaDeposits(env: Env): Promise<QtaSweepResult> {
  if (!qtaSweepEnabled(env)) return { ok: true, reason: 'disabled' };

  const network = env.QTA_NETWORK === 'qta-testnet' ? 'qta-testnet' : 'qta-mainnet';
  const mnemonic = env.QTA_HD_WALLET_MNEMONIC as string;
  const rpcUrl = env.QTA_RPC_URL as string;
  const chainId = Number(env.QTA_CHAIN_ID || '60000') || 60000;
  const cfg: EvmRpcConfig = { rpcUrl, chainId };

  const destination = qtaSweepDestination(env, mnemonic);
  if (!destination) return { ok: false, reason: 'no_destination' };

  // Token contracts to sweep.
  const tokens: Array<{ symbol: string; contract: string; decimals: number }> = [];
  if (env.QTA_TOKEN_QX_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(env.QTA_TOKEN_QX_ADDRESS)) {
    tokens.push({ symbol: 'QX', contract: env.QTA_TOKEN_QX_ADDRESS, decimals: Number(env.QTA_TOKEN_QX_DECIMALS || '18') || 18 });
  }
  if (env.QTA_TOKEN_QKEY_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(env.QTA_TOKEN_QKEY_ADDRESS)) {
    tokens.push({ symbol: 'QKEY', contract: env.QTA_TOKEN_QKEY_ADDRESS, decimals: Number(env.QTA_TOKEN_QKEY_DECIMALS || '18') || 18 });
  }
  if (tokens.length === 0) return { ok: true, reason: 'no_tokens' };

  // Candidate deposit addresses: any address (index >= 1) that has received a
  // credited QX/QKEY deposit. We JOIN qta_hd_indexes to get the derivation
  // index so we can reconstruct the signer. Skip the destination itself.
  const { results: cands } = await env.DB.prepare(
    `SELECT DISTINCT a.address, a.user_id, h.address_index AS idx
       FROM qta_addresses a
       JOIN qta_hd_indexes h ON h.user_id = a.user_id
       JOIN qta_deposits d ON d.address = a.address AND d.network = a.network
      WHERE a.network = ? AND a.is_active = 1
        AND d.status = 'credited' AND d.asset IN ('QX','QKEY')
      ORDER BY h.address_index ASC
      LIMIT 50`
  ).bind(network).all<{ address: string; user_id: string; idx: number }>();

  if (!cands || cands.length === 0) return { ok: true, reason: 'nothing_to_sweep' };

  // Fee suggestion once per tick.
  let fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
  try {
    fees = await suggestFees(cfg);
  } catch (e: any) {
    return { ok: false, reason: 'suggest_fees_failed: ' + String(e?.message || e) };
  }
  const erc20GasLimit = 200_000n;
  const nativeGasLimit = 21_000n;
  const sweepGasCost = fees.maxFeePerGas * erc20GasLimit;

  for (const cand of cands) {
    const idx = Number(cand.idx);
    if (!Number.isInteger(idx) || idx < 1) continue; // never sweep index 0 (the hot wallet itself)

    // Derive the user's deposit account and HARD-VERIFY it matches the stored
    // address. A mismatch means the mnemonic can't actually control this
    // address, so signing would send FROM the wrong account → abort this addr.
    let userAcct: SphincsAccount;
    try {
      userAcct = deriveAccountFromMnemonic(mnemonic, idx);
    } catch (e) {
      console.error('[qta-sweep] derive failed idx', idx, e);
      continue;
    }
    if (userAcct.address.toLowerCase() !== cand.address.toLowerCase()) {
      console.error(`[qta-sweep] derived ${userAcct.address} != stored ${cand.address} (idx ${idx}) — mnemonic mismatch, skip`);
      continue;
    }
    if (userAcct.address.toLowerCase() === destination.toLowerCase()) continue;

    // Live token balances of this user address.
    let qxBal = 0n, qkeyBal = 0n, nativeBal = 0n;
    try {
      const tokenBals: bigint[] = await Promise.all(
        tokens.map(t => erc20BalanceOf(cfg, t.contract, userAcct.address)),
      );
      tokens.forEach((t, i) => {
        if (t.symbol === 'QX') qxBal = tokenBals[i];
        else if (t.symbol === 'QKEY') qkeyBal = tokenBals[i];
      });
      nativeBal = await getNativeBalance(cfg, userAcct.address);
    } catch (e: any) {
      console.warn('[qta-sweep] balance read failed', userAcct.address, e?.message || e);
      continue;
    }

    // Pick the first token with a non-zero balance to move THIS tick.
    const moving = tokens.find(t => (t.symbol === 'QX' ? qxBal : qkeyBal) > 0n);
    if (!moving) continue; // no token balance here — try next candidate

    const tokenBal = moving.symbol === 'QX' ? qxBal : qkeyBal;

    // ── STEP 1: gas funding (user addr can't pay for the ERC-20 transfer) ──
    if (nativeBal < sweepGasCost) {
      let hot: SphincsAccount;
      try { hot = deriveAccountFromMnemonic(mnemonic, 0); }
      catch (e) { return { ok: false, reason: 'derive_hot_failed' }; }

      const topup = sweepGasCost + sweepGasCost / 2n; // 1.5x headroom
      let hotNative = 0n, hotNonce = 0;
      try {
        [hotNative, hotNonce] = await Promise.all([
          getNativeBalance(cfg, hot.address),
          getNonce(cfg, hot.address),
        ]);
      } catch (e: any) {
        return { ok: false, reason: 'hot_read_failed: ' + String(e?.message || e) };
      }
      const hotSendCost = fees.maxFeePerGas * nativeGasLimit;
      if (hotNative < topup + hotSendCost) {
        // The main wallet has no gas to fund sweeps. Surface this loudly — the
        // operator must top up the hot wallet with native QTA.
        console.warn(`[qta-sweep] HOT WALLET ${hot.address} OUT OF GAS: need ${topup + hotSendCost} wei, have ${hotNative}`);
        return {
          ok: false,
          action: 'hot_wallet_out_of_gas',
          address: hot.address,
          reason: `hot wallet needs native QTA for gas (need ~${Number(topup + hotSendCost) / 1e18} QTA, have ${Number(hotNative) / 1e18})`,
        };
      }

      try {
        const { rawTx } = signSphincsTx(
          {
            chainId, nonce: hotNonce,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
            maxFeePerGas: fees.maxFeePerGas,
            gasLimit: nativeGasLimit,
            to: userAcct.address, value: topup, data: '0x',
          },
          hot.publicKey, hot.secretKey,
        );
        const txHash = await sendRawTransaction(cfg, rawTx);
        console.log(`[qta-sweep] gas-funded ${userAcct.address} tx=${txHash}`);
        return { ok: true, action: 'gas_funded', address: userAcct.address, txHash };
      } catch (e: any) {
        return { ok: false, action: 'gas_fund_failed', address: userAcct.address, reason: String(e?.message || e) };
      }
    }

    // ── STEP 2: sweep the ENTIRE token balance to the main wallet ──
    try {
      const userNonce = await getNonce(cfg, userAcct.address);
      const data = encodeErc20Transfer(destination, tokenBal);
      const { rawTx } = signSphincsTx(
        {
          chainId, nonce: userNonce,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
          maxFeePerGas: fees.maxFeePerGas,
          gasLimit: erc20GasLimit,
          to: toChecksumAddress(moving.contract),
          value: 0n, data,
        },
        userAcct.publicKey, userAcct.secretKey,
      );
      const txHash = await sendRawTransaction(cfg, rawTx);
      const human = weiToDecimalString(tokenBal.toString(), moving.decimals);
      console.log(`[qta-sweep] swept ${human} ${moving.symbol} from ${userAcct.address} → ${destination} tx=${txHash}`);
      return { ok: true, action: 'swept', asset: moving.symbol, address: userAcct.address, amount: human, txHash };
    } catch (e: any) {
      return { ok: false, action: 'sweep_failed', asset: moving.symbol, address: userAcct.address, reason: String(e?.message || e) };
    }
  }

  return { ok: true, reason: 'nothing_to_sweep' };
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

  // MANUAL WITHDRAWAL MODE (boss decision 2026-08-17): while withdrawals are
  // paid out by a human operator sending from the Quantarium wallet app
  // directly, the cron worker MUST NOT auto-sign/broadcast. It leaves
  // 'broadcasting' rows untouched so an admin can process + mark them done
  // by hand. This also sidesteps the hot-wallet/mnemonic index-0 match
  // requirement (the app derives addresses differently than our HD scheme),
  // which is irrelevant when the server never signs. Default: ON.
  // Set QTA_MANUAL_WITHDRAWALS='false' to re-enable server-side auto-signing
  // (only valid once the mnemonic's index-0 == QTA_HOT_WALLET_ADDRESS).
  const manualMode = String(env.QTA_MANUAL_WITHDRAWALS ?? 'true').toLowerCase() !== 'false';
  if (manualMode) {
    return { ok: true, picked: 0, reason: 'manual_withdrawal_mode' };
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
