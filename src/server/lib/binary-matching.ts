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

  // Read the sponsor's own deposit total for the 2x downline-cap warning flag.
  let selfUsd = 0;
  let downlineUsd = 0;
  try {
    const vol = await db.prepare(
      `SELECT left_usd, right_usd, self_usd FROM binary_volume WHERE user_id = ?`
    ).bind(sponsorId).first();
    const left = Number(vol?.left_usd || 0);
    const right = Number(vol?.right_usd || 0);
    selfUsd = Number(vol?.self_usd || 0);
    downlineUsd = left + right;
  } catch { /* volume table might be empty */ }

  const cap = selfUsd * DOWNLINE_CAP_MULTIPLE;
  const capped = selfUsd > 0 && downlineUsd >= cap;

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
