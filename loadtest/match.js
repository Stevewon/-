// loadtest/match.js — matching engine TPS
//
// Usage:
//   node loadtest/seed-users.mjs --base=$BASE_URL --count=200
//   k6 run loadtest/match.js -e BASE_URL=$BASE_URL --vus 50 --duration 2m

import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Rate, Trend, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://quantaex.io';
const SYMBOL = __ENV.SYMBOL || 'BTC-USDT';
const MID_PRICE = parseFloat(__ENV.MID_PRICE || '67000');
const SPREAD_PCT = parseFloat(__ENV.SPREAD_PCT || '0.5'); // ±0.5% around mid
const ORDER_USD = parseFloat(__ENV.ORDER_USD || '50');   // $50 per order

const matchLatency = new Trend('match_latency', true);
const matchedRate = new Rate('matched_rate');
const orderErrors = new Counter('order_errors');
const insufficientFunds = new Counter('insufficient_funds');

const users = new SharedArray('users', function () {
  // CSV produced by seed-users.mjs: email,password,jwt
  const txt = open('./users.csv');
  const rows = txt.split(/\r?\n/).slice(1).filter(Boolean);
  return rows.map((line) => {
    const [email, password, jwt] = line.split(',');
    return { email, password, jwt };
  });
});

export const options = {
  thresholds: {
    http_req_failed: ['rate<0.05'],
    match_latency: ['p(95)<1500', 'p(99)<3000'],
    matched_rate: ['rate>0.5'],   // >50% of orders touch the book or match
  },
  scenarios: {
    match: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '50', 10),
      duration: __ENV.DURATION || '2m',
    },
  },
};

function randPrice() {
  const factor = 1 + (Math.random() * SPREAD_PCT * 2 - SPREAD_PCT) / 100;
  return Math.round(MID_PRICE * factor * 100) / 100;
}

export default function () {
  if (users.length === 0) {
    console.error('No users in users.csv. Run seed-users.mjs first.');
    return;
  }
  const u = users[__VU % users.length];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${u.jwt}` };

  const price = randPrice();
  const amount = +(ORDER_USD / price).toFixed(6);
  const side = Math.random() < 0.5 ? 'buy' : 'sell';

  const t0 = Date.now();
  const res = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({ market_symbol: SYMBOL, side, type: 'limit', price, amount }),
    { headers, tags: { name: 'POST /orders' } },
  );
  matchLatency.add(Date.now() - t0);

  const ok = res.status === 200;
  check(res, {
    'order accepted': (r) => r.status === 200,
    'response shape': (r) => {
      try { const j = r.json(); return j.order && typeof j.order.id === 'string'; } catch { return false; }
    },
  });

  if (!ok) {
    const body = res.body || '';
    if (/insufficient|balance/i.test(body)) insufficientFunds.add(1);
    else orderErrors.add(1);
    matchedRate.add(false);
  } else {
    try {
      const j = res.json();
      const filled = (j.trades?.length || 0) > 0;
      const restingOpen = j.order?.status === 'open' || j.order?.status === 'partial';
      matchedRate.add(filled || restingOpen);
    } catch {
      matchedRate.add(false);
    }
  }

  // Mild pacing
  sleep(0.2);
}
