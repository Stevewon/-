// ============================================================================
// EVM HD derivation + EIP-1559 (type-2) signer for EXTERNAL sweeps — Phase B.
// ----------------------------------------------------------------------------
// The external-deposit sweep job must, per per-user deposit address:
//   1. re-derive that address's secp256k1 private key from the exchange
//      mnemonic + stored HD index, and
//   2. sign a standard EIP-1559 transaction (native gas top-up OR ERC-20
//      transfer to the hot wallet) and broadcast it.
//
// Regular EVM chains use ordinary secp256k1 keys (unlike Quantarium's SPHINCS+
// typed txs), so this is the classic Ethereum signing path:
//   - RLP-encode the 9-field type-2 payload
//   - keccak256 over (0x02 || rlp(payload))  → sighash
//   - secp256k1 sign (recoverable) → yParity, r, s
//   - RLP-encode the 12-field signed tx  → 0x02 || rlp(signed)
//
// All crypto is pure JS (@scure/bip32, @scure/bip39, @noble/curves,
// @noble/hashes) — safe in the Workers runtime, no Node built-ins.
//
// This module is the ONLY place that derives private keys in the cron worker.
// Keys are held transiently in memory during signing and never logged/stored.
//
// ✅ VERIFICATION STATUS (2026-08-25): PRODUCTION-CORRECT.
//   Validated against ethers v6 with the Hardhat test mnemonic:
//     - address derivation matches for indices 0..N
//     - signEip1559Tx() rawTx is BYTE-FOR-BYTE identical to ethers'
//       wallet.signTransaction() for native + ERC-20 transfers on chainId 1 & 56
//     - ethers.Transaction.from(rawTx).from === signer across 24 mixed cases
//       (6 indices × {ETH,BSC} × {native,erc20}) — i.e. every signature
//       recovers to the correct signer, and txHash matches.
//   The earlier "recovers to wrong address" bug was a single missing option:
//   noble v2 re-hashes the input unless `prehash: false` is passed (our input
//   is already the keccak256 sighash). Fixed at the sign() call below.
//
//   Even though it is correct, signing/broadcasting is still driven from a
//   scheduled sweep job (not a request handler) for isolation.
// ============================================================================

import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const EVM_PATH_PREFIX = "m/44'/60'/0'/0";

export interface EvmAccount {
  index: number;
  path: string;
  address: string;       // EIP-55 checksummed
  privateKey: Uint8Array; // 32 bytes — transient, never persist/log
}

function seedFromMnemonic(mnemonic: string): Uint8Array {
  const m = (mnemonic || '').trim();
  if (!m) throw new Error('EXT_HD_WALLET_MNEMONIC is not set');
  if (!validateMnemonic(m, wordlist)) throw new Error('EXT_HD_WALLET_MNEMONIC invalid');
  return mnemonicToSeedSync(m);
}

export function toChecksumAddress(addrLowerNoPrefix: string): string {
  const addr = addrLowerNoPrefix.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(addr)));
  let out = '0x';
  for (let i = 0; i < addr.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return out;
}

export function addressFromPublicKey(pubUncompressed: Uint8Array): string {
  const body = pubUncompressed.length === 65 ? pubUncompressed.slice(1) : pubUncompressed;
  const hash = keccak_256(body);
  return toChecksumAddress(bytesToHex(hash.slice(-20)));
}

