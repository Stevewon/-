// ============================================================================
// Generic EVM explorer client for EXTERNAL (non-Quantarium) deposits — Phase B.
// ----------------------------------------------------------------------------
// The external deposit watcher needs to list inbound ERC-20 transfers (USDT to
// start) and inbound native transfers (ETH/BNB) for each per-user deposit
// address on a public EVM chain (Ethereum mainnet, BSC, …).
//
// We support two explorer flavours behind ONE normalised interface so the
// watcher is explorer-agnostic:
//
//   1. Etherscan-family (Etherscan V2 multichain, BscScan, …) — the classic
//      `?module=account&action=tokentx` / `txlist` API. Requires an API key.
//      Etherscan V2 uses a single key across chains via `&chainid=<id>`.
//
//   2. Blockscout v2 — the same REST shape we already use for Quantarium
//      (`/api/v2/addresses/<addr>/token-transfers`). No key needed.
//
// The flavour is chosen per-network by config (see ExtExplorerConfig.flavour).
//
// All code is pure fetch/JSON — safe for Cloudflare Workers, no Node built-ins.
// This module ONLY reads.
// ============================================================================

export type ExtExplorerFlavour = 'etherscan' | 'blockscout';

export interface ExtExplorerConfig {
  flavour: ExtExplorerFlavour;
  /** Base API URL.
   *  etherscan: e.g. https://api.etherscan.io/v2/api  (V2 multichain)
   *  blockscout: e.g. https://eth.blockscout.com  (no trailing slash) */
  baseUrl: string;
  /** Etherscan API key (required for etherscan flavour). */
  apiKey?: string;
  /** Etherscan V2 chain id (1 = Ethereum, 56 = BSC). Etherscan flavour only. */
  chainId?: number;
}

/** Normalised inbound transfer shared by native + token listers. */
export interface ExtInboundTransfer {
  hash: string;
  blockNumber: number | null;
  from: string;
  to: string;
  /** Raw on-chain amount in base units (wei-scale) as a decimal string. */
  valueWei: string;
  /** Credited coin symbol, e.g. 'USDT' | 'ETH' | 'BNB'. */
  symbol: string;
  /** null for native; the ERC-20 contract address (lowercase) for tokens. */
  tokenContract: string | null;
  decimals: number;
  /** log index within the tx (ERC-20 only; 0 for native). Disambiguates
   *  multiple Transfer logs in one tx. */
  logIndex: number;
  ok: boolean;
  timestamp: string | null;
}

