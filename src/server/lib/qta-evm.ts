/**
 * Minimal EVM RPC + tx-signing client for the Quantarium chain.
 *
 * WHY minimal instead of pulling in ethers/viem?
 *   - Cloudflare Pages Workers bundle limit is 1MB compressed.
 *   - We only need: getBalance / getTransactionCount / eth_call / eth_getLogs /
 *     eth_gasPrice / eth_maxPriorityFeePerGas / eth_sendRawTransaction and
 *     one signer path (EIP-1559 native + ERC-20 transfer).
 *   - Full ethers v6 adds ~250 kB gzipped which would push us near the limit.
 *
 * All crypto is pure-JS via @noble/curves + @noble/hashes (Worker-safe).
 * All RLP encoding is done inline (small, ~40 lines).
 *
 * Env vars consumed by makeEvmClient(env):
 *   QTA_RPC_URL              e.g. https://rpc.quantarium.io
 *   QTA_CHAIN_ID             e.g. 60000
 *   QTA_HOT_WALLET_ADDRESS   0x496EEaCE6Cf759C95e9eFea5d4C16A35D0524E97
 *   QTA_HOT_WALLET_PRIVATE_KEY  32-byte hex, held as Cloudflare Pages secret
 *   QTA_TOKEN_QX_ADDRESS     ERC-20 contract
 *   QTA_TOKEN_QKEY_ADDRESS   ERC-20 contract
 */

import { keccak_256 } from '@noble/hashes/sha3.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { toHex, fromHex, parseHexPrivateKey, addressFromPrivateKey, toChecksumAddress } from './qta-hd';

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

/** Latest nonce (transaction count) for an address. */
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
// RLP encoding (minimal — enough for EIP-1559 tx envelopes).
// -----------------------------------------------------------------------------
type RlpInput = Uint8Array | RlpInput[];

function rlpEncode(input: RlpInput): Uint8Array {
  if (input instanceof Uint8Array) {
    if (input.length === 1 && input[0] < 0x80) return input;
    return concat(encodeLength(input.length, 0x80), input);
  }
  const items = input.map(rlpEncode);
  const payload = concat(...items);
  return concat(encodeLength(payload.length, 0xc0), payload);
}