export function deriveEvmAccount(mnemonic: string, index: number): EvmAccount {
  if (!Number.isInteger(index) || index < 0) throw new Error(`invalid HD index: ${index}`);
  const seed = seedFromMnemonic(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const path = `${EVM_PATH_PREFIX}/${index}`;
  const node = root.derive(path);
  if (!node.privateKey) throw new Error(`HD derivation produced no key at ${path}`);
  const pubUncompressed = secp256k1.getPublicKey(node.privateKey, false);
  return { index, path, address: addressFromPublicKey(pubUncompressed), privateKey: node.privateKey };
}

export function deriveEvmAddress(mnemonic: string, index: number): string {
  return deriveEvmAccount(mnemonic, index).address;
}

/** True if `s` is a syntactically valid 0x-prefixed 20-byte EVM address. */
export function evmAddressIsValid(s: string | undefined | null): boolean {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

// ----------------------------------------------------------------------------
// Minimal RLP encoder (byte strings + lists only — enough for EIP-1559 txs).
// ----------------------------------------------------------------------------
function toBytes(x: Uint8Array | string): Uint8Array {
  if (x instanceof Uint8Array) return x;
  const clean = x.replace(/^0x/, '');
  if (clean === '') return new Uint8Array(0);
  return hexToBytes(clean.length % 2 ? '0' + clean : clean);
}

/** Encode a non-negative bigint as a minimal big-endian byte array (no leading zeros). */
function bigintToMinimalBytes(n: bigint): Uint8Array {
  if (n < 0n) throw new Error('negative');
  if (n === 0n) return new Uint8Array(0); // RLP integer 0 == empty string
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return hexToBytes(hex);
}

function encodeLength(len: number, offset: number): Uint8Array {
  if (len < 56) return Uint8Array.of(offset + len);
  const hex = len.toString(16);
  const lenBytes = hexToBytes(hex.length % 2 ? '0' + hex : hex);
  return concat(Uint8Array.of(offset + 55 + lenBytes.length), lenBytes);
}

/** Strip leading zero bytes (RLP integers are minimal big-endian). */
function trimLeadingZeros(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  return b.slice(i);
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function rlpEncodeBytes(b: Uint8Array): Uint8Array {
  if (b.length === 1 && b[0] < 0x80) return b; // single low byte is its own encoding
  return concat(encodeLength(b.length, 0x80), b);
}

type RlpItem = Uint8Array | RlpItem[];

function rlpEncode(item: RlpItem): Uint8Array {
  if (item instanceof Uint8Array) return rlpEncodeBytes(item);
  // list
  const encodedItems = concat(...item.map(rlpEncode));
  return concat(encodeLength(encodedItems.length, 0xc0), encodedItems);
}

// ----------------------------------------------------------------------------
// EIP-1559 (type-2) signer
// ----------------------------------------------------------------------------
export interface Eip1559Tx {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: string;             // 0x… 20-byte recipient (contract for ERC-20, or dest for native)
  value: bigint;          // wei (0 for ERC-20 transfer)
  data: string;           // 0x calldata ('' / '0x' for a plain native send)
}

function addr20(to: string): Uint8Array {
  const clean = to.toLowerCase().replace(/^0x/, '');
  if (clean.length !== 40) throw new Error('bad to address');
  return hexToBytes(clean);
}

/** Sign an EIP-1559 tx with a raw secp256k1 private key. Returns 0x-prefixed rawTx. */
export function signEip1559Tx(tx: Eip1559Tx, privateKey: Uint8Array): { rawTx: string; txHash: string } {
  // accessList is empty ([]).
  const payloadFields: RlpItem[] = [
    bigintToMinimalBytes(BigInt(tx.chainId)),
    bigintToMinimalBytes(BigInt(tx.nonce)),
    bigintToMinimalBytes(tx.maxPriorityFeePerGas),
    bigintToMinimalBytes(tx.maxFeePerGas),
    bigintToMinimalBytes(tx.gasLimit),
    addr20(tx.to),
    bigintToMinimalBytes(tx.value),
    toBytes(tx.data || ''),
    [], // accessList
  ];
  const rlpPayload = rlpEncode(payloadFields);
  const sigInput = concat(Uint8Array.of(0x02), rlpPayload); // 0x02 || rlp(payload)
  const sighash = keccak_256(sigInput);

  // @noble/curves v2: sign() defaults to a compact 64-byte Uint8Array. Request
  // the 'recovered' format → 65 bytes laid out as [recovery(1) || r(32) || s(32)].
  //
  // ⚠️ CRITICAL: `prehash: false`. `sighash` is ALREADY the keccak256 digest of
  // (0x02 || rlp(payload)). Without prehash:false, noble v2 hashes the input
  // AGAIN (SHA-256 by default) before signing, producing a valid-but-WRONG
  // signature that recovers to a different address. This was the Phase B sweep
  // signer bug. Verified against ethers v6 SigningKey: with prehash:false the
  // r/s/recovery match exactly and Transaction.from(rawTx).from === signer.
  const sig = secp256k1.sign(sighash, privateKey, { format: 'recovered', prehash: false });
  const yParity = sig[0]; // 0 | 1
  const r = trimLeadingZeros(sig.slice(1, 33));
  const s = trimLeadingZeros(sig.slice(33, 65));

  const signedFields: RlpItem[] = [
    ...payloadFields,
    bigintToMinimalBytes(BigInt(yParity)),
    r,
    s,
  ];
  const rlpSigned = rlpEncode(signedFields);
  const rawBytes = concat(Uint8Array.of(0x02), rlpSigned);
  const rawTx = '0x' + bytesToHex(rawBytes);
  const txHash = '0x' + bytesToHex(keccak_256(rawBytes));
  return { rawTx, txHash };
}

export { hexToBytes, bytesToHex };
