import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const KEY = JSON.parse(fs.readFileSync('user_pq_key_c1.json','utf8'));
const API_KEY = KEY.api_key;
const SK = new Uint8Array(Buffer.from(KEY.secret_key_b64,'base64'));
const HOST = 'https://quantaex.io';
const PATH = '/api/v1/server-time';
const LOG = 'monitor_24h.log';

function sha256hex(b){ return crypto.createHash('sha256').update(b).digest('hex'); }

async function call(label){
  const t0 = Date.now();
  const ts = Math.floor(t0/1000);
  const nonce = crypto.randomUUID();
  const canonical = `GET\n${PATH}\n${ts}\n${sha256hex('')}`;
  const sig = ml_dsa44.sign(new TextEncoder().encode(canonical), SK);
  const sigB64 = Buffer.from(sig).toString('base64');
  let status, body, err='';
  try {
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
    status = res.status;
    body = await res.text();
  } catch (e) { err = String(e); status = 0; body = ''; }
  const ms = Date.now() - t0;
  const line = `[${new Date().toISOString()}] ${label} HTTP ${status} ${ms}ms ${body.slice(0,140)}${err?' ERR='+err:''}`;
  console.log(line);
  fs.appendFileSync(LOG, line+'\n');
}

// hour 0..23 → 24 calls, 1 hour apart
const startHour = parseInt(process.env.START_HOUR || '0', 10);
const endHour = parseInt(process.env.END_HOUR || '24', 10);

await call(`hourly-${String(startHour).padStart(2,'0')}h (initial)`);
for (let h = startHour+1; h < endHour; h++) {
  await new Promise(r => setTimeout(r, 3600 * 1000));
  await call(`hourly-${String(h).padStart(2,'0')}h`);
}
console.log('monitor_24h done');
