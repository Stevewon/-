// ============================================================================
// binary-matching.ts (cron worker) — process credited deposits into binary
// left/right volume and pay tiered matching bonuses in QTA.
// ----------------------------------------------------------------------------
// Runs each tick. Idempotent: each deposit's USD value is rolled into the
// binary ancestry exactly once (tracked by `binary_counted_at`). Matching pays
// on min(left,right) UNMATCHED volume in $100 units at a tiered rate, carrying
// matched volume over so it is never double-paid.
//
// Volume source (owner rule): DEPOSIT amount (USD value at credit time). We
// count BOTH real on-chain deposits (`ext_deposits`, status credited/swept)
// and completed internal `deposits` rows.
// ============================================================================

interface Env {
  DB: D1Database;
}

// Bonus tiers from the owner's table.
function matchBonusRate(matchedUsd: number): number {
  if (matchedUsd >= 100_000) return 0.07;
  if (matchedUsd >= 50_000) return 0.06;
  if (matchedUsd >= 10_000) return 0.05;
  if (matchedUsd >= 5_000) return 0.04;
  if (matchedUsd >= 1_000) return 0.03;
  if (matchedUsd >= 100) return 0.02;
  return 0;
}

const MATCH_UNIT_USD = 100;

// Downline (left+right) may grow to at most this multiple of the user's own
// deposit total (self_usd / "몸값"). Owner rule (2026-08-26): 2x.
const DOWNLINE_CAP_MULTIPLE = 2;

