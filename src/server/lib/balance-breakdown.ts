// ============================================================================
// balance-breakdown.ts
// ----------------------------------------------------------------------------
// QuantaEX has no single unified ledger table — credits to a wallet come from
// several places (welcome bonus, referral rewards, on-chain / admin deposits,
// withdrawals). This module reconstructs, for a given (user, coin), WHERE the
// current balance came from, so both the user and an admin can see a clear
// breakdown instead of a single opaque number.
//
// Balance model (per wallets row):
//   available          — spendable balance (trading + withdraw candidate)
//   locked             — held (open orders, unverified welcome bonus, pending
//                        withdrawals)
//   available_initial  — the portion of `available` that is COMPANY-ISSUED
//                        (welcome bonus + referral rewards + daily rewards +
//                        admin manual credit). Non-withdrawable.
//
// Decomposition we expose:
//   total          = available + locked
//   companyIssued  = available_initial            (non-withdrawable)
//     ├─ referral  = SUM(referrals.reward_qta) for this user & coin (QX only)
//     └─ otherBonus = companyIssued - referral    (welcome/daily/admin credit)
//   deposited      = SUM(completed deposits) - SUM(admin-credited deposits)
//   netExternal    = available - available_initial (withdrawable, from real
//                    deposits/trading P&L)
//
// We also return the raw source rows (deposits/withdrawals/referrals) so the
// UI can render a real chronological history.
// ============================================================================

export interface BalanceSourceRow {
  kind: 'welcome_bonus' | 'referral' | 'deposit' | 'admin_credit' | 'withdrawal';
  amount: number; // positive = credit, negative = debit
  label: string;
  ts?: string | null;
  meta?: Record<string, unknown>;
}

export interface BalanceBreakdown {
  coin: string;
  total: number;
  available: number;
  locked: number;
  companyIssued: number; // available_initial (non-withdrawable)
  withdrawable: number; // max(0, available - available_initial)
  parts: {
    referral: number; // company-issued via referrals
    welcomeAndOther: number; // company-issued minus referral (welcome/daily/admin)
    externalNet: number; // available - available_initial (real deposits/trading)
    lockedPending: number; // locked (orders / unverified bonus / pending wd)
  };
  sources: BalanceSourceRow[];
}

/**
 * Reconstruct a per-coin balance breakdown for one user.
 * Read-only: performs SELECTs only, never mutates.
 */
