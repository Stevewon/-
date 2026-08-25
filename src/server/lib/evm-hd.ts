/**
 * EVM HD wallet — standard Ethereum (secp256k1 + keccak256, BIP-32/44).
 * ============================================================================
 *
 * Phase B external-deposit infrastructure. Unlike the Quantarium chain
 * (SPHINCS+ post-quantum, see lib/qta-sphincs.ts), regular EVM chains
 * (Ethereum ERC20, BNB Chain BEP20, …) use ordinary secp256k1 keys and can
 * therefore use real BIP-32 hierarchical derivation.
 *
 * Wallet model (mirrors the QTA HD model)
 * ---------------------------------------
 *   - QuantaEX holds ONE 12/24-word BIP-39 mnemonic in the Cloudflare secret
 *     `EXT_HD_WALLET_MNEMONIC` (NEVER committed, NEVER logged).
 *   - Derivation path: m/44'/60'/0'/0/<index>  (standard Ethereum account path).
 *   - Index 0  = exchange hot wallet (sweep destination + gas funder).
 *   - Index 1..N = per-user deposit addresses, allocated monotonically in the
 *     ext_hd_indexes table (migration 0046).
 *   - Private keys are NEVER stored; they are re-derived on demand from the
 *     mnemonic + index.
 *
 * Address computation
 * -------------------
 *   privKey  = BIP32(seed).derive("m/44'/60'/0'/0/<index>").privateKey
 *   pubKey   = secp256k1 uncompressed public key (65 bytes, drop 0x04 prefix)
 *   address  = "0x" + keccak256(pubKey[1:])[-20:]  (EIP-55 checksummed)
 *
 * All crypto is pure JS via @scure/bip32 + @scure/bip39 + @noble/curves +
 * @noble/hashes and runs in the Workers runtime with no Node built-ins.
 *
 * NOTE: This module derives addresses and (later) signs sweep/withdrawal txs.
 * Signing is cheap for secp256k1 (unlike SPHINCS+) so it MAY run in a handler,
 * but we still prefer to sweep from a scheduled/queue job for isolation.
 */

import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// Standard Ethereum BIP-44 path prefix. Index is appended per user.
const EVM_PATH_PREFIX = "m/44'/60'/0'/0";

export interface EvmAccount {
  index: number;
  path: string;
  address: string;      // EIP-55 checksummed 0x…40hex
  privateKeyHex: string; // 0x-prefixed 32-byte hex — HANDLE WITH CARE, never log/persist
  publicKeyHex: string;  // 0x-prefixed uncompressed (65 bytes)
}

/** Derive the raw BIP-32 seed from the exchange mnemonic. */
function seedFromMnemonic(mnemonic: string): Uint8Array {
  const m = (mnemonic || '').trim();
  if (!m) throw new Error('EXT_HD_WALLET_MNEMONIC is not set');
  if (!validateMnemonic(m, wordlist)) {
    throw new Error('EXT_HD_WALLET_MNEMONIC is not a valid BIP-39 mnemonic');
  }
  return mnemonicToSeedSync(m);
}

/**
 * EIP-55 checksum encoding of a 20-byte address (input: lowercase hex, no 0x).
 */
export function toChecksumAddress(addrLowerNoPrefix: string): string {
  const addr = addrLowerNoPrefix.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(addr)));
  let out = '0x';
  for (let i = 0; i < addr.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return out;
}

/** Compute the EIP-55 address from an uncompressed secp256k1 public key. */
export function addressFromPublicKey(pubUncompressed: Uint8Array): string {
  // Drop the 0x04 prefix byte, keccak256 the remaining 64 bytes, take last 20.
  const body = pubUncompressed.length === 65 ? pubUncompressed.slice(1) : pubUncompressed;
  const hash = keccak_256(body);
  const addr = hash.slice(-20);
  return toChecksumAddress(bytesToHex(addr));
}

/**
 * Derive the EVM account at a given HD index from the exchange mnemonic.
 * Index 0 is the hot wallet; 1..N are user deposit addresses.
 */
export function deriveEvmAccount(mnemonic: string, index: number): EvmAccount {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`invalid HD index: ${index}`);
  }
  const seed = seedFromMnemonic(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const path = `${EVM_PATH_PREFIX}/${index}`;
  const node = root.derive(path);
  if (!node.privateKey || !node.publicKey) {
    throw new Error(`HD derivation produced no key at ${path}`);
  }
  // @scure/bip32 publicKey is COMPRESSED (33 bytes). Re-expand to uncompressed
  // via the curve so we can hash it into an address.
  const pubUncompressed = secp256k1.getPublicKey(node.privateKey, false); // false => uncompressed 65 bytes
  const address = addressFromPublicKey(pubUncompressed);
  return {
    index,
    path,
    address,
    privateKeyHex: '0x' + bytesToHex(node.privateKey),
    publicKeyHex: '0x' + bytesToHex(pubUncompressed),
  };
}

/** Convenience: just the checksummed address at an index (no private key kept). */
export function deriveEvmAddress(mnemonic: string, index: number): string {
  return deriveEvmAccount(mnemonic, index).address;
}

/**
 * The exchange hot wallet (HD index 0) — sweep destination + gas funder.
 */
export function evmHotWallet(mnemonic: string): EvmAccount {
  return deriveEvmAccount(mnemonic, 0);
}

// Re-export a couple of low-level helpers for the (later) signer.
export { hexToBytes, bytesToHex };
