// Phase B regression test — HMAC, Dilithium2, Hybrid against /api/v1/server-time
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://quantaex.io';
const PATH = '/api/v1/server-time';
const METHOD = 'GET';
const keys = JSON.parse(fs.readFileSync('test_keys.json', 'utf8'));

function b64ToBytes(b64) {
  const buf = Buffer.from(b64, 'base64');
  // @noble/post-quantum's abytes() does a strict instanceof Uint8Array check
  // and rejects Node Buffer subclasses; copy into a fresh Uint8Array.
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out;
}
function bytesToB64(b)   { return Buffer.from(b).toString('base64'); }
function sha256Hex(s)    { return crypto.createHash('sha256').update(s).digest('hex'); }
function hmacHex(key, msg) { return crypto.createHmac('sha256', key).update(msg).digest('hex'); }
function nonce()         { return crypto.randomBytes(16).toString('hex'); }

function canonical(ts, body = '') {
  return `${METHOD}\n${PATH}\n${ts}\n${sha256Hex(body)}`;
}

async function call(label, headers) {
  const url = BASE + PATH;
  const r = await fetch(url, { method: METHOD, headers });
  const text = await r.text();
  console.log(`\n=== ${label} ===`);
  console.log('HTTP', r.status);
  console.log('Body', text.slice(0, 240));
  return { status: r.status, body: text };
}

// 1) HMAC
{
  const ts = Math.floor(Date.now() / 1000);
  const sig = hmacHex(keys.hmac.secret_hash, canonical(ts));
  await call('HMAC-SHA256', {
    'X-API-Key':   keys.hmac.api_key,
    'X-Algorithm': 'hmac-sha256',
    'X-Timestamp': String(ts),
    'X-Nonce':     nonce(),
    'X-Signature': sig,
  });
}

// 2) Dilithium2
{
  const ts = Math.floor(Date.now() / 1000);
  const msg = new TextEncoder().encode(canonical(ts));
  const sk = b64ToBytes(keys.dilithium2.secret_key_b64);
  // @noble/post-quantum 0.6.x: sign(msg, secretKey)
  const sig = ml_dsa44.sign(msg, sk);
  await call('Dilithium2 (ML-DSA-44)', {
    'X-API-Key':   keys.dilithium2.api_key,
    'X-Algorithm': 'dilithium2',
    'X-Timestamp': String(ts),
    'X-Nonce':     nonce(),
    'X-Signature': bytesToB64(sig),
  });
}

// 3) Hybrid (HMAC half in X-Signature, Dilithium2 half in X-Signature-Pq)
{
  const ts = Math.floor(Date.now() / 1000);
  const c  = canonical(ts);
  const hmac = hmacHex(keys.hybrid.hmac_secret_hash, c);
  const sk = b64ToBytes(keys.hybrid.dil_sec_b64);
  // @noble/post-quantum 0.6.x: sign(msg, secretKey)
  const pqSig = ml_dsa44.sign(new TextEncoder().encode(c), sk);
  await call('Hybrid (HMAC + Dilithium2)', {
    'X-API-Key':       keys.hybrid.api_key,
    'X-Algorithm':     'hybrid',
    'X-Timestamp':     String(ts),
    'X-Nonce':         nonce(),
    'X-Signature':     hmac,
    'X-Signature-Pq':  bytesToB64(pqSig),
  });
}

// 4) Negative: tampered HMAC
{
  const ts = Math.floor(Date.now() / 1000);
  await call('NEGATIVE: Tampered HMAC', {
    'X-API-Key':   keys.hmac.api_key,
    'X-Algorithm': 'hmac-sha256',
    'X-Timestamp': String(ts),
    'X-Nonce':     nonce(),
    'X-Signature': '00'.repeat(32),
  });
}
