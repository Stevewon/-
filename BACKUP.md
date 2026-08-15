# QuantaEX — Backup & Restore Runbook

Backup strategy for the production Cloudflare D1 database
(`quantaex-production`, id `5eb4f183-1dfc-4310-8872-07b014078dbc`).

There are **two** backup paths. Use both.

---

## 1. Full logical backup — `wrangler d1 export` (PRIMARY)

The authoritative, consistent, restorable backup. Run from a machine that
has a Cloudflare API token with D1 access.

```bash
# One-off full export (schema + data) to a timestamped SQL file:
wrangler d1 export quantaex-production --remote \
  --output "quantaex_backup_$(date +%F).sql"

# Schema only:
wrangler d1 export quantaex-production --remote --no-data \
  --output "quantaex_schema_$(date +%F).sql"

# Data only:
wrangler d1 export quantaex-production --remote --no-schema \
  --output "quantaex_data_$(date +%F).sql"
```

**Restore** (into a fresh/replacement D1) is the reverse:

```bash
wrangler d1 execute quantaex-production --remote \
  --file "quantaex_backup_2026-08-15.sql"
```

### Recommended cadence
| Phase | Frequency |
|-------|-----------|
| Soft-launch (internal balances only) | **Weekly** |
| After real deposits/withdrawals enabled | **Daily** |
| Before any migration / schema change | **Always, immediately before** |

Store the `.sql` files off-platform (e.g. private object storage or an
encrypted archive). Do **not** commit them to git — they contain user data.

---

## 2. On-demand admin snapshot — `GET /api/admin/db-export` (SECONDARY)

A convenience JSON snapshot of the core tables, downloadable from the admin
panel (or via an authenticated admin token). Good for a quick manual
safety-net before a risky operation; **not** a substitute for the full
`wrangler d1 export`.

```bash
# With an admin JWT:
curl -H "Authorization: Bearer <ADMIN_JWT>" \
  https://quantaex.io/api/admin/db-export \
  -o "quantaex_snapshot_$(date +%F).json"
```

Notes:
- Whitelisted core tables only, capped at 5000 rows/table.
- `users.password` hashes are **redacted** from the snapshot.
- Every export is written to `admin_audit_logs`.

---

## 3. Code / config rollback

- **App code**: every deploy is a git commit on `main` + a Cloudflare Pages
  deployment. Roll back by reverting the commit (redeploys automatically) or
  by promoting a previous Pages deployment in the Cloudflare dashboard.
- **Migrations**: applied via idempotent self-bootstrap blocks in
  `src/server/index.ts`, gated by `system_markers` rows. Re-running is safe.
- **Secrets/env** (`JWT_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET`, …) live
  in the Cloudflare Pages dashboard, **not** in git. Keep an encrypted copy of
  their values somewhere safe so the project can be re-created.

---

## 4. Pre-open checklist

- [ ] Take a full `wrangler d1 export` and verify the file is non-empty.
- [ ] Confirm the export can be re-imported into a scratch D1.
- [ ] Record the backup location + date in ops notes.
- [ ] Schedule the recurring export job (weekly → daily post-launch).
