// ============================================================================
// Reward-swap overpayment clawback — ONE-TIME, idempotent, atomic.
// ----------------------------------------------------------------------------
// ★ OWNER ORDER (2026-09-29): "초과분 회수해".
// Between the §6 staker exemption deploy (2026-09-28) and the rewardSwapPrice
// fix (commit 3d47b01, 2026-09-29), staking-reward Converts
// (convert_orders.source='staking_reward') were filled at the MARKET bid
// (~0.0101 USDT/QTA) instead of the §9 payout basis (10 KRW / 1,450 ≈
// 0.006897 USDT/QTA). For each such fill:
//     over = to_amount − from_amount × 10/1450
// is taken back from the member's USDT wallet (never below 0) and returned
// to the treasury that paid it.
//
// Safety:
//   • Ledger table convert_clawbacks (PK = convert_id) → each fill is
//     clawed back at most once, ever.
//   • The debit, the treasury credit, the notifications, the audit rows and
//     the applied=1 mark run in ONE D1 batch (a single transaction), so a
//     failure part-way leaves nothing applied and the next tick retries.
//   • Runs on every */5 tick; after the first success it finds no pending
//     rows and is a no-op.
// Member-facing text is English (OWNER_RULES §0).
// ============================================================================

export interface ClawbackEnv { DB: D1Database }

const BASIS_USDT_PER_QTA = 10 / 1450;           // §9 payout basis in force since 2026-09-14
const OVERPRICED = BASIS_USDT_PER_QTA + 1e-7;   // fills priced above the basis

