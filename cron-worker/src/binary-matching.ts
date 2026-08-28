// ============================================================================
// binary-matching.ts (cron worker) — process STAKING SUBSCRIPTIONS into binary
// left/right volume and pay tiered matching bonuses in QTA.
// ----------------------------------------------------------------------------
// Runs each tick. Idempotent: each staking position's QTA-USD value is rolled
// into the binary ancestry exactly once (tracked by `binary_counted_at`).
// Matching pays on min(left,right) UNMATCHED volume in $100 units at a tiered
// rate, carrying matched volume over so it is never double-paid.
//
// ⚑ OWNER RULE (2026-08-28): 몸값(self_usd) and binary downline volume come
//   EXCLUSIVELY from STAKING SUBSCRIPTIONS — the exact QTA amount ACTUALLY
//   DEDUCTED when a member subscribes to staking (staking_positions). DEPOSITS
//   (ext_deposits / internal deposits) and USDT->QTA market buys DO NOT count
//   toward self_usd or binary volume at all. Depositing Tether and buying QTA
//   on the exchange is NOT 몸값 — only staking is.
//
//   The subscribe handler (src/server/routes/earn.ts) rolls a new position up
//   synchronously. This cron sweeper is a SAFETY NET that catches any staking
//   position whose synchronous roll-up was missed (legacy rows / transient
//   failure): it scans staking_positions with binary_counted_at IS NULL.
// ============================================================================

interface Env {
  DB: D1Database;
}

// ⚑ OWNER RULE (2026-08-28, FINAL): the Left/Right matching bonus is
//   소실적(weaker leg) × its SINGLE (FLAT) tier rate, paid ONCE — matched volume
//   never re-pays. 소실적 = min(left, right). The ENTIRE 소실적 is priced at the
//   ONE tier its total falls into (NOT a progressive per-slice blend).
//   Owner examples (VERBATIM): 좌$500·우$900 → 소실적 $500 → $500×3% = $15 ;
//   좌$700·우$900 → 소실적 $700 → $700×3% = $21.
//   Option 가) INCREMENTAL: matched_usd tracks 소실적 already paid; when the
//   weaker leg grows we pay only flatBonusUsd(weaker) − flatBonusUsd(matched).
//   Tiers (3%~8%): $100~3%, $1k~4%, $5k~5%, $10k~6%, $50k~7%, $100k~8%.
//   소실적 below $100 pays nothing.
const MATCH_TIERS: Array<{ from: number; rate: number }> = [
  { from: 100,     rate: 0.03 },
  { from: 1_000,   rate: 0.04 },
  { from: 5_000,   rate: 0.05 },
  { from: 10_000,  rate: 0.06 },
  { from: 50_000,  rate: 0.07 },
  { from: 100_000, rate: 0.08 },
];

// FLAT tier rate for a 소실적 amount: the single rate of the highest tier whose
// `from` threshold the amount reaches. Below $100 → 0.
function flatRateOf(amountUsd: number): number {
  let rate = 0;
  for (const tier of MATCH_TIERS) {
    if (amountUsd >= tier.from) rate = tier.rate;
    else break;
  }
  return rate;
}

// FLAT bonus on a cumulative 소실적: entire amount × its single tier rate.
// e.g. $500 → $15 ; $700 → $21 ; $1,200 → $48.
function flatBonusUsd(amountUsd: number): number {
  if (!(amountUsd >= MATCH_TIERS[0].from)) return 0;
  return amountUsd * flatRateOf(amountUsd);
}

// Option 가) incremental payout: bonus for growing 소실적 from `paid` to `total`.
function tieredBonusUsd(paid: number, total: number): number {
  if (!(total > paid)) return 0;
  const delta = flatBonusUsd(total) - flatBonusUsd(paid);
  return delta > 0 ? delta : 0;
}

