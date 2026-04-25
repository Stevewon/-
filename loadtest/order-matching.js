// Order matching engine load test.
//
// Half the VUs post buy orders, the other half post sell orders at overlapping
// prices, exercising the matchOrder() hot path. Tracks TPS, latency, and
// matched-trade rate.
//
// Usage:
//   BASE_URL=https://quantaex.io \
//     TEST_USERS_FILE=./users.json \
//     k6 run order-matching.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE_URL || 'http://localhost:8787';
const USERS_FILE = __ENV.TEST_USERS_FILE || './users.json';
const MARKET = __ENV.MARKET || 'BTC-USDT';
const BASE_PRICE = parseFloat(__ENV.BASE_PRICE || '67000');

const users = new SharedArray('users', () => {
  const raw = open(USERS_FILE);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length < 2) {
    throw new Error(`${USERS_FILE} must contain at least 2 users with .jwt`);
  }
  return parsed;
});

const orderPlaceRate = new Rate('order_place_success_rate');
const orderMatchedRate = new Rate('order_matched_rate');
const placeLatency = new Trend('place_order_latency_ms', true);
const tradesExecuted = new Counter('trades_executed_total');

export const options = {
  scenarios: {
    ramp_up_steady: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },  // warm-up
        { duration: '2m',  target: 50 },  // sustained
        { duration: '30s', target: 0  },  // cool-down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:place_order}': ['p(95)<1500', 'p(99)<3000'],
    'order_place_success_rate': ['rate>0.99'],
    'http_req_failed{endpoint:place_order}': ['rate<0.02'],
  },
};

export default function () {
  const me = users[__VU % users.length];
  const isBuy = __VU % 2 === 0;

  // Jitter prices around BASE_PRICE so buys and sells overlap and actually match
  const jitterPct = (Math.random() - 0.5) * 0.002; // ±0.1%
  const price = +(BASE_PRICE * (1 + jitterPct)).toFixed(2);
  const amount = +(0.001 + Math.random() * 0.004).toFixed(6);

  const payload = JSON.stringify({
    market_symbol: MARKET,
    side: isBuy ? 'buy' : 'sell',
    type: 'limit',
    price,
    amount,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${me.jwt}`,
    },
    tags: { endpoint: 'place_order' },
    timeout: '10s',
  };

  const start = Date.now();
  const res = http.post(`${BASE}/api/orders`, payload, params);
  placeLatency.add(Date.now() - start);

  const ok = check(res, {
    'HTTP 200': (r) => r.status === 200,
    'has order id': (r) => {
      try { return !!JSON.parse(r.body).order?.id; } catch { return false; }
    },
  });

  orderPlaceRate.add(ok);

  if (ok) {
    const body = res.json();
    const trades = body.trades || [];
    orderMatchedRate.add(trades.length > 0);
    tradesExecuted.add(trades.length);
  } else if (res.status === 429) {
    // Rate-limited — back off a bit
    sleep(2);
  } else {
    console.warn(`place_order failed: ${res.status} ${res.body?.slice?.(0, 200)}`);
  }

  // Think time — simulates a human placing orders, not a HFT bot
  sleep(Math.random() * 0.5 + 0.2);
}

export function handleSummary(data) {
  // Machine-readable summary for CI integration
  return {
    stdout: textSummary(data),
    'summary.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const metrics = data.metrics;
  const lines = [
    '',
    '=== QuantaEx Order Matching Load Test ===',
    `Duration:               ${(data.state.testRunDurationMs / 1000).toFixed(1)}s`,
    `Orders placed:          ${metrics.http_reqs?.values?.count || 0}`,
    `Orders/s throughput:    ${(metrics.http_reqs?.values?.rate || 0).toFixed(2)}`,
    `Place success rate:     ${((metrics.order_place_success_rate?.values?.rate || 0) * 100).toFixed(2)}%`,
    `Orders that matched:    ${((metrics.order_matched_rate?.values?.rate || 0) * 100).toFixed(2)}%`,
    `Trades executed:        ${metrics.trades_executed_total?.values?.count || 0}`,
    `p(95) place latency:    ${(metrics.place_order_latency_ms?.values?.['p(95)'] || 0).toFixed(0)}ms`,
    `p(99) place latency:    ${(metrics.place_order_latency_ms?.values?.['p(99)'] || 0).toFixed(0)}ms`,
    '',
  ];
  return lines.join('\n');
}
