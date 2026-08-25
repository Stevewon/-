/**
 * External-deposit address allocation service — Phase B.
 * ============================================================================
 *
 * Allocates a REAL per-user deposit address for external chains (starting with
 * EVM/ERC20) and records it in the ext_hd_indexes + ext_addresses tables
 * (migration 0046). Mirrors the QTA HD-index allocation model.
 *
 * Safety invariants:
 *   - address_index is monotonic & immutable per (user_id, chain). Re-calling
 *     for the same user returns the SAME address (idempotent).
 *   - Index 0 is reserved for the exchange hot wallet — user indices start at 1.
 *   - Private keys are never derived or returned here (address only).
 *
 * The feature is gated by the presence of EXT_HD_WALLET_MNEMONIC. When the
 * secret is absent we throw a typed error so the route can return a clean
 * "integration pending" 503 instead of leaking a stack trace.
 */

import { deriveEvmAddress } from './evm-hd';

export type ExtChain = 'evm'; // extend later: 'tron' | 'btc'

export interface ExtEnv {
  DB: D1Database;
  EXT_HD_WALLET_MNEMONIC?: string;
  EXT_DEPOSITS_ENABLED?: string; // 'true' to turn the feature on
}

export class ExtDepositPendingError extends Error {
  constructor(msg = 'EXTERNAL_DEPOSIT_PENDING') { super(msg); this.name = 'ExtDepositPendingError'; }
}

/** Map a user-facing network id → (chain family, canonical network key). */
export function resolveNetwork(networkId: string): { chain: ExtChain; network: string; coinDefault: string } | null {
  const n = (networkId || '').toUpperCase();
  switch (n) {
    case 'ERC20': return { chain: 'evm', network: 'erc20', coinDefault: 'USDT' };
    case 'BEP20': return { chain: 'evm', network: 'bep20', coinDefault: 'USDT' };
    // TRC20 / BTC handled by future adapters — intentionally unsupported here.
    default: return null;
  }
}

/** Whether external deposits are switched on AND the HD secret is present. */
export function extEnabled(env: ExtEnv): boolean {
  return String(env.EXT_DEPOSITS_ENABLED || '').toLowerCase() === 'true'
    && !!(env.EXT_HD_WALLET_MNEMONIC && env.EXT_HD_WALLET_MNEMONIC.trim());
}

/**
 * Allocate (or fetch) the monotonic HD index for a user on a chain.
 * Uses a compare-and-set loop on ext_hd_indexes to stay safe under concurrency
 * without server-side sequences (D1 has no SEQUENCE). Index 0 is the hot
 * wallet, so user indices begin at 1.
 */
async function allocateIndex(env: ExtEnv, userId: string, chain: ExtChain): Promise<number> {
  // Fast path: already allocated.
  const existing = await env.DB.prepare(
    `SELECT address_index FROM ext_hd_indexes WHERE user_id = ? AND chain = ?`
  ).bind(userId, chain).first<{ address_index: number }>();
  if (existing) return existing.address_index;

  // Allocate: next index = max(existing) + 1, floor 1 (0 = hot wallet).
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await env.DB.prepare(
      `SELECT COALESCE(MAX(address_index), 0) AS mx FROM ext_hd_indexes WHERE chain = ?`
    ).bind(chain).first<{ mx: number }>();
    const next = Math.max(1, (row?.mx || 0) + 1);
    try {
      await env.DB.prepare(
        `INSERT INTO ext_hd_indexes (user_id, chain, address_index) VALUES (?, ?, ?)`
      ).bind(userId, chain, next).run();
      return next;
    } catch (e: any) {
      // UNIQUE(chain, address_index) or PK(user_id,chain) collision under a
      // race — re-read and retry (or return the winner's index).
      const again = await env.DB.prepare(
        `SELECT address_index FROM ext_hd_indexes WHERE user_id = ? AND chain = ?`
      ).bind(userId, chain).first<{ address_index: number }>();
      if (again) return again.address_index;
      // else: someone else grabbed `next` — loop and pick a higher one.
    }
  }
  throw new Error('failed to allocate ext HD index after retries');
}

/**
 * Issue (idempotently) the user's external deposit address for a given
 * user-facing network id (e.g. 'ERC20'). Returns the stored/derived address.
 */
export async function getOrCreateExtAddress(
  env: ExtEnv,
  userId: string,
  networkId: string,
): Promise<{ address: string; chain: ExtChain; network: string; index: number; derivation: string }> {
  if (!extEnabled(env)) throw new ExtDepositPendingError();

  const resolved = resolveNetwork(networkId);
  if (!resolved) throw new ExtDepositPendingError('UNSUPPORTED_NETWORK');
  const { chain, network } = resolved;

  // Existing address for this (user, chain, network)?
  const existing = await env.DB.prepare(
    `SELECT address, address_index, derivation FROM ext_addresses
      WHERE user_id = ? AND chain = ? AND network = ? AND is_active = 1
      LIMIT 1`
  ).bind(userId, chain, network).first<{ address: string; address_index: number; derivation: string }>();
  if (existing) {
    return { address: existing.address, chain, network, index: existing.address_index, derivation: existing.derivation };
  }

  const index = await allocateIndex(env, userId, chain);

  // Derive the real address (EVM for now). Same address across all EVM
  // networks (erc20/bep20) since it's the same secp256k1 key.
  const mnemonic = env.EXT_HD_WALLET_MNEMONIC as string;
  const address = deriveEvmAddress(mnemonic, index);
  const derivation = `m/44'/60'/0'/0/${index}`;

  // Cache the derived address on the index row (best-effort).
  try {
    await env.DB.prepare(
      `UPDATE ext_hd_indexes SET address = COALESCE(address, ?) WHERE user_id = ? AND chain = ?`
    ).bind(address, userId, chain).run();
  } catch { /* non-fatal */ }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO ext_addresses (id, user_id, chain, network, address, derivation, address_index)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, userId, chain, network, address, derivation, index).run();
  } catch (e: any) {
    // UNIQUE(chain, network, address) collision → re-read the winning row.
    const again = await env.DB.prepare(
      `SELECT address, address_index, derivation FROM ext_addresses
        WHERE user_id = ? AND chain = ? AND network = ? AND is_active = 1 LIMIT 1`
    ).bind(userId, chain, network).first<{ address: string; address_index: number; derivation: string }>();
    if (again) return { address: again.address, chain, network, index: again.address_index, derivation: again.derivation };
    throw e;
  }

  return { address, chain, network, index, derivation };
}
