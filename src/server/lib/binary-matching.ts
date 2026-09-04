// ============================================================================
// binary-matching.ts — BINARY TREE PLACEMENT (web-server side).
// ----------------------------------------------------------------------------
// ⚠️  SCOPE NOTE (read before editing):
//   This module ONLY handles PLACEMENT — attaching a new member under their
//   sponsor's lighter leg at signup (placeInBinaryTree, called from auth.ts).
//
//   The LIVE matching-bonus engine (deposit roll-up + min(left,right) matching
//   + QTA payout) lives in **cron-worker/src/binary-matching.ts** and runs on
//   the scheduled cron tick (binaryMatchingTick). Do NOT re-implement roll-up /
//   match logic here — it caused a duplicate/dead-code confusion before.
//
// Policy (owner, 2026-08-27 — MANUAL sponsor-chosen placement):
//   • At signup we ONLY attach the new member to their sponsor
//     (binary_parent_id). We DO NOT auto-pick a leg. binary_leg stays NULL
//     ("미배치") until the SPONSOR themselves chooses Left or Right — exactly
//     ONCE, irreversibly — from their dashboard (see assignBinaryLeg).
//   • A member's VOLUME only rolls up once their leg is assigned (NULL leg =>
//     not yet counted). See cron-worker/src/binary-matching.ts.
//   • Downline (left+right) may grow to at most 2x the user's own deposit
//     total (self_usd / "몸값"). Enforced on roll-up in the cron worker.
// ============================================================================

// ---------------------------------------------------------------------------
// PLACEMENT (signup) — attach a new user UNDER their sponsor, leg UNASSIGNED.
// The sponsor is the direct referrer (matched by ref_code at signup). We set
// binary_parent_id but leave binary_leg = NULL so the sponsor can later choose
// the side (once). Never blocks signup.
// ---------------------------------------------------------------------------
// The downline (left+right) can grow to at most this multiple of the user's
// own deposit total (self_usd / "몸값"). Owner rule (2026-08-26): 2x.
export const DOWNLINE_CAP_MULTIPLE = 2;

export async function placeInBinaryTree(
  db: any,
  newUserId: string,
  sponsorId: string,
): Promise<{ leg: 'L' | 'R' | null; capped: boolean; self_usd: number; downline_usd: number }> {
  if (!sponsorId || sponsorId === newUserId) {
    return { leg: null, capped: false, self_usd: 0, downline_usd: 0 };
  }

  // Read the sponsor's volume + own 몸값. Volume is UNLIMITED now; the 2× cap
  // applies only to the TOTAL match bonus (owner rule 2026-09-04).
  let selfUsd = 0;
  let downlineUsd = 0;
  let left = 0;
  let right = 0;
  try {
    const vol = await db.prepare(
      `SELECT left_usd, right_usd, self_usd FROM binary_volume WHERE user_id = ?`
    ).bind(sponsorId).first();
    left = Number(vol?.left_usd || 0);
    right = Number(vol?.right_usd || 0);
    selfUsd = Number(vol?.self_usd || 0);
    downlineUsd = left + right;
  } catch { /* volume table might be empty */ }

  // ★ OWNER RULE (2026-09-04): leg volume is NOT capped, so placement is never
  //   blocked by volume. "capped" now means the sponsor has already received
  //   their LIFETIME match ceiling (2× 몸값) — informational only; the sponsor
  //   can still place downline (their volume keeps growing, they just won't earn
  //   more match unless they raise their 몸값).
  const matchCapUsd = selfUsd * DOWNLINE_CAP_MULTIPLE;
  let paidMatchUsd = 0;
  try {
    const agg = await db.prepare(
      `SELECT COALESCE(SUM(bonus_usd),0) AS paid FROM binary_match_bonuses WHERE user_id = ?`
    ).bind(sponsorId).first();
    paidMatchUsd = Number(agg?.paid || 0);
  } catch { /* no bonuses yet */ }
  const capped = selfUsd > 0 && paidMatchUsd >= matchCapUsd;

  // Attach to the sponsor but DO NOT assign a leg — the sponsor picks it later.
  try {
    await db.prepare(
      `UPDATE users SET binary_parent_id = ?, binary_leg = NULL WHERE id = ?`
    ).bind(sponsorId, newUserId).run();
  } catch (e) {
    console.warn('[binary] placement (attach) failed:', e);
  }
  return { leg: null, capped, self_usd: selfUsd, downline_usd: downlineUsd };
}