// EACH downline leg (left AND right, independently) may grow to at most this
// multiple of the user's own STAKING total (self_usd / "몸값"). Owner rule
// (2026-08-28, revised): 2× PER LEG — e.g. 몸값 $1,000 → left up to $2,000 AND
// right up to $2,000 (not $2,000 combined).
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
// Match one user: pay 소실적(min(left,right)) × tier rate on the not-yet-paid
// slice only. matched_usd = cumulative 소실적 already paid (never re-paid).
// --------------------------------------------------------------------------
async function runMatchForUser(env: Env, userId: string, qtaPrice: number): Promise<void> {
  const vol = await env.DB.prepare(
    `SELECT left_usd, right_usd, matched_usd, self_usd FROM binary_volume WHERE user_id = ?`
  ).bind(userId).first<any>();
  if (!vol) return;

  // ⚑ OWNER RULE (2026-08-27): a member earns NOTHING from their downline's
  //   staking unless THEY THEMSELVES have staked. If the member's own value
  //   (self_usd, "몸값") is 0, matching is fully blocked. Volume still
  //   accumulates so it can be matched later once the member stakes.
  const selfUsd = Number(vol.self_usd || 0);
  if (selfUsd <= 0) return; // not staked -> not eligible for any payout

  const left = Number(vol.left_usd || 0);
  const right = Number(vol.right_usd || 0);
  const matched = Number(vol.matched_usd || 0);

  // 소실적 = weaker leg. Pay only the part above what we've already paid.
  const weaker = Math.min(left, right);
  if (weaker <= matched) return;                 // nothing new to match
  if (weaker < MATCH_TIERS[0].from) return;      // below $100 → no tier, no pay

  const bonusUsd = tieredBonusUsd(matched, weaker);
  if (!(bonusUsd > 0)) return;
  const bonusQta = qtaPrice > 0 ? bonusUsd / qtaPrice : 0;

  // Advance matched_usd to the full 소실적 (guards against a racing tick).
  const upd = await env.DB.prepare(
    `UPDATE binary_volume SET matched_usd = ?, updated_at = datetime('now')
      WHERE user_id = ? AND matched_usd = ?`
  ).bind(weaker, userId, matched).run();
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

  const newSlice = weaker - matched;
  const effRate = newSlice > 0 ? bonusUsd / newSlice : 0;
  await env.DB.prepare(
    `INSERT INTO binary_match_bonuses
       (id, user_id, matched_usd, rate, bonus_usd, bonus_qta, qta_price,
        left_total, right_total, matched_total, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))`
  ).bind(
    uuid(), userId, newSlice, effRate, bonusUsd, bonusQta, qtaPrice,
    left, right, weaker,
  ).run();

  console.log(`[binary] matched user=${userId} sosiljeok=${weaker} slice=${newSlice} bonusUsd=${bonusUsd.toFixed(2)} qta=${bonusQta.toFixed(2)}`);
}

// --------------------------------------------------------------------------
// reclaimPending — RETIRED (owner rule 2026-08-28). The 2× 몸값 cap is now a
// HARD ceiling: over-cap volume is DROPPED at roll-up time (see rollUp) instead
// of parked in pending_left/right and later reclaimed. The pending_* columns
// are left in the schema for backward compatibility but are no longer written
// or read by the matching engine. If a future policy re-enables parking, revive
// this function and re-add the reclaimPending() call in rollUp().
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Roll a STAKING subscription's USD up every binary ancestor's correct leg,
// then match. usdValue = USD value of the QTA actually DEDUCTED at subscribe.
// --------------------------------------------------------------------------
async function rollUp(env: Env, memberId: string, usdValue: number, qtaPrice: number): Promise<void> {
  if (!(usdValue > 0)) return;

  // 1) The staker's OWN self value ("몸값") grows by this staking subscription,
  //    raising THEIR downline cap (2x self_usd) so more downline can accumulate.
  await env.DB.prepare(
    `INSERT INTO binary_volume (user_id, left_usd, right_usd, matched_usd, self_usd, updated_at)
     VALUES (?, 0, 0, 0, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       self_usd = self_usd + ?, updated_at = datetime('now')`
  ).bind(memberId, usdValue, usdValue).run();

  // ⚑ OWNER RULE (2026-08-28, replaces the old park/reclaim behaviour):
  //   Over-cap downline volume is NO LONGER parked-and-reclaimed. The 2× 몸값
  //   cap is a HARD ceiling: any volume that would push a parent's downline
  //   over 2×self_usd is simply DROPPED (never counted, never revived). The
  //   member is warned on the stake-entry screen to size their principal so it
  //   fits under the sponsor's remaining headroom. reclaimPending is retired.

  const seen = new Set<string>([memberId]);
  let childId = memberId;
  let depth = 0;

  while (depth < 200) {
    depth++;
    const node = await env.DB.prepare(
      `SELECT binary_parent_id, binary_leg FROM users WHERE id = ?`
    ).bind(childId).first<any>();
    const parentId: string | null = node?.binary_parent_id || null;
    if (!parentId || seen.has(parentId)) break;

    // ⚑ OWNER RULE (2026-08-27): a member's volume rolls up to their parent ONLY
    //   after the SPONSOR has explicitly assigned this member to their Left or
    //   Right leg. While binary_leg is NULL ("미배치"), the sponsor has not yet
    //   chosen a side, so we STOP the roll-up here — nothing is counted or parked
    //   on the parent until the sponsor picks a leg (assignBinaryLeg). This makes
    //   placement 100% sponsor-controlled and one-time.
    const rawLeg = node?.binary_leg;
    if (rawLeg !== 'L' && rawLeg !== 'R') break; // unassigned -> do not roll up
    const leg: 'L' | 'R' = rawLeg;
    seen.add(parentId);

    await env.DB.prepare(
      `INSERT INTO binary_volume (user_id, left_usd, right_usd, matched_usd, self_usd, updated_at)
       VALUES (?, 0, 0, 0, 0, datetime('now'))
       ON CONFLICT(user_id) DO NOTHING`
    ).bind(parentId).run();

    // Enforce the 2× cap as a HARD, PER-LEG ceiling (owner rule 2026-08-28,
    // revised): EACH leg may hold up to 2 × self_usd INDEPENDENTLY — i.e. a
    // parent with 몸값 $1,000 can carry $2,000 on the LEFT and $2,000 on the
    // RIGHT (not $2,000 combined). Volume OVER the incoming leg's own remaining
    // room is DROPPED (no parking, no later reclaim). The other leg's fill does
    // NOT reduce this leg's room. Members are warned on the stake-entry UI.
    const cur = await env.DB.prepare(
      `SELECT left_usd, right_usd, self_usd FROM binary_volume WHERE user_id = ?`
    ).bind(parentId).first<any>();
    const left = Number(cur?.left_usd || 0);
    const right = Number(cur?.right_usd || 0);
    const selfUsd = Number(cur?.self_usd || 0);
    const cap = selfUsd * DOWNLINE_CAP_MULTIPLE;      // per-leg ceiling
    const legUsed = leg === 'R' ? right : left;        // this leg's current volume
    const room = Math.max(0, cap - legUsed);           // room on THIS leg only
    const add = Math.min(usdValue, room);
    const dropped = usdValue - add; // over-leg-cap remainder -> DROPPED (not parked)

    const liveCol = leg === 'R' ? 'right_usd' : 'left_usd';

    if (add > 0) {
      await env.DB.prepare(
        `UPDATE binary_volume SET ${liveCol} = ${liveCol} + ?, updated_at = datetime('now') WHERE user_id = ?`
      ).bind(add, parentId).run();
      await runMatchForUser(env, parentId, qtaPrice);
    }
    if (dropped > 0) {
      console.log(`[binary] over-cap DROPPED user=${parentId} leg=${leg} dropped=${dropped} cap=${cap}`);
    }
    childId = parentId;
  }
}

