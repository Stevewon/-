// ============================================================================
// Company-only TWAP split-sell — cron driver.
// ----------------------------------------------------------------------------
// The heavy lifting (locking treasury balance, inserting the child order,
// running the real matching engine, refunding unfilled lock, updating candles
// and the displayed price) lives on the MAIN server, inside the private
// matchOrder() in src/server/routes/order.ts. The cron worker cannot import
// that function, so instead it POSTs the server's internal endpoint
// `/api/orders/twap-tick` (guarded by the shared TWAP_CRON_SECRET) once per
// tick. The server then finds every due twap_orders row and fires ONE slice
// each, spreading the treasury sell thin so it never crashes the price.
//
// This keeps the matching logic in exactly one place and avoids duplicating
// the order engine in the cron worker.
// ============================================================================

interface TwapEnv {
  APP_URL?: string;
  TWAP_CRON_SECRET?: string;
}

export async function twapTick(env: TwapEnv): Promise<void> {
  const secret = env.TWAP_CRON_SECRET;
  if (!secret) {
    // Not configured yet — nothing to do (fail-safe: no secret ⇒ no slices).
    console.log('[twap] TWAP_CRON_SECRET not set; skipping tick');
    return;
  }

  const base = (env.APP_URL || 'https://quantaex.io').replace(/\/+$/, '');
  const url = `${base}/api/orders/twap-tick`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-twap-secret': secret,
      },
      body: '{}',
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[twap] tick HTTP ${res.status}: ${body.slice(0, 200)}`);
      return;
    }

    const data: any = await res.json().catch(() => ({}));
    if (data?.checked || (data?.executed && data.executed.length)) {
      console.log(
        `[twap] tick ok — checked=${data.checked ?? 0} executed=${(data.executed || []).length}`,
      );
    }
  } catch (e: any) {
    console.warn('[twap] tick failed:', String(e?.message || e).slice(0, 200));
  }
}
