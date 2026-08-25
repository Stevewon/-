// ============================================================================
// External (non-Quantarium) deposit watcher — Phase B.
// ----------------------------------------------------------------------------
// Mirrors the QTA watcher (scanQtaDeposits + qtaChainTick) for public EVM
// chains (Ethereum ERC-20 USDT to start, BSC BEP-20 next). Two independent
// jobs, both idempotent:
//
//   scanExtDeposits(env)  — for every active per-user deposit address in
//     ext_addresses, ask the explorer for inbound USDT (and optionally native)
//     transfers and INSERT OR IGNORE new ones into ext_deposits as 'detected'.
//     UNIQUE(chain, tx_hash, log_index, address) makes re-scans a no-op.
//
//   extDepositTick(env)   — pull the live chain head over RPC, bump
//     confirmations on detected/confirming rows, and when a deposit reaches
//     required_confs flip it to 'credited' AND increment the user's internal
//     balance in ONE atomic, status-guarded batch (no double-credit).
//
// Gating: both jobs no-op unless EXT_DEPOSITS_ENABLED === 'true'. Per-network
// config (explorer, RPC, USDT contract) is read from env; a network with no
// config is silently skipped. Nothing here derives private keys or moves funds
// — sweeping is a separate job (ext-sweep.ts).
// ============================================================================

import { getBlockNumber } from './lib/qta-evm';
import {
  listExtInboundTokenTransfers,
  listExtInboundNativeTxs,
  type ExtExplorerConfig,
  type ExtInboundTransfer,
} from './lib/ext-evm-explorer';

// Env surface consumed by the external watcher. Kept loose (index signature via
// the cast at the call sites) so we don't have to duplicate the cron Env here.
export interface ExtWatcherEnv {
  DB: D1Database;
  EXT_DEPOSITS_ENABLED?: string;

  // ── Ethereum (ERC-20) ──────────────────────────────────────────────────
  EXT_ETH_RPC_URL?: string;
  EXT_ETH_EXPLORER_URL?: string;       // etherscan V2 api base or blockscout base
  EXT_ETH_EXPLORER_FLAVOUR?: string;   // 'etherscan' | 'blockscout' (default etherscan)
  EXT_ETH_EXPLORER_API_KEY?: string;
  EXT_ETH_USDT_CONTRACT?: string;      // 0xdAC17F958D2ee523a2206206994597C13D831ec7 (mainnet)
  EXT_ETH_USDT_DECIMALS?: string;      // '6'
  EXT_ETH_REQUIRED_CONFS?: string;     // default 12

  // ── BSC (BEP-20) ───────────────────────────────────────────────────────
  EXT_BSC_RPC_URL?: string;
  EXT_BSC_EXPLORER_URL?: string;
  EXT_BSC_EXPLORER_FLAVOUR?: string;
  EXT_BSC_EXPLORER_API_KEY?: string;
  EXT_BSC_USDT_CONTRACT?: string;      // 0x55d398326f99059fF775485246999027B3197955 (BSC-USD)
  EXT_BSC_USDT_DECIMALS?: string;      // '18'
  EXT_BSC_REQUIRED_CONFS?: string;     // default 15
}

interface NetworkCfg {
  chain: 'evm';
  network: string;          // 'erc20' | 'bep20'
  nativeSymbol: string;     // 'ETH' | 'BNB'
  explorer: ExtExplorerConfig;
  rpcUrl: string;
  rpcChainId: number;
  requiredConfs: number;
  tokenMap: Map<string, { symbol: string; decimals: number }>;
}

const SCAN_ADDRESS_LIMIT = 200; // addresses per tick (bounded)

export function extWatcherEnabled(env: ExtWatcherEnv): boolean {
  return String(env.EXT_DEPOSITS_ENABLED || '').toLowerCase() === 'true';
}