// ---------------------------------------------------------------------------
// LEG ASSIGNMENT (sponsor-chosen, ONCE) — the sponsor assigns one of their
// UNPLACED direct downline members to their Left or Right leg. Irreversible:
// only succeeds when the member currently has binary_leg IS NULL AND the caller
// is that member's direct sponsor (binary_parent_id). Returns a discriminated
// result so the route can map it to a precise HTTP status/message.
// ---------------------------------------------------------------------------
export type AssignLegResult =
  | { ok: true; member_id: string; leg: 'L' | 'R' }
  | { ok: false; code: 'INVALID_LEG' | 'NOT_YOUR_DOWNLINE' | 'ALREADY_PLACED' | 'MEMBER_NOT_FOUND' | 'ERROR' };

export async function assignBinaryLeg(
  db: any,
  sponsorId: string,
  memberId: string,
  leg: 'L' | 'R',
): Promise<AssignLegResult> {
  if (leg !== 'L' && leg !== 'R') return { ok: false, code: 'INVALID_LEG' };
  if (!sponsorId || !memberId || sponsorId === memberId) return { ok: false, code: 'NOT_YOUR_DOWNLINE' };
  try {
    const member = await db.prepare(
      `SELECT binary_parent_id, binary_leg FROM users WHERE id = ?`
    ).bind(memberId).first();
    if (!member) return { ok: false, code: 'MEMBER_NOT_FOUND' };
    if (member.binary_parent_id !== sponsorId) return { ok: false, code: 'NOT_YOUR_DOWNLINE' };
    if (member.binary_leg === 'L' || member.binary_leg === 'R') {
      return { ok: false, code: 'ALREADY_PLACED' }; // one-time only
    }
    // Guarded UPDATE: only flips when the leg is still NULL (idempotent / race-safe).
    // Also stamp WHEN the placement happened so the sponsor dashboard can show a
    // placement history ("배치일시"). binary_leg_assigned_at is added by migration
    // 0053; wrap in try so older DBs (pre-0053) still assign the leg.
    let upd;
    try {
      upd = await db.prepare(
        `UPDATE users SET binary_leg = ?, binary_leg_assigned_at = datetime('now')
          WHERE id = ? AND binary_parent_id = ? AND binary_leg IS NULL`
      ).bind(leg, memberId, sponsorId).run();
    } catch {
      // Column may not exist yet — fall back without the timestamp.
      upd = await db.prepare(
        `UPDATE users SET binary_leg = ?
          WHERE id = ? AND binary_parent_id = ? AND binary_leg IS NULL`
      ).bind(leg, memberId, sponsorId).run();
    }
    if (!upd?.meta || upd.meta.changes === 0) {
      return { ok: false, code: 'ALREADY_PLACED' };
    }
    return { ok: true, member_id: memberId, leg };
  } catch (e) {
    console.warn('[binary] assignBinaryLeg failed:', e);
    return { ok: false, code: 'ERROR' };
  }
}

// ============================================================================
// STAKING -> BINARY roll-up + matching (web-server side, SYNCHRONOUS).
// ----------------------------------------------------------------------------
// ⚑ OWNER RULE (2026-08-28): 몸값(self_usd) and binary downline volume are
//   EXCLUSIVELY the STAKING SUBSCRIPTION amount — the exact QTA actually
//   DEDUCTED at POST /earn/subscribe, valued in USD at stake time. Deposits
//   (ext_deposits / internal deposits) and USDT->QTA market buys DO NOT count.
//
// This mirrors the cron worker's rollUp/runMatchForUser so a stake takes effect
// IMMEDIATELY on subscribe (the cron binaryMatchingTick is only a safety-net
// sweeper for positions whose synchronous roll-up was missed). Idempotency is
// handled by the caller stamping staking_positions.binary_counted_at.
// ============================================================================

