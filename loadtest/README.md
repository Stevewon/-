# QuantaEx Load Testing

k6-based load tests for the order matching engine. Measures throughput, latency,
and correctness of the Cloudflare Pages + D1 stack under concurrent load.

## Prerequisites

```bash
# macOS
brew install k6

# Linux
sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install k6

# Docker
docker pull grafana/k6
```

## Scenarios

### 1. `smoke.js` — health check
Fires 10 req/s at `/api/health`, `/api/markets` for 30 s.
Use to verify the target is up before running heavy tests.

```bash
BASE_URL=https://quantaex.io k6 run smoke.js
```

### 2. `order-matching.js` — full order lifecycle
Simulates concurrent users placing limit buy/sell orders that match each other.
Uses pre-created test accounts (see **Setup** below).
Reports **TPS (orders/s)**, **p95 latency**, and **matched trade rate**.

```bash
BASE_URL=https://quantaex.io \
  TEST_USERS_FILE=./users.json \
  k6 run order-matching.js
```

Default profile: ramps 0 → 50 VUs over 30 s, holds for 2 min, ramps down.
Pass-fail thresholds baked in:
- `http_req_duration{endpoint:place_order} p(95) < 1500ms`
- `order_place_failure_rate < 1%`

### 3. `read-heavy.js` — orderbook/markets read load
100 VUs hammering `/api/markets`, `/api/markets/:symbol/orderbook`,
`/api/markets/:symbol/trades`. Tests CDN + D1 read replica behavior.

```bash
BASE_URL=https://quantaex.io k6 run read-heavy.js
```

### 4. `chaos.js` — adverse conditions
Injects scenarios that exercise failure paths:
- Insufficient-balance rejections
- Invalid-signature / expired-JWT
- Rapid-fire order cancels (race with matching engine)
- POST_ONLY rejections against live orderbook
- FOK rejections

Primarily a correctness test — confirms the exchange returns proper error codes
under stress, never double-spends, and never leaves stuck 'pending' orders.

```bash
BASE_URL=https://quantaex.io \
  TEST_USERS_FILE=./users.json \
  k6 run chaos.js
```

## Setup: provisioning test accounts

Create N test users, give them seed balances on TESTNET ONLY, export to JSON:

```bash
# Against local dev DB
node scripts/provision-test-users.js --count 20 --output ./users.json

# Format of users.json:
# [{ "email": "load-00@test.quantaex.io", "password": "...", "jwt": "...", "userId": "..." }]
```

Seed wallet balances for matching tests (via admin manual-deposit endpoint):

```bash
ADMIN_JWT=$ADMIN_JWT node scripts/seed-test-balances.js \
  --users ./users.json --base BTC --quote USDT --amount 10
```

## Reading results

k6 prints a summary table at the end:

```
http_req_duration..............: avg=145ms  p(95)=820ms  p(99)=1.3s
http_reqs......................: 12450    62.1/s
order_place_success_rate.......: 99.20%
order_matched_rate.............: 68.3%
iterations.....................: 6225     31.0/s
```

Key metrics:
- **`http_reqs` rate/s** — overall request throughput
- **`iterations/s`** — completed user journeys (place → match → verify)
- **`p(95)` latency** — 95th percentile response time; <1.5 s is the SLO
- **`order_matched_rate`** — how many orders found a counterparty; <20% means
  spread is too wide or orderbook is starved

## Recommended targets

| Phase | VUs | Duration | Goal |
|-------|-----|----------|------|
| Baseline | 10 | 2 min | Confirm basic functionality, establish latency floor |
| Sustained | 50 | 10 min | Normal production load |
| Spike | 200 | 1 min | Handle 4× sudden burst |
| Soak | 30 | 60 min | Detect memory leaks, D1 connection exhaustion |

## Interpreting D1 limits

Cloudflare D1 current limits (2026-04):
- **Writes/s per DB**: ~1,000 sustained
- **Reads/s per DB**: ~5,000 sustained
- **Max concurrent connections**: 6 per Worker instance

If `http_req_duration` p95 climbs above 2 s **and** `error_rate` spikes,
you've likely hit the write throughput ceiling. Options:
1. Batch orderbook updates in the matching engine
2. Move hot reads (orderbook, recent trades) to KV with TTL
3. Shard by market_id (one D1 per market)

## Ethical use

- **NEVER** run against production without stakeholder approval
- Always use test accounts with zero real value
- Rate-limit yourself; Cloudflare will 429 you if you exceed 1200 req/min from a single IP
- For production capacity planning, prefer Cloudflare's load-test endpoints or a
  dedicated staging environment (`quantaex-staging.pages.dev`)
