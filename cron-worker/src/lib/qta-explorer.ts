// ============================================================================
// Blockscout v2 explorer client for the Quantarium chain.
// ----------------------------------------------------------------------------
// The QTA chain runs a Blockscout v2 explorer at https://scan.quantarium.io.
// Because Quantarium transactions are SPHINCS+ typed txs (envelope 0x7f /
// type 127), we do NOT try to parse raw blocks ourselves — the explorer
// already normalises every tx into a stable JSON shape (hash / value /
// block_number / from / to / status), which is far cheaper and more robust
// than pulling `eth_getBlockByNumber` and decoding token transfer logs.
//
// This module only READS. It exposes two listing helpers used by the deposit
// scanner:
//   * listInboundNativeTxs(address)  — native QTA transfers TO `address`
//   * listInboundTokenTransfers(address) — ERC-20 (QX/QKEY) transfers TO addr
//
// Both return a normalised { hash, blockNumber, from, to, valueWei, symbol,
// tokenContract, status, timestamp } shape so the scanner is explorer-agnostic.
//
// All code is pure fetch/JSON — safe for Cloudflare Workers, no Node built-ins.
// ============================================================================

export interface ExplorerConfig {
  /** Base explorer URL, e.g. https://scan.quantarium.io (no trailing slash). */
  baseUrl: string;
}

/** Normalised inbound transfer as seen by the deposit scanner. */
export interface InboundTransfer {
  hash: string;
  blockNumber: number | null;
  from: string;
  to: string;
  /** Raw on-chain amount in the token's base unit (wei-scale) as a string. */
  valueWei: string;
  /** 'QTA' for native, or token symbol ('QX' | 'QKEY') for ERC-20. */
  symbol: string;
  /** null for native QTA; the ERC-20 contract address for tokens. */
  tokenContract: string | null;
  /** Explorer decimals hint (18 for all Quantarium assets today). */
  decimals: number;
  /** true when the tx executed successfully on-chain. */
  ok: boolean;
  /** ISO timestamp string, if provided by the explorer. */
  timestamp: string | null;
}

// -----------------------------------------------------------------------------
// Raw Blockscout v2 shapes (only the fields we consume)
// -----------------------------------------------------------------------------
interface BsAddressRef {
  hash: string;
  is_contract?: boolean;
}
interface BsNativeTx {
  hash: string;
  block_number: number | null;
  value: string; // wei string
  from: BsAddressRef | null;
  to: BsAddressRef | null;
  status: string | null; // "ok" | "error" | null (pending)
  result?: string | null; // "success" | ...
  timestamp: string | null;
}
interface BsTokenInfo {
  address?: string;
  address_hash?: string;
  symbol: string | null;
  decimals: string | null;
  type: string | null; // "ERC-20" | "ERC-721" | ...
}
interface BsTokenTransfer {
  transaction_hash?: string;
  tx_hash?: string;
  block_number?: number | null;
  block_hash?: string | null;
  from: BsAddressRef | null;
  to: BsAddressRef | null;
  timestamp?: string | null;
  total?: { value?: string; decimals?: string | null } | null;
  token: BsTokenInfo | null;
}
interface BsPage<T> {
  items: T[];
  next_page_params: Record<string, unknown> | null;
}

// -----------------------------------------------------------------------------
// Transport
// -----------------------------------------------------------------------------
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`explorer GET ${res.status} ${url}`);
  return (await res.json()) as T;
}

function normHash(h: string): string {
  return (h || '').toLowerCase();
}

// -----------------------------------------------------------------------------
// Public listers
// -----------------------------------------------------------------------------

/**
 * List inbound NATIVE QTA transfers to `address`, newest first.
 *
 * Uses `?filter=to` so the explorer only returns txs where `address` is the
 * recipient. We still defensively re-check `to == address` and value > 0.
 *
 * `maxPages` bounds the walk so a very busy address can't blow the cron's
 * time budget; the scanner also stops early once it has seen enough recent
 * history (it dedupes against qta_deposits by (tx_hash,address)).
 */
export async function listInboundNativeTxs(
  cfg: ExplorerConfig,
  address: string,
  maxPages = 2,
): Promise<InboundTransfer[]> {
  const addr = normHash(address);
  const out: InboundTransfer[] = [];
  let next: Record<string, unknown> | null = null;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ filter: 'to' });
    if (next) for (const [k, v] of Object.entries(next)) qs.set(k, String(v));
    const url = `${cfg.baseUrl}/api/v2/addresses/${address}/transactions?${qs.toString()}`;
    const data = await getJson<BsPage<BsNativeTx>>(url);
    for (const it of data.items || []) {
      const to = normHash(it.to?.hash || '');
      if (to !== addr) continue; // defensive
      // Skip contract-call / token-only txs with zero native value.
      let valueWei = '0';
      try {
        valueWei = BigInt(it.value || '0').toString();
      } catch {
        valueWei = '0';
      }
      if (valueWei === '0') continue;
      const ok = (it.status === 'ok') || (it.result === 'success');
      out.push({
        hash: normHash(it.hash),
        blockNumber: typeof it.block_number === 'number' ? it.block_number : null,
        from: normHash(it.from?.hash || ''),
        to,
        valueWei,
        symbol: 'QTA',
        tokenContract: null,
        decimals: 18,
        ok,
        timestamp: it.timestamp || null,
      });
    }
    next = data.next_page_params;
    if (!next) break;
  }
  return out;
}

/**
 * List inbound ERC-20 token transfers (QX / QKEY) to `address`, newest first.
 *
 * `allowedContracts` is a lowercase set of the token contract addresses we
 * credit; transfers of any other token are ignored (someone airdropping a
 * random token must not create a spurious deposit).
 */
export async function listInboundTokenTransfers(
  cfg: ExplorerConfig,
  address: string,
  allowedContracts: Map<string, { symbol: string; decimals: number }>,
  maxPages = 2,
): Promise<InboundTransfer[]> {
  const addr = normHash(address);
  const out: InboundTransfer[] = [];
  let next: Record<string, unknown> | null = null;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ type: 'ERC-20', filter: 'to' });
    if (next) for (const [k, v] of Object.entries(next)) qs.set(k, String(v));
    const url = `${cfg.baseUrl}/api/v2/addresses/${address}/token-transfers?${qs.toString()}`;
    const data = await getJson<BsPage<BsTokenTransfer>>(url);
    for (const it of data.items || []) {
      const to = normHash(it.to?.hash || '');
      if (to !== addr) continue;
      const contract = normHash(it.token?.address || it.token?.address_hash || '');
      const allowed = allowedContracts.get(contract);
      if (!allowed) continue; // not a token we credit
      let valueWei = '0';
      try {
        valueWei = BigInt(it.total?.value || '0').toString();
      } catch {
        valueWei = '0';
      }
      if (valueWei === '0') continue;
      const hash = normHash(it.transaction_hash || it.tx_hash || '');
      if (!hash) continue;
      // Token-transfer rows on Blockscout don't always carry status; a listed
      // transfer implies the tx succeeded (a reverted tx emits no Transfer log).
      out.push({
        hash,
        blockNumber: typeof it.block_number === 'number' ? it.block_number : null,
        from: normHash(it.from?.hash || ''),
        to,
        valueWei,
        symbol: allowed.symbol,
        tokenContract: contract,
        decimals: allowed.decimals,
        ok: true,
        timestamp: it.timestamp || null,
      });
    }
    next = data.next_page_params;
    if (!next) break;
  }
  return out;
}