// ⚑ OWNER RULE (2026-08-29, FINAL — REACH-BASED, ONCE PER TIER): the Left/Right
//   matching bonus is paid when the 소실적(weaker leg = min(left,right)) REACHES
//   a tier's target (도달점). Reaching a target pays TARGET × that tier's rate,
//   exactly ONCE per target. Already-reached targets never re-pay. 소실적 that
//   sits between two targets pays nothing until the NEXT target is reached.
//
//   Owner examples (VERBATIM): 소실적이 $1,000 도달 → $1,000 × 3% = $30 ;
//   $5,000 도달 → $5,000 × 4% = $200 ; 마지막 $300,000 도달 → $300,000 × 8% = $24,000.
//
//   Targets & rates (owner-confirmed 2026-08-29):
//     $100~$1,000     → reach $1,000   pays 1,000  × 3% = $30
//     $1,000~$5,000   → reach $5,000   pays 5,000  × 4% = $200
//     $5,000~$10,000  → reach $10,000  pays 10,000 × 5% = $500
//     $10,000~$50,000 → reach $50,000  pays 50,000 × 6% = $3,000
//     $50,000 이상    → reach $100,000 pays 100,000× 8% = $8,000
//   Below the first target ($1,000) 소실적 pays nothing.
//   Owner rule (2026-08-28, FINAL 5-tier per attached table): the top tier is
//   "$100,000 이상 → 8%". There is NO 7% tier and NO $300,000 tier.
//
//   matched_usd = the highest tier TARGET already paid. When 소실적 crosses one
//   or more new targets, each newly-reached target is paid (target × rate) and
//   matched_usd advances to the highest reached target (race-guarded).
const MATCH_TIERS: Array<{ target: number; rate: number }> = [
  { target: 1_000,   rate: 0.03 },
  { target: 5_000,   rate: 0.04 },
  { target: 10_000,  rate: 0.05 },
  { target: 50_000,  rate: 0.06 },
  { target: 100_000, rate: 0.08 },
];

// Sum of bonuses for all tier TARGETS with `paidTarget < target <= weaker`.
// Each newly-reached target pays target × rate, exactly once.
function reachBonusUsd(paidTarget: number, weaker: number): number {
  let bonus = 0;
  for (const tier of MATCH_TIERS) {
    if (tier.target > paidTarget && tier.target <= weaker) {
      bonus += tier.target * tier.rate;
    }
  }
  return bonus;
}

// Highest tier target that the 소실적(weaker) has reached (0 if none reached).
function highestReachedTarget(weaker: number): number {
  let t = 0;
  for (const tier of MATCH_TIERS) {
    if (weaker >= tier.target) t = tier.target;
    else break;
  }
  return t;
}

