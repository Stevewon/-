/**
 * Client-side PQ key helpers — Sprint 5 Phase S5-2 PQ-Live A.
 *
 * Mirrors the server's `src/server/lib/pq-crypto.ts` contract: same
 * library (`@noble/post-quantum`'s ml_dsa44 = NIST FIPS 204), same
 * canonical request bytes, same base64 encoding. Browser-generated keys
 * are now *real* Dilithium2 / ML-DSA-44 keys that the server can
 * actually verify against.
 *
 * Security boundary:
 *   - The secret key (2560 bytes) NEVER leaves the user's browser. We
 *     hand it to the user exactly once via JSON download and never POST
 *     it back to the server.
 *   - Only the public key (1312 bytes) is uploaded — that's what the
 *     server stores in api_keys.public_key.
 *
 * Browser compatibility:
 *   - ml_dsa44.keygen uses crypto.getRandomValues() under the hood.
 *     Chrome / Edge / Firefox / Safari 14+ all good.
 */

import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';

/** Dilithium2 (ML-DSA-44 FIPS 204) raw public key length. */
export const DILITHIUM2_PUBKEY_BYTES = 1312;

/** Dilithium2 (ML-DSA-44 FIPS 204) raw secret key length. */
export const DILITHIUM2_SECRET_BYTES = 2560;

/** Dilithium2 signature length (used by sign/verify). */
export const DILITHIUM2_SIG_BYTES = 2420;

export interface PqKeyPair {
  /** base64-encoded raw public key bytes — sent to server. */
  publicKey: string;
  /** base64-encoded raw secret key bytes — kept by user, NEVER uploaded. */
  secretKey: string;
  /** Algorithm tag — matches `signature_alg` column. */
  algorithm: 'dilithium2';
  /** Phase marker so ops can identify the integration stage. */
  phase: 'phase-s5-2-live';
  /** ISO timestamp of generation. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// base64 helpers (browser-safe, no Buffer)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Key pair generation (stub)
// ---------------------------------------------------------------------------

/**
 * Generate a real Dilithium2 (ML-DSA-44 FIPS 204) key pair in the
 * browser. The secret key bytes are returned base64-encoded for the
 * user to download; they are NEVER transmitted to the server.
 *
 * Live since Sprint 5 PQ-Live A: pairs produced here verify against
 * the server's pq-crypto.ts on every signed request.
 */
export function generateDilithium2KeyPair(): PqKeyPair {
  // ml_dsa44.keygen() returns { publicKey: Uint8Array(1312),
  //                             secretKey: Uint8Array(2560) }.
  // It draws randomness from crypto.getRandomValues internally, so the
  // resulting key pair is suitable for production use.
  const kp = ml_dsa44.keygen();
  return {
    publicKey: bytesToBase64(kp.publicKey),
    secretKey: bytesToBase64(kp.secretKey),
    algorithm: 'dilithium2',
    phase: 'phase-s5-2-live',
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Download helpers — secret key gets handed to the user exactly once.
// ---------------------------------------------------------------------------

export interface DownloadablePqKey {
  /** filename suggested for the .json download. */
  filename: string;
  /** the JSON text the browser will save. */
  content: string;
}

/**
 * Build the JSON payload the user downloads. We deliberately include
 * the public key alongside the secret so a lost server-side row can be
 * recovered from the user's backup if needed.
 */
export function buildPqKeyDownload(opts: {
  apiKeyId: string;
  apiKey: string;
  label: string;
  keyPair: PqKeyPair;
}): DownloadablePqKey {
  const safeLabel = opts.label.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32) || 'key';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    filename: `quantaex-pq-key-${safeLabel}-${ts}.json`,
    content: JSON.stringify(
      {
        warning:
          'KEEP THIS FILE SECRET. The secret_key inside it CANNOT be recovered. ' +
          'QuantaEx never stores it. If you lose this file you must regenerate the API key.',
        api_key_id: opts.apiKeyId,
        api_key: opts.apiKey,
        label: opts.label,
        algorithm: opts.keyPair.algorithm,
        phase: opts.keyPair.phase,
        created_at: opts.keyPair.createdAt,
        public_key_b64: opts.keyPair.publicKey,
        secret_key_b64: opts.keyPair.secretKey,
        public_key_bytes: DILITHIUM2_PUBKEY_BYTES,
        secret_key_bytes: DILITHIUM2_SECRET_BYTES,
      },
      null,
      2,
    ),
  };
}

/**
 * Trigger a browser download for the given content. No-op on SSR.
 */
export function triggerDownload(file: DownloadablePqKey): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([file.content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Fingerprint helper — short SHA-256 of the public key, for the UI badge.
// ---------------------------------------------------------------------------

export async function publicKeyFingerprint(publicKeyB64: string): Promise<string> {
  try {
    const bin = atob(publicKeyB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const arr = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < 8; i++) {
      const b = arr[i];
      hex += (b < 16 ? '0' : '') + b.toString(16);
    }
    // 16-char fingerprint, grouped 4-4-4-4 for readability.
    return hex.replace(/(.{4})/g, '$1 ').trim();
  } catch {
    return '';
  }
}