export async function runRewardSwapClawback(env: ClawbackEnv): Promise<any> {
  const DB = env.DB;
  await DB.prepare(
    `CREATE TABLE IF NOT EXISTS convert_clawbacks (
       convert_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, from_amount REAL NOT NULL,
       paid_usdt REAL NOT NULL, fair_usdt REAL NOT NULL, over_usdt REAL NOT NULL,
       taken_usdt REAL, treasury_user_id TEXT, applied INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL DEFAULT (datetime('now')), applied_at TEXT)`,
  ).run();

  // Record every overpriced reward fill once (INSERT OR IGNORE on the PK).
  await DB.prepare(
    `INSERT OR IGNORE INTO convert_clawbacks
       (convert_id, user_id, from_amount, paid_usdt, fair_usdt, over_usdt, treasury_user_id)
     SELECT id, user_id, from_amount, to_amount,
            ROUND(from_amount * ?, 6), ROUND(to_amount - from_amount * ?, 6), treasury_user_id
       FROM convert_orders
      WHERE source = 'staking_reward' AND status = 'filled' AND price > ?
        AND to_amount - from_amount * ? > 0.000001`,
  ).bind(BASIS_USDT_PER_QTA, BASIS_USDT_PER_QTA, OVERPRICED, BASIS_USDT_PER_QTA).run();

  const pending = await DB.prepare(
    `SELECT c.convert_id, c.user_id, c.from_amount, c.paid_usdt, c.fair_usdt, c.over_usdt, c.treasury_user_id,
            u.email, u.nickname, cv.filled_at
       FROM convert_clawbacks c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN convert_orders cv ON cv.id = c.convert_id
      WHERE c.applied = 0`,
  ).all<any>();
  const rows = pending.results || [];
  if (!rows.length) return { ok: true, pending: 0 };

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    // 1) Decide the amount actually taken: the overpayment, capped at the
    //    member's current USDT (never drive a wallet negative).
    stmts.push(DB.prepare(
      `UPDATE convert_clawbacks
          SET taken_usdt = MIN(over_usdt, MAX(0, COALESCE(
                (SELECT available FROM wallets WHERE user_id = ? AND coin_symbol = 'USDT'), 0)))
        WHERE convert_id = ? AND applied = 0`,
    ).bind(r.user_id, r.convert_id));
    // 2) Debit the member.
    stmts.push(DB.prepare(
      `UPDATE wallets SET available = available - (SELECT taken_usdt FROM convert_clawbacks WHERE convert_id = ?)
        WHERE user_id = ? AND coin_symbol = 'USDT'`,
    ).bind(r.convert_id, r.user_id));
    // 3) Return it to the treasury that paid it.
    stmts.push(DB.prepare(
      `UPDATE wallets SET available = available + (SELECT taken_usdt FROM convert_clawbacks WHERE convert_id = ?)
        WHERE user_id = ? AND coin_symbol = 'USDT'`,
    ).bind(r.convert_id, r.treasury_user_id || 'admin-001'));
    // 4) Tell the member (English only).
    const day = String(r.filled_at || '').slice(0, 10);
    stmts.push(DB.prepare(
      `INSERT INTO notifications (id, user_id, type, title, message, data, is_read, created_at)
       SELECT ?, ?, 'convert', 'Convert adjustment',
              'Your staking-reward conversion of ' || ? || ' QTA on ' || ? ||
              ' was settled at the market price instead of the staking payout rate (KRW 10 per QTA). ' ||
              'The difference of ' || printf('%.2f', taken_usdt) || ' USDT has been adjusted from your USDT balance.',
              ?, 0, ?
         FROM convert_clawbacks WHERE convert_id = ?`,
    ).bind(crypto.randomUUID(), r.user_id, Number(r.from_amount).toLocaleString('en-US', { maximumFractionDigits: 4 }), day,
      JSON.stringify({ convert_id: r.convert_id, paid_usdt: r.paid_usdt, fair_usdt: r.fair_usdt, over_usdt: r.over_usdt, rule: 'OWNER_RULES §6 reward swap price' }),
      now, r.convert_id));
    // 5) Audit.
    stmts.push(DB.prepare(
      `INSERT INTO admin_audit_logs (id, admin_id, admin_email, action, target_type, target_id, payload, created_at)
       SELECT ?, 'system:reward-clawback', 'system@quantaex.io', 'convert.reward_clawback', 'user', ?,
              json_object('convert_id', convert_id, 'nickname', ?, 'email', ?, 'from_qta', from_amount,
                          'paid_usdt', paid_usdt, 'fair_usdt', fair_usdt, 'over_usdt', over_usdt,
                          'taken_usdt', taken_usdt, 'treasury', treasury_user_id, 'order', 'owner 2026-09-29 초과분 회수'), ?
         FROM convert_clawbacks WHERE convert_id = ?`,
    ).bind(crypto.randomUUID(), r.user_id, r.nickname || null, r.email || null, now, r.convert_id));
    // 6) Mark done — same transaction as the money movement.
    stmts.push(DB.prepare(
      `UPDATE convert_clawbacks SET applied = 1, applied_at = ? WHERE convert_id = ? AND applied = 0`,
    ).bind(now, r.convert_id));
  }
  await DB.batch(stmts); // atomic: all or nothing

  const done = await DB.prepare(
    `SELECT c.convert_id, u.nickname, c.from_amount, c.paid_usdt, c.fair_usdt, c.over_usdt, c.taken_usdt, c.applied_at
       FROM convert_clawbacks c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.applied_at`,
  ).all<any>();
  console.log('[reward-clawback] applied', JSON.stringify(done.results).slice(0, 800));
  return { ok: true, applied_now: rows.length, ledger: done.results };
}

// ============================================================================
// Double-paid matching bonus clawback — ONE-TIME, idempotent, atomic.
// ----------------------------------------------------------------------------
// ★ OWNER ORDER (2026-09-30): "잘못 쌓인 것들 잡으라고".
// /staker-reconcile found that the binary matching bonuses created
// 2026-09-01 14:38 UTC (before the 2026-09-03 "claimable" change, be6faa5)
// sit in these members' wallets TWICE: once credited at match time and again
// when the row (reset to claimed=0 on 09-03) was claimed. The 09-03 reversal
// only reached chogukho. Evidence per member: wallet − ledger = exactly the
// bonus amount. Only the proven duplicate is taken back; unexplained
// remainders (tree75 3,850 · namim 9,804 QTA) are reported, not touched.
// Taken from QTA first; if the member already swapped it, the rest is taken
// from USDT at the 10 KRW payout basis (the rate those swaps now settle at).
// Returned to the treasury (admin-001).
// ============================================================================
const MATCH_DOUBLE_PAID: { user_id: string; nickname: string; qta: number }[] = [
  { user_id: '3d7b1376-4e39-4dcb-9312-ecc57cc3ebf7', nickname: 'yesica', qta: 176416.66666667 },
  { user_id: '784ef18b-6879-4880-8215-b68ef7d332d7', nickname: 'parkjongbum', qta: 7250 },
  { user_id: '5e51e5d6-f4f1-4467-96bd-c61193749120', nickname: 'KIMYEONSIM', qta: 7250 },
  { user_id: '2a192ce4-bd04-40b7-9f0b-a1aae703be07', nickname: 'insillee', qta: 7250 },
  { user_id: '9a39fd6e-418c-4796-9836-5c39453575b5', nickname: 'tree75', qta: 7250 },
  { user_id: '5d3c4905-ef04-4812-9efd-9a7b628949d8', nickname: 'namim', qta: 7250 },
];

