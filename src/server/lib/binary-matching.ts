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
// Policy (owner, 2026-08-27 — supersedes the volume-tie rule):
//   • Each user is AUTO-PLACED under their sponsor by ALTERNATING left/right
//     (좌우 번갈아). We balance by the sponsor's current head-count per leg and
//     alternate on ties, so members never pile onto one side before deposits.
//   • Downline (left+right) may grow to at most 2x the user's own deposit
//     total (self_usd / "몸값"). Enforced on roll-up in the cron worker.
// ============================================================================

// ---------------------------------------------------------------------------
// PLACEMENT — put a new user into their sponsor's leg, ALTERNATING left/right.
// The sponsor is the direct referrer (matched by ref_code at signup).
// We count how many members the sponsor already has on each leg and place the
// new member on the side with FEWER members; on a tie we ALTERNATE (the tie is
// broken by the parity of the current head count, so consecutive signups under
// an empty sponsor go L, R, L, R, ...). This removes the old left-skew where
// everyone piled onto Left before any deposits existed. Deeper spillover is not
// used; only the direct child sits on the sponsor's leg, but the member's future
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
  // Pick the side by HEAD COUNT (how many members already sit on each leg),
  // alternating on ties. This keeps the tree balanced even before any deposits
  // exist (old bug: volume-based tie always chose Left -> everyone left-skewed).
  let leg: 'L' | 'R' = 'L';
  let selfUsd = 0;
  let downlineUsd = 0;
  try {
    const counts = await db.prepare(
      `SELECT
         SUM(CASE WHEN binary_leg = 'L' THEN 1 ELSE 0 END) AS l,
         SUM(CASE WHEN binary_leg = 'R' THEN 1 ELSE 0 END) AS r
       FROM users WHERE binary_parent_id = ?`
    ).bind(sponsorId).first();
    const lCount = Number(counts?.l || 0);
    const rCount = Number(counts?.r || 0);
    if (rCount < lCount) {
      leg = 'R';
    } else if (lCount < rCount) {
      leg = 'L';
    } else {
      // Tie -> ALTERNATE. Parity of the total head count decides: 0 members -> L,
      // 1 -> R, 2 -> L, ... so consecutive empty-sponsor signups go L, R, L, R.
      leg = ((lCount + rCount) % 2 === 0) ? 'L' : 'R';
    }
  } catch { /* users table lookup failed; default Left */ }

  // Read the sponsor's own deposit total for the 2x downline-cap warning flag.
  try {
    const vol = await db.prepare(
      `SELECT left_usd, right_usd, self_usd FROM binary_volume WHERE user_id = ?`
    ).bind(sponsorId).first();
    const left = Number(vol?.left_usd || 0);
    const right = Number(vol?.right_usd || 0);
    selfUsd = Number(vol?.self_usd || 0);
    downlineUsd = left + right;
  } catch { /* volume table might be empty */ }

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
