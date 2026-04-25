// Read-heavy load test — orderbook, markets list, trades.
// No auth required; simulates unauthenticated traffic hitting the public API.
//
// Usage: BASE_URL=https://quantaex.io k6 run read-heavy.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:8787';
const MARKETS = (__ENV.MARKETS || 'BTC-USDT,ETH-USDT,SOL-USDT,QTA-USDT').split(',');

const readErrorRate = new Rate('read_error_rate');

export const options = {
  scenarios: {
    hammer: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '2m',  target: 100 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
    read_error_rate: ['rate<0.01'],
  },
};

export default function () {
  const market = MARKETS[Math.floor(Math.random() * MARKETS.length)];
  const roll = Math.random();

  let res;
  if (roll < 0.3) {
    res = http.get(`${BASE}/api/markets`, { tags: { endpoint: 'markets_list' } });
  } else if (roll < 0.7) {
    res = http.get(`${BASE}/api/markets/${market}/orderbook`, { tags: { endpoint: 'orderbook' } });
  } else {
    res = http.get(`${BASE}/api/markets/${market}/trades?limit=50`, { tags: { endpoint: 'trades' } });
  }

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'valid JSON': (r) => { try { JSON.parse(r.body); return true; } catch { return false; } },
  });
  readErrorRate.add(!ok);

  sleep(Math.random() * 0.3);
}