export async function runMatchDoubleClawback(env: ClawbackEnv): Promise<any> {
  const DB = env.DB;
  await DB.prepare(
    `CREATE TABLE IF NOT EXISTS match_double_clawbacks (
       user_id TEXT PRIMARY KEY, nickname TEXT, due_qta REAL NOT NULL,
       qta_taken REAL, usdt_taken REAL, qta_equiv_from_usdt REAL,
       applied INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), applied_at TEXT)`,
  ).run();
  for (const m of MATCH_DOUBLE_PAID) {
    await DB.prepare(`INSERT OR IGNORE INTO match_double_clawbacks (user_id, nickname, due_qta) VALUES (?,?,?)`)
      .bind(m.user_id, m.nickname, m.qta).run();
  }
  const pending = (await DB.prepare(`SELECT user_id, nickname, due_qta FROM match_double_clawbacks WHERE applied = 0`).all<any>()).results || [];
  if (!pending.length) return { ok: true, pending: 0 };
  const now = new Date().toISOString();
  const B = BASIS_USDT_PER_QTA;
  const stmts: D1PreparedStatement[] = [];
  for (const r of pending) {
    const uid = r.user_id;
    stmts.push(DB.prepare(
      `UPDATE match_double_clawbacks SET qta_taken = MIN(due_qta, MAX(0, COALESCE(
         (SELECT available FROM wallets WHERE user_id = ? AND coin_symbol = 'QTA'), 0))) WHERE user_id = ? AND applied = 0`).bind(uid, uid));
    stmts.push(DB.prepare(
      `UPDATE match_double_clawbacks SET usdt_taken = ROUND(MIN((due_qta - qta_taken) * ?, MAX(0, COALESCE(
         (SELECT available FROM wallets WHERE user_id = ? AND coin_symbol = 'USDT'), 0))), 6) WHERE user_id = ? AND applied = 0`).bind(B, uid, uid));
    stmts.push(DB.prepare(
      `UPDATE match_double_clawbacks SET qta_equiv_from_usdt = ROUND(usdt_taken / ?, 4) WHERE user_id = ? AND applied = 0`).bind(B, uid));
    stmts.push(DB.prepare(
      `UPDATE wallets SET available = available - (SELECT qta_taken FROM match_double_clawbacks WHERE user_id = ?)
        WHERE user_id = ? AND coin_symbol = 'QTA'`).bind(uid, uid));
    stmts.push(DB.prepare(
      `UPDATE wallets SET available_initial = MIN(COALESCE(available_initial,0), available) WHERE user_id = ? AND coin_symbol = 'QTA'`).bind(uid));
    stmts.push(DB.prepare(
      `UPDATE wallets SET available = available - (SELECT usdt_taken FROM match_double_clawbacks WHERE user_id = ?)
        WHERE user_id = ? AND coin_symbol = 'USDT'`).bind(uid, uid));
    stmts.push(DB.prepare(
      `UPDATE wallets SET available = available + (SELECT qta_taken FROM match_double_clawbacks WHERE user_id = ?)
        WHERE user_id = 'admin-001' AND coin_symbol = 'QTA'`).bind(uid));
    stmts.push(DB.prepare(
      `UPDATE wallets SET available = available + (SELECT usdt_taken FROM match_double_clawbacks WHERE user_id = ?)
        WHERE user_id = 'admin-001' AND coin_symbol = 'USDT'`).bind(uid));
    stmts.push(DB.prepare(
      `INSERT INTO notifications (id, user_id, type, title, message, data, is_read, created_at)
       SELECT ?, ?, 'earn', 'Matching bonus correction',
              'Your 2026-09-01 matching bonus of ' || CAST(CAST(due_qta AS INTEGER) AS TEXT) ||
              ' QTA was credited to your wallet twice due to a system error. The duplicate has been corrected: ' ||
              printf('%.2f', qta_taken) || ' QTA' ||
              CASE WHEN usdt_taken > 0 THEN ' and ' || printf('%.2f', usdt_taken) || ' USDT (for QTA already converted)' ELSE '' END ||
              ' adjusted from your balance.', ?, 0, ?
         FROM match_double_clawbacks WHERE user_id = ?`,
    ).bind(crypto.randomUUID(), uid, JSON.stringify({ rule: 'match double-credit 2026-09-01', due_qta: r.due_qta }), now, uid));
    stmts.push(DB.prepare(
      `INSERT INTO admin_audit_logs (id, admin_id, admin_email, action, target_type, target_id, payload, created_at)
       SELECT ?, 'system:match-clawback', 'system@quantaex.io', 'earn.match_double_clawback', 'user', user_id,
              json_object('nickname', nickname, 'due_qta', due_qta, 'qta_taken', qta_taken, 'usdt_taken', usdt_taken,
                          'qta_equiv_from_usdt', qta_equiv_from_usdt, 'basis', ?, 'order', 'owner 2026-09-30 잘못 쌓인 것 회수'), ?
         FROM match_double_clawbacks WHERE user_id = ?`,
    ).bind(crypto.randomUUID(), B, now, uid));
    stmts.push(DB.prepare(`UPDATE match_double_clawbacks SET applied = 1, applied_at = ? WHERE user_id = ? AND applied = 0`).bind(now, uid));
  }
  await DB.batch(stmts); // atomic
  const done = (await DB.prepare(`SELECT * FROM match_double_clawbacks ORDER BY due_qta DESC`).all<any>()).results;
  console.log('[match-clawback] applied', JSON.stringify(done).slice(0, 800));
  return { ok: true, applied_now: pending.length, ledger: done };
}

