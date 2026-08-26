// ============================================================================
// binary-matching.ts — left/right binary matching-bonus engine (server side).
// ----------------------------------------------------------------------------
// Policy (owner, 2026-08-26):
//   • Each user is AUTO-PLACED under their sponsor into the sponsor's smaller
//     leg (by current accumulated leg volume; ties -> Left).
//   • A member's DEPOSIT (USD value) rolls up EVERY binary ancestor's correct
//     leg. "Correct leg" = the leg (L/R) of the ancestor's direct child that
//     the member descends from.
//   • Matching pays on min(left, right) UNMATCHED volume, in $100 units, at a
//     tiered rate. Matched volume carries over (never double-paid).
//   • Bonus is paid in QTA at the live QTA price.
// ============================================================================

// Bonus tiers — matched USD (per match event) -> rate. Highest matching band.
// From the owner's table:
//   $100–$999 2% · $1,000–$4,999 3% · $5,000–$9,999 4% ·
//   $10,000–$49,999 5% · $50,000–$99,999 6% · $100,000+ 7%
export function matchBonusRate(matchedUsd: number): number {
  if (matchedUsd >= 100_000) return 0.07;
  if (matchedUsd >= 50_000) return 0.06;
  if (matchedUsd >= 10_000) return 0.05;
  if (matchedUsd >= 5_000) return 0.04;
  if (matchedUsd >= 1_000) return 0.03;
  if (matchedUsd >= 100) return 0.02;
  return 0; // below the $100 floor — no match yet
}

// Matching happens in $100 units.
const MATCH_UNIT_USD = 100;

/** Live QTA price in USD (fallback to launch peg). */
async function qtaPriceUsd(db: any): Promise<number> {
  try {
    const row = await db.prepare(`SELECT price_usd FROM coins WHERE symbol = 'QTA'`).first();
    const p = Number(row?.price_usd || 0);
    return p > 0 ? p : 0.00357142857;
  } catch {
    return 0.00357142857;
  }
}

function uuid(): string {
  return (globalThis as any).crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

// ---------------------------------------------------------------------------
// PLACEMENT — put a new user into their sponsor's smaller leg.
// The sponsor is the direct referrer (matched by referral_code at signup).
// We compare the sponsor's own accumulated left vs right volume; the new
// member goes on the lighter side (tie -> Left). Deeper spillover is not used;
// only the direct child sits on the sponsor's leg, but the member's future
// VOLUME rolls up the whole ancestry (see rollUpDepositVolume).
// ---------------------------------------------------------------------------
export async function placeInBinaryTree(
  db: any,
  newUserId: string,
  sponsorId: string,
): Promise<'L' | 'R'> {
  if (!sponsorId || sponsorId === newUserId) return 'L';
  // Look at the sponsor's current leg volumes to pick the lighter side.
  let leg: 'L' | 'R' = 'L';
  try {
    const vol = await db.prepare(
      `SELECT left_usd, right_usd FROM binary_volume WHERE user_id = ?`
    ).bind(sponsorId).first();
    const left = Number(vol?.left_usd || 0);
    const right = Number(vol?.right_usd || 0);
    leg = right < left ? 'R' : 'L'; // tie -> Left
  } catch { /* volume table might be empty; default Left */ }

  try {
    await db.prepare(
      `UPDATE users SET binary_parent_id = ?, binary_leg = ? WHERE id = ?`
    ).bind(sponsorId, leg, newUserId).run();
  } catch (e) {
    console.warn('[binary] placement failed:', e);
  }
  return leg;
}

// ---------------------------------------------------------------------------
// ROLL-UP — add a deposit's USD value into every binary ancestor's leg, then
// run the match check for each touched ancestor. Cycle-safe & depth-capped.
// ---------------------------------------------------------------------------
export async function rollUpDepositVolume(
  db: any,
  memberId: string,
  usdValue: number,
): Promise<void> {
  if (!(usdValue > 0)) return;

  const price = await qtaPriceUsd(db);
  const seen = new Set<string>([memberId]);
  let childId = memberId;
  let depth = 0;

  while (depth < 200) {
    depth++;
    // Who is this child's binary parent, and on which leg does the child sit?
    let node: { binary_parent_id: string | null; binary_leg: string | null } | null = null;
    try {
      node = await db.prepare(
        `SELECT binary_parent_id, binary_leg FROM users WHERE id = ?`
      ).bind(childId).first();
    } catch { break; }
    const parentId = node?.binary_parent_id;
    const leg = (node?.binary_leg === 'R' ? 'R' : 'L') as 'L' | 'R';
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);

    // Ensure a volume row exists, then add to the correct leg.
    try {
      await db.prepare(
        `INSERT INTO binary_volume (user_id, left_usd, right_usd, matched_usd, updated_at)
         VALUES (?, 0, 0, 0, datetime('now'))
         ON CONFLICT(user_id) DO NOTHING`
      ).bind(parentId).run();
      const col = leg === 'R' ? 'right_usd' : 'left_usd';
      await db.prepare(
        `UPDATE binary_volume SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE user_id = ?`
      ).bind(usdValue, parentId).run();
    } catch (e) {
      console.warn('[binary] volume bump failed:', e);
    }

    // Run the match check for this ancestor.
    await runMatchForUser(db, parentId, price);

    childId = parentId;
  }
}

