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
// Policy (owner, 2026-08-26):
//   • Each user is AUTO-PLACED under their sponsor into the sponsor's smaller
//     leg (by current accumulated leg volume; ties -> Left).
//   • Downline (left+right) may grow to at most 2x the user's own deposit
//     total (self_usd / "몸값"). Enforced on roll-up in the cron worker.
// ============================================================================

// ---------------------------------------------------------------------------
// PLACEMENT — put a new user into their sponsor's smaller leg.
// The sponsor is the direct referrer (matched by referral_code at signup).
// We compare the sponsor's own accumulated left vs right volume; the new
// member goes on the lighter side (tie -> Left). Deeper spillover is not used;
// only the direct child sits on the sponsor's leg, but the member's future
// VOLUME rolls up the whole ancestry (see cron-worker/src/binary-matching.ts).
// ---------------------------------------------------------------------------
// The downline (left+right) can grow to at most this multiple of the user's
// own deposit total (self_usd / "몸값"). Owner rule (2026-08-26): 2x.
export const DOWNLINE_CAP_MULTIPLE = 2;

export async function placeInBinaryTree(
  db: any,
  newUserId: string,
  sponsorId: string,
): Promise<{ leg: 'L' | 'R'; capped: boolean; self_usd: number; downline_usd: number }> {
  if (!sponsorId || sponsorId === newUserId) {
    return { leg: 'L', capped: false, self_usd: 0, downline_usd: 0 };
  }
  // Look at the sponsor's current leg volumes to pick the lighter side, and
  // check the 2x downline cap against the sponsor's own deposit total.
  let leg: 'L' | 'R' = 'L';
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
    leg = right < left ? 'R' : 'L'; // tie -> Left
  } catch { /* volume table might be empty; default Left */ }

  // Downline is "full" when accumulated left+right already reached 2x the
  // sponsor's own deposit value. We STILL record the tree position (so the
  // member is attached and can be counted once the sponsor raises their own
  // value), but flag it so the UI can warn. Deposit rollup enforces the hard
  // cap on volume (see cron-worker/src/binary-matching.ts rollUp).
  const cap = selfUsd * DOWNLINE_CAP_MULTIPLE;
  const capped = selfUsd > 0 && downlineUsd >= cap;

  try {
    await db.prepare(
      `UPDATE users SET binary_parent_id = ?, binary_leg = ? WHERE id = ?`
    ).bind(sponsorId, leg, newUserId).run();
  } catch (e) {
    console.warn('[binary] placement failed:', e);
  }
  return { leg, capped, self_usd: selfUsd, downline_usd: downlineUsd };
}
