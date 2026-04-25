#!/usr/bin/env node
/**
 * seed-users.mjs — idempotently create N test accounts for k6 load tests.
 *
 * Usage:
 *   node loadtest/seed-users.mjs --base=https://staging.quantaex.io --count=200
 *
 * Creates loadtest+0001@quantaex.io ... loadtest+NNNN@quantaex.io
 * Password: Loadtest!1234
 *
 * If a user already exists (409 / "already registered") it is treated as a
 * success and skipped. Output: a CSV file `loadtest/users.csv` with email,
 * password, jwt — consumable from k6 SharedArray.
 */

import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const BASE = (args.base || process.env.BASE_URL || 'https://quantaex.io').replace(/\/$/, '');
const COUNT = parseInt(args.count || '200', 10);
const PASSWORD = 'Loadtest!1234';
const CONCURRENCY = parseInt(args.concurrency || '10', 10);

console.log(`[seed] base=${BASE} count=${COUNT} concurrency=${CONCURRENCY}`);

async function registerOrLogin(email) {
  // Try register first; if 409 fall through to login
  try {
    const r = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, nickname: email.split('@')[0] }),
    });
    if (r.ok) {
      const data = await r.json();
      return { ok: true, email, password: PASSWORD, jwt: data.token, action: 'created' };
    }
    if (r.status !== 409 && r.status !== 400) {
      const txt = await r.text();
      return { ok: false, email, error: `register ${r.status}: ${txt.slice(0, 200)}` };
    }
  } catch (e) {
    return { ok: false, email, error: `register network: ${e.message}` };
  }
  // Login fallback
  try {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (!r.ok) {
      const txt = await r.text();
      return { ok: false, email, error: `login ${r.status}: ${txt.slice(0, 200)}` };
    }
    const data = await r.json();
    return { ok: true, email, password: PASSWORD, jwt: data.token, action: 'login' };
  } catch (e) {
    return { ok: false, email, error: `login network: ${e.message}` };
  }
}

async function main() {
  const results = [];
  let created = 0, login = 0, failed = 0;
  for (let i = 0; i < COUNT; i += CONCURRENCY) {
    const batch = [];
    for (let j = 0; j < CONCURRENCY && i + j < COUNT; j++) {
      const n = String(i + j + 1).padStart(4, '0');
      const email = `loadtest+${n}@quantaex.io`;
      batch.push(registerOrLogin(email));
    }
    const out = await Promise.all(batch);
    for (const r of out) {
      if (r.ok) {
        results.push(r);
        if (r.action === 'created') created++; else login++;
      } else {
        failed++;
        console.warn(`[seed] FAIL ${r.email}: ${r.error}`);
      }
    }
    if (i % 50 === 0 || i + CONCURRENCY >= COUNT) {
      console.log(`[seed] progress ${results.length}/${COUNT} (created=${created} login=${login} failed=${failed})`);
    }
    // Be nice to rate limits: 5/h on register per IP. Slow down heavily.
    if (created > 0 && created % 4 === 0) await sleep(800);
  }

  // Write CSV
  const csv = ['email,password,jwt']
    .concat(results.map((r) => `${r.email},${r.password},${r.jwt}`))
    .join('\n');
  writeFileSync('loadtest/users.csv', csv);
  console.log(`[seed] wrote loadtest/users.csv with ${results.length} users (created=${created} login=${login} failed=${failed})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
