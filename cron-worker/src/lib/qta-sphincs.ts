// ⚠️ COPIED from src/server/lib/qta-sphincs.ts — cron-worker has its own
// build context and cannot import across project roots. Keep this file in
// sync with the Pages-app copy when the wire format / derivation changes.
/**
 * SPHINCS+ (SLH-DSA-SHA2-128s) wallet + transaction signer for Quantarium chain.
 * ============================================================================
 *
 * Quantarium is a go-ethereum v1.13.15 fork that replaces (or rather, adds
 * alongside) ECDSA/secp256k1 signing with the post-quantum SPHINCS+ signature
 * scheme. On-chain, transactions signed with SPHINCS+ use a new typed tx
 * envelope `0x7f` instead of the standard EIP-1559 `0x02`.
 *
 * Wallet model
 * ------------
 * QuantaEX holds ONE 12-word BIP-39 mnemonic (registered as a Cloudflare
 * Pages secret `QTA_HD_WALLET_MNEMONIC`). From that single mnemonic we
 * derive as many SPHINCS+ keypairs as we need — one per user for deposit
 * addresses, plus index 0 which is the exchange hot wallet used for
 * withdrawals.
 *
 * HD derivation (NOT BIP-32, custom scheme required by SPHINCS+)
 * ---------------------------------------------------------------
 * BIP-32 defines HD derivation for secp256k1 specifically (it multiplies
 * points on the curve). SPHINCS+ has no such algebraic structure so we
 * cannot use BIP-32. Instead we follow the reference implementation
 * shipped in the Quantarium team's `tests_nodejs/generate_sphincs_wallet.js`:
 *
 *   seed                  = BIP-39 pbkdf2(mnemonic, "mnemonic" + passphrase)
 *   info                  = "sphincs-hd-wallet-v1" || uint32_be(index)
 *   derivedSeed[48 bytes] = HKDF-SHA256(salt=zeros(32), ikm=seed, info)
 *   {publicKey, secretKey} = slh_dsa_sha2_128s.keygen(derivedSeed)
 *   address               = last 20 bytes of keccak256(publicKey), EIP-55
 *
 * We verified this implementation against the reference script's output
 * for the fixed test mnemonic
 *   "mango hybrid legend vote drum dune divorce spike asset someone hurry duty"
 * and it produces byte-identical public keys, secret keys and addresses.
 *
 * Transaction signing
 * -------------------
 * The Quantarium node accepts a new typed transaction:
 *
 *   0x7f || RLP([
 *     chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit,
 *     to, value, data, accessList,
 *     publicKey,        // 32 bytes — SPHINCS+ pubkey MUST be in the tx
 *     signature         // 7856 bytes — SPHINCS+ signature
 *   ])
 *
 * The signing hash is `keccak256(0x7f || RLP(fields WITHOUT the signature))`.
 * We fill in the pubkey field before hashing (matches reference script line
 * 170-184 of test_compatibility_v2.js).
 *
 * Broadcast is via the ordinary `eth_sendRawTransaction` JSON-RPC method,
 * exactly like EIP-1559 txs.
 *
 * Performance caveats
 * -------------------
 * SPHINCS+ signing is CPU-intensive: on Node.js 20 (unstressed x86_64)
 * one sign() call takes ~6.5 seconds and produces a 7856-byte signature.
 * Verification is fast (~8 ms). This means:
 *   - Cloudflare Pages Workers on the FREE tier (10 ms CPU budget) CANNOT
 *     produce a signature. The paid tier gives 30 s CPU budget which fits.
 *   - Even on paid tier we should NEVER sign inside a user-facing HTTP
 *     handler because 6+ seconds of blocking CPU would starve concurrent
 *     requests. All withdrawal signing MUST happen inside a Queue consumer
 *     or scheduled task, not the /wallet/withdraw handler itself.
 *   - The withdrawal endpoint should ENQUEUE a job and return a "pending"
 *     tx id to the client; a background consumer picks it up, signs, and
 *     broadcasts.
 *
 * All crypto here is pure JS via @noble/post-quantum + @noble/hashes and
 * runs in the Workers runtime with no Node built-ins.
 */

