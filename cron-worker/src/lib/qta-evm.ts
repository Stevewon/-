// ⚠️ COPIED from src/server/lib/qta-evm.ts — cron-worker has its own
// build context and cannot import across project roots. Keep this file in
// sync with the Pages-app copy when the wire format / derivation changes.
/**
 * Minimal EVM RPC client for the Quantarium chain.
 * ============================================================================
 *
 * Post SPHINCS+ pivot (2026-08-13): This file previously contained an
 * ECDSA/secp256k1 EIP-1559 signer. Quantarium turned out to be a go-ethereum
 * fork with SPHINCS+ (SLH-DSA-SHA2-128s) transaction signatures via typed
 * envelope 0x7f, NOT standard ECDSA. All secp256k1 signing code has been
 * moved to lib/qta-sphincs.ts (with SPHINCS+ signing) and this file now
 * hosts only the RPC read helpers + broadcast that are chain-agnostic and
 * still usable under the PQ scheme.
 *
 * What lives here (chain-agnostic, safe under any signature scheme):
 *   - JSON-RPC transport (rpcCall)
 *   - Read methods: getNativeBalance, getNonce, getBlockNumber, suggestFees,
 *     ethCall, erc20BalanceOf
 *   - ERC-20 calldata helper: encodeErc20Transfer
 *   - Broadcast: sendRawTransaction (accepts pre-signed rawTx of ANY type)
 *
 * What used to live here but is now gone:
 *   - signEip1559Tx (was ECDSA secp256k1)  → replaced by signSphincsTx in
 *     lib/qta-sphincs.ts (SLH-DSA-SHA2-128s, typed tx 0x7f)
 *   - sendNative / sendErc20 wrappers      → integrated into
 *     SphincsQtaChainClient in lib/qta-chain.ts
 *   - verifyHotWalletKeypair (ECDSA)       → replaced by
 *     verifyMnemonicMatchesHotWallet in lib/qta-sphincs.ts
 *
 * All code here is pure JS, safe for Cloudflare Workers, no Node built-ins.
 */

// -----------------------------------------------------------------------------
// RPC transport
// -----------------------------------------------------------------------------
export interface EvmRpcConfig {
  rpcUrl: string;
  chainId: number;
}

interface JsonRpcOk<T> { jsonrpc: '2.0'; id: number; result: T; }
interface JsonRpcErr { jsonrpc: '2.0'; id: number; error: { code: number; message: string }; }

let rpcId = 1;

async function rpcCall<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json = (await res.json()) as JsonRpcOk<T> | JsonRpcErr;
  if ('error' in json) {
    throw new Error(`RPC ${method} error: ${json.error.message}`);
  }
  return json.result;
}

// -----------------------------------------------------------------------------
// Public read methods
// -----------------------------------------------------------------------------

/** Native QTA balance in wei (bigint). */
export async function getNativeBalance(cfg: EvmRpcConfig, address: string): Promise<bigint> {
  const hex = await rpcCall<string>(cfg.rpcUrl, 'eth_getBalance', [address, 'latest']);
  return BigInt(hex);
}

/** Latest nonce (pending — so multiple sends in flight increment correctly). */
export async function getNonce(cfg: EvmRpcConfig, address: string): Promise<number> {
  const hex = await rpcCall<string>(cfg.rpcUrl, 'eth_getTransactionCount', [address, 'pending']);
  return Number(BigInt(hex));
}

/** Current head block height. */
export async function getBlockNumber(cfg: EvmRpcConfig): Promise<number> {
  const hex = await rpcCall<string>(cfg.rpcUrl, 'eth_blockNumber', []);
  return Number(BigInt(hex));
}

/** EIP-1559 fee suggestion. Falls back to eth_gasPrice / 2 for maxPriorityFeePerGas
 *  if the node doesn't expose eth_maxPriorityFeePerGas. */
export async function suggestFees(cfg: EvmRpcConfig): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const gasPriceHex = await rpcCall<string>(cfg.rpcUrl, 'eth_gasPrice', []);
  const gasPrice = BigInt(gasPriceHex);
  let priorityFee: bigint;
  try {
    const p = await rpcCall<string>(cfg.rpcUrl, 'eth_maxPriorityFeePerGas', []);
    priorityFee = BigInt(p);
  } catch {
    priorityFee = gasPrice / 2n;
  }
  // Simple headroom: maxFee = gasPrice * 2 + priority.
  const maxFee = gasPrice * 2n + priorityFee;
  return { maxFeePerGas: maxFee, maxPriorityFeePerGas: priorityFee };
}

/** eth_call — used for ERC-20 balanceOf/decimals reads. */
export async function ethCall(cfg: EvmRpcConfig, to: string, data: string): Promise<string> {
  return rpcCall<string>(cfg.rpcUrl, 'eth_call', [{ to, data }, 'latest']);
}

// -----------------------------------------------------------------------------
// ERC-20 helpers
// -----------------------------------------------------------------------------

/** ERC-20 balanceOf(address) → wei-scale bigint. */
export async function erc20BalanceOf(
  cfg: EvmRpcConfig,
  token: string,
  holder: string,
): Promise<bigint> {
  // Function selector: keccak256("balanceOf(address)")[:4] = 0x70a08231
  const data = '0x70a08231' + padAddress(holder);
  const raw = await ethCall(cfg, token, data);
  return raw && raw !== '0x' ? BigInt(raw) : 0n;
}

/** Encode ERC-20 transfer(address,uint256) calldata. */
export function encodeErc20Transfer(to: string, amountWei: bigint): string {
  // Selector: keccak256("transfer(address,uint256)")[:4] = 0xa9059cbb
  return '0xa9059cbb' + padAddress(to) + padUint(amountWei);
}

function padAddress(addr: string): string {
  const clean = addr.toLowerCase().replace(/^0x/, '');
  if (clean.length !== 40) throw new Error('bad address');
  return clean.padStart(64, '0');
}

function padUint(n: bigint): string {
  if (n < 0n) throw new Error('negative uint');
  return n.toString(16).padStart(64, '0');
}

// -----------------------------------------------------------------------------
// Broadcast (chain-agnostic — accepts any pre-signed rawTx)
// -----------------------------------------------------------------------------

/** Broadcast a pre-signed rawTx via eth_sendRawTransaction. Returns the tx hash
 *  returned by the node (canonical hash). Works for standard EIP-1559 (0x02) txs
 *  and for the Quantarium SPHINCS+ typed tx (0x7f) alike — the node parses the
 *  envelope type byte and dispatches to the appropriate verifier. */
export async function sendRawTransaction(cfg: EvmRpcConfig, rawTx: string): Promise<string> {
  return rpcCall<string>(cfg.rpcUrl, 'eth_sendRawTransaction', [rawTx]);
}
