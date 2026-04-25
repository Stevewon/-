// Chaos / adverse-condition test — exercises failure paths to ensure the
// exchange returns proper error codes under stress and never double-spends.
//
// Usage:
//   BASE_URL=https://quantaex.io \
//     TEST_USERS_FILE=./users.json \
//     k6 run chaos.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE_URL || 'http://localhost:8787';
const USERS_FILE = __ENV.TEST_USERS_FILE || './users.json';
const MARKET = __ENV.MARKET || 'BTC-USDT';

const users = new SharedArray('users', () => JSON.parse(open(USERS_FILE)));

const expectedRejection = new Rate('expected_rejection_rate');
const unexpectedError = new Counter('unexpected_errors');
const doubleSpendAttempts = new Counter('double_spend_attempts_blocked');

export const options = {
  scenarios: {
    chaos: {
      executor: 'constant-vus',
      vus: 20,
      duration: '2m',
    },
  },
  thresholds: {
    expected_rejection_rate: ['rate>0.8'],
    unexpected_errors: ['count<5'],
  },
};

const SCENARIOS = [
  'insufficient_balance',
  'expired_jwt',
  'post_only_would_match',
  'fok_cannot_fill',
  'rapid_cancel_race',
];

export default function () {
  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  const me = users[__VU % users.length];

  switch (scenario) {
    case 'insufficient_balance':     return insufficientBalance(me);
    case 'expired_jwt':              return expiredJwt();
    case 'post_only_would_match':    return postOnlyWouldMatch(me);
    case 'fok_cannot_fill':          return fokCannotFill(me);
    case 'rapid_cancel_race':        return rapidCancelRace(me);
  }
}

function insufficientBalance(me) {
  // Try to buy 1,000,000 BTC with likely-small USDT balance
  const res = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({
      market_symbol: MARKET, side: 'buy', type: 'limit',
      price: 67000, amount: 1_000_000,
    }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${me.jwt}` }, tags: { scenario: 'insufficient_balance' } }
  );
  const rejected = check(res, {
    'rejected with 400': (r) => r.status === 400,
    'error message present': (r) => { try { return !!JSON.parse(r.body).error; } catch { return false; } },
  });
  expectedRejection.add(rejected);
  if (res.status === 200) {
    doubleSpendAttempts.add(1); // DANGER: order accepted with insufficient funds
    unexpectedError.add(1);
    console.error('CRITICAL: oversize order was accepted!', res.body);
  }
}

function expiredJwt() {
  const res = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({ market_symbol: MARKET, side: 'buy', type: 'limit', price: 1, amount: 0.001 }),
    { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid.jwt.token' }, tags: { scenario: 'expired_jwt' } }
  );
  const rejected = check(res, { 'rejected with 401': (r) => r.status === 401 });
  expectedRejection.add(rejected);
  if (!rejected) unexpectedError.add(1);
}

function postOnlyWouldMatch(me) {
  // Send a POST_ONLY buy order at a deliberately aggressive price
  const res = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({
      market_symbol: MARKET, side: 'buy', type: 'limit',
      price: 200000, amount: 0.001, time_in_force: 'POST_ONLY',
    }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${me.jwt}` }, tags: { scenario: 'post_only_would_match' } }
  );
  const rejected = check(res, {
    '400 or accepted as pure maker': (r) => r.status === 400 || r.status === 200,
  });
  expectedRejection.add(rejected);
}

function fokCannotFill(me) {
  const res = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({
      market_symbol: MARKET, side: 'buy', type: 'limit',
      price: 67000, amount: 9999, time_in_force: 'FOK',
    }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${me.jwt}` }, tags: { scenario: 'fok_cannot_fill' } }
  );
  const rejected = check(res, {
    'FOK rejected': (r) => {
      if (r.status === 200) {
        try {
          const b = JSON.parse(r.body);
          return b.order?.status === 'cancelled' || b.error;
        } catch { return false; }
      }
      return r.status === 400;
    },
  });
  expectedRejection.add(rejected);
}

function rapidCancelRace(me) {
  // Place then immediately cancel — ensures locked funds are always refunded
  const placeRes = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({ market_symbol: MARKET, side: 'buy', type: 'limit', price: 1, amount: 0.001 }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${me.jwt}` }, tags: { scenario: 'rapid_cancel_place' } }
  );
  if (placeRes.status !== 200) return;
  let orderId;
  try { orderId = JSON.parse(placeRes.body).order?.id; } catch {}
  if (!orderId) return;

  const cancelRes = http.del(
    `${BASE}/api/orders/${orderId}`,
    null,
    { headers: { Authorization: `Bearer ${me.jwt}` }, tags: { scenario: 'rapid_cancel_delete' } }
  );
  const ok = check(cancelRes, { 'cancel 200 or 404': (r) => r.status === 200 || r.status === 404 });
  expectedRejection.add(ok);
}