function normHash(h: string): string {
  return (h || '').toLowerCase();
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ext-explorer GET ${res.status}`);
  return (await res.json()) as T;
}

// ----------------------------------------------------------------------------
// Etherscan-family shapes
// ----------------------------------------------------------------------------
interface EsResponse<T> {
  status: string;   // "1" ok, "0" empty/err
  message: string;
  result: T | string;
}
interface EsTokenTx {
  hash: string;
  blockNumber: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  tokenSymbol: string;
  tokenDecimal: string;
  timeStamp: string;
  logIndex?: string;
}
interface EsNativeTx {
  hash: string;
  blockNumber: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  isError: string; // "0" ok, "1" reverted
  txreceipt_status?: string;
}

function esUrl(cfg: ExtExplorerConfig, params: Record<string, string>): string {
  const qs = new URLSearchParams(params);
  if (cfg.chainId) qs.set('chainid', String(cfg.chainId));
  if (cfg.apiKey) qs.set('apikey', cfg.apiKey);
  return `${cfg.baseUrl.replace(/\/+$/, '')}?${qs.toString()}`;
}

async function esInboundTokenTransfers(
  cfg: ExtExplorerConfig,
  address: string,
  allowed: Map<string, { symbol: string; decimals: number }>,
): Promise<ExtInboundTransfer[]> {
  const addr = normHash(address);
  const url = esUrl(cfg, {
    module: 'account',
    action: 'tokentx',
    address,
    startblock: '0',
    endblock: '99999999',
    sort: 'desc',
    page: '1',
    offset: '100',
  });
  const data = await getJson<EsResponse<EsTokenTx[]>>(url);
  if (data.status !== '1' || !Array.isArray(data.result)) return [];
  const out: ExtInboundTransfer[] = [];
  for (const it of data.result) {
    if (normHash(it.to) !== addr) continue;
    const contract = normHash(it.contractAddress);
    const meta = allowed.get(contract);
    if (!meta) continue; // only credit whitelisted tokens (e.g. USDT)
    let valueWei = '0';
    try { valueWei = BigInt(it.value || '0').toString(); } catch { valueWei = '0'; }
    if (valueWei === '0') continue;
    out.push({
      hash: normHash(it.hash),
      blockNumber: Number(it.blockNumber) || null,
      from: normHash(it.from),
      to: addr,
      valueWei,
      symbol: meta.symbol,
      tokenContract: contract,
      decimals: meta.decimals,
      logIndex: Number(it.logIndex || '0') || 0,
      ok: true,
      timestamp: it.timeStamp || null,
    });
  }
  return out;
}

async function esInboundNativeTxs(
  cfg: ExtExplorerConfig,
  address: string,
  nativeSymbol: string,
): Promise<ExtInboundTransfer[]> {
  const addr = normHash(address);
  const url = esUrl(cfg, {
    module: 'account',
    action: 'txlist',
    address,
    startblock: '0',
    endblock: '99999999',
    sort: 'desc',
    page: '1',
    offset: '100',
  });
  const data = await getJson<EsResponse<EsNativeTx[]>>(url);
  if (data.status !== '1' || !Array.isArray(data.result)) return [];
  const out: ExtInboundTransfer[] = [];
  for (const it of data.result) {
    if (normHash(it.to) !== addr) continue;
    let valueWei = '0';
    try { valueWei = BigInt(it.value || '0').toString(); } catch { valueWei = '0'; }
    if (valueWei === '0') continue;
    const ok = it.isError !== '1' && (it.txreceipt_status === undefined || it.txreceipt_status === '1');
    out.push({
      hash: normHash(it.hash),
      blockNumber: Number(it.blockNumber) || null,
      from: normHash(it.from),
      to: addr,
      valueWei,
      symbol: nativeSymbol,
      tokenContract: null,
      decimals: 18,
      logIndex: 0,
      ok,
      timestamp: it.timeStamp || null,
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Blockscout v2 shapes (subset)
// ----------------------------------------------------------------------------
interface BsRef { hash: string }
interface BsTokenTransfer {
  transaction_hash?: string;
  tx_hash?: string;
  block_number?: number | null;
  log_index?: number | null;
  from: BsRef | null;
  to: BsRef | null;
  timestamp?: string | null;
  total?: { value?: string; decimals?: string | null } | null;
  token?: { address?: string; address_hash?: string; symbol?: string | null; decimals?: string | null } | null;
}
interface BsPage<T> { items: T[]; next_page_params: Record<string, unknown> | null }

async function bsInboundTokenTransfers(
  cfg: ExtExplorerConfig,
  address: string,
  allowed: Map<string, { symbol: string; decimals: number }>,
  maxPages = 2,
): Promise<ExtInboundTransfer[]> {
  const addr = normHash(address);
  const out: ExtInboundTransfer[] = [];
  let next: Record<string, unknown> | null = null;
  const base = cfg.baseUrl.replace(/\/+$/, '');
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ type: 'ERC-20', filter: 'to' });
    if (next) for (const [k, v] of Object.entries(next)) qs.set(k, String(v));
    const url = `${base}/api/v2/addresses/${address}/token-transfers?${qs.toString()}`;
    const data = await getJson<BsPage<BsTokenTransfer>>(url);
    for (const it of data.items || []) {
      if (normHash(it.to?.hash || '') !== addr) continue;
      const contract = normHash(it.token?.address || it.token?.address_hash || '');
      const meta = allowed.get(contract);
      if (!meta) continue;
      let valueWei = '0';
      try { valueWei = BigInt(it.total?.value || '0').toString(); } catch { valueWei = '0'; }
      if (valueWei === '0') continue;
      const hash = normHash(it.transaction_hash || it.tx_hash || '');
      if (!hash) continue;
      out.push({
        hash,
        blockNumber: typeof it.block_number === 'number' ? it.block_number : null,
        from: normHash(it.from?.hash || ''),
        to: addr,
        valueWei,
        symbol: meta.symbol,
        tokenContract: contract,
        decimals: meta.decimals,
        logIndex: typeof it.log_index === 'number' ? it.log_index : 0,
        ok: true,
        timestamp: it.timestamp || null,
      });
    }
    next = data.next_page_params;
    if (!next) break;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Public dispatch
// ----------------------------------------------------------------------------

/** Inbound ERC-20 (whitelisted tokens only) transfers to `address`. */
export async function listExtInboundTokenTransfers(
  cfg: ExtExplorerConfig,
  address: string,
  allowed: Map<string, { symbol: string; decimals: number }>,
): Promise<ExtInboundTransfer[]> {
  if (allowed.size === 0) return [];
  return cfg.flavour === 'etherscan'
    ? esInboundTokenTransfers(cfg, address, allowed)
    : bsInboundTokenTransfers(cfg, address, allowed);
}

/** Inbound native (ETH/BNB) transfers to `address`. */
export async function listExtInboundNativeTxs(
  cfg: ExtExplorerConfig,
  address: string,
  nativeSymbol: string,
): Promise<ExtInboundTransfer[]> {
  // Native crediting is optional (most exchanges only auto-credit the token).
  // Only Etherscan flavour implemented for now; Blockscout returns [].
  return cfg.flavour === 'etherscan'
    ? esInboundNativeTxs(cfg, address, nativeSymbol)
    : Promise.resolve([]);
}
