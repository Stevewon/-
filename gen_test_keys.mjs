import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import crypto from 'node:crypto';

function bytesToB64(b) { return Buffer.from(b).toString('base64'); }
function bytesToHex(b) { return Buffer.from(b).toString('hex'); }
async function sha256Hex(s) {
  const h = await crypto.webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Buffer.from(h).toString('hex');
}

// HMAC key — random 32 bytes
const hmacSecret = crypto.randomBytes(32).toString('hex'); // 64 hex chars
const hmacSecretHash = await sha256Hex(hmacSecret);

// Dilithium2 keypair (real)
const dil = ml_dsa44.keygen();
console.log(JSON.stringify({
  hmac: {
    api_key: 'qx_test_hmac_' + crypto.randomBytes(8).toString('hex'),
    secret_plain: hmacSecret,             // client-side use
    secret_hash: hmacSecretHash,          // stored server-side
  },
  dilithium2: {
    api_key: 'qx_test_dil_' + crypto.randomBytes(8).toString('hex'),
    public_key_b64: bytesToB64(dil.publicKey),
    secret_key_b64: bytesToB64(dil.secretKey),
    pub_len: dil.publicKey.length,
    sec_len: dil.secretKey.length,
  },
  hybrid: {
    api_key: 'qx_test_hybrid_' + crypto.randomBytes(8).toString('hex'),
    hmac_secret_plain: hmacSecret,        // reuse same
    hmac_secret_hash: hmacSecretHash,
    dil_pub_b64: bytesToB64(dil.publicKey),
    dil_sec_b64: bytesToB64(dil.secretKey),
  },
}, null, 2));