function encodeLength(len: number, offset: number): Uint8Array {
  if (len < 56) return Uint8Array.of(offset + len);
  const hex = len.toString(16);
  const padded = hex.length % 2 ? '0' + hex : hex;
  const lenBytes = fromHex(padded);
  return concat(Uint8Array.of(offset + 55 + lenBytes.length), lenBytes);
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

/** Encode a non-negative bigint as a big-endian byte array with no leading zeros
 *  (0n → empty, per Ethereum RLP convention). */
function bigintToBytes(n: bigint): Uint8Array {
  if (n < 0n) throw new Error('negative not supported');
  if (n === 0n) return new Uint8Array(0);
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return fromHex(hex);
}

function numToBytes(n: number | bigint): Uint8Array {
  return bigintToBytes(typeof n === 'number' ? BigInt(n) : n);
}

function addrToBytes(a: string): Uint8Array {
  return fromHex(a.toLowerCase().replace(/^0x/, ''));
}

// -----------------------------------------------------------------------------
// EIP-1559 (type 0x02) transaction signing
// -----------------------------------------------------------------------------
export interface Eip1559Tx {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: string;           // 0x-prefixed 20 bytes
  value: bigint;        // wei
  data: string;         // 0x-prefixed hex, may be '0x' (empty)
  accessList?: [];      // always empty for our txs
}

/** Sign and return { rawTx: '0x02...', txHash: '0x...' }. */
export function signEip1559Tx(tx: Eip1559Tx, privkey: Uint8Array): { rawTx: string; txHash: string } {
  const dataBytes = tx.data && tx.data !== '0x' ? fromHex(tx.data) : new Uint8Array(0);
  const fields: RlpInput = [
    numToBytes(tx.chainId),
    numToBytes(tx.nonce),
    bigintToBytes(tx.maxPriorityFeePerGas),
    bigintToBytes(tx.maxFeePerGas),
    bigintToBytes(tx.gasLimit),
    addrToBytes(tx.to),
    bigintToBytes(tx.value),
    dataBytes,
    [], // accessList
  ];
  const unsignedPayload = rlpEncode(fields);
  const unsigned = concat(Uint8Array.of(0x02), unsignedPayload);
  const sigHash = keccak_256(unsigned);

  // Deterministic (RFC 6979) ECDSA — @noble/curves default.
  const sig = secp256k1.sign(sigHash, privkey);
  // In @noble/curves v2, sig has .r, .s (bigints) and .recovery (0|1).
  const r = bigintToBytes(sig.r);
  const s = bigintToBytes(sig.s);
  const v = numToBytes(sig.recovery ?? 0);

  const signedPayload = rlpEncode([...fields, v, r, s] as RlpInput);
  const signed = concat(Uint8Array.of(0x02), signedPayload);
  const rawTx = '0x' + toHex(signed);
  const txHash = '0x' + toHex(keccak_256(signed));
  return { rawTx, txHash };
}

/** Broadcast a pre-signed rawTx via eth_sendRawTransaction. */
export async function sendRawTransaction(cfg: EvmRpcConfig, rawTx: string): Promise<string> {
  return rpcCall<string>(cfg.rpcUrl, 'eth_sendRawTransaction', [rawTx]);
}

// -----------------------------------------------------------------------------
// High-level helpers wrapping "build fees + nonce, sign, broadcast".
// -----------------------------------------------------------------------------

/** Send native QTA. Returns tx hash. */
export async function sendNative(params: {
  cfg: EvmRpcConfig;
  fromAddress: string;
  fromPrivkey: Uint8Array;
  to: string;
  amountWei: bigint;
  gasLimit?: bigint;
}): Promise<{ txHash: string; rawTx: string }> {
  const { cfg, fromAddress, fromPrivkey, to, amountWei } = params;
  const [nonce, fees] = await Promise.all([
    getNonce(cfg, fromAddress),
    suggestFees(cfg),
  ]);
  const { rawTx, txHash } = signEip1559Tx(
    {
      chainId: cfg.chainId,
      nonce,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      maxFeePerGas: fees.maxFeePerGas,
      gasLimit: params.gasLimit ?? 21000n,
      to,
      value: amountWei,
      data: '0x',
    },
    fromPrivkey,
  );
  const broadcastHash = await sendRawTransaction(cfg, rawTx);
  return { txHash: broadcastHash || txHash, rawTx };
}

/** Send an ERC-20 transfer. Returns tx hash. */
export async function sendErc20(params: {
  cfg: EvmRpcConfig;
  token: string;
  fromAddress: string;
  fromPrivkey: Uint8Array;
  to: string;
  amountWei: bigint;
  gasLimit?: bigint;
}): Promise<{ txHash: string; rawTx: string }> {
  const { cfg, token, fromAddress, fromPrivkey, to, amountWei } = params;
  const [nonce, fees] = await Promise.all([
    getNonce(cfg, fromAddress),
    suggestFees(cfg),
  ]);
  const data = encodeErc20Transfer(to, amountWei);
  const { rawTx, txHash } = signEip1559Tx(
    {
      chainId: cfg.chainId,
      nonce,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      maxFeePerGas: fees.maxFeePerGas,
      gasLimit: params.gasLimit ?? 90000n,
      to: token,
      value: 0n,
      data,
    },
    fromPrivkey,
  );
  const broadcastHash = await sendRawTransaction(cfg, rawTx);
  return { txHash: broadcastHash || txHash, rawTx };
}

// -----------------------------------------------------------------------------
// Health check — verify env.QTA_HOT_WALLET_PRIVATE_KEY matches env.QTA_HOT_WALLET_ADDRESS.
// -----------------------------------------------------------------------------
export function verifyHotWalletKeypair(privkeyHex: string, expectedAddress: string): { ok: true } | { ok: false; derived: string; expected: string } {
  const pk = parseHexPrivateKey(privkeyHex);
  const derived = addressFromPrivateKey(pk);
  const expected = toChecksumAddress(expectedAddress);
  if (derived.toLowerCase() === expected.toLowerCase()) return { ok: true };
  return { ok: false, derived, expected };
}