/** Build the list of networks we have full config for. Missing config → skip. */
function resolveNetworks(env: ExtWatcherEnv): NetworkCfg[] {
  const out: NetworkCfg[] = [];

  // Ethereum ERC-20
  if (env.EXT_ETH_RPC_URL && env.EXT_ETH_EXPLORER_URL && env.EXT_ETH_USDT_CONTRACT) {
    const tokenMap = new Map<string, { symbol: string; decimals: number }>();
    tokenMap.set(env.EXT_ETH_USDT_CONTRACT.toLowerCase(), {
      symbol: 'USDT',
      decimals: Number(env.EXT_ETH_USDT_DECIMALS || '6') || 6,
    });
    out.push({
      chain: 'evm',
      network: 'erc20',
      nativeSymbol: 'ETH',
      explorer: {
        flavour: (env.EXT_ETH_EXPLORER_FLAVOUR === 'blockscout' ? 'blockscout' : 'etherscan'),
        baseUrl: env.EXT_ETH_EXPLORER_URL,
        apiKey: env.EXT_ETH_EXPLORER_API_KEY,
        chainId: 1,
      },
      rpcUrl: env.EXT_ETH_RPC_URL,
      rpcChainId: 1,
      requiredConfs: Number(env.EXT_ETH_REQUIRED_CONFS || '12') || 12,
      tokenMap,
    });
  }

  // BSC BEP-20
  if (env.EXT_BSC_RPC_URL && env.EXT_BSC_EXPLORER_URL && env.EXT_BSC_USDT_CONTRACT) {
    const tokenMap = new Map<string, { symbol: string; decimals: number }>();
    tokenMap.set(env.EXT_BSC_USDT_CONTRACT.toLowerCase(), {
      symbol: 'USDT',
      decimals: Number(env.EXT_BSC_USDT_DECIMALS || '18') || 18,
    });
    out.push({
      chain: 'evm',
      network: 'bep20',
      nativeSymbol: 'BNB',
      explorer: {
        flavour: (env.EXT_BSC_EXPLORER_FLAVOUR === 'blockscout' ? 'blockscout' : 'etherscan'),
        baseUrl: env.EXT_BSC_EXPLORER_URL,
        apiKey: env.EXT_BSC_EXPLORER_API_KEY,
        chainId: 56,
      },
      rpcUrl: env.EXT_BSC_RPC_URL,
      rpcChainId: 56,
      requiredConfs: Number(env.EXT_BSC_REQUIRED_CONFS || '15') || 15,
      tokenMap,
    });
  }

  return out;
}

function weiToDecimalString(wei: string, decimals: number): string {
  let v: bigint;
  try { v = BigInt(wei); } catch { return '0'; }
  if (v <= 0n) return '0';
  const base = 10n ** BigInt(decimals);
  const intPart = v / base;
  const frac = v % base;
  if (frac === 0n) return intPart.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${intPart.toString()}.${fracStr}`;
}

// ----------------------------------------------------------------------------
// scanExtDeposits — detect new inbound transfers → ext_deposits rows
// ----------------------------------------------------------------------------
export async function scanExtDeposits(env: ExtWatcherEnv): Promise<{
  ok: boolean; addresses: number; detected: number; reason?: string;
}> {
  if (!extWatcherEnabled(env)) return { ok: true, addresses: 0, detected: 0, reason: 'disabled' };
  const networks = resolveNetworks(env);
  if (networks.length === 0) return { ok: true, addresses: 0, detected: 0, reason: 'no_network_config' };

  const nowIso = new Date().toISOString();
  let totalAddrs = 0;
  let detected = 0;

  for (const net of networks) {
    // Active per-user addresses on this chain/network.
    const { results: addrs } = await env.DB.prepare(
      `SELECT user_id, address FROM ext_addresses
        WHERE chain = ? AND network = ? AND is_active = 1
        LIMIT ?`
    ).bind(net.chain, net.network, SCAN_ADDRESS_LIMIT).all<{ user_id: string; address: string }>();
    if (!addrs || addrs.length === 0) continue;
    totalAddrs += addrs.length;

    for (const a of addrs) {
      let inbound: ExtInboundTransfer[] = [];
      try {
        const [tok, nat] = await Promise.all([
          listExtInboundTokenTransfers(net.explorer, a.address, net.tokenMap),
          // Native crediting is optional; only Etherscan flavour returns rows.
          listExtInboundNativeTxs(net.explorer, a.address, net.nativeSymbol).catch(() => []),
        ]);
        inbound = [...tok, ...nat];
      } catch (e) {
        console.warn(`[ext-scan] explorer read failed for ${net.network}/${a.address}:`, (e as any)?.message || e);
        continue; // retry next tick
      }

      const stmts: D1PreparedStatement[] = [];
      for (const t of inbound) {
        if (!t.ok || !t.hash) continue;
        const amountStr = weiToDecimalString(t.valueWei, t.decimals);
        if (amountStr === '0') continue;
        stmts.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO ext_deposits
               (id, user_id, chain, network, coin_symbol, address, tx_hash, log_index,
                block_height, amount, confirmations, required_confs, status, raw_meta,
                created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'detected', ?, ?, ?)`
          ).bind(
            crypto.randomUUID(),
            a.user_id,
            net.chain,
            net.network,
            t.symbol,
            a.address,
            t.hash,
            t.logIndex,
            t.blockNumber,
            amountStr,
            net.requiredConfs,
            JSON.stringify({ from: t.from, contract: t.tokenContract, ts: t.timestamp }),
            nowIso,
            nowIso,
          ),
        );
      }

      if (stmts.length > 0) {
        const CHUNK = 30;
        for (let i = 0; i < stmts.length; i += CHUNK) {
          const res = await env.DB.batch(stmts.slice(i, i + CHUNK));
          for (const r of res) {
            if (((r as any)?.meta?.changes ?? 0) > 0) detected++;
          }
        }
      }
    }
  }

  return { ok: true, addresses: totalAddrs, detected };
}

