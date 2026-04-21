# Price Alert Cron — Setup Options

Cloudflare **Pages Functions** (which hosts the main QuantaEX API) does **not**
support Cron Triggers — those are Workers-only. This doc lists three ways to
schedule the periodic price-alert check. Pick one based on the permissions you
already have.

## TL;DR

The app exposes `POST /api/admin/run-price-alert-check` (admin-authenticated)
that:
1. Loads all active `price_alerts` where `triggered_at IS NULL`.
2. Compares each against current `coins.price_usd`.
3. For hits: inserts a notification + flips `is_active=0, triggered_at=NOW`.

You just need **something** to call that endpoint on a schedule.

---

## Option A — GitHub Actions (easiest, no extra Cloudflare permissions)

Copy `docs/price-alert-cron.yml.template` to `.github/workflows/price-alert-cron.yml`,
then add the secret:

```bash
# From your local clone (needs a Personal Access Token with 'workflow' scope)
mkdir -p .github/workflows
cp docs/price-alert-cron.yml.template .github/workflows/price-alert-cron.yml
git add .github/workflows/price-alert-cron.yml
git commit -m "ci: add price-alert cron workflow"
git push
```

Then on GitHub:
1. Repo → **Settings** → **Secrets and variables** → **Actions** → **New secret**
2. Name: `ADMIN_PASSWORD`   Value: `admin1234` (or whatever you changed it to)
3. (Optional) `ADMIN_EMAIL` if not `admin@quantaex.io`
4. (Optional) `API_BASE`    if not `https://quantaex.io`

The workflow runs every 5 minutes automatically once merged to `main`. You can
also trigger it manually: **Actions** → **Price Alert Cron** → **Run workflow**.

**Caveats**: GitHub's free cron tier runs with up to 10 min delay and may skip
during high platform load. Good enough for non-critical alerts; use Option B
if you need strict timing.

## Option B — Dedicated Cloudflare Worker (most reliable)

Code is already in `cron-worker/`. Requires an API token with these permissions:

- **Account** → **Workers Scripts** → Edit
- **Account** → **D1** → Edit
- **Account** → **Account Settings** → Read

```bash
cd cron-worker
npm install
CLOUDFLARE_API_TOKEN=<token with Workers Scripts Edit> npx wrangler deploy
```

First deploy creates the `quantaex-cron` Worker, binds D1, and activates
`*/5 * * * *`. Change the schedule in `cron-worker/wrangler.jsonc` as needed.

Test: `curl https://quantaex-cron.<account>.workers.dev/run`

## Option C — External uptime / cron service

Any service that can hit an HTTP endpoint with a Bearer token on schedule:
cron-job.org, UptimeRobot, EasyCron, etc.

1. Log in as admin, grab the long-lived token (or implement a service account)
2. Configure the service to POST to `https://quantaex.io/api/admin/run-price-alert-check`
   with header `Authorization: Bearer <token>`
3. Set schedule to every 5 minutes.

**Note**: JWT tokens expire; you'll need to refresh periodically or add a
long-lived admin API key (feature not yet implemented).

---

## Manual trigger (from anywhere)

- **Admin UI**: Admin Dashboard → header → **Run Price Alert Check** button
- **API**: `POST /api/admin/run-price-alert-check` (admin Bearer token)
- Response: `{ "checked": N, "triggered": M }`
