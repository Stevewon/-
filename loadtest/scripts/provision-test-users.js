#!/usr/bin/env node
/**
 * Provisions N load-test users against a running QuantaEx instance.
 *
 * Registers each user via /api/auth/register, captures the JWT, and writes a
 * users.json file consumed by k6 scripts.
 *
 * Usage:
 *   node provision-test-users.js --base https://quantaex.io --count 20 --output ./users.json
 *
 * All users share a fixed password pattern: `LoadTest!<index>`. DO NOT run this
 * against production — use a staging env with isolated data.
 */

const fs = require('node:fs');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const BASE = args.base || process.env.BASE_URL || 'http://localhost:8787';
const COUNT = parseInt(args.count || '20', 10);
const OUTPUT = args.output || './users.json';
const PREFIX = args.prefix || 'load';

if (BASE.includes('quantaex.io') && !args.yes) {
  console.error('Refusing to provision against production. Pass --yes to override.');
  process.exit(1);
}

async function registerOne(i) {
  const email = `${PREFIX}-${String(i).padStart(3, '0')}@test.quantaex.local`;
  const password = `LoadTest!${i}x${Math.random().toString(36).slice(2, 8)}`;

  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, nickname: `loadtest-${i}` }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) {
    // If already exists, try login instead
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const lb = await login.json().catch(() => ({}));
    if (!login.ok || !lb.token) {
      throw new Error(`register+login failed for ${email}: ${res.status} / ${login.status} — ${JSON.stringify(body)} / ${JSON.stringify(lb)}`);
    }
    return { email, password, jwt: lb.token, userId: lb.user?.id };
  }

  return { email, password, jwt: body.token, userId: body.user?.id };
}

(async () => {
  const out = [];
  for (let i = 0; i < COUNT; i++) {
    try {
      const u = await registerOne(i);
      out.push(u);
      process.stdout.write('.');
    } catch (e) {
      process.stdout.write('x');
      console.error(`\n[${i}]`, e.message);
    }
  }
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${out.length} users → ${OUTPUT}`);
  console.log(`Remember to seed balances: node seed-test-balances.js --users ${OUTPUT} --base ${BASE}`);
})();
