# QuantaEX Load Tests

k6-based load tests for the QuantaEX API. Three independent scenarios cover the
hottest paths: read traffic (orderbook polling), order placement throughput, and
the full user journey (login → query → order → cancel).

## Prerequisites

```bash
# Install k6 (one-time)
# macOS:    brew install k6
# Linux:    https://k6.io/docs/get-started/installation/
# Windows:  choco install k6
k6 version
```

## Targets

By default tests hit `https://quantaex.io`. Override with the `BASE_URL` env var
to run against staging or local:

```bash
export BASE_URL=https://staging.quantaex.io
# or for the local Pages dev server (npm run dev:pages):
export BASE_URL=http://localhost:3000
```

## Pre-flight: seed test users

The scenarios below require `LOAD_USERS` test accounts to exist. Run the seed
script once against the target environment (idempotent — it skips users that
already exist):

```bash
# Creates loadtest+0001@quantaex.io ... loadtest+NNNN@quantaex.io
# password: Loadtest!1234
node loadtest/seed-users.mjs --base=$BASE_URL --count=200
```

## Scenarios

### 1. `read.js` — orderbook & market read traffic

Pure GETs against unauthenticated public endpoints. Emulates a user staring at
the trade page (orderbook, recent trades, ticker) at 1 Hz.

```bash
k6 run loadtest/read.js \
  -e BASE_URL=$BASE_URL \
  --vus 200 --duration 2m
```

**Pass criteria** (defined in the script `thresholds`):
- `http_req_failed` < 1%
- `http_req_duration{p(95)}` < 800 ms
- `http_req_duration{p(99)}` < 1500 ms

### 2. `match.js` — matching engine TPS

Authenticated VUs each place a randomized limit order in `BTC-USDT` once per
iteration. Sell prices ±0.5% above/below mid so most orders match. Measures
server-side time to insert + match + reply.

```bash
k6 run loadtest/match.js \
  -e BASE_URL=$BASE_URL \
  -e LOAD_USERS=200 \
  --vus 50 --duration 2m
```

**Pass criteria**:
- `http_req_failed` < 2% (some "insufficient balance" expected as wallets drain)
- `match_latency{p(95)}` < 1500 ms
- successful match rate > 95% of placed orders

### 3. `journey.js` — end-to-end user flow

Login → fetch wallets → fetch orderbook → place limit order → cancel. Closer to
real user behavior. Used to detect interaction effects (rate limits, JWT
contention, etc.).

```bash
k6 run loadtest/journey.js \
  -e BASE_URL=$BASE_URL \
  -e LOAD_USERS=200 \
  --vus 100 --duration 5m
```

## Smoke (CI)

A 30-second sanity check used as a gate before bigger runs:

```bash
k6 run loadtest/read.js -e BASE_URL=$BASE_URL --vus 5 --duration 30s
```

## Reading the output

k6 prints aggregate metrics and threshold pass/fail at the end. Key fields:

- `http_reqs` — total requests, rate per second
- `http_req_duration` — server-side latency (p50/p90/p95/p99)
- `iterations` — completed VU loops; with one order per loop in `match.js`
  this is roughly your sustained order TPS
- `checks` — domain-level assertions (e.g. response had `order.id`)

## Cloudflare considerations

- **Worker CPU limit**: D1-backed routes can hit the 50 ms CPU limit under a
  burst. Watch for `1102` errors in the stderr output — they show up as 5xx
  with body `Worker exceeded resource limits`.
- **Rate limits**: `auth.ts` rate-limits login at 10/5min/IP. Run `seed-users`
  with --use-token-cache so VUs reuse JWTs and avoid blowing the limit.
- **D1 contention**: heavy concurrent writes to the same row (e.g. wallets)
  serialize. The matching engine already addresses this with locked balance
  per-user, but batch DB writes will queue. Don't be surprised by p99 spikes
  on `match.js`.

## Reporting

Output a JSON summary for tracking trends:

```bash
k6 run loadtest/match.js \
  -e BASE_URL=$BASE_URL \
  --vus 50 --duration 2m \
  --summary-export=loadtest/results/match-$(date +%Y%m%d-%H%M).json
```
