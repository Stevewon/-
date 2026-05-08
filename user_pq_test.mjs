// User PQ key regression test against production /api/v1/server-time
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const BASE = 'https://quantaex.io';
const PATH = '/api/v1/server-time';
const METHOD = 'GET';
const k = JSON.parse(fs.readFileSync('user_pq_key.json', 'utf8'));

function b64ToBytes(b64) {
  const buf = Buffer.from(b64, 'base64');
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out;
}
function bytesToB64(b) { return Buffer.from(b).toString('base64'); }
function sha256Hex(s)  { return crypto.createHash('sha256').update(s).digest('hex'); }
function nonce()       { return crypto.randomBytes(16).toString('hex'); }

const ts = Math.floor(Date.now() / 1000);
const canonical = `${METHOD}\n${PATH}\n${ts}\n${sha256Hex('')}`;
const sk = b64ToBytes(k.secret_key_b64);
const sig = ml_dsa44.sign(new TextEncoder().encode(canonical), sk);
console.log('canonical:', JSON.stringify(canonical));
console.log('sig len:', sig.length, '(expect 2420)');
console.log('api_key:', k.api_key);

const r = await fetch(BASE + PATH, {
  method: METHOD,
  headers: {
    'X-API-Key':   k.api_key,
    'X-Algorithm': 'dilithium2',
    'X-Timestamp': String(ts),
    'X-Nonce':     nonce(),
    'X-Signature': bytesToB64(sig),
  },
});
const text = await r.text();
console.log('\n=== USER PQ KEY (Dilithium2) ===');
console.log('HTTP', r.status);
console.log('Body', text);