function bmUuid(): string {
  return (globalThis as any).crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

// Match one user (REACH-BASED): when 소실적(min(left,right)) reaches new tier
// TARGET(s), pay TARGET × rate for each, once. matched_usd = highest target paid.
async function runMatchForUser(db: any, userId: string, qtaPriceUsd: number): Promise<void> {
  const vol = await db.prepare(
    `SELECT left_usd, right_usd, matched_usd, self_usd FROM binary_volume WHERE user_id = ?`
  ).bind(userId).first();
  if (!vol) return;

  // A member earns NOTHING from downline unless THEY THEMSELVES have staked
  // (self_usd / 몸값 > 0). Volume still accumulates for later matching.
  const selfUsd = Number(vol.self_usd || 0);
  if (selfUsd <= 0) return;

  const left = Number(vol.left_usd || 0);
  const right = Number(vol.right_usd || 0);
  const paidTarget = Number(vol.matched_usd || 0);   // highest tier target already paid

  // 소실적 = weaker leg. Which tier targets has it newly reached?
  const weaker = Math.min(left, right);
  const reachedTarget = highestReachedTarget(weaker);
  if (reachedTarget <= paidTarget) return;           // no new target reached

  const bonusUsdRaw = reachBonusUsd(paidTarget, weaker);
  if (!(bonusUsdRaw > 0)) return;

  // ★ OWNER RULE (2026-09-04): TOTAL match bonus a member can EVER receive is
  //   HARD-CAPPED at 2× their own 몸값(self_usd), in USD, no matter how large the
  //   downline / 소실적 is. e.g. self $1,000 → lifetime match ceiling $2,000, even
  //   if a $500k 소실적 tier would otherwise pay $20,000. The DAILY dividend is
  //   SEPARATE and NOT limited by this cap. We track the cap in USD (bonus_usd),
  //   since bonuses are paid in QTA at a moving price.
  const matchCapUsd = selfUsd * DOWNLINE_CAP_MULTIPLE;   // 2× 몸값
  const paidAgg = await db.prepare(
    `SELECT COALESCE(SUM(bonus_usd),0) AS paid FROM binary_match_bonuses WHERE user_id = ?`
  ).bind(userId).first();
  const alreadyPaidUsd = Number(paidAgg?.paid || 0);
  const remainingCapUsd = Math.max(0, matchCapUsd - alreadyPaidUsd);
  // Clamp this payout to the remaining room under the 2× 몸값 ceiling.
  const bonusUsd = Math.min(bonusUsdRaw, remainingCapUsd);

  // Advance matched_usd to the highest reached TARGET (race-guarded). We STILL
  // advance the tier pointer even when the cap clamps the payout to 0, so the
  // same tier is not re-evaluated forever; the member simply receives nothing
  // more once the 2× ceiling is hit (unless they later raise their 몸값, which
  // lifts matchCapUsd and lets a subsequent higher tier pay again).
  const upd = await db.prepare(
    `UPDATE binary_volume SET matched_usd = ?, updated_at = datetime('now')
      WHERE user_id = ? AND matched_usd = ?`
  ).bind(reachedTarget, userId, paidTarget).run();
  if (!upd?.meta || upd.meta.changes === 0) return;

  // Nothing left to pay under the cap — advance the pointer only, record no row.
  if (!(bonusUsd > 0)) return;
  const bonusQta = qtaPriceUsd > 0 ? bonusUsd / qtaPriceUsd : 0;

  // ★ OWNER RULE (2026-09-03): match bonus is NO LONGER credited to the wallet
  //   immediately. It accumulates as CLAIMABLE (claimed=0) together with the
  //   staking dividend, and is only paid out on the Friday claim window via
  //   /claim or /claim-all (see earn.ts). This prevents match from being
  //   withdrawable before the member actually claims it. DO NOT re-add a
  //   `UPDATE wallets SET available = available + ?` here — that would double-pay
  //   the same bonus once the member claims it.
  const newSlice = reachedTarget - paidTarget;
  const effRate = newSlice > 0 ? bonusUsd / newSlice : 0;
  try {
    await db.prepare(
      `INSERT INTO binary_match_bonuses
         (id, user_id, matched_usd, rate, bonus_usd, bonus_qta, qta_price,
          left_total, right_total, matched_total, claimed, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 0, datetime('now'))`
    ).bind(
      bmUuid(), userId, newSlice, effRate, bonusUsd, bonusQta, qtaPriceUsd,
      left, right, reachedTarget,
    ).run();
  } catch (e) {
    console.warn('[binary] match bonus insert failed:', e);
  }
}

// Roll a STAKING subscription's USD up every binary ancestor's correct leg,
// then match. usdValue = USD value of the QTA actually DEDUCTED at subscribe.
//
// opts.skipSelf: when true, DO NOT grow the staker's own self_usd (몸값). Used by
//   the admin recompute path, which sets every user's self_usd up-front (so the
//   2× cap is correct before ANY volume rolls up) and then only needs the
//   ancestor volume roll-up here.
export async function rollStakeUpBinary(
  db: any,
  memberId: string,
  usdValue: number,
  qtaPriceUsd: number,
  opts?: { skipSelf?: boolean },
): Promise<void> {
  if (!(usdValue > 0)) return;

  if (!opts?.skipSelf) {
    // 1) The staker's OWN 몸값 grows by this staking subscription, raising THEIR
    //    downline cap (2× self_usd per leg) so more downline can accumulate.
    await db.prepare(
      `INSERT INTO binary_volume (user_id, left_usd, right_usd, matched_usd, self_usd, updated_at)
       VALUES (?, 0, 0, 0, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         self_usd = self_usd + ?, updated_at = datetime('now')`
    ).bind(memberId, usdValue, usdValue).run();
  }

  // The staker may now be matchable if downline volume was already parked.
  await runMatchForUser(db, memberId, qtaPriceUsd);

  const seen = new Set<string>([memberId]);
  let childId = memberId;
  let depth = 0;

  while (depth < 200) {
    depth++;
    const node = await db.prepare(
      `SELECT binary_parent_id, binary_leg FROM users WHERE id = ?`
    ).bind(childId).first();
    const parentId: string | null = node?.binary_parent_id || null;
    if (!parentId || seen.has(parentId)) break;

    // Volume rolls up ONLY after the sponsor assigned this member a leg.
    const rawLeg = node?.binary_leg;
    if (rawLeg !== 'L' && rawLeg !== 'R') break;
    const leg: 'L' | 'R' = rawLeg;
    seen.add(parentId);

    await db.prepare(
      `INSERT INTO binary_volume (user_id, left_usd, right_usd, matched_usd, self_usd, updated_at)
       VALUES (?, 0, 0, 0, 0, datetime('now'))
       ON CONFLICT(user_id) DO NOTHING`
    ).bind(parentId).run();

    // ★ OWNER RULE (2026-09-04): the leg VOLUME (left_usd / right_usd) is
    //   UNLIMITED — every downline stake rolls up in FULL, no drop. The 2×
    //   self_usd cap is NOT a volume ceiling; it is applied ONLY to the total
    //   MATCH BONUS the member can ever receive (see runMatchForUser). So here
    //   we simply add the whole usdValue to the correct leg.
    const liveCol = leg === 'R' ? 'right_usd' : 'left_usd';
    await db.prepare(
      `UPDATE binary_volume SET ${liveCol} = ${liveCol} + ?, updated_at = datetime('now') WHERE user_id = ?`
    ).bind(usdValue, parentId).run();
    await runMatchForUser(db, parentId, qtaPriceUsd);
    childId = parentId;
  }
}

// ============================================================================
// recomputeBinaryFromStaking — ADMIN RESET (owner rule 2026-08-28).
// ----------------------------------------------------------------------------
// Wipes ALL binary volume (self_usd / left / right / matched / pending) and
// rebuilds it FROM STAKING SUBSCRIPTIONS ONLY. This retroactively purges the
// old, WRONG deposit-derived 몸값 so nothing but staking counts.
//
// Also resets any previously-paid binary_match_bonuses history and re-derives
// it from scratch (matched_usd starts at 0, so runMatchForUser will re-pay as
// volume is rolled back in — bonuses are re-inserted, not double-counted,
// because the rebuild starts from a clean slate).
//
// Ordering matters:
//   Phase 1 — SET every user's self_usd = SUM(staking principal, in USD at
//             stake time). Doing this FIRST guarantees each ancestor's 2× cap
//             is correct before ANY downline volume rolls up.
//   Phase 2 — For every staking position, roll its USD up the ancestry
//             (skipSelf=true so self_usd is not double-added) and match.
//
// Returns a small report for the admin UI / logs.
// ============================================================================
export async function recomputeBinaryFromStaking(
  db: any,
  qtaPriceUsd: number,
): Promise<{
  ok: boolean;
  users_reset: number;
  self_seeded: number;
  positions_rolled: number;
  bonuses_cleared: number;
}> {
  // 0) Clean slate: wipe all volume rows and paid-bonus history, and un-count
  //    every staking position so it can be rolled back in.
  let bonusesCleared = 0;
  try {
    const del = await db.prepare(`DELETE FROM binary_match_bonuses`).run();
    bonusesCleared = Number(del?.meta?.changes || 0);
  } catch { /* table may be empty / absent */ }

  // Reset ALL volume columns to 0 (keep the rows so ON CONFLICT paths are cheap).
  await db.prepare(
    `UPDATE binary_volume
        SET left_usd = 0, right_usd = 0, matched_usd = 0, self_usd = 0,
            pending_left_usd = 0, pending_right_usd = 0,
            updated_at = datetime('now')`
  ).run().catch(async () => {
    // pending_* columns may not exist on older DBs — fall back without them.
    await db.prepare(
      `UPDATE binary_volume
          SET left_usd = 0, right_usd = 0, matched_usd = 0, self_usd = 0,
              updated_at = datetime('now')`
    ).run();
  });

  // Un-count every staking position (so a later cron sweep is also consistent).
  try {
    await db.prepare(`UPDATE staking_positions SET binary_counted_at = NULL`).run();
  } catch { /* column may not exist yet — bootstrap adds it */ }

  const usersReset = await db.prepare(`SELECT COUNT(*) AS n FROM binary_volume`)
    .first().then((r: any) => Number(r?.n || 0)).catch(() => 0);

  // Phase 1 — seed self_usd = SUM of each user's staking principal (USD at
  //   stake time = principal_qta × qta_price_at_stake, fallback principal_usd).
  //   We consider ALL positions that consumed QTA (any status) as 몸값, since
  //   the QTA was actually deducted. If the owner later wants only ACTIVE
  //   positions to count, add `WHERE status='active'` here.
  const selfRows = await db.prepare(
    `SELECT user_id,
            SUM(
              CASE
                WHEN COALESCE(principal_qta,0) > 0 AND COALESCE(qta_price_at_stake,0) > 0
                  THEN principal_qta * qta_price_at_stake
                ELSE COALESCE(principal_usd,0)
              END
            ) AS self_usd
       FROM staking_positions
      GROUP BY user_id`
  ).all().then((r: any) => r?.results || []).catch(() => []);

  let selfSeeded = 0;
  for (const row of selfRows) {
    const uid = row.user_id;
    const selfUsd = Number(row.self_usd || 0);
    if (!uid || !(selfUsd > 0)) continue;
    await db.prepare(
      `INSERT INTO binary_volume (user_id, left_usd, right_usd, matched_usd, self_usd, updated_at)
       VALUES (?, 0, 0, 0, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET self_usd = ?, updated_at = datetime('now')`
    ).bind(uid, selfUsd, selfUsd).run();
    selfSeeded++;
  }

  // Phase 2 — roll every staking position's USD up the ancestry (skipSelf so
  //   self_usd isn't double-added) and match. Stamp binary_counted_at.
  const posRows = await db.prepare(
    `SELECT id, user_id, principal_qta, qta_price_at_stake, principal_usd
       FROM staking_positions
      ORDER BY created_at ASC`
  ).all().then((r: any) => r?.results || []).catch(() => []);

  let positionsRolled = 0;
  for (const p of posRows) {
    const qta = Number(p.principal_qta || 0);
    const px = Number(p.qta_price_at_stake || 0);
    let usd = qta > 0 && px > 0 ? qta * px : Number(p.principal_usd || 0);
    if (!(usd > 0)) continue;
    await rollStakeUpBinary(db, p.user_id, usd, qtaPriceUsd, { skipSelf: true });
    try {
      await db.prepare(
        `UPDATE staking_positions SET binary_counted_at = datetime('now') WHERE id = ?`
      ).bind(p.id).run();
    } catch { /* column may not exist — cron will handle */ }
    positionsRolled++;
  }

  return {
    ok: true,
    users_reset: usersReset,
    self_seeded: selfSeeded,
    positions_rolled: positionsRolled,
    bonuses_cleared: bonusesCleared,
  };
}
