// loadtest/journey.js — full user journey
//
// Login → wallets → orderbook → place order → cancel.
//
// Usage:
//   node loadtest/seed-users.mjs --base=$BASE_URL --count=200
//   k6 run loadtest/journey.js -e BASE_URL=$BASE_URL --vus 100 --duration 5m

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend, Counter, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://quantaex.io';
const SYMBOL = __ENV.SYMBOL || 'BTC-USDT';
const MID_PRICE = parseFloat(__ENV.MID_PRICE || '67000');

const journeyOk = new Rate('journey_ok');
const cancelLatency = new Trend('cancel_latency', true);
const cancellations = new Counter('cancellations');

const users = new SharedArray('users', function () {
  const txt = open('./users.csv');
  return txt.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
    const [email, password, jwt] = line.split(',');
    return { email, password, jwt };
  });
});

export const options = {
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
    journey_ok: ['rate>0.9'],
  },
  scenarios: {
    journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { target: parseInt(__ENV.VUS || '100', 10), duration: '1m' },  // ramp up
        { target: parseInt(__ENV.VUS || '100', 10), duration: '3m' },  // hold
        { target: 0, duration: '1m' },                                  // ramp down
      ],
    },
  },
};

export default function () {
  if (users.length === 0) {
    console.error('No users in users.csv. Run seed-users.mjs first.');
    return;
  }
  const u = users[__VU % users.length];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${u.jwt}` };

  let ok = true;

  group('walletsAndBook', () => {
    const r1 = http.get(`${BASE}/api/wallet`, { headers, tags: { name: 'GET /wallet' } });
    ok = ok && check(r1, { 'wallets 200': (x) => x.status === 200 });

    const r2 = http.get(`${BASE}/api/markets/${SYMBOL}/orderbook?depth=20`, { tags: { name: 'GET /orderbook' } });
    ok = ok && check(r2, { 'orderbook 200': (x) => x.status === 200 });
  });

  let orderId = null;
  group('placeOrder', () => {
    // Place a far-from-market limit so it sits on the book and we can cancel it
    const farPrice = +(MID_PRICE * (Math.random() < 0.5 ? 0.7 : 1.3)).toFixed(2);
    const side = farPrice > MID_PRICE ? 'sell' : 'buy';
    const amount = +(20 / farPrice).toFixed(6);
    const r = http.post(
      `${BASE}/api/orders`,
      JSON.stringify({ market_symbol: SYMBOL, side, type: 'limit', price: farPrice, amount }),
      { headers, tags: { name: 'POST /orders' } },
    );
    ok = ok && check(r, { 'place 200': (x) => x.status === 200 });
    if (r.status === 200) {
      try { orderId = r.json().order.id; } catch { /* noop */ }
    }
  });

  if (orderId) {
    group('cancel', () => {
      const t0 = Date.now();
      const r = http.del(`${BASE}/api/orders/${orderId}`, null, { headers, tags: { name: 'DELETE /orders/:id' } });
      cancelLatency.add(Date.now() - t0);
      cancellations.add(1);
      ok = ok && check(r, { 'cancel 200': (x) => x.status === 200 });
    });
  }

  journeyOk.add(ok);
  sleep(1);
}
