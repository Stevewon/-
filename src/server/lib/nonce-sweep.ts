/**
 * Nonce sweep — Sprint 5 Phase D3-α.
 *
 * `api_key_nonces` is an append-only replay-defense ledger. Every signed
 * external-trading API request inserts one row, keyed by (api_key_id, nonce).
 * The skew window is bounded (default ±60s, max 600s) so any nonce older than
 * that window can never replay successfully — the timestamp check rejects it
 * before nonce lookup. We therefore can prune rows older than 24h with zero
 * impact on replay protection, while keeping the table compact (D1 storage
 * cost + index size).
 *
 * Trigger: Cloudflare Workers cron `*\/15 * * * *` (every 15 minutes).
 *
 * Failure mode: if the table is missing or D1 is unavailable, sweep is a
 * no-op. Cron retries automatically on next tick.
 */

import type { Env } from '../index';

/** Retention horizon, seconds (24 hours). */
const RETENTION_SEC = 24 * 3600;

/** Max rows deleted per sweep — keeps the cron tick fast on backlog. */
const SWEEP_BATCH_LIMIT = 5000;

export interface NonceSweepResult {
  ok: boolean;
  cutoff_ts: number;
  deleted: number;
  duration_ms: number;
  error?: string;
}

/**
 * Delete `api_key_nonces` rows whose `ts` is older than now - 24h.
 * Also writes a `system_markers` row `last_nonce_sweep_at` so the admin
 * dashboard can surface the cron's freshness.
 */
export async function sweepExpiredNonces(env: Env): Promise<NonceSweepResult> {
  const t0 = Date.now();
  const cutoff = Math.floor(Date.now() / 1000) - RETENTION_SEC;

  try {
    const res = await env.DB.prepare(
      `DELETE FROM api_key_nonces
        WHERE rowid IN (
          SELECT rowid FROM api_key_nonces WHERE ts < ? LIMIT ?
        )`,
    )
      .bind(cutoff, SWEEP_BATCH_LIMIT)
      .run();

    const deleted = Number((res as any)?.meta?.changes ?? 0);

    // Best-effort marker update for ops visibility. Errors swallowed —
    // the sweep itself succeeded.
    try {
      await env.DB.prepare(
        `INSERT INTO system_markers (key, value, updated_at)
         VALUES ('last_nonce_sweep_at', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(String(deleted)).run();
    } catch { /* marker write is optional */ }

    return {
      ok: true,
      cutoff_ts: cutoff,
      deleted,
      duration_ms: Date.now() - t0,
    };
  } catch (e: any) {
    return {
      ok: false,
      cutoff_ts: cutoff,
      deleted: 0,
      duration_ms: Date.now() - t0,
      error: String(e?.message || e),
    };
  }
}
