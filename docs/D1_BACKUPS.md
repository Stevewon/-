# D1 → R2 Daily Backups (Sprint 3+ #4)

The `quantaex-cron` Worker runs the daily D1 backup at **03:00 UTC**.

## One-time setup

```bash
# 1. Create the R2 bucket (once per account)
npx wrangler r2 bucket create quantaex-backups

# 2. Deploy the cron worker with the new bindings
cd cron-worker
npx wrangler deploy
```

The R2 binding `BACKUPS` and both cron schedules are already declared in
`cron-worker/wrangler.jsonc`, so `wrangler deploy` is the only thing needed.

## What the backup contains

Each run produces **one gzipped JSONL object** at:

```
r2://quantaex-backups/backups/YYYY-MM-DD/quantaex-<timestamp>.jsonl.gz
```

File structure (one JSON object per line):

```
{ "__meta": true, "created_at": "...", "database": "...", "tables": [...] }
{ "__table": "users",  "id": "...", "email": "...", ... }
{ "__table": "users",  "id": "...", ... }
{ "__table": "wallets","id": "...", ... }
...
```

Skipped tables (e.g., migration not yet applied) are recorded as:

```
{ "__table": "fee_ledger", "__skipped": true, "reason": "no such table" }
```

## Tables included

`users`, `wallets`, `markets`, `coins`, `orders`, `trades`, `deposits`,
`withdrawals`, `withdraw_whitelist`, `login_history`, `price_alerts`,
`notifications`, `email_verifications`, `password_resets`, `fee_tiers`,
`fee_ledger`, `admin_audit_logs`, `system_state`.

## Retention

Objects older than `BACKUP_RETENTION_DAYS` (default **30**) are deleted on the
next cron run. Tune via `cron-worker/wrangler.jsonc` vars.

## Manual trigger

Development endpoints exposed on the Worker:

```
GET https://quantaex-cron.<account>.workers.dev/backup       # force a backup now
GET https://quantaex-cron.<account>.workers.dev/backup/prune # force retention sweep
```

## Restore

Workers cannot restore D1 directly; use `wrangler` from a dev machine:

```bash
# 1. Download a backup
npx wrangler r2 object get quantaex-backups/backups/2026-04-24/quantaex-....jsonl.gz \
  --file=backup.jsonl.gz

# 2. Decompress and split per-table, then replay rows with a small Node script
#    that calls `wrangler d1 execute --remote --command="INSERT INTO ..."` or
#    reads the JSONL and uses the D1 HTTP API.
```

A ready-made restore script is a follow-up task when we first need it.