// --------------------------------------------------------------------------
// Main tick: SAFETY-NET sweep of not-yet-counted STAKING SUBSCRIPTIONS.
// ----------------------------------------------------------------------------
// ⛑ OWNER RULE (2026-08-28): 몸값(self_usd) & binary volume come ONLY from
//   staking subscriptions — NEVER from deposits or USDT->QTA buys. Deposits are
//   therefore NOT scanned here anymore. The subscribe handler rolls each new
//   position up synchronously; this tick only re-processes positions whose
//   binary_counted_at is still NULL (missed / legacy rows).
// --------------------------------------------------------------------------
export async function binaryMatchingTick(env: Env): Promise<{ ok: boolean; processed: number; reason?: string }> {
  let processed = 0;
  const qtaPrice = await priceOf(env, 'QTA');

  // Staking subscriptions not yet rolled into binary volume. We use the exact
  // QTA amount deducted at subscribe (principal_qta) × the QTA price snapshot at
  // stake time (qta_price_at_stake) = the USD value that was actually deducted.
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, user_id, principal_qta, qta_price_at_stake, principal_usd
         FROM staking_positions
        WHERE binary_counted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 50`
    ).all<any>();
    for (const s of results || []) {
      // Claim it first (idempotent): only proceed if WE flipped the marker.
      const claim = await env.DB.prepare(
        `UPDATE staking_positions SET binary_counted_at = datetime('now')
          WHERE id = ? AND binary_counted_at IS NULL`
      ).bind(s.id).run();
      if (!claim?.meta || claim.meta.changes === 0) continue;

      // 몸값 = the exact QTA deducted at subscribe, valued in USD at stake time.
      const qtaDeducted = Number(s.principal_qta || 0);
      const pxAtStake = Number(s.qta_price_at_stake || 0);
      let usd = qtaDeducted > 0 && pxAtStake > 0 ? qtaDeducted * pxAtStake : 0;
      // Fallback to the stored principal_usd if the QTA/price columns are absent.
      if (!(usd > 0)) usd = Number(s.principal_usd || 0);
      if (!(usd > 0)) continue;

      await rollUp(env, s.user_id, usd, qtaPrice);
      processed++;
    }
  } catch (e) {
    // staking_positions.binary_counted_at may not exist yet (pre-0052).
    return { ok: false, processed, reason: String((e as any)?.message || e).slice(0, 200) };
  }

  return { ok: true, processed };
}