import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

// -----------------------------------------------------------------------------
// Byte / hex helpers (local — kept independent from qta-hd.ts which is
// being decommissioned)
// -----------------------------------------------------------------------------

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2) throw new Error('odd hex length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** EIP-55 checksum a 20-byte address (accepts 0x-prefixed or bare lowercase hex). */
export function toChecksumAddress(input: string): string {
  const clean = input.toLowerCase().replace(/^0x/, '');
  if (clean.length !== 40) throw new Error('address must be 20 bytes hex');
  const hash = keccak_256(new TextEncoder().encode(clean));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const nibble = (hash[i >> 1] >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
    out += nibble >= 8 ? clean[i].toUpperCase() : clean[i];
  }
  return out;
}

// -----------------------------------------------------------------------------
// BIP-39 mnemonic → SPHINCS+ HD keypair
// -----------------------------------------------------------------------------

export interface SphincsAccount {
  index: number;
  publicKey: Uint8Array;   // 32 bytes
  secretKey: Uint8Array;   // 64 bytes
  address: string;         // EIP-55 checksummed 0x...
}

/** Validate a BIP-39 mnemonic against the English wordlist. */
export function isValidMnemonic(mnemonic: string): boolean {
  try {
    return validateMnemonic(mnemonic.trim().normalize('NFKD'), wordlist);
  } catch {
    return false;
  }
}

/**
 * Convert a mnemonic + optional passphrase to a 64-byte BIP-39 seed.
 * Uses PBKDF2-HMAC-SHA512 with 2048 iterations (BIP-39 standard).
 */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Uint8Array {
  const norm = mnemonic.trim().normalize('NFKD');
  if (!validateMnemonic(norm, wordlist)) {
    throw new Error('Invalid BIP-39 mnemonic');
  }
  return mnemonicToSeedSync(norm, passphrase);
}

/**
 * Derive the SPHINCS+ keypair for a given index from a BIP-39 seed.
 * The derivation is DETERMINISTIC and matches the Quantarium reference
 * script byte-for-byte.
 *
 * @param seed  64-byte BIP-39 seed
 * @param index non-negative 32-bit integer HD account index
 */
export function deriveSphincsAccount(seed: Uint8Array, index: number): SphincsAccount {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
    throw new Error('index must be a uint32');
  }
  // info = "sphincs-hd-wallet-v1" || big-endian uint32(index)
  const label = new TextEncoder().encode('sphincs-hd-wallet-v1');
  const info = new Uint8Array(label.length + 4);
  info.set(label, 0);
  const dv = new DataView(info.buffer, label.length, 4);
  dv.setUint32(0, index, false); // big-endian

  // salt = null → noble/hkdf uses zeros(hashLen). Matches ref script's
  // `salt || Buffer.alloc(32, 0)` (SHA-256 block size = 32 bytes for salt-zero).
  const derivedSeed = hkdf(sha256, seed, undefined, info, 48);
  const { publicKey, secretKey } = slh_dsa_sha2_128s.keygen(derivedSeed);

  const hash = keccak_256(publicKey);
  const addressBytes = hash.slice(-20);
  const address = toChecksumAddress(toHex(addressBytes));

  return { index, publicKey, secretKey, address };
}

/** Convenience: derive from mnemonic in one call. */
export function deriveAccountFromMnemonic(
  mnemonic: string,
  index: number,
  passphrase = '',
): SphincsAccount {
  const seed = mnemonicToSeed(mnemonic, passphrase);
  return deriveSphincsAccount(seed, index);
}

// -----------------------------------------------------------------------------
// SPHINCS+ signing
// -----------------------------------------------------------------------------

/**
 * Sign a message hash with a SPHINCS+ secret key.
 * Returns 7856-byte signature.
 *
 * ⚠️ CPU-INTENSIVE (~6.5 s on Node.js x86_64). Must NOT be called from
 * user-facing HTTP handlers on Cloudflare Workers — enqueue instead.
 */