/** Read-only report for /reward-clawback-census. */
export async function rewardClawbackReport(env: ClawbackEnv): Promise<any> {
  const out: any = { generated_at: new Date().toISOString(), basis_usdt_per_qta: BASIS_USDT_PER_QTA };
  out.ledger = (await env.DB.prepare(
    `SELECT c.*, u.nickname, u.email,
            (SELECT available FROM wallets w WHERE w.user_id = c.user_id AND w.coin_symbol = 'USDT') AS usdt_now
       FROM convert_clawbacks c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.created_at`,
  ).all<any>().catch((e: any) => ({ results: String(e?.message || e) }))).results;
  out.match_double = (await env.DB.prepare(
    `SELECT m.*, (SELECT available FROM wallets w WHERE w.user_id = m.user_id AND w.coin_symbol='QTA') qta_now,
            (SELECT available FROM wallets w WHERE w.user_id = m.user_id AND w.coin_symbol='USDT') usdt_now
       FROM match_double_clawbacks m ORDER BY due_qta DESC`,
  ).all<any>().catch((e: any) => ({ results: String(e?.message || e) }))).results;
  out.treasury_qta = await env.DB.prepare(
    `SELECT available FROM wallets WHERE user_id = 'admin-001' AND coin_symbol = 'QTA'`,
  ).first<any>().catch(() => null);
  out.treasury_usdt = await env.DB.prepare(
    `SELECT available FROM wallets WHERE user_id = 'admin-001' AND coin_symbol = 'USDT'`,
  ).first<any>().catch(() => null);
  out.reward_fills_after_fix = (await env.DB.prepare(
    `SELECT id, user_id, from_amount, to_amount, price, filled_at FROM convert_orders
      WHERE source = 'staking_reward' AND status = 'filled' ORDER BY filled_at DESC LIMIT 20`,
  ).all<any>().catch(() => ({ results: [] }))).results;
  return out;
}
