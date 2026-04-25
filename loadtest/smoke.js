// Smoke test — verifies target is reachable. Run first, always.
// Usage: BASE_URL=https://quantaex.io k6 run smoke.js

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8787';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 10,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  const endpoints = [
    `${BASE}/api/health`,
    `${BASE}/api/markets`,
    `${BASE}/api/markets/BTC-USDT/ticker`,
  ];

  for (const url of endpoints) {
    const res = http.get(url, { tags: { endpoint: url.split('/').pop() } });
    check(res, {
      'status 200': (r) => r.status === 200,
      'body not empty': (r) => r.body && r.body.length > 0,
    });
  }

  sleep(1);
}