// ----------------------------------------------------------------------------
// extDepositTick — advance confirmations + credit balances
// ----------------------------------------------------------------------------
export async function extDepositTick(env: ExtWatcherEnv): Promise<{
  ok: boolean; credited: number; pending: number; reason?: string;
}> {
  if (!extWatcherEnabled(env)) return { ok: true, credited: 0, pending: 0, reason: 'disabled' };
  const networks = resolveNetworks(env);
  if (networks.length === 0) return { ok: true, credited: 0, pending: 0, reason: 'no_network_config' };

  const nowIso = new Date().toISOString();
  let credited = 0;
  let pendingCount = 0;

  for (const net of networks) {
    // Live chain head (best-effort; skip network on RPC failure).
    let head: number;
    try {
      head = await getBlockNumber({ rpcUrl: net.rpcUrl, chainId: net.rpcChainId });
    } catch (e) {
      console.warn(`[ext-tick] getBlockNumber failed for ${net.network}:`, (e as any)?.message || e);
      continue;
    }

    // Persist head snapshot (best-effort).
    try {
      await env.DB.prepare(
        `INSERT INTO ext_scan_state (chain, network, head_block, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chain, network) DO UPDATE SET head_block = excluded.head_block, updated_at = excluded.updated_at`
      ).bind(net.chain, net.network, head, nowIso).run();
    } catch { /* non-fatal */ }

    const { results: pending } = await env.DB.prepare(
      `SELECT id, user_id, coin_symbol, amount, block_height, required_confs
         FROM ext_deposits
        WHERE chain = ? AND network = ? AND status IN ('detected','confirming')`
    ).bind(net.chain, net.network).all<{
      id: string; user_id: string; coin_symbol: string; amount: string;
      block_height: number | null; required_confs: number;
    }>();
    pendingCount += (pending || []).length;

    const stmts: D1PreparedStatement[] = [];
    for (const d of pending || []) {
      if (!d.block_height) continue;
      const confs = Math.max(0, head - d.block_height);
      const need = d.required_confs || net.requiredConfs;

      if (confs >= need) {
        const asset = String(d.coin_symbol || 'USDT').toUpperCase();
        const amt = Number(d.amount || '0');
        if (amt > 0) {
          // Ensure wallet row exists.
          stmts.push(
            env.DB.prepare(
              `INSERT INTO wallets (user_id, coin_symbol, available, locked)
               VALUES (?, ?, 0, 0)
               ON CONFLICT(user_id, coin_symbol) DO NOTHING`
            ).bind(d.user_id, asset),
          );
          // Status-guarded credit (idempotent under racing ticks): the wallet
          // UPDATE only fires while THIS deposit is still un-credited.
          stmts.push(
            env.DB.prepare(
              `UPDATE wallets SET available = available + ?
                 WHERE user_id = ? AND coin_symbol = ?
                   AND EXISTS (
                     SELECT 1 FROM ext_deposits
                      WHERE id = ? AND status IN ('detected','confirming')
                   )`
            ).bind(amt, d.user_id, asset, d.id),
          );
        }
        // Flip status AFTER the guarded credit (batch runs sequentially).
        stmts.push(
          env.DB.prepare(
            `UPDATE ext_deposits
                SET status = 'credited', confirmations = ?, credited_at = ?, updated_at = ?
              WHERE id = ? AND status IN ('detected','confirming')`
          ).bind(confs, nowIso, nowIso, d.id),
        );
        credited++;
      } else {
        // Not yet confirmed: just bump the confirmation count / mark confirming.
        stmts.push(
          env.DB.prepare(
            `UPDATE ext_deposits
                SET status = 'confirming', confirmations = ?, updated_at = ?
              WHERE id = ? AND status IN ('detected','confirming')`
          ).bind(confs, nowIso, d.id),
        );
      }
    }

    if (stmts.length > 0) {
      const CHUNK = 30;
      for (let i = 0; i < stmts.length; i += CHUNK) {
        await env.DB.batch(stmts.slice(i, i + CHUNK));
      }
    }
  }

  return { ok: true, credited, pending: pendingCount };
}
