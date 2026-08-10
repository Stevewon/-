/**
 * QuantaEX HD Wallet for the Quantarium chain (EVM, chain_id 60000).
 *
 * Design (per boss's 2026-08-10 decision — "옵션 2: 봇 안 씀, 서버 단독 HD Wallet"):
 *   - Master seed lives in a Cloudflare Pages secret as a BIP-39 mnemonic:
 *       QTA_HD_WALLET_MNEMONIC   (12 or 24 words, English wordlist)
 *   - Deposit addresses are derived per user with BIP-32 at:
 *       m / 44' / 60' / 0' / 0 / <account_index>
 *     where account_index is a stable, non-recycled uint32 issued from the
 *     `qta_hd_indexes` table (see migration 0036 in the follow-up commit).
 *     Standard Ethereum path (coin_type 60') is used because Quantarium is
 *     an EVM-compatible Geth fork.
 *   - The hot wallet (0x496EEaCE...4E97) is NOT derived from the HD tree —
 *     its private key is held as a separate secret QTA_HOT_WALLET_PRIVATE_KEY
 *     so it can be rotated independently of user addresses.
 *
 * Everything in this file is pure JS (no Node built-ins beyond what
 * Cloudflare Workers already ship). Uses @scure/bip32 + @scure/bip39
 * + @noble/hashes/keccak_256 which are all Worker-compatible.
 */

import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
// @scure/bip39 v2 requires explicit `.js` in the wordlist import path.
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

/** BIP-44 base path for Ethereum-family chains (Quantarium uses coin_type 60). */
const HD_BASE_PATH = "m/44'/60'/0'/0";

export interface DerivedAddress {
  /** 0x + 40 hex, EIP-55 mixed-case checksum. */
  address: string;
  /** BIP-44 index used (matches qta_hd_indexes.address_index). */
  index: number;
  /** Full derivation path, e.g. m/44'/60'/0'/0/17. */
  path: string;
  /** Uncompressed secp256k1 public key (hex, no 0x, 128 chars). */
  pubkey: string;
}

// -----------------------------------------------------------------------------
// Public: derive a deposit address from an HD index. Called from
// generateAddress() in EvmQtaChainClient after allocating a fresh index.
// -----------------------------------------------------------------------------
export function deriveAddressFromMnemonic(
  mnemonic: string,
  index: number,
): DerivedAddress {
  if (!isValidMnemonic(mnemonic)) {
    throw new Error('QTA_HD_WALLET_MNEMONIC is missing or malformed');
  }
  if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) {
    throw new Error(`Invalid HD index: ${index}`);
  }

  const seed = mnemonicToSeedSync(mnemonic.trim());
  const master = HDKey.fromMasterSeed(seed);
  const path = `${HD_BASE_PATH}/${index}`;
  const node = master.derive(path);
  if (!node.privateKey) {
    throw new Error(`HD derivation returned no private key at ${path}`);
  }
  // secp256k1 pubkey: uncompressed = 0x04 + X(32) + Y(32) = 65 bytes.
  const pub = secp256k1.getPublicKey(node.privateKey, /* compressed */ false);
  const address = pubkeyToAddress(pub);

  return {
    address,
    index,
    path,
    pubkey: toHex(pub.slice(1)), // drop 0x04 prefix
  };
}

// -----------------------------------------------------------------------------
// Public: raw private key access (for the sweep-from-user-address path).
// Callers MUST NOT log or persist the returned buffer.
// -----------------------------------------------------------------------------
export function derivePrivateKeyFromMnemonic(
  mnemonic: string,
  index: number,
): Uint8Array {
  if (!isValidMnemonic(mnemonic)) {
    throw new Error('QTA_HD_WALLET_MNEMONIC is missing or malformed');
  }
  const seed = mnemonicToSeedSync(mnemonic.trim());
  const master = HDKey.fromMasterSeed(seed);
  const node = master.derive(`${HD_BASE_PATH}/${index}`);
  if (!node.privateKey) {
    throw new Error('HD derivation returned no private key');
  }
  return node.privateKey;
}

// -----------------------------------------------------------------------------
// Public: mnemonic validation. Wraps @scure/bip39 with an explicit English
// wordlist so behaviour is deterministic regardless of upstream defaults.
// -----------------------------------------------------------------------------
export function isValidMnemonic(mnemonic: string | undefined | null): boolean {
  if (!mnemonic || typeof mnemonic !== 'string') return false;
  const cleaned = mnemonic.trim();
  if (!cleaned) return false;
  const words = cleaned.split(/\s+/);
  if (words.length !== 12 && words.length !== 24) return false;
  try {
    return validateMnemonic(cleaned, englishWordlist);
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Public: parse and validate a raw hex private key. Accepts optional 0x prefix
// and normalises to a 32-byte Uint8Array. Rejects anything out of curve order.
// -----------------------------------------------------------------------------
export function parseHexPrivateKey(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error('Private key must be 32 bytes hex (64 chars, optional 0x)');
  }
  const bytes = fromHex(clean);
  // secp256k1 order check.
  const n = secp256k1.CURVE.n;
  const asBigInt = BigInt('0x' + clean);
  if (asBigInt === 0n || asBigInt >= n) {
    throw new Error('Private key out of secp256k1 range');
  }
  return bytes;
}

// -----------------------------------------------------------------------------
// Public: derive the 0x address that corresponds to a raw secp256k1 private key.
// Used for the hot wallet health-check ("does env.QTA_HOT_WALLET_PRIVATE_KEY
// actually match env.QTA_HOT_WALLET_ADDRESS?").
// -----------------------------------------------------------------------------
export function addressFromPrivateKey(privkey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privkey, /* compressed */ false);
  return pubkeyToAddress(pub);
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/**
 * Convert an uncompressed secp256k1 pubkey (65 bytes, 0x04 || X || Y) into
 * an EIP-55 checksummed 0x-address.
 */
function pubkeyToAddress(uncompressedPubkey: Uint8Array): string {
  // Ethereum-style: keccak256(pubkey[1:]) → take last 20 bytes.
  const hash = keccak_256(uncompressedPubkey.slice(1));
  const addrLower = '0x' + toHex(hash.slice(-20));
  return toChecksumAddress(addrLower);
}

/** EIP-55: mixed-case checksum of a 20-byte address. */
export function toChecksumAddress(addr: string): string {
  const lower = addr.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(lower)) {
    throw new Error('Not a 20-byte hex address');
  }
  const hashHex = toHex(keccak_256(new TextEncoder().encode(lower)));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const ch = lower[i];
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else {
      // If corresponding hex-digit of the hash >= 8, uppercase.
      out += parseInt(hashHex[i], 16) >= 8 ? ch.toUpperCase() : ch;
    }
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  if (clean.length % 2 !== 0) throw new Error('Hex length must be even');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
