# QuantaEX Cron Worker

Standalone Cloudflare Worker that runs every 5 minutes to evaluate active
price alerts against the latest coin prices stored in the shared D1 database.

## Why a separate Worker?

Cloudflare **Pages Functions** (how the main `quantaex` app is deployed) do
**not** support Cron Triggers — those are a Workers-only feature. This
companion Worker binds to the same D1 database (`quantaex-production`) and
writes directly into the `notifications` table, so end‑users receive alerts
through the regular notifications pipeline.

## Schedule

Configured in `wrangler.jsonc`:

```jsonc
"triggers": { "crons": ["*/5 * * * *"] }
```

Change the cron expression to tune frequency (minimum: once per minute on
the Workers Paid plan; otherwise the minimum is once every 2 minutes on the
Free plan — `*/5` is a safe default).

## What it does

1. Selects up to 500 `price_alerts` where `is_active = 1 AND triggered_at IS NULL`.
2. Reads current `coins.price_usd` for all active coins.
3. For each alert whose direction is satisfied (`above` / `below`), inserts a
   `notifications` row with `type = 'price_alert'` and flips the alert to
   `triggered_at = <now>, is_active = 0`.
4. All writes are performed via D1 `batch()` in chunks of 30 statements for
   atomicity and throughput.

## Deploy

```bash
cd cron-worker
npm install
CLOUDFLARE_API_TOKEN=<token> npx wrangler deploy
```

On first deploy Cloudflare will create the Worker `quantaex-cron`, attach
the D1 binding, and activate the cron schedule.

## Manual trigger

- **HTTP**: `curl https://quantaex-cron.<account>.workers.dev/run` → runs the
  check immediately and returns `{ checked, triggered }`.
- **From the admin app**: `POST /api/admin/run-price-alert-check`
  (same logic, requires admin JWT).

## Local testing

```bash
cd cron-worker
npx wrangler dev --test-scheduled
# In another terminal:
curl "http://localhost:8787/__scheduled?cron=*%2F5+*+*+*+*"
```

## Cost

Free plan: 3M Worker invocations + 100k D1 reads / day. With 500 alerts
checked every 5 minutes = 288 × 501 = ~144k reads/day + ~288 writes/day.
Well within the free tier.
