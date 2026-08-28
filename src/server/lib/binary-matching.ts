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

  // Read the sponsor's own deposit total for the PER-LEG 2× cap warning flag.
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

  // Per-leg cap (owner rule 2026-08-28 revised): each leg ≤ 2 × self_usd.
  // At signup the leg is not chosen yet, so we only flag "capped" when BOTH
  // legs are already full — otherwise the sponsor can still place this member
  // on whichever leg still has room.
  const cap = selfUsd * DOWNLINE_CAP_MULTIPLE;
  const capped = selfUsd > 0 && left >= cap && right >= cap;

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
    const upd = await db.prepare(
      `UPDATE users SET binary_leg = ?
        WHERE id = ? AND binary_parent_id = ? AND binary_leg IS NULL`
    ).bind(leg, memberId, sponsorId).run();
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

// ⚑ OWNER RULE (2026-08-28, FINAL): the Left/Right matching bonus is
//   소실적(weaker leg) × its tier rate, paid ONCE — matched volume never
//   re-pays. 소실적 = min(left, right). Only the NOT-YET-PAID slice of the
//   weaker leg (min(left,right) − matched_usd) is paid this event; matched_usd
//   is then advanced so the same 실적 is never paid twice.
//
//   The rate is a FLAT (single) tier: the ENTIRE 소실적 is paid at the ONE tier
//   rate its total amount falls into — NOT a progressive per-slice blend.
//   Owner examples (2026-08-28, VERBATIM): 좌$500·우$900 → 소실적 $500 →
//   $500 × 3% = $15 ; 좌$700·우$900 → 소실적 $700 → $700 × 3% = $21.
//   Tiers (3%~8%, owner-confirmed):
//     $100~$999      → 3%
//     $1,000~$4,999  → 4%
//     $5,000~$9,999  → 5%
//     $10,000~$49,999→ 6%
//     $50,000~$99,999→ 7%
//     $100,000~      → 8%
//   Below $100 소실적 pays nothing (no tier).
//
//   Option 가) INCREMENTAL: matched_usd tracks the 소실적 already paid. When the
//   weaker leg grows, we pay only the NEWLY-increased slice, priced by the FLAT
//   rule: bonus = flatBonusUsd(weaker) − flatBonusUsd(matched). This never
//   re-pays matched volume, and if the new weaker total crosses into a higher
//   tier, the whole 소실적 is re-priced at the higher rate (the already-paid
//   portion is subtracted so only the delta is credited).
const MATCH_TIERS: Array<{ from: number; rate: number }> = [
  { from: 100,     rate: 0.03 },
  { from: 1_000,   rate: 0.04 },
  { from: 5_000,   rate: 0.05 },
  { from: 10_000,  rate: 0.06 },
  { from: 50_000,  rate: 0.07 },
  { from: 100_000, rate: 0.08 },
];

// FLAT tier rate for a 소실적 amount: the single rate of the highest tier whose
// `from` threshold the amount reaches. Below $100 → 0 (no tier).
function flatRateOf(amountUsd: number): number {
  let rate = 0;
  for (const tier of MATCH_TIERS) {
    if (amountUsd >= tier.from) rate = tier.rate;
    else break;
  }
  return rate;
}

// FLAT bonus on a cumulative 소실적 amount: entire amount × its single tier rate.
// e.g. $500 → 500×3% = $15 ; $700 → 700×3% = $21 ; $1,200 → 1200×4% = $48.
function flatBonusUsd(amountUsd: number): number {
  if (!(amountUsd >= MATCH_TIERS[0].from)) return 0;
  return amountUsd * flatRateOf(amountUsd);
}

// Option 가) incremental payout: bonus for growing 소실적 from `paid` to `total`.
// = flatBonusUsd(total) − flatBonusUsd(paid). Never negative.
function tieredBonusUsd(paid: number, total: number): number {
  if (!(total > paid)) return 0;
  const delta = flatBonusUsd(total) - flatBonusUsd(paid);
  return delta > 0 ? delta : 0;
}

function bmUuid(): string {
  return (globalThis as any).crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

// Match one user: pay 소실적(min(left,right)) × tier rate on the not-yet-paid
// slice only. matched_usd = cumulative 소실적 already paid (never re-paid).
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
  const matched = Number(vol.matched_usd || 0);

  // 소실적 = weaker leg. Pay only the part above what we've already paid.
  const weaker = Math.min(left, right);
  if (weaker <= matched) return;                 // nothing new to match
  if (weaker < MATCH_TIERS[0].from) return;      // below $100 → no tier, no pay

  const bonusUsd = tieredBonusUsd(matched, weaker);
  if (!(bonusUsd > 0)) return;
  const bonusQta = qtaPriceUsd > 0 ? bonusUsd / qtaPriceUsd : 0;

  // Advance matched_usd to the full 소실적 (guards against a racing tick).
  const upd = await db.prepare(
    `UPDATE binary_volume SET matched_usd = ?, updated_at = datetime('now')
      WHERE user_id = ? AND matched_usd = ?`
  ).bind(weaker, userId, matched).run();
  if (!upd?.meta || upd.meta.changes === 0) return;

  try {
    await db.prepare(
      `INSERT INTO wallets (id, user_id, coin_symbol, available, locked)
       VALUES (?, ?, 'QTA', 0, 0)
       ON CONFLICT(user_id, coin_symbol) DO NOTHING`
    ).bind(bmUuid(), userId).run();
  } catch { /* ignore */ }
  await db.prepare(
    `UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = 'QTA'`
  ).bind(bonusQta, userId).run();

  // Record the event. matched_usd column here = the newly-paid 소실적 slice;
  // rate = effective blended rate on that slice; matched_total = cumulative.
  const newSlice = weaker - matched;
  const effRate = newSlice > 0 ? bonusUsd / newSlice : 0;
  try {
    await db.prepare(
      `INSERT INTO binary_match_bonuses
         (id, user_id, matched_usd, rate, bonus_usd, bonus_qta, qta_price,
          left_total, right_total, matched_total, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))`
    ).bind(
      bmUuid(), userId, newSlice, effRate, bonusUsd, bonusQta, qtaPriceUsd,
      left, right, weaker,
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

    // Enforce the 2× cap as a HARD, PER-LEG ceiling. Over-leg-cap volume is
    // DROPPED (no parking / no reclaim).
    const cur = await db.prepare(
      `SELECT left_usd, right_usd, self_usd FROM binary_volume WHERE user_id = ?`
    ).bind(parentId).first();
    const left = Number(cur?.left_usd || 0);
    const right = Number(cur?.right_usd || 0);
    const selfUsd = Number(cur?.self_usd || 0);
    const cap = selfUsd * DOWNLINE_CAP_MULTIPLE;
    const legUsed = leg === 'R' ? right : left;
    const room = Math.max(0, cap - legUsed);
    const add = Math.min(usdValue, room);
    const dropped = usdValue - add;
    const liveCol = leg === 'R' ? 'right_usd' : 'left_usd';

    if (add > 0) {
      await db.prepare(
        `UPDATE binary_volume SET ${liveCol} = ${liveCol} + ?, updated_at = datetime('now') WHERE user_id = ?`
      ).bind(add, parentId).run();
      await runMatchForUser(db, parentId, qtaPriceUsd);
    }
    if (dropped > 0) {
      console.log(`[binary] stake over-cap DROPPED user=${parentId} leg=${leg} dropped=${dropped} cap=${cap}`);
    }
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