function uuid(): string {
  return (globalThis as any).crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

async function priceOf(env: Env, symbol: string): Promise<number> {
  try {
    const row = await env.DB.prepare(`SELECT price_usd FROM coins WHERE symbol = ?`)
      .bind(symbol).first<any>();
    const p = Number(row?.price_usd || 0);
    if (p > 0) return p;
  } catch { /* ignore */ }
  if (symbol === 'USDT' || symbol === 'USDC') return 1;
  if (symbol === 'QTA') return 0.00357142857;
  return 0;
}

// --------------------------------------------------------------------------
// Match one user: min(left,right) unmatched, $100 units, tiered QTA payout.
// --------------------------------------------------------------------------
async function runMatchForUser(env: Env, userId: string, qtaPrice: number): Promise<void> {
  const vol = await env.DB.prepare(
    `SELECT left_usd, right_usd, matched_usd, self_usd FROM binary_volume WHERE user_id = ?`
  ).bind(userId).first<any>();
  if (!vol) return;

  // ⚑ OWNER RULE (2026-08-27): a member earns NOTHING from their downline's
  //   staking/deposits unless THEY THEMSELVES have staked/deposited. If the
  //   member's own value (self_usd, "몸값") is 0, matching is fully blocked —
  //   no bonus, no dividend, not a single unit. Volume still accumulates so it
  //   can be matched later once the member stakes; it is simply not paid now.
  const selfUsd = Number(vol.self_usd || 0);
  if (selfUsd <= 0) return; // not staked -> not eligible for any payout

  const left = Number(vol.left_usd || 0);
  const right = Number(vol.right_usd || 0);
  const matched = Number(vol.matched_usd || 0);

  const pairable = Math.min(left, right) - matched;
  if (pairable < MATCH_UNIT_USD) return;

  const newMatchUsd = Math.floor(pairable / MATCH_UNIT_USD) * MATCH_UNIT_USD;
  if (newMatchUsd < MATCH_UNIT_USD) return;

  const rate = matchBonusRate(newMatchUsd);
  if (rate <= 0) return;

  const bonusUsd = newMatchUsd * rate;
  const bonusQta = qtaPrice > 0 ? bonusUsd / qtaPrice : 0;
  const newMatchedTotal = matched + newMatchUsd;

  // Advance carry-over first (guards against a racing tick double-paying).
  const upd = await env.DB.prepare(
    `UPDATE binary_volume SET matched_usd = ?, updated_at = datetime('now')
      WHERE user_id = ? AND matched_usd = ?`
  ).bind(newMatchedTotal, userId, matched).run();
  if (!upd?.meta || upd.meta.changes === 0) return;

  try {
    await env.DB.prepare(
      `INSERT INTO wallets (id, user_id, coin_symbol, available, locked)
       VALUES (?, ?, 'QTA', 0, 0)
       ON CONFLICT(user_id, coin_symbol) DO NOTHING`
    ).bind(uuid(), userId).run();
  } catch { /* ignore */ }
  await env.DB.prepare(
    `UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = 'QTA'`
  ).bind(bonusQta, userId).run();

  await env.DB.prepare(
    `INSERT INTO binary_match_bonuses
       (id, user_id, matched_usd, rate, bonus_usd, bonus_qta, qta_price,
        left_total, right_total, matched_total, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))`
  ).bind(
    uuid(), userId, newMatchUsd, rate, bonusUsd, bonusQta, qtaPrice,
    left, right, newMatchedTotal,
  ).run();

  console.log(`[binary] matched user=${userId} usd=${newMatchUsd} rate=${rate} qta=${bonusQta.toFixed(2)}`);
}

// --------------------------------------------------------------------------
// Reclaim parked (over-cap) volume once an ancestor's own 몸값 (self_usd) rose.
// ----------------------------------------------------------------------------
// ⚑ OWNER RULE (2026-08-27): "상부 몸값이 상승하면 재계산이 당연히 되는게 맞지!"
//   When a member stakes/deposits, their downline cap (2 × self_usd) rises.
//   Any volume that was previously parked in pending_left/right (because it
//   exceeded the cap at the time — e.g. the upline hadn't staked yet) is pulled
//   back into the live left_usd / right_usd up to the new cap, and matching is
//   re-run. This makes matching independent of deposit/stake ORDER. Volume is
//   NEVER dropped anymore — only parked until there is cap room for it.
// --------------------------------------------------------------------------
async function reclaimPending(env: Env, userId: string, qtaPrice: number): Promise<void> {
  const cur = await env.DB.prepare(
    `SELECT left_usd, right_usd, self_usd, pending_left_usd, pending_right_usd
       FROM binary_volume WHERE user_id = ?`
  ).bind(userId).first<any>();
  if (!cur) return;

  let left = Number(cur.left_usd || 0);
  let right = Number(cur.right_usd || 0);
  const selfUsd = Number(cur.self_usd || 0);
  let pendLeft = Number(cur.pending_left_usd || 0);
  let pendRight = Number(cur.pending_right_usd || 0);
  if (pendLeft <= 0 && pendRight <= 0) return;

  const cap = selfUsd * DOWNLINE_CAP_MULTIPLE;
  const room = Math.max(0, cap - (left + right));
  if (room <= 0) return;

  // Fill from both parked legs proportionally to the room available, keeping
  // the total live downline within the cap. Left is filled first, then Right;
  // order does not change totals (both go to the same live cap room).
  let takeLeft = Math.min(pendLeft, room);
  let remaining = room - takeLeft;
  let takeRight = Math.min(pendRight, Math.max(0, remaining));

  if (takeLeft <= 0 && takeRight <= 0) return;

  left += takeLeft;
  right += takeRight;
  pendLeft -= takeLeft;
  pendRight -= takeRight;

  await env.DB.prepare(
    `UPDATE binary_volume
        SET left_usd = ?, right_usd = ?,
            pending_left_usd = ?, pending_right_usd = ?,
            updated_at = datetime('now')
      WHERE user_id = ?`
  ).bind(left, right, pendLeft, pendRight, userId).run();

  await runMatchForUser(env, userId, qtaPrice);
}

// --------------------------------------------------------------------------
// Roll a deposit's USD up every binary ancestor's correct leg, then match.
// --------------------------------------------------------------------------
async function rollUp(env: Env, memberId: string, usdValue: number, qtaPrice: number): Promise<void> {
  if (!(usdValue > 0)) return;

  // 1) The depositor's OWN self value ("몸값") grows by this deposit, raising
  //    THEIR downline cap (2x self_usd) so more downline can accumulate.
  await env.DB.prepare(
    `INSERT INTO binary_volume (user_id, left_usd, right_usd, matched_usd, self_usd, updated_at)
     VALUES (?, 0, 0, 0, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       self_usd = self_usd + ?, updated_at = datetime('now')`
  ).bind(memberId, usdValue, usdValue).run();

  // The depositor just raised their OWN 몸값 -> their cap rose. Pull back any
  // downline volume that was parked (pending) while their cap was too small,
  // and re-run matching. This is the ORDER-INDEPENDENCE fix.
  await reclaimPending(env, memberId, qtaPrice);

  const seen = new Set<string>([memberId]);
  let childId = memberId;
  let depth = 0;

  while (depth < 200) {
    depth++;
    const node = await env.DB.prepare(
      `SELECT binary_parent_id, binary_leg FROM users WHERE id = ?`
    ).bind(childId).first<any>();
    const parentId: string | null = node?.binary_parent_id || null;
    const leg = node?.binary_leg === 'R' ? 'R' : 'L';
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);

    await env.DB.prepare(
      `INSERT INTO binary_volume (user_id, left_usd, right_usd, matched_usd, self_usd, updated_at)
       VALUES (?, 0, 0, 0, 0, datetime('now'))
       ON CONFLICT(user_id) DO NOTHING`
    ).bind(parentId).run();

    // Enforce the 2x cap: the parent's downline (left+right) may not exceed
    // 2 * self_usd. Volume OVER the cap is NOT dropped anymore — it is parked in
    // pending_left/right and reclaimed later once the parent raises their 몸값
    // (see reclaimPending). Volume is never lost, matching is order-independent.
    const cur = await env.DB.prepare(
      `SELECT left_usd, right_usd, self_usd FROM binary_volume WHERE user_id = ?`
    ).bind(parentId).first<any>();
    const left = Number(cur?.left_usd || 0);
    const right = Number(cur?.right_usd || 0);
    const selfUsd = Number(cur?.self_usd || 0);
    const cap = selfUsd * DOWNLINE_CAP_MULTIPLE;
    const room = Math.max(0, cap - (left + right));
    const add = Math.min(usdValue, room);
    const park = usdValue - add; // over-cap remainder -> park, don't drop

    const liveCol = leg === 'R' ? 'right_usd' : 'left_usd';
    const pendCol = leg === 'R' ? 'pending_right_usd' : 'pending_left_usd';

    if (add > 0) {
      await env.DB.prepare(
        `UPDATE binary_volume SET ${liveCol} = ${liveCol} + ?, updated_at = datetime('now') WHERE user_id = ?`
      ).bind(add, parentId).run();
    }
    if (park > 0) {
      await env.DB.prepare(
        `UPDATE binary_volume SET ${pendCol} = ${pendCol} + ?, updated_at = datetime('now') WHERE user_id = ?`
      ).bind(park, parentId).run();
    }
    if (add > 0) {
      await runMatchForUser(env, parentId, qtaPrice);
    }
    childId = parentId;
  }
}