// ---------------------------------------------------------------------------
// MATCH — for one user: match min(left,right) UNMATCHED volume in $100 units,
// pay the tiered bonus in QTA, and advance the carry-over (matched_usd).
// ---------------------------------------------------------------------------
export async function runMatchForUser(
  db: any,
  userId: string,
  price?: number,
): Promise<{ matched_usd: number; bonus_qta: number } | null> {
  const qtaPrice = price ?? (await qtaPriceUsd(db));

  const vol = await db.prepare(
    `SELECT left_usd, right_usd, matched_usd FROM binary_volume WHERE user_id = ?`
  ).bind(userId).first();
  if (!vol) return null;

  const left = Number(vol.left_usd || 0);
  const right = Number(vol.right_usd || 0);
  const matched = Number(vol.matched_usd || 0);

  // Unmatched, matchable volume = min(left,right) - already matched.
  const pairable = Math.min(left, right) - matched;
  if (pairable < MATCH_UNIT_USD) return null; // less than one $100 unit

  // Round DOWN to whole $100 units.
  const newMatchUsd = Math.floor(pairable / MATCH_UNIT_USD) * MATCH_UNIT_USD;
  if (newMatchUsd < MATCH_UNIT_USD) return null;

  const rate = matchBonusRate(newMatchUsd);
  if (rate <= 0) return null;

  const bonusUsd = newMatchUsd * rate;
  const bonusQta = qtaPrice > 0 ? bonusUsd / qtaPrice : 0;
  const newMatchedTotal = matched + newMatchUsd;

  // Advance carry-over first (so a racing tick can't double-pay the same band).
  const upd = await db.prepare(
    `UPDATE binary_volume SET matched_usd = ?, updated_at = datetime('now')
      WHERE user_id = ? AND matched_usd = ?`
  ).bind(newMatchedTotal, userId, matched).run();
  if (!upd?.meta || upd.meta.changes === 0) return null; // lost the race; skip

  // Credit QTA to the user's wallet (create row if missing).
  try {
    await db.prepare(
      `INSERT INTO wallets (id, user_id, coin_symbol, available, locked)
       VALUES (?, ?, 'QTA', 0, 0)
       ON CONFLICT(user_id, coin_symbol) DO NOTHING`
    ).bind(uuid(), userId).run();
  } catch { /* some schemas key wallets differently; ignore */ }
  await db.prepare(
    `UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = 'QTA'`
  ).bind(bonusQta, userId).run();

  // Ledger row the user can view.
  await db.prepare(
    `INSERT INTO binary_match_bonuses
       (id, user_id, matched_usd, rate, bonus_usd, bonus_qta, qta_price,
        left_total, right_total, matched_total, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))`
  ).bind(
    uuid(), userId, newMatchUsd, rate, bonusUsd, bonusQta, qtaPrice,
    left, right, newMatchedTotal,
  ).run();

  return { matched_usd: newMatchUsd, bonus_qta: bonusQta };
}
