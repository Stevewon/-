import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const KEY = JSON.parse(fs.readFileSync('user_pq_key_c1.json','utf8'));
const API_KEY = KEY.api_key;
const SK = new Uint8Array(Buffer.from(KEY.secret_key_b64,'base64'));
const HOST = 'https://quantaex.io';
const PATH = '/api/v1/server-time';

function sha256hex(b){ return crypto.createHash('sha256').update(b).digest('hex'); }

async function call(label){
  const ts = Math.floor(Date.now()/1000);
  const nonce = crypto.randomUUID();
  const body = '';
  const canonical = `GET\n${PATH}\n${ts}\n${sha256hex(body)}`;
  const sig = ml_dsa44.sign(new TextEncoder().encode(canonical), SK);
  const sigB64 = Buffer.from(sig).toString('base64');
  const res = await fetch(HOST+PATH, {
    method:'GET',
    headers:{
      'X-API-Key': API_KEY,
      'X-Algorithm': 'dilithium2',
      'X-Timestamp': String(ts),
      'X-Nonce': nonce,
      'X-Signature': sigB64,
    }
  });
  const text = await res.text();
  console.log(`[${label}] HTTP ${res.status} ${text}`);
  return { status: res.status, body: text };
}

await call(process.argv[2] || 'test');
