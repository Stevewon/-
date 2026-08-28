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

const MATCH_UNIT_USD = 100;

function matchBonusRate(matchedUsd: number): number {
  if (matchedUsd >= 100_000) return 0.08;
  if (matchedUsd >= 50_000) return 0.07;
  if (matchedUsd >= 10_000) return 0.06;
  if (matchedUsd >= 5_000) return 0.05;
  if (matchedUsd >= 1_000) return 0.04;
  if (matchedUsd >= 100) return 0.03;
  return 0;
}

function bmUuid(): string {
  return (globalThis as any).crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

// Match one user: min(left,right) unmatched, $100 units, tiered QTA payout.
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

  const pairable = Math.min(left, right) - matched;
  if (pairable < MATCH_UNIT_USD) return;

  const newMatchUsd = Math.floor(pairable / MATCH_UNIT_USD) * MATCH_UNIT_USD;
  if (newMatchUsd < MATCH_UNIT_USD) return;

  const rate = matchBonusRate(newMatchUsd);
  if (rate <= 0) return;

  const bonusUsd = newMatchUsd * rate;
  const bonusQta = qtaPriceUsd > 0 ? bonusUsd / qtaPriceUsd : 0;
  const newMatchedTotal = matched + newMatchUsd;

  const upd = await db.prepare(
    `UPDATE binary_volume SET matched_usd = ?, updated_at = datetime('now')
      WHERE user_id = ? AND matched_usd = ?`
  ).bind(newMatchedTotal, userId, matched).run();
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

  try {
    await db.prepare(
      `INSERT INTO binary_match_bonuses
         (id, user_id, matched_usd, rate, bonus_usd, bonus_qta, qta_price,
          left_total, right_total, matched_total, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))`
    ).bind(
      bmUuid(), userId, newMatchUsd, rate, bonusUsd, bonusQta, qtaPriceUsd,
      left, right, newMatchedTotal,
    ).run();
  } catch (e) {
    console.warn('[binary] match bonus insert failed:', e);
  }
}

// Roll a STAKING subscription's USD up every binary ancestor's correct leg,
// then match. usdValue = USD value of the QTA actually DEDUCTED at subscribe.
export async function rollStakeUpBinary(
  db: any,
  memberId: string,
  usdValue: number,
  qtaPriceUsd: number,
): Promise<void> {
  if (!(usdValue > 0)) return;

  // 1) The staker's OWN 몸값 grows by this staking subscription, raising THEIR
  //    downline cap (2× self_usd per leg) so more downline can accumulate.
  await db.prepare(
    `INSERT INTO binary_volume (user_id, left_usd, right_usd, matched_usd, self_usd, updated_at)
     VALUES (?, 0, 0, 0, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       self_usd = self_usd + ?, updated_at = datetime('now')`
  ).bind(memberId, usdValue, usdValue).run();

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