export function sphincsSign(messageHash: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return slh_dsa_sha2_128s.sign(messageHash, secretKey);
}

/** Verify a SPHINCS+ signature. Fast (~8 ms). */
export function sphincsVerify(
  signature: Uint8Array,
  messageHash: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return slh_dsa_sha2_128s.verify(signature, messageHash, publicKey);
}

// -----------------------------------------------------------------------------
// RLP encoding (identical to qta-evm.ts's implementation — copied here so
// this file has no dependency on the deprecated qta-evm signing module).
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

function bigintToBytes(n: bigint): Uint8Array {
  if (n < 0n) throw new Error('negative bigint');
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
// SPHINCS+ typed transaction (envelope 0x7f)
// -----------------------------------------------------------------------------

export interface SphincsTx {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: string;              // 0x-prefixed 20-byte address
  value: bigint;
  data: string;            // 0x-prefixed hex, may be '0x'
  accessList?: [];         // always empty for our txs
}

/**
 * Sign a Quantarium 0x7f transaction and return the raw broadcast bytes.
 *
 * Layout matches tests_nodejs/test_compatibility_v2.js lines 170-217:
 *
 *   unsignedRlp = RLP([chainId, nonce, tip, fee, gas, to, value, data,
 *                      accessList, publicKey])
 *   signingHash = keccak256(0x7f || unsignedRlp)
 *   signature   = SLH-DSA-SHA2-128s.sign(signingHash, secretKey)   // 7856 bytes
 *
 *   signedRlp   = RLP([chainId, nonce, tip, fee, gas, to, value, data,
 *                      accessList, publicKey, signature])
 *   rawTx       = 0x7f || signedRlp
 *   txHash      = keccak256(rawTx)
 */
export function signSphincsTx(
  tx: SphincsTx,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
): { rawTx: string; txHash: string; signBytes: number; signMs: number } {
  const dataBytes = tx.data && tx.data !== '0x' ? fromHex(tx.data) : new Uint8Array(0);

  const unsignedFields: RlpInput = [
    numToBytes(tx.chainId),
    numToBytes(tx.nonce),
    bigintToBytes(tx.maxPriorityFeePerGas),
    bigintToBytes(tx.maxFeePerGas),
    bigintToBytes(tx.gasLimit),
    addrToBytes(tx.to),
    bigintToBytes(tx.value),
    dataBytes,
    [],                    // accessList
    publicKey,             // 32 bytes
  ];
  const unsignedRlp = rlpEncode(unsignedFields);
  const preimage = concat(Uint8Array.of(0x7f), unsignedRlp);
  const signingHash = keccak_256(preimage);

  const t0 = Date.now();
  const signature = sphincsSign(signingHash, secretKey);
  const signMs = Date.now() - t0;

  const signedFields: RlpInput = [
    ...unsignedFields,
    signature,             // 7856 bytes
  ];
  const signedRlp = rlpEncode(signedFields);
  const raw = concat(Uint8Array.of(0x7f), signedRlp);
  const rawTx = '0x' + toHex(raw);
  const txHash = '0x' + toHex(keccak_256(raw));

  return { rawTx, txHash, signBytes: raw.length, signMs };
}

// -----------------------------------------------------------------------------
// Health check — verify env.QTA_HD_WALLET_MNEMONIC yields the expected
// index-0 address. Used by the diagnostic env-check endpoint.
// -----------------------------------------------------------------------------

export function verifyMnemonicMatchesHotWallet(
  mnemonic: string,
  expectedHotWallet: string,
  passphrase = '',
): { ok: true } | { ok: false; derived: string; expected: string } {
  const acc = deriveAccountFromMnemonic(mnemonic, 0, passphrase);
  const expected = toChecksumAddress(expectedHotWallet);
  if (acc.address.toLowerCase() === expected.toLowerCase()) return { ok: true };
  return { ok: false, derived: acc.address, expected };
}