// --------------------------------------------------------------------------
// Main tick: process not-yet-counted credited deposits (ext + internal).
// --------------------------------------------------------------------------
export async function binaryMatchingTick(env: Env): Promise<{ ok: boolean; processed: number; reason?: string }> {
  let processed = 0;
  const qtaPrice = await priceOf(env, 'QTA');

  // (1) External on-chain deposits: credited or swept, not yet counted.
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, user_id, coin_symbol, amount
         FROM ext_deposits
        WHERE status IN ('credited','swept') AND binary_counted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 50`
    ).all<any>();
    for (const d of results || []) {
      // Claim it first (idempotent): only proceed if WE flipped the marker.
      const claim = await env.DB.prepare(
        `UPDATE ext_deposits SET binary_counted_at = datetime('now')
          WHERE id = ? AND binary_counted_at IS NULL`
      ).bind(d.id).run();
      if (!claim?.meta || claim.meta.changes === 0) continue;

      const px = await priceOf(env, String(d.coin_symbol || 'USDT').toUpperCase());
      const usd = Number(d.amount || 0) * px;
      await rollUp(env, d.user_id, usd, qtaPrice);
      processed++;
    }
  } catch (e) {
    // ext_deposits or binary tables may not exist on very old DBs.
    return { ok: false, processed, reason: String((e as any)?.message || e).slice(0, 200) };
  }

  // (2) Internal completed deposits, not yet counted. Skip admin-* tx (QA /
  //     compensation credits) so only genuine user deposits count.
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, user_id, coin_symbol, amount, tx_hash
         FROM deposits
        WHERE status = 'completed' AND binary_counted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 50`
    ).all<any>();
    for (const d of results || []) {
      const claim = await env.DB.prepare(
        `UPDATE deposits SET binary_counted_at = datetime('now')
          WHERE id = ? AND binary_counted_at IS NULL`
      ).bind(d.id).run();
      if (!claim?.meta || claim.meta.changes === 0) continue;

      // Exclude admin/compensation credits from binary volume.
      if (String(d.tx_hash || '').startsWith('admin-')) continue;

      const px = await priceOf(env, String(d.coin_symbol || 'USDT').toUpperCase());
      const usd = Number(d.amount || 0) * px;
      await rollUp(env, d.user_id, usd, qtaPrice);
      processed++;
    }
  } catch {
    // deposits.binary_counted_at may not exist yet (pre-0048); ignore softly.
  }

  return { ok: true, processed };
}
