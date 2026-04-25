#!/usr/bin/env node
/**
 * Seeds trading balances for load-test users via the admin manual-deposit
 * endpoint. Requires ADMIN_JWT to be set in the environment.
 *
 * Usage:
 *   ADMIN_JWT=xxx node seed-test-balances.js \
 *     --users ./users.json --base https://staging.quantaex.io \
 *     --coin USDT --amount 100000
 *   ADMIN_JWT=xxx node seed-test-balances.js \
 *     --users ./users.json --coin BTC --amount 1
 */

const fs = require('node:fs');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const BASE = args.base || process.env.BASE_URL || 'http://localhost:8787';
const USERS_FILE = args.users || './users.json';
const COIN = args.coin || 'USDT';
const AMOUNT = parseFloat(args.amount || '100000');
const ADMIN_JWT = process.env.ADMIN_JWT;

if (!ADMIN_JWT) {
  console.error('ADMIN_JWT env required.');
  process.exit(1);
}

const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));

(async () => {
  let ok = 0, fail = 0;
  for (const u of users) {
    try {
      const res = await fetch(`${BASE}/api/admin/deposits/manual`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_JWT}`,
        },
        body: JSON.stringify({
          user_id: u.userId,
          coin_symbol: COIN,
          amount: AMOUNT,
          note: 'load-test seed',
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      ok++;
      process.stdout.write('.');
    } catch (e) {
      fail++;
      process.stdout.write('x');
      console.error(`\n${u.email}:`, e.message);
    }
  }
  console.log(`\nSeeded ${COIN} ${AMOUNT} to ${ok} users (${fail} failed)`);
})();