export async function computeBalanceBreakdown(
  db: D1Database,
  userId: string,
  coin: string,
): Promise<BalanceBreakdown> {
  const sym = coin.toUpperCase();

  // 1) Wallet row (source of truth for the current numbers)
  const wallet = await db
    .prepare(
      `SELECT available, locked, COALESCE(available_initial, 0) AS available_initial
       FROM wallets WHERE user_id = ? AND coin_symbol = ?`,
    )
    .bind(userId, sym)
    .first<{ available: number; locked: number; available_initial: number }>();

  const available = Number(wallet?.available || 0);
  const locked = Number(wallet?.locked || 0);
  const companyIssued = Number(wallet?.available_initial || 0);
  const total = available + locked;
  const withdrawable = Math.max(0, available - companyIssued);

  // 2) Referral rewards for this coin. Rewards are always issued in QX today,
  //    so for non-QX coins this is simply 0.
  let referralTotal = 0;
  const referralRows: BalanceSourceRow[] = [];
  if (sym === 'QX') {
    try {
      const r = await db
        .prepare(
          `SELECT r.reward_qta, r.level, r.created_at,
                  u.nickname AS referred_nickname
           FROM referrals r
           LEFT JOIN users u ON u.id = r.referred_id
           WHERE r.referrer_id = ?
           ORDER BY r.created_at DESC LIMIT 500`,
        )
        .bind(userId)
        .all<any>();
      for (const row of r.results || []) {
        const amt = Number(row.reward_qta || 0);
        referralTotal += amt;
        const lvl = Number(row.level || 1);
        referralRows.push({
          kind: 'referral',
          amount: amt,
          label: `L${lvl} referral${row.referred_nickname ? ` — ${row.referred_nickname}` : ''}`,
          ts: row.created_at,
          meta: { level: lvl },
        });
      }
    } catch {
      // level column may not exist yet in some environments — fall back to a
      // simple sum with no per-row detail.
      try {
        const r = await db
          .prepare(
            `SELECT COALESCE(SUM(reward_qta),0) AS s
             FROM referrals WHERE referrer_id = ?`,
          )
          .bind(userId)
          .first<{ s: number }>();
        referralTotal = Number(r?.s || 0);
      } catch {
        /* ignore */
      }
    }
  }

  // 3) Deposits for this coin. Admin manual credits are also stored in
  //    `deposits` with a tx_hash prefixed "admin-", so we split them out.
  const depositRows: BalanceSourceRow[] = [];
  try {
    const d = await db
      .prepare(
        `SELECT amount, tx_hash, status, created_at
         FROM deposits
         WHERE user_id = ? AND coin_symbol = ? AND status = 'completed'
         ORDER BY created_at DESC LIMIT 200`,
      )
      .bind(userId, sym)
      .all<any>();
    for (const row of d.results || []) {
      const isAdmin =
        typeof row.tx_hash === 'string' && row.tx_hash.startsWith('admin-');
      depositRows.push({
        kind: isAdmin ? 'admin_credit' : 'deposit',
        amount: Number(row.amount || 0),
        label: isAdmin ? 'Admin credit' : 'Deposit',
        ts: row.created_at,
        meta: { tx_hash: row.tx_hash },
      });
    }
  } catch {
    /* ignore */
  }

  // 4) Withdrawals for this coin (debits).
  const withdrawalRows: BalanceSourceRow[] = [];
  try {
    const w = await db
      .prepare(
        `SELECT amount, fee, status, created_at
         FROM withdrawals
         WHERE user_id = ? AND coin_symbol = ?
           AND status IN ('completed','processing','pending','approved')
         ORDER BY created_at DESC LIMIT 200`,
      )
      .bind(userId, sym)
      .all<any>();
    for (const row of w.results || []) {
      withdrawalRows.push({
        kind: 'withdrawal',
        amount: -Number(row.amount || 0),
        label: `Withdrawal (${row.status})`,
        ts: row.created_at,
        meta: { fee: Number(row.fee || 0), status: row.status },
      });
    }
  } catch {
    /* ignore */
  }

  // 5) Welcome / daily / admin-non-deposit bonus = company-issued minus the
  //    part we can attribute to referrals. This is the residual that has no
  //    dedicated table row (welcome bonus is only reflected in
  //    available_initial). Never negative.
  const welcomeAndOther = Math.max(0, companyIssued - referralTotal);

  const externalNet = available - companyIssued;

  // Assemble a synthetic "welcome bonus" source row so the user sees it.
  const sources: BalanceSourceRow[] = [];
  if (welcomeAndOther > 0) {
    sources.push({
      kind: 'welcome_bonus',
      amount: welcomeAndOther,
      label: 'Sign-up bonus / rewards',
    });
  }
  sources.push(...referralRows, ...depositRows, ...withdrawalRows);
  // Sort newest-first where we have timestamps; undated (welcome) stays on top.
  sources.sort((a, b) => {
    if (!a.ts && b.ts) return -1;
    if (a.ts && !b.ts) return 1;
    if (!a.ts && !b.ts) return 0;
    return (b.ts as string).localeCompare(a.ts as string);
  });

  return {
    coin: sym,
    total,
    available,
    locked,
    companyIssued,
    withdrawable,
    parts: {
      referral: referralTotal,
      welcomeAndOther,
      externalNet,
      lockedPending: locked,
    },
    sources,
  };
}
