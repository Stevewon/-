#!/usr/bin/env node
/*
 * ============================================================================
 * QuantaEX QTA Hot Wallet Mnemonic Generator
 * ============================================================================
 *
 * PURPOSE:
 *   Generate a brand-new 12-word BIP-39 mnemonic for QuantaEX's QTA hot wallet
 *   and derive its index-0 SPHINCS+ address. This mnemonic is INDEPENDENT of
 *   any external wallet (Telegram bot, browser wallet, etc.) — QuantaEX
 *   controls the private material end-to-end.
 *
 * USAGE:
 *   From project root (/home/user/webapp):
 *     node scripts/generate-hot-wallet.mjs
 *
 *   With custom entropy source (advanced, optional):
 *     ENTROPY_HEX=<32-byte hex> node scripts/generate-hot-wallet.mjs
 *
 * SECURITY:
 *   - Uses Node's crypto.randomBytes(16) = 128-bit entropy → 12-word mnemonic
 *   - Output is printed to stdout ONLY. Nothing is written to disk.
 *   - Run this on a MACHINE YOU TRUST. Wipe scrollback after copying.
 *   - The printed mnemonic controls REAL funds. Never share, screenshot,
 *     paste into chat, or commit to git.
 *
 * OUTPUT:
 *   MNEMONIC              — 12 words, register as QTA_HD_WALLET_MNEMONIC
 *                           (Cloudflare → Environment → Secret / encrypted)
 *   HOT_WALLET_ADDRESS    — 0x… EIP-55 checksum, register as
 *                           QTA_HOT_WALLET_ADDRESS (Text variable)
 *   NEXT ACTIONS          — Cloudflare dashboard checklist
 *
 * VERIFICATION:
 *   After Cloudflare deploy, hit:
 *     https://quantaex.io/api/chain/qta/env-check-temporary
 *   Must show:
 *     integration_status: "live"
 *     mnemonic_check.ok: true
 *     derived_address == expected_address
 * ============================================================================
 */

import { randomBytes } from 'node:crypto';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

// ---------------------------------------------------------------------------
// Helpers — MUST match src/server/lib/qta-sphincs.ts byte-for-byte
// ---------------------------------------------------------------------------

function toHex(bytes) {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toChecksumAddress(input) {
  const lower = input.toLowerCase().replace(/^0x/, '');
  const hashHex = Array.from(keccak_256(new TextEncoder().encode(lower)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hashHex[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

function deriveSphincsAccount(seed, index) {
  const label = new TextEncoder().encode('sphincs-hd-wallet-v1');
  const info = new Uint8Array(label.length + 4);
  info.set(label, 0);
  new DataView(info.buffer, label.length, 4).setUint32(0, index, false);
  const derivedSeed = hkdf(sha256, seed, undefined, info, 48);
  const { publicKey, secretKey } = slh_dsa_sha2_128s.keygen(derivedSeed);
  const hash = keccak_256(publicKey);
  const address = toChecksumAddress(toHex(hash.slice(-20)));
  return { index, publicKey, secretKey, address };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║       QuantaEX QTA Hot Wallet Mnemonic Generator (SPHINCS+)          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Generate mnemonic
  //    Either use user-supplied entropy (advanced) or Node CSPRNG.
  let mnemonic;
  if (process.env.ENTROPY_HEX) {
    const ent = process.env.ENTROPY_HEX.trim().toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{32}$/.test(ent)) {
      console.error('ERROR: ENTROPY_HEX must be exactly 32 hex chars (16 bytes / 128 bits)');
      process.exit(1);
    }
    const entropy = new Uint8Array(ent.match(/.{2}/g).map(h => parseInt(h, 16)));
    mnemonic = generateMnemonic(wordlist, 128, entropy);
    console.log('[!] Using supplied ENTROPY_HEX (advanced mode)');
  } else {
    // 128 bits = 16 bytes = 12 words. Use Node crypto.randomBytes.
    const entropy = new Uint8Array(randomBytes(16));
    mnemonic = generateMnemonic(wordlist, 128, entropy);
  }

  // 2. Sanity-check
  if (!validateMnemonic(mnemonic, wordlist)) {
    console.error('FATAL: generated mnemonic failed BIP-39 checksum. Aborting.');
    process.exit(1);
  }

  // 3. Derive index-0 (hot wallet) — this is what the backend will use as the
  //    fee-payer and outgoing-tx signer.
  //
  //    NOTE: SPHINCS+ keygen is CPU-heavy (~5–10 seconds). Please be patient.
  console.log('Deriving index-0 SPHINCS+ address… (this takes 5–10 seconds)');
  console.log('');
  const t0 = Date.now();
  const seed = mnemonicToSeedSync(mnemonic, '');
  const account = deriveSphincsAccount(seed, 0);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // 4. Print — clearly, unmistakably
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('  MNEMONIC   (12 words — register as QTA_HD_WALLET_MNEMONIC, Secret)');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('    ' + mnemonic);
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('  HOT WALLET ADDRESS   (register as QTA_HOT_WALLET_ADDRESS, Text)');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('    ' + account.address);
  console.log('');
  console.log(`  (derived in ${elapsed}s — SPHINCS+ keygen is slow by design)`);
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('  NEXT ACTIONS — Cloudflare Pages → Settings → Variables and secrets');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  1. UPDATE existing secret:');
  console.log('       Name:  QTA_HD_WALLET_MNEMONIC');
  console.log('       Type:  Secret  (encrypted)');
  console.log('       Value: <paste the 12 words above>');
  console.log('');
  console.log('  2. UPDATE existing variable:');
  console.log('       Name:  QTA_HOT_WALLET_ADDRESS');
  console.log('       Type:  Text  (or Secret — either works)');
  console.log('       Value: ' + account.address);
  console.log('');
  console.log('  3. Redeploy (Deployments → latest → Retry deployment)');
  console.log('');
  console.log('  4. Verify:');
  console.log('       curl https://quantaex.io/api/chain/qta/env-check-temporary');
  console.log('     Must show:');
  console.log('       integration_status: "live"');
  console.log('       mnemonic_check.ok: true');
  console.log('');
  console.log('  5. Fund the hot wallet:');
  console.log('     From your Telegram bot wallet (0x496EEaCE…), send a small');
  console.log('     amount of QTA to the new hot wallet address above. Confirm');
  console.log('     balance on https://scan.quantarium.io before opening withdrawals.');
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('  ⚠  SECURITY REMINDERS');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('  • Nothing has been written to disk. This mnemonic exists ONLY in');
  console.log('    your terminal scrollback right now.');
  console.log('  • After registering in Cloudflare, close & wipe this terminal.');
  console.log('  • Keep an OFFLINE backup (paper / hardware) — losing the mnemonic');
  console.log('    means losing every satoshi in the hot wallet forever.');
  console.log('  • Never paste this into Telegram, chat, git, or a screenshot.');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('');
}

main();
