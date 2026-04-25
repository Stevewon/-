// loadtest/read.js — orderbook & market read traffic
//
// Usage:
//   k6 run loadtest/read.js -e BASE_URL=https://quantaex.io --vus 200 --duration 2m

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://quantaex.io';
const SYMBOLS = (__ENV.SYMBOLS || 'BTC-USDT,ETH-USDT,QTA-USDT').split(',');

const errorRate = new Rate('errors');
const orderbookLatency = new Trend('orderbook_latency', true);

export const options = {
  thresholds: {
    http_req_failed: ['rate<0.01'],          // <1% errors
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    errors: ['rate<0.01'],
    orderbook_latency: ['p(95)<800'],
  },
  scenarios: {
    read: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '200', 10),
      duration: __ENV.DURATION || '2m',
    },
  },
};

export default function () {
  const sym = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

  // 1) markets list (cheap, cached)
  let r = http.get(`${BASE}/api/markets`, { tags: { name: 'GET /markets' } });
  check(r, { 'markets 200': (x) => x.status === 200 });
  errorRate.add(r.status !== 200);

  // 2) orderbook
  r = http.get(`${BASE}/api/markets/${sym}/orderbook?depth=20`, { tags: { name: 'GET /orderbook' } });
  orderbookLatency.add(r.timings.duration);
  check(r, {
    'orderbook 200': (x) => x.status === 200,
    'orderbook has bids/asks': (x) => {
      try { const j = x.json(); return Array.isArray(j.bids) && Array.isArray(j.asks); } catch { return false; }
    },
  });
  errorRate.add(r.status !== 200);

  // 3) recent trades
  r = http.get(`${BASE}/api/markets/${sym}/trades?limit=20`, { tags: { name: 'GET /trades' } });
  check(r, { 'trades 200': (x) => x.status === 200 });
  errorRate.add(r.status !== 200);

  // 4) ticker
  r = http.get(`${BASE}/api/markets/${sym}/ticker`, { tags: { name: 'GET /ticker' } });
  check(r, { 'ticker 200': (x) => x.status === 200 });
  errorRate.add(r.status !== 200);

  sleep(1); // 1 Hz per VU
}
