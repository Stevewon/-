import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware } from '../middleware/auth';
import { assignBinaryLeg, rollStakeUpBinary } from '../lib/binary-matching';
import { getFeeExemption } from '../utils/fees';

// ---------------------------------------------------------------------------
// QTA Staking API (official tier plan)
//
// FLOW
//   Stake:     user stakes USDT in $100 increments; tier (daily rate) chosen
//              by USDT band + term. Principal (USDT) is locked out of wallet.
//   Dividend:  denominated in USD = principal_usd * daily_rate * elapsed_days
//              (simple interest, no compounding), accrued daily, paid AS QTA.
//   Lock:      each position matures on its OWN start date + the product term
//              (180/360d). Redeeming before that position's maturity is an
//              early exit: 30% penalty on (principal + accrued dividend), then
//              net off already-taken QTA at today's price, remainder as USDT.
//              At/after maturity: keep dividend + full principal, no penalty.
//              Positions never merge — each stake is settled independently.
//   Payout:    dividend QTA credited on redeem/claim; company-issued
//              (available_initial bumped so it stays internal).
//   Withdraw:  a dedicated staking-dividend withdrawal (QTA), 100-QTA
//              increments, flat 5% fee (95 QTA net on 100 requested).
//   Referral:  when dividend is credited, L1 referrer gets 10% and L2 gets
//              5% of that dividend value, paid as QTA (company-issued).
//
// FUND SAFETY: subscribe uses an atomic conditional balance lock; redeem uses
// a claim-first status flip so a position can't be redeemed twice.
// ---------------------------------------------------------------------------

const app = new Hono<AppEnv>();

const uuid = () => crypto.randomUUID();
const MS_PER_DAY = 86_400_000;
const EARLY_PENALTY = 0.30;          // 30% penalty on (principal + dividend) for early exit
const WITHDRAW_FEE = 0.05;           // 5% flat fee on dividend withdrawal
const WITHDRAW_UNIT_QTA = 100;       // 100-QTA increments
const MATCH_L1 = 0.10;               // 1st-level referral match
const MATCH_L2 = 0.05;               // 2nd-level referral match
const STAKE_UNIT_USD = 100;          // $100 increments

// ★ OWNER RULE (2026-09-01): FIXED 6-WON ENTRY-PRICE WINDOW ─────────────────
//   For 2026-09-01 through 2026-09-11 (KST, 11 days — extended +1 day) the QTA "entry price"
//   used to derive the STAKED QUANTITY (dividend basis) and to convert the
//   DIVIDEND WITHDRAWAL is FIXED at 6원, with USDT pegged at 1,450원/USD.
//     6원 ÷ 1,450원/USD = $0.00413793 per QTA.
//   This ONLY affects staking (entry/dividend/withdraw conversion). It does
//   NOT touch the live exchange trading price. Outside the window we fall back
//   to the managed band center (price-independent) as before.
const FIXED_USDT_KRW = 1450;                       // 테더 고정 환율 (1 USD = 1,450원)
const FIXED_QTA_KRW = 6;                            // QTA 고정 진입가 (개당 6원)
const FIXED_QTA_USD = FIXED_QTA_KRW / FIXED_USDT_KRW; // = $0.00413793.../QTA
// Window in KST day-index terms (kstDayIndex). 2026-09-01 KST 00:00 .. 2026-09-11 KST 23:59.
const FIXED_WINDOW_START_MS = Date.parse('2026-09-01T00:00:00+09:00');
const FIXED_WINDOW_END_MS   = Date.parse('2026-09-12T00:00:00+09:00'); // exclusive (through 09-11 KST — extended +1 day)

// True if `nowMs` falls inside the fixed 6-won staking window (KST).
function inFixedWindow(nowMs: number): boolean {
  return nowMs >= FIXED_WINDOW_START_MS && nowMs < FIXED_WINDOW_END_MS;
}

async function qtaPrice(c: any): Promise<number> {
  const row = await c.env.DB.prepare(
    `SELECT price_usd FROM coins WHERE symbol = 'QTA'`
  ).first<any>();
  const p = row?.price_usd || 0;
  return p > 0 ? p : 0.01; // fallback so we never divide by zero
}

// ★ OWNER RULE (2026-09-01): the "staked QTA quantity" that the FIXED daily
//   dividend is computed from must NOT move with the live market price. For
//   positions that recorded their own staked quantity (principal_qta) or their
//   stake-time price (qta_price_at_stake) we use those. But admin-GRANTED
//   positions (migration 0056) locked no QTA — principal_qta = 0 and
//   qta_price_at_stake = 0 — so their staked quantity has to be DERIVED from
//   principal_usd ONCE, at a STABLE reference price, not the live price.
//   We use the managed band CENTER (coins.price_center) as that stable
//   reference so the derived staked quantity — and therefore every future
//   daily dividend — is completely price-independent. Falls back to the live
//   QTA price only if no center is configured.
async function qtaStakeBasisPrice(c: any): Promise<number> {
  // ★ 2026-09-01 ~ 09-10 (KST): fixed 6원 entry price (USDT pegged 1,450원).
  if (inFixedWindow(Date.now())) return FIXED_QTA_USD;
  const row = await c.env.DB.prepare(
    `SELECT price_usd, price_mode, price_center FROM coins WHERE symbol = 'QTA'`
  ).first<any>();
  const center = Number(row?.price_center || 0);
  if (row?.price_mode === 'managed' && center > 0) return center;
  const live = Number(row?.price_usd || 0);
  return live > 0 ? live : 0.01;
}

// The QTA price (USD) used to CONVERT a staking-dividend WITHDRAWAL amount.
// During the fixed window this is the 6원 peg ($0.00413793); otherwise it is
// the live QTA price. (Part "C" of the owner rule: withdraw at 6원 / 1,450원.)
async function qtaWithdrawPrice(c: any): Promise<number> {
  if (inFixedWindow(Date.now())) return FIXED_QTA_USD;
  return qtaPrice(c);
}

// Live USDT price (USD). Normally 1.00, but read from coins so a peg change
// is respected. Fallback 1.00.
async function usdtPrice(c: any): Promise<number> {
  const row = await c.env.DB.prepare(
    `SELECT price_usd FROM coins WHERE symbol = 'USDT'`
  ).first<any>();
  const p = row?.price_usd || 0;
  return p > 0 ? p : 1.0;
}

// KST(한국 표준시, UTC+9) offset in ms — dividends roll over at KST midnight.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// The KST calendar-day index for an instant (ms since epoch). Two instants on
// the SAME Korean calendar day share the same index; each crossing of KST
// midnight (00:00 한국시각) increments it by exactly 1. Implemented by shifting
// the UTC clock forward 9h and flooring to whole days — no Date/timezone libs
// needed (Workers runtime is UTC-only).
function kstDayIndex(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / MS_PER_DAY);
}

// Accrued dividend in USD for a position, capped at the full term.
//
// ★ Owner rule (2026-08-31, REVISED — CALENDAR-DAY / KST): dividends accrue by
//   KOREAN CALENDAR DATE, not by elapsed 24h clock. Income starts the day AFTER
//   subscription (D+1) and steps up by ONE whole day every time the Korean
//   calendar date rolls over at KST midnight (한국시각 자정) — regardless of the
//   time-of-day the member subscribed.
//     • subscribe 토요일 (any time)         → 0 days  (당일은 0)
//     • 일요일 (KST 자정 1번 지남)            → 1 day
//     • 월요일 (KST 자정 2번 지남)            → 2 days   … and so on.
//   So a Saturday entrant, once it is Monday in Korea, is paid 2 days
//   (일요일치 + 월요일치) — matching the owner's "날이 바뀌었으니 2회" rule.
//   completedDays = (오늘 KST 날짜 - 진입 KST 날짜), clamped to [0, term_days].
function accruedUsd(p: {
  principal_usd: number;
  daily_rate: number;
  term_days: number;
  created_at: string | null;
}, nowMs: number): number {
  const start = p.created_at ? Date.parse(p.created_at) : nowMs;
  const startMs = isNaN(start) ? nowMs : start;
  // Whole Korean calendar days elapsed since subscription (D+1 = first payout).
  const dayDiff = kstDayIndex(nowMs) - kstDayIndex(startMs);
  const completedDays = Math.max(0, dayDiff);
  const cappedDays = Math.min(completedDays, p.term_days || 0);
  const usd = (p.principal_usd || 0) * (p.daily_rate || 0) * cappedDays;
  return isFinite(usd) ? usd : 0;
}

// Whole Korean calendar days accrued for a position (D+1 = first payout),
// clamped to [0, term_days]. Same KST-midnight rule as accruedUsd.
function accruedDays(p: { term_days: number; created_at: string | null }, nowMs: number): number {
  const start = p.created_at ? Date.parse(p.created_at) : nowMs;
  const startMs = isNaN(start) ? nowMs : start;
  const dayDiff = kstDayIndex(nowMs) - kstDayIndex(startMs);
  const completedDays = Math.max(0, dayDiff);
  return Math.min(completedDays, p.term_days || 0);
}

// ★ OWNER RULE (2026-09-01): the dividend is paid in a FIXED QTA QUANTITY,
//   NOT a USD value converted at the live price. The daily dividend is a
//   percentage of the STAKED QTA PRINCIPAL QUANTITY, so the member always
//   receives the same QTA amount per day regardless of how the QTA price
//   moves.  dividend_qta = principal_qta × daily_rate × KST-days.
//   (principal_qta = the QTA quantity actually locked when staking.)
function accruedQta(p: {
  principal_qta?: number;
  principal?: number;
  principal_usd?: number;
  qta_price_at_stake?: number;
  daily_rate: number;
  term_days: number;
  created_at: string | null;
}, nowMs: number, basisPrice: number): number {
  const days = accruedDays(p, nowMs);
  const principalQta = stakedQtyOf(p, basisPrice);
  const qta = principalQta * (p.daily_rate || 0) * days;
  return isFinite(qta) ? qta : 0;
}

// Resolve a position's canonical STAKED QTA QUANTITY (price-independent basis
// for the fixed daily dividend). Order of truth:
//   1) principal_qta — the QTA quantity actually locked at stake time.
//   2) principal      — legacy column that also stored the staked QTA quantity.
//   3) principal_usd / qta_price_at_stake — derive from the STAKE-TIME price.
//   4) principal_usd / basisPrice — admin-GRANTED positions locked no QTA and
//      recorded no stake price, so derive ONCE at the stable band-center price
//      (basisPrice). This never uses the live market price, so the resulting
//      staked quantity — and every future daily dividend — is price-independent.
function stakedQtyOf(p: {
  principal_qta?: number;
  principal?: number;
  principal_usd?: number;
  qta_price_at_stake?: number;
}, basisPrice: number): number {
  const explicit = Number(p.principal_qta || p.principal || 0);
  if (explicit > 0) return explicit;
  const stakePrice = Number(p.qta_price_at_stake || 0);
  if (stakePrice > 0) return Number(p.principal_usd || 0) / stakePrice;
  const basis = Number(basisPrice) > 0 ? Number(basisPrice) : 0;
  return basis > 0 ? Number(p.principal_usd || 0) / basis : 0;
}

// Credit a QTA amount to a user as company-issued (internal, non-withdrawable
// beyond the staking-dividend withdrawal path). Creates wallet row if missing.
async function creditQta(c: any, userId: string, qta: number) {
  if (qta <= 0) return;
  const upd = await c.env.DB.prepare(
    `UPDATE wallets SET available = available + ?,
            available_initial = COALESCE(available_initial,0) + ?
      WHERE user_id = ? AND coin_symbol = 'QTA'`
  ).bind(qta, qta, userId).run();
  if (!upd.meta || upd.meta.changes === 0) {
    await c.env.DB.prepare(
      `INSERT INTO wallets (id, user_id, coin_symbol, available, available_initial)
       VALUES (?,?, 'QTA', ?, ?)`
    ).bind(uuid(), userId, qta, qta).run();
  }
}

// Pay referral match bonuses for a dividend of `usdValue` earned by `stakerId`.
//
// ★ RETIRED (owner rule 2026-08-26): the old L1 10% / L2 5% dividend-match
//   program has been replaced by the binary left/right MATCHING BONUS. The old
//   "Referral Match — Level 1/Level 2" panel was removed from the Earn page and
//   this payout is now DISABLED. Kept as a no-op (guarded below) for audit
//   history; flip DIVIDEND_REFERRAL_MATCH_ENABLED to re-enable if ever needed.
const DIVIDEND_REFERRAL_MATCH_ENABLED = false;
async function payReferralMatch(c: any, stakerId: string, usdValue: number, price: number, positionId: string) {
  if (!DIVIDEND_REFERRAL_MATCH_ENABLED) return; // retired — see note above
  if (usdValue <= 0) return;
  // L1: who referred the staker?
  const l1 = await c.env.DB.prepare(
    `SELECT referrer_id FROM referrals WHERE referred_id = ?`
  ).bind(stakerId).first<any>();
  if (!l1?.referrer_id) return;

  const l1Usd = usdValue * MATCH_L1;
  const l1Qta = l1Usd / price;
  await creditQta(c, l1.referrer_id, l1Qta);
  await c.env.DB.prepare(
    `INSERT INTO staking_dividends (id, position_id, user_id, kind, usd_amount, qta_amount, qta_price, source_user_id)
     VALUES (?,?,?, 'match_l1', ?,?,?,?)`
  ).bind(uuid(), positionId, l1.referrer_id, l1Usd, l1Qta, price, stakerId).run();

  // L2: who referred the L1 referrer?
  const l2 = await c.env.DB.prepare(
    `SELECT referrer_id FROM referrals WHERE referred_id = ?`
  ).bind(l1.referrer_id).first<any>();
  if (!l2?.referrer_id) return;

  const l2Usd = usdValue * MATCH_L2;
  const l2Qta = l2Usd / price;
  await creditQta(c, l2.referrer_id, l2Qta);
  await c.env.DB.prepare(
    `INSERT INTO staking_dividends (id, position_id, user_id, kind, usd_amount, qta_amount, qta_price, source_user_id)
     VALUES (?,?,?, 'match_l2', ?,?,?,?)`
  ).bind(uuid(), positionId, l2.referrer_id, l2Usd, l2Qta, price, stakerId).run();
}

// --------------------------------------------------------------------------
// GET /products — active tier catalog (public).
// --------------------------------------------------------------------------
app.get('/products', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, coin_symbol, kind, min_usd, max_usd, term_days, daily_rate,
            payout_coin, sort_order
       FROM staking_products
      WHERE is_active = 1
      ORDER BY sort_order ASC`
  ).all();
  const price = await qtaPrice(c);
  const products = (results || []).map((p: any) => ({
    ...p,
    total_return: (p.daily_rate * p.term_days), // e.g. 0.36 = 36%
    unit_usd: STAKE_UNIT_USD,
  }));
  return c.json({ products, qta_price: price, stake_unit_usd: STAKE_UNIT_USD });
});

// --------------------------------------------------------------------------
// GET /binary/stake-headroom — how much of THIS user's next stake will actually
// count toward their DIRECT sponsor's binary downline before hitting the hard
// PER-LEG 2× 몸값 cap. Drives the stake-entry warning popup ("얼마까지 가능").
// ----------------------------------------------------------------------------
// Owner rule (2026-08-28, revised): the 2× cap is a HARD, PER-LEG ceiling —
// each of the sponsor's legs may hold up to 2 × self_usd INDEPENDENTLY. When a
// member stakes $X, it rolls up to the ONE leg they are placed on; only the
// portion that fits under THAT leg's remaining room matches — the rest is
// DROPPED (no parking). We surface that leg's room here so the UI can warn the
// user to size their principal to fit (e.g. 몸값 $1,000 → each leg up to $2,000;
// if my leg already holds $2,100 worth, only $2,000 was ever admissible).
//
// Response:
//   has_sponsor      : is this user placed under a sponsor at all?
//   leg_assigned     : has the sponsor chosen this user's L/R leg yet?
//   leg              : which leg this user is on ('L' | 'R' | null)
//   sponsor_self_usd : sponsor's own 몸값
//   sponsor_cap_usd  : per-leg cap = 2 × self_usd
//   sponsor_leg_usd  : current volume already on MY leg
//   headroom_usd     : remaining room on MY leg = max(0, cap - leg_usd)  ← "얼마까지 가능"
//   uncapped         : true if there is effectively no binding cap for this
//                      stake (no sponsor, or leg not yet assigned so nothing
//                      rolls up yet) — UI shows no ceiling warning.
// --------------------------------------------------------------------------
app.get('/binary/stake-headroom', authMiddleware, async (c) => {
  const user = c.get('user');

  // Who is this user's direct sponsor, and on which leg are they placed?
  const me = await c.env.DB.prepare(
    `SELECT binary_parent_id, binary_leg FROM users WHERE id = ?`
  ).bind(user.id).first<any>().catch(() => null);

  const sponsorId: string | null = me?.binary_parent_id || null;
  const legRaw = me?.binary_leg;
  const legAssigned = legRaw === 'L' || legRaw === 'R';

  // Top-level user (no sponsor) OR leg not yet chosen => nothing rolls up to a
  // parent yet, so there is no binding downline cap for this stake.
  if (!sponsorId || sponsorId === user.id || !legAssigned) {
    return c.json({
      has_sponsor: !!(sponsorId && sponsorId !== user.id),
      leg_assigned: legAssigned,
      uncapped: true,
      headroom_usd: null,
      sponsor_self_usd: 0,
      sponsor_cap_usd: 0,
      sponsor_downline_usd: 0,
      leg: legAssigned ? legRaw : null,
    });
  }

  // Sponsor's per-leg volume + own 몸값 drive the hard PER-LEG 2× cap.
  const vol = await c.env.DB.prepare(
    `SELECT left_usd, right_usd, self_usd FROM binary_volume WHERE user_id = ?`
  ).bind(sponsorId).first<any>().catch(() => null);

  const selfUsd = Number(vol?.self_usd || 0);
  const left = Number(vol?.left_usd || 0);
  const right = Number(vol?.right_usd || 0);
  const capUsd = selfUsd * 2;                       // per-leg cap = 2× 몸값
  const legUsd = legRaw === 'R' ? right : left;     // volume already on MY leg
  const headroomUsd = Math.max(0, capUsd - legUsd); // room on MY leg only

  return c.json({
    has_sponsor: true,
    leg_assigned: true,
    uncapped: false,
    leg: legRaw,
    sponsor_self_usd: selfUsd,
    sponsor_cap_usd: capUsd,                         // per-leg cap
    sponsor_downline_usd: left + right,             // both legs (info only)
    sponsor_leg_usd: legUsd,                         // current volume on my leg
    headroom_usd: headroomUsd,                       // ← "얼마까지 가능" (USD, my leg)
  });
});

// --------------------------------------------------------------------------
// GET /positions — user's active positions with live accrual (in USD + QTA).
// --------------------------------------------------------------------------
app.get('/positions', authMiddleware, async (c) => {
  const user = c.get('user');
  const now = Date.now();
  const price = await qtaPrice(c);
  // Stable, price-independent basis for deriving the staked quantity of
  // admin-granted positions (band center). NOT the live price.
  const basis = await qtaStakeBasisPrice(c);

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM staking_positions
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at DESC`
  ).bind(user.id).all();

  const positions = ((results || []) as any[]).map((p) => {
    const divUsd = accruedUsd(p, now);
    // ★ QTA dividend is a FIXED fraction of the STAKED QTA quantity — NOT the
    //   USD value re-converted at the live price. This guarantees the member
    //   receives the same QTA amount per day no matter how the price moves.
    const divQta = accruedQta(p, now, basis);
    const termEnd = p.term_end_at ? Date.parse(p.term_end_at) : now;
    const matured = now >= termEnd;          // this position's own term reached
    const principalQta = stakedQtyOf(p, basis);
    return {
      ...p,
      principal_qta: principalQta,
      accrued_dividend_usd: divUsd,
      accrued_dividend_qta: divQta,
      // Normal (penalty-free) redeem is allowed only once THIS position's own
      // term (180/360d from its own start date) has been reached. Before that
      // it is an early exit. Each position has its own term_end_at.
      can_redeem: matured,
      matured,
      term_end_at: p.term_end_at,
    };
  });

  const summary = {
    totalPrincipalUsd: positions.reduce((s, p) => s + (p.principal_usd || 0), 0),
    totalDividendUsd: positions.reduce((s, p) => s + (p.accrued_dividend_usd || 0), 0),
    totalDividendQta: positions.reduce((s, p) => s + (p.accrued_dividend_qta || 0), 0),
  };
  return c.json({ positions, summary, qta_price: price });
});

// --------------------------------------------------------------------------
// POST /subscribe { product_id, amount_usd? , amount_qta? }
// Stakes QTA (bought on the exchange) into a tier. The tier band is USD, but
// the staked asset is QTA: the required QTA quantity is derived from the LIVE
// QTA price at stake time. Caller may send either a USD target (amount_usd) or
// the QTA quantity directly (amount_qta) — they're two views of the same stake.
//   required_qta   = amount_usd / price      (when USD target given)
//   principal_usd  = qta_qty * price         (locked-in USD value at stake)
// Dividend math stays USD-denominated off principal_usd; principal returns in
// QTA (the same quantity that was staked).
// --------------------------------------------------------------------------
app.post('/subscribe', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const productId = String(body.product_id || '');
  const price = await qtaPrice(c);              // live QTA price (USD)

  if (!productId) return c.json({ error: 'product_id required' }, 400);

  const product = await c.env.DB.prepare(
    `SELECT * FROM staking_products WHERE id = ? AND is_active = 1`
  ).bind(productId).first<any>();
  if (!product) return c.json({ error: 'Product not found' }, 404);

  // ── OWNER RULE (2026-08-28, FINAL): STAKING-BINARY SPONSOR — chosen ONCE ──
  //   The staking binary tree is SEPARATE from the free-signup referral tree.
  //   On a member's FIRST staking subscription they may supply a `sponsor_code`
  //   (the sponsor's referral_code). We bind that sponsor as their permanent
  //   binary_parent_id (binary_leg stays NULL — the sponsor picks L/R later).
  //   This choice is IRREVERSIBLE: once binary_parent_id is set it is never
  //   changed by a later stake, and any sponsor_code sent again is ignored.
  {
    const me = await c.env.DB.prepare(
      `SELECT binary_parent_id FROM users WHERE id = ?`
    ).bind(user.id).first<any>();
    const alreadyBound = !!me?.binary_parent_id;
    // The sponsor identifier the member typed. Users naturally enter the
    // sponsor's ID (nickname / email), NOT the 8-char referral_code — so we
    // accept ANY of: nickname, email, referral_code, or raw user id. Matching
    // is case/whitespace-insensitive.
    const sponsorRaw = body.sponsor_code != null ? String(body.sponsor_code).trim() : '';
    const sponsorUpper = sponsorRaw.toUpperCase();
    const sponsorLower = sponsorRaw.toLowerCase();

    if (!alreadyBound && sponsorRaw) {
      // Resolve by (a) exact referral_code, (b) case-insensitive referral_code,
      // (c) case-insensitive nickname, (d) lowercased email, (e) raw user id.
      let sponsor = await c.env.DB.prepare(
        `SELECT id FROM users
          WHERE referral_code = ?1
             OR UPPER(TRIM(referral_code)) = ?1
             OR LOWER(TRIM(nickname)) = ?2
             OR LOWER(TRIM(email)) = ?2
             OR id = ?3
          LIMIT 1`
      ).bind(sponsorUpper, sponsorLower, sponsorRaw).first<any>();
      if (!sponsor) {
        // Echo what we searched for so an input mismatch is visible client-side.
        return c.json({
          error: 'SPONSOR_NOT_FOUND',
          message: `추천인을 찾을 수 없습니다: ${sponsorRaw} (닉네임/이메일/추천코드 중 하나를 정확히 입력하세요)`,
        }, 400);
      }
      if (sponsor.id === user.id) {
        return c.json({ error: 'SPONSOR_SELF', message: 'You cannot set yourself as your sponsor.' }, 400);
      }
      // ⚑ OWNER RULE (2026-08-28): the chosen sponsor MUST have staked first.
      //   A member cannot be set as someone's staking sponsor unless they
      //   themselves hold at least one ACTIVE staking position. Otherwise the
      //   downline is blocked with "추천인 자격이 없습니다" and NO binding is made.
      const sponsorHasStake = await c.env.DB.prepare(
        `SELECT 1 FROM staking_positions
          WHERE user_id = ? AND status = 'active' LIMIT 1`
      ).bind(sponsor.id).first<any>();
      if (!sponsorHasStake) {
        return c.json({
          error: 'SPONSOR_NOT_QUALIFIED',
          message: '추천인 자격이 없습니다. (추천인이 먼저 스테이킹을 완료해야 합니다.)',
        }, 400);
      }
      // Race-safe: only bind when still unset. binary_leg stays NULL so the
      // sponsor can assign Left/Right from their own dashboard exactly once.
      await c.env.DB.prepare(
        `UPDATE users SET binary_parent_id = ?, binary_leg = NULL
          WHERE id = ? AND binary_parent_id IS NULL`
      ).bind(sponsor.id, user.id).run();
    } else if (!alreadyBound && !sponsorRaw) {
      // First stake with NO sponsor code — allowed only for top-level members.
      // We simply leave binary_parent_id NULL (a standalone binary root).
    }
    // If alreadyBound: ignore any sponsor_code — the binary sponsor is locked.
  }

  // ── OWNER RULE (2026-08-27): SPONSOR-MUST-STAKE-FIRST gate ────────────────
  // A member may stake ONLY IF their DIRECT sponsor (binary_parent_id) has
  // themselves staked (holds at least one ACTIVE staking position). If the
  // sponsor has not staked, the whole downline is blocked from staking at all
  // — not just from earning. Top-level users (no sponsor) are unaffected.
  try {
    const me = await c.env.DB.prepare(
      `SELECT binary_parent_id FROM users WHERE id = ?`
    ).bind(user.id).first<any>();
    const sponsorId = me?.binary_parent_id || null;
    if (sponsorId && sponsorId !== user.id) {
      const sponsorStake = await c.env.DB.prepare(
        `SELECT 1 FROM staking_positions
          WHERE user_id = ? AND status = 'active' LIMIT 1`
      ).bind(sponsorId).first<any>();
      if (!sponsorStake) {
        return c.json({
          error: 'SPONSOR_NOT_STAKED',
          message: '추천인(스폰서)이 먼저 스테이킹을 완료해야 스테이킹이 가능합니다.',
        }, 403);
      }
    }
  } catch (e) {
    // If the sponsor lookup itself fails (schema gap), fail SAFE = block,
    // since the owner rule is a hard gate. Log for diagnosis.
    console.warn('[earn] sponsor-stake gate lookup failed:', e);
    return c.json({ error: 'SPONSOR_CHECK_FAILED' }, 503);
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Resolve the stake into a QTA quantity + its USD value at the live price.
  // Prefer an explicit QTA quantity; otherwise convert the USD target.
  let qtaQty = Number(body.amount_qta);
  let amountUsd = Number(body.amount_usd);
  if (isFinite(qtaQty) && qtaQty > 0) {
    amountUsd = qtaQty * price;
  } else if (isFinite(amountUsd) && amountUsd > 0) {
    qtaQty = amountUsd / price;
  } else {
    return c.json({ error: 'Invalid amount' }, 400);
  }
  if (!isFinite(qtaQty) || qtaQty <= 0 || !isFinite(amountUsd) || amountUsd <= 0) {
    return c.json({ error: 'Invalid amount' }, 400);
  }

  // Validate the USD value against the tier band.
  if (amountUsd < product.min_usd) {
    return c.json({ error: `Minimum for this tier is $${product.min_usd}` }, 400);
  }
  if (product.max_usd != null && amountUsd > product.max_usd) {
    return c.json({ error: `Maximum for this tier is $${product.max_usd}` }, 400);
  }

  // Lock the QTA principal atomically from the user's available balance.
  const lockRes = await c.env.DB.prepare(
    `UPDATE wallets SET available = available - ?, locked = COALESCE(locked,0) + ?
      WHERE user_id = ? AND coin_symbol = 'QTA' AND available >= ?`
  ).bind(qtaQty, qtaQty, user.id, qtaQty).run();
  if (!lockRes.meta || lockRes.meta.changes === 0) {
    return c.json({ error: 'Insufficient QTA balance' }, 400);
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  // Each position matures on its OWN start date + the product term (180/360d).
  const termEndIso = new Date(now + product.term_days * MS_PER_DAY).toISOString();
  const lockEndIso = termEndIso; // legacy column kept in sync with term end
  const posId = uuid();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO staking_positions
        (id, user_id, product_id, coin_symbol, kind, apr, principal,
         accrued_interest, status, lock_days,
         principal_usd, principal_qta, qta_price_at_stake,
         daily_rate, term_days, accrued_dividend_usd,
         paid_dividend_qta, payout_coin, lock_end_at, term_end_at,
         last_accrued_at, created_at)
       VALUES (?,?,?, 'QTA','fixed', ?, ?, 0, 'active', ?,
               ?,?,?, ?,?,0, 0, 'QTA', ?,?, ?, ?)`
    ).bind(posId, user.id, product.id, product.total_return || (product.daily_rate * product.term_days),
           qtaQty, product.term_days,
           amountUsd, qtaQty, price,
           product.daily_rate, product.term_days,
           lockEndIso, termEndIso, nowIso, nowIso),
    c.env.DB.prepare(
      `UPDATE staking_products SET total_staked = COALESCE(total_staked,0) + ?, updated_at = ?
        WHERE id = ?`
    ).bind(amountUsd, nowIso, product.id),
  ]);

  // ── OWNER RULE (2026-08-28): 몸값(self_usd) = STAKING SUBSCRIPTION ONLY ──────
  //   The member's 몸값 grows by the USD value of the QTA that was ACTUALLY
  //   DEDUCTED for this stake (qtaQty × the live QTA price used above). This is
  //   the ONLY thing that accrues self_usd / binary volume — deposits and
  //   USDT→QTA buys do NOT. Roll it up the binary ancestry synchronously so the
  //   stake takes effect immediately, then stamp binary_counted_at so the cron
  //   safety-net sweeper never double-counts this position.
  const stakedUsd = qtaQty * price; // exact deducted QTA valued at stake price
  // ★ 2026-09-01~09-10 (KST): binary MATCH BONUS QTA payout must convert at the
  //   6원 fixed peg ($0.00413793), same rule as staking dividends — NOT the live
  //   QTA price. Volume (stakedUsd) stays live-valued; only the bonus→QTA price
  //   is pegged. Outside the window, matchPrice == live price.
  const matchPrice = await qtaStakeBasisPrice(c);
  try {
    await rollStakeUpBinary(c.env.DB, user.id, stakedUsd, matchPrice);
    await c.env.DB.prepare(
      `UPDATE staking_positions SET binary_counted_at = datetime('now')
        WHERE id = ? AND binary_counted_at IS NULL`
    ).bind(posId).run();
  } catch (e) {
    // If the synchronous roll-up fails (e.g. schema gap), we intentionally
    // leave binary_counted_at NULL so the cron binaryMatchingTick sweeper will
    // pick this position up and roll it in later. The stake itself is safe.
    console.warn('[earn] stake->binary roll-up failed (cron will retry):', e);
  }
  // ────────────────────────────────────────────────────────────────────────────

  return c.json({
    ok: true, position_id: posId,
    staked_qta: qtaQty, principal_usd: amountUsd, qta_price: price,
    lock_end_at: lockEndIso, term_end_at: termEndIso,
  });
});

// --------------------------------------------------------------------------
// POST /claim { position_id }
// Credits accrued QTA dividend WITHOUT closing the position. Dividends accrue
// daily in real time, so a claim is allowed anytime there is unclaimed
// dividend (the principal stays staked until maturity or early exit). Pays
// referral match on the credited amount.
// --------------------------------------------------------------------------
app.post('/claim', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const positionId = String(body.position_id || '');
  if (!positionId) return c.json({ error: 'position_id required' }, 400);

  const pos = await c.env.DB.prepare(
    `SELECT * FROM staking_positions WHERE id = ? AND user_id = ?`
  ).bind(positionId, user.id).first<any>();
  if (!pos) return c.json({ error: 'Position not found' }, 404);
  if (pos.status !== 'active') return c.json({ error: 'Position not active' }, 409);

  const now = Date.now();
  const price = await qtaPrice(c);
  const basis = await qtaStakeBasisPrice(c);
  // ★ OWNER RULE (2026-09-01): pay a FIXED QTA QUANTITY (principal QTA × rate ×
  //   KST-days), NOT a USD value re-divided by the live price. paid_dividend_qta
  //   is the running total of QTA already paid, so the claimable QTA is simply
  //   (accrued QTA so far − already paid QTA).
  const totalQta = accruedQta(pos, now, basis);
  const alreadyPaidQta = Number(pos.paid_dividend_qta || 0);
  const qta = Math.max(0, totalQta - alreadyPaidQta);
  if (qta <= 0) return c.json({ ok: true, credited_qta: 0, note: 'nothing to claim' });

  // USD value of this claim (for the ledger + referral match), valued at the
  // stake BASIS (6원 peg in window) so usd_amount / qta_price stay consistent
  // with the fixed-quantity QTA that is actually paid.
  const totalUsd = accruedUsd(pos, now);
  const payableUsd = qta * basis;

  // Claim-first: bump the paid QTA snapshot atomically (CAS on paid_dividend_qta)
  // so concurrent claims can't double-pay.
  const claim = await c.env.DB.prepare(
    `UPDATE staking_positions
        SET accrued_dividend_usd = ?, paid_dividend_qta = ?,
            last_accrued_at = ?
      WHERE id = ? AND status = 'active' AND COALESCE(paid_dividend_qta,0) = ?`
  ).bind(totalUsd, totalQta, new Date(now).toISOString(), positionId, alreadyPaidQta).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ error: 'Claim already in progress, retry' }, 409);
  }

  await creditQta(c, user.id, qta);
  await c.env.DB.prepare(
    `INSERT INTO staking_dividends (id, position_id, user_id, kind, usd_amount, qta_amount, qta_price)
     VALUES (?,?,?, 'dividend', ?,?,?)`
  ).bind(uuid(), positionId, user.id, payableUsd, qta, basis).run();

  await payReferralMatch(c, user.id, payableUsd, basis, positionId);

  return c.json({ ok: true, credited_qta: qta, qta_price: basis });
});

// --------------------------------------------------------------------------
// POST /claim-all
// Claims the unclaimed accrued dividend of EVERY active position for the user
// in one call, crediting the total to the QTA wallet. This backs the Withdraw
// flow's "auto-claim before withdraw" (Option A): the Earn page shows a live
// "accruing" dividend that only becomes a real, withdrawable wallet balance
// once claimed — so pressing Withdraw first sweeps all pending dividends here.
// Idempotent-ish: positions with nothing to claim are skipped; concurrent
// claims are guarded per-position by the accrued_dividend_usd snapshot CAS.
// --------------------------------------------------------------------------
app.post('/claim-all', authMiddleware, async (c) => {
  const user = c.get('user');
  const now = Date.now();
  const price = await qtaPrice(c);
  const basis = await qtaStakeBasisPrice(c);
  if (!(price > 0)) return c.json({ error: 'QTA price unavailable' }, 503);

  const positions = await c.env.DB.prepare(
    `SELECT * FROM staking_positions WHERE user_id = ? AND status = 'active'`
  ).bind(user.id).all<any>();
  const rows = positions.results || [];

  let totalQta = 0;
  let claimedCount = 0;
  for (const pos of rows) {
    // ★ OWNER RULE (2026-09-01): fixed QTA quantity (principal QTA × rate ×
    //   KST-days) minus what was already paid — price-independent.
    const posTotalQta = accruedQta(pos, now, basis);
    const alreadyPaidQta = Number(pos.paid_dividend_qta || 0);
    const qta = Math.max(0, posTotalQta - alreadyPaidQta);
    if (qta <= 0) continue;

    const totalUsd = accruedUsd(pos, now);      // reporting only
    const payableUsd = qta * basis;             // reporting basis (6원 peg in window)

    // Claim-first CAS on paid_dividend_qta: only credit if the paid snapshot is
    // still what we read, so a concurrent /claim on the same position can't
    // double-pay.
    const claim = await c.env.DB.prepare(
      `UPDATE staking_positions
          SET accrued_dividend_usd = ?, paid_dividend_qta = ?,
              last_accrued_at = ?
        WHERE id = ? AND status = 'active' AND COALESCE(paid_dividend_qta,0) = ?`
    ).bind(totalUsd, posTotalQta, new Date(now).toISOString(), pos.id, alreadyPaidQta).run();
    if (!claim.meta || claim.meta.changes === 0) continue; // lost the race; skip

    await creditQta(c, user.id, qta);
    await c.env.DB.prepare(
      `INSERT INTO staking_dividends (id, position_id, user_id, kind, usd_amount, qta_amount, qta_price)
       VALUES (?,?,?, 'dividend', ?,?,?)`
    ).bind(uuid(), pos.id, user.id, payableUsd, qta, basis).run();

    await payReferralMatch(c, user.id, payableUsd, basis, pos.id);

    totalQta += qta;
    claimedCount += 1;
  }

  return c.json({ ok: true, credited_qta: totalQta, positions_claimed: claimedCount, qta_price: basis });
});

// --------------------------------------------------------------------------
// POST /redeem { position_id }
// Closes a position. "Early" is measured against THIS position's own maturity
// date (term_end_at = its own start + the product term, 180/360d) — there is
// no global fixed lock, and each position is settled independently.
//   Before maturity (early): base = principal_usd + TOTAL accrued dividend
//     (USD, whether or not any QTA was already claimed); deduct 30% of that
//     base, then net off any QTA already taken valued at today's price; pay the
//     remainder ALL AS USDT.
//   At/after maturity: pay remaining (unpaid) dividend as QTA + return full
//     USDT principal (no penalty).
// --------------------------------------------------------------------------
app.post('/redeem', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const positionId = String(body.position_id || '');
  if (!positionId) return c.json({ error: 'position_id required' }, 400);

  const pos = await c.env.DB.prepare(
    `SELECT * FROM staking_positions WHERE id = ? AND user_id = ?`
  ).bind(positionId, user.id).first<any>();
  if (!pos) return c.json({ error: 'Position not found' }, 404);
  if (pos.status !== 'active') return c.json({ error: 'Already redeemed' }, 409);

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const price = await qtaPrice(c);
  const basis = await qtaStakeBasisPrice(c);
  const principalUsd = pos.principal_usd || 0;

  // ── Admin-granted BONUS position (migration 0056) ────────────────────────
  //   principal_usd is INFLATED (real + bonus). real_principal_usd holds the
  //   REAL money that must be returned; the bonus portion evaporates. These
  //   positions locked NO QTA at grant time (principal_qta = 0), so nothing is
  //   released from `locked` — the returned QTA is simply credited.
  const isGranted = pos.real_principal_usd != null;
  const realPrincipalUsd = isGranted ? Number(pos.real_principal_usd || 0) : principalUsd;

  // QTA principal that was locked at stake time (legacy self-subscribed only).
  // Fall back to `principal` (the QTA quantity is now stored there) or derive
  // from the staked-price.
  const principalQta = pos.principal_qta
    || pos.principal
    || (pos.qta_price_at_stake > 0 ? principalUsd / pos.qta_price_at_stake : 0);
  // How much QTA was actually LOCKED (to release back). Granted positions
  // locked nothing.
  const lockedQta = isGranted ? 0 : principalQta;
  // The REAL principal to return, expressed in QTA:
  //   • granted → real_principal_usd converted at TODAY's price
  //   • legacy  → the QTA that was locked
  // ★ 2026-09-01~ (fixed window): granted-position principal is returned in QTA
  //   valued at the SAME basis the stake used (6원 peg in window), NOT the live
  //   price — otherwise the returned QTA quantity would be inconsistent with the
  //   6원 entry rule. Outside the window, basis == live price.
  const realPrincipalQta = isGranted
    ? (basis > 0 ? realPrincipalUsd / basis : 0)
    : principalQta;
  // Early == before this position's own maturity date (per-position).
  const isEarly = pos.term_end_at ? Date.parse(pos.term_end_at) > now : false;

  // Claim-first status flip.
  const claim = await c.env.DB.prepare(
    `UPDATE staking_positions SET status = 'redeemed', redeemed_at = ?, last_accrued_at = ?
      WHERE id = ? AND status = 'active'`
  ).bind(nowIso, nowIso, positionId).run();
  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ error: 'Already redeemed' }, 409);
  }

  let returnedQta: number;      // QTA principal returned to the wallet
  let dividendQta = 0;          // remaining unpaid dividend (matured only)
  let penaltyQta = 0;           // QTA principal forfeited (early only)

  if (isEarly) {
    // ★★★ Boss's early-exit rule: the 30% penalty is charged on the FULL
    // base = (principal + accrued dividend), NOT the principal alone.
    //   e.g. principal 100 + accrued interest 10 = base 110
    //        penalty  = 110 * 30% = 33
    //        returned = 110 - 33 = 77   (paid as QTA)
    // Everything is denominated in QTA for wallet consistency: the accrued
    // dividend (USD) is converted to QTA at today's price, and any dividend
    // the user ALREADY claimed is netted out of the base so it isn't paid
    // twice.
    //
    // For ADMIN-GRANTED (bonus) positions the owner rule (2026-08-29) is:
    // the 30% penalty applies to the WHOLE INFLATED base (2,000 principal +
    // accrued dividend), and only 70% of that is returned. So the base uses
    // realPrincipalQta for legacy, but the FULL inflated principal for grants.
    // ★ OWNER RULE (2026-09-01): dividend accrues as a FIXED QTA quantity, so
    // the remaining (unpaid) dividend is (total accrued QTA − already-paid QTA)
    // — price-independent — rather than a USD value re-divided by today's price.
    const totalDivQta = accruedQta(pos, now, basis);           // total dividend so far (QTA)
    const alreadyPaidQta = Number(pos.paid_dividend_qta || 0); // dividend already taken (QTA)
    const remainingDivQta = Math.max(0, totalDivQta - alreadyPaidQta);

    // Principal portion of the penalty base:
    //   • granted → the FULL inflated principal_usd (2,000) as QTA
    //   • legacy  → the locked principalQta
    // ★ granted-position penalty base principal valued at the stake basis
    //   (6원 peg in window), consistent with the entry rule.
    const penaltyPrincipalQta = isGranted
      ? (basis > 0 ? principalUsd / basis : 0)
      : principalQta;

    const baseQta = penaltyPrincipalQta + remainingDivQta;   // 원금(부풀린) + 적립이자 (QTA)
    penaltyQta = baseQta * EARLY_PENALTY;                     // 30% of (base)
    returnedQta = Math.max(0, baseQta - penaltyQta);         // remaining 70%, paid as QTA
  } else {
    // Matured: return the REAL principal (granted → real only, legacy → full)
    // + pay remaining unpaid dividend. ★ OWNER RULE (2026-09-01): the dividend
    // is a FIXED QTA quantity (principal QTA × rate × KST-days), NOT a USD value
    // re-divided by the live price — so the remaining dividend is simply
    // (total accrued QTA − already-paid QTA).
    const totalQta = accruedQta(pos, now, basis);
    const paidQta = Number(pos.paid_dividend_qta || 0);
    dividendQta = Math.max(0, totalQta - paidQta);
    // ★ Report the dividend USD at the SAME basis the QTA quantity was derived
    //   from (6원 peg in window), so usd_amount / qta_price stay consistent.
    const payableUsd = dividendQta * basis;      // reporting basis (6원 peg in window)
    returnedQta = realPrincipalQta;

    if (dividendQta > 0) {
      await creditQta(c, user.id, dividendQta);
      await c.env.DB.prepare(
        `UPDATE staking_positions SET paid_dividend_qta = ? WHERE id = ?`
      ).bind(totalQta, positionId).run();
      await c.env.DB.prepare(
        `INSERT INTO staking_dividends (id, position_id, user_id, kind, usd_amount, qta_amount, qta_price)
         VALUES (?,?,?, 'dividend', ?,?,?)`
      ).bind(uuid(), positionId, user.id, payableUsd, dividendQta, basis).run();
      await payReferralMatch(c, user.id, payableUsd, basis, positionId);
    }
  }

  // Return the QTA principal (net of any early penalty): credit `available`
  // and release only the QTA that was actually LOCKED (0 for admin grants).
  // Non-negative guard keeps locked from underflowing.
  if (returnedQta > 0) {
    const upd = await c.env.DB.prepare(
      `UPDATE wallets
          SET available = available + ?,
              locked = MAX(0, COALESCE(locked,0) - ?)
        WHERE user_id = ? AND coin_symbol = 'QTA'`
    ).bind(returnedQta, lockedQta, user.id).run();
    if (!upd.meta || upd.meta.changes === 0) {
      await c.env.DB.prepare(
        `INSERT INTO wallets (id, user_id, coin_symbol, available, available_initial)
         VALUES (?,?, 'QTA', ?, 0)`
      ).bind(uuid(), user.id, returnedQta).run();
    }
  } else if (lockedQta > 0) {
    // Nothing returned (100% forfeit edge case): just release the lock.
    await c.env.DB.prepare(
      `UPDATE wallets SET locked = MAX(0, COALESCE(locked,0) - ?)
        WHERE user_id = ? AND coin_symbol = 'QTA'`
    ).bind(lockedQta, user.id).run();
  }

  await c.env.DB.prepare(
    `UPDATE staking_products SET total_staked = MAX(0, COALESCE(total_staked,0) - ?), updated_at = ?
      WHERE id = ?`
  ).bind(principalUsd, nowIso, pos.product_id).run();

  return c.json({
    ok: true, early: isEarly,
    returned_qta: returnedQta, penalty_qta: penaltyQta,
    principal_qta: principalQta,
    real_principal_usd: realPrincipalUsd,
    bonus_principal_usd: isGranted ? Number(pos.bonus_principal_usd || 0) : 0,
    granted: isGranted,
    dividend_qta: dividendQta, qta_price: price,
  });
});

// --------------------------------------------------------------------------
// POST /withdraw-dividend { amount_qta, address, payout_coin? }
// Withdraws staking-dividend QTA. 100-QTA increments, flat 5% fee.
// The dividend is always denominated in QTA, but the user CHOOSES the payout
// coin: 'QTA' (default) or 'USDT'. When USDT is chosen, the net QTA is
// converted at that moment's LIVE QTA and USDT prices:
//     usdt_amount = net_qta * qta_price / usdt_price
// Creates a normal withdrawal request in the chosen asset (operator settles).
// --------------------------------------------------------------------------
app.post('/withdraw-dividend', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const amountQta = Number(body.amount_qta);
  const address = String(body.address || '').trim();
  const payoutCoin = String(body.payout_coin || 'QTA').toUpperCase();

  if (!isFinite(amountQta) || amountQta <= 0) return c.json({ error: 'Invalid amount' }, 400);
  if (amountQta % WITHDRAW_UNIT_QTA !== 0) {
    return c.json({ error: `Amount must be in ${WITHDRAW_UNIT_QTA}-QTA increments` }, 400);
  }
  if (payoutCoin !== 'QTA' && payoutCoin !== 'USDT') {
    return c.json({ error: 'payout_coin must be QTA or USDT' }, 400);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return c.json({ error: 'Valid destination (0x...) address required' }, 400);
  }

  // Prices used to VALUE / CONVERT this withdrawal.
  //   ★ 2026-09-01 ~ 09-10 (KST): QTA is valued at the FIXED 6원 entry price
  //     ($0.00413793) and USDT is pegged at 1,450원 = exactly $1 — so the
  //     withdrawal converts at 6원 / 1,450원, NOT the live market price.
  //   Outside the window: live prices.
  const fixedWin = inFixedWindow(Date.now());
  const qPrice = fixedWin ? FIXED_QTA_USD : await qtaPrice(c);   // QTA price in USD
  const uPrice = fixedWin ? 1.0 : await usdtPrice(c);            // USDT price in USD (≈1)

  // ★★★★★★★ Boss's minimum-withdrawal rule (2026-08-26): $50 USD equivalent,
  //   valued at the QTA price (fixed 6원 during the window). Below $50 blocked.
  const MIN_WITHDRAW_USD = 50;
  const requestUsd = amountQta * qPrice;
  if (qPrice > 0 && requestUsd < MIN_WITHDRAW_USD) {
    return c.json({
      error: `Minimum withdrawal is $${MIN_WITHDRAW_USD} (valued at the current live price).`,
      code: 'BELOW_MIN_WITHDRAWAL',
      min_usd: MIN_WITHDRAW_USD,
      requested_usd: Math.round(requestUsd * 100) / 100,
    }, 400);
  }

  // Owner request (2026-08-27): shareholders (exchange/casino) and QX>=500k
  //   holders are EXEMPT from the withdrawal fee (feeQta = 0 → net = full).
  const divExemption = await getFeeExemption(c.env.DB, user.id);
  const feeQta = divExemption.withdrawExempt ? 0 : amountQta * WITHDRAW_FEE;   // 5% fee on the QTA amount
  const netQta = amountQta - feeQta;         // e.g. 95 on 100

  // Atomically lock the requested QTA from the user's QTA available balance.
  const lock = await c.env.DB.prepare(
    `UPDATE wallets SET available = available - ?, locked = COALESCE(locked,0) + ?
      WHERE user_id = ? AND coin_symbol = 'QTA' AND available >= ?`
  ).bind(amountQta, amountQta, user.id, amountQta).run();
  if (!lock.meta || lock.meta.changes === 0) {
    return c.json({ error: 'Insufficient QTA balance' }, 400);
  }

  const id = uuid();
  const nowIso = new Date().toISOString();

  // Determine the settled payout in the chosen asset.
  let payoutAmount: number;
  let payoutFee: number;
  let network: string;
  if (payoutCoin === 'USDT') {
    // Convert net QTA -> USDT at live prices.
    payoutAmount = (netQta * qPrice) / uPrice;
    payoutFee = (feeQta * qPrice) / uPrice;
    network = 'bep20';               // USDT settles on BEP-20 (BSC)
  } else {
    payoutAmount = netQta;
    payoutFee = feeQta;
    network = 'qta-mainnet';
  }

  // Record as a withdrawal request (manual-withdrawal mode; operator settles).
  // amount/fee are TEXT columns in qta_withdrawals — store as strings.
  await c.env.DB.prepare(
    `INSERT INTO qta_withdrawals
       (id, user_id, asset, amount, fee, to_address, status, network, created_at)
     VALUES (?,?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(id, user.id, payoutCoin, String(payoutAmount), String(payoutFee), address, network, nowIso).run();

  return c.json({
    ok: true,
    withdrawal_id: id,
    payout_coin: payoutCoin,
    requested_qta: amountQta,
    fee_qta: feeQta,
    net_qta: netQta,
    qta_price: qPrice,
    usdt_price: uPrice,
    payout_amount: payoutAmount,
    payout_fee: payoutFee,
  });
});

// --------------------------------------------------------------------------
// GET /dividends — recent dividend + match ledger for the user.
// --------------------------------------------------------------------------
app.get('/dividends', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT kind, usd_amount, qta_amount, qta_price, created_at
       FROM staking_dividends WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 100`
  ).bind(user.id).all();
  return c.json({ dividends: results || [] });
});

// --------------------------------------------------------------------------
// GET /binary/tree — the caller's own binary summary:
//   • left_usd / right_usd / total downline volume (좌우 볼륨 총액) + self 몸값
//   • the two assigned legs (who is on Left, who is on Right)
//   • UNPLACED direct downline (binary_leg IS NULL) that the sponsor must still
//     choose a side for (single, irreversible choice).
// --------------------------------------------------------------------------
app.get('/binary/tree', authMiddleware, async (c) => {
  const user = c.get('user');

  // Volume totals (may be absent if the user has no binary_volume row yet).
  const vol = await c.env.DB.prepare(
    `SELECT left_usd, right_usd, matched_usd, self_usd,
            pending_left_usd, pending_right_usd
       FROM binary_volume WHERE user_id = ?`
  ).bind(user.id).first<any>().catch(() => null);

  const leftUsd = Number(vol?.left_usd || 0);
  const rightUsd = Number(vol?.right_usd || 0);
  const pendingLeft = Number(vol?.pending_left_usd || 0);
  const pendingRight = Number(vol?.pending_right_usd || 0);
  const selfUsd = Number(vol?.self_usd || 0);
  const matchedUsd = Number(vol?.matched_usd || 0);

  // Direct downline split by leg. Unassigned members (leg IS NULL) go to the
  // "pending placement" list the sponsor must act on. We also surface each
  // member's OWN staked USD total (몸값 / self_usd) so the sponsor can SEE how
  // much the downline staked BEFORE choosing which leg to place them on.
  // NOTE: binary_leg_assigned_at (migration 0053) records WHEN the sponsor
  //   placed each member. Selected via a tolerant query so pre-0053 DBs still
  //   work (the column simply comes back NULL / the query is retried without it).
  let downline: any[] = [];
  try {
    const r = await c.env.DB.prepare(
      `SELECT u.id, u.nickname, u.email, u.binary_leg, u.created_at,
              u.binary_leg_assigned_at AS assigned_at,
              COALESCE(bv.self_usd, 0) AS staked_usd
         FROM users u
         LEFT JOIN binary_volume bv ON bv.user_id = u.id
        WHERE u.binary_parent_id = ?
        ORDER BY u.created_at ASC`
    ).bind(user.id).all<any>();
    downline = r.results || [];
  } catch {
    const r = await c.env.DB.prepare(
      `SELECT u.id, u.nickname, u.email, u.binary_leg, u.created_at,
              COALESCE(bv.self_usd, 0) AS staked_usd
         FROM users u
         LEFT JOIN binary_volume bv ON bv.user_id = u.id
        WHERE u.binary_parent_id = ?
        ORDER BY u.created_at ASC`
    ).bind(user.id).all<any>().catch(() => ({ results: [] as any[] }));
    downline = r.results || [];
  }

  const left: any[] = [];
  const right: any[] = [];
  const unplaced: any[] = [];
  for (const m of (downline || [])) {
    const row = {
      id: m.id,
      nickname: m.nickname,
      joined_at: m.created_at,
      staked_usd: Number(m.staked_usd || 0), // 하부가 스테이킹한 금액(USD)
      assigned_at: m.assigned_at || null,    // 사장님이 좌/우 배치한 시각(placement time)
    };
    if (m.binary_leg === 'L') left.push(row);
    else if (m.binary_leg === 'R') right.push(row);
    else unplaced.push(row);
  }

  return c.json({
    volume: {
      self_usd: selfUsd,                 // 본인 몸값
      left_usd: leftUsd,                 // 좌 볼륨 총액
      right_usd: rightUsd,               // 우 볼륨 총액
      total_usd: leftUsd + rightUsd,     // 좌우 볼륨 총액
      matched_usd: matchedUsd,
      pending_left_usd: pendingLeft,     // 캡 초과로 보관 중(좌)
      pending_right_usd: pendingRight,   // 캡 초과로 보관 중(우)
      cap_usd: selfUsd * 2,              // 2x 몸값 캡
    },
    left_members: left,
    right_members: right,
    unplaced_members: unplaced,          // 사장님이 좌/우 선택해야 하는 신규 하부
  });
});

// --------------------------------------------------------------------------
// POST /binary/assign-leg — the sponsor assigns ONE of their unplaced direct
// downline members to their Left or Right leg. ONE-TIME, irreversible.
// Body: { member_id: string, leg: 'L' | 'R' }
// --------------------------------------------------------------------------
app.post('/binary/assign-leg', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({} as any));
  const memberId = body?.member_id ? String(body.member_id) : '';
  const legRaw = body?.leg ? String(body.leg).toUpperCase() : '';
  const leg = legRaw === 'L' || legRaw === 'R' ? (legRaw as 'L' | 'R') : null;

  if (!memberId || !leg) {
    return c.json({ error: 'INVALID_INPUT', message: 'member_id와 leg(L 또는 R)가 필요합니다.' }, 400);
  }

  const res = await assignBinaryLeg(c.env.DB, user.id, memberId, leg);
  if (res.ok) {
    // ── Placement now DONE → roll the member's already-staked value UP ──
    //   When the member first staked, binary_leg was NULL so rollStakeUpBinary
    //   STOPPED at them (nothing reached the sponsor's Left/Right leg). Now that
    //   the sponsor has picked a side, we roll the member's total staked USD
    //   (their self_usd / 몸값) up the ancestry so the sponsor's Left/Right
    //   Volume immediately reflects it. skipSelf=true → don't re-grow the
    //   member's OWN self_usd (already set at stake time).
    try {
      const memberVol = await c.env.DB.prepare(
        `SELECT COALESCE(self_usd, 0) AS self_usd FROM binary_volume WHERE user_id = ?`
      ).bind(res.member_id).first<any>();
      const memberUsd = Number(memberVol?.self_usd || 0);
      if (memberUsd > 0) {
        // ★ match-bonus QTA payout uses the 6원 fixed peg during the window.
        const price = await qtaStakeBasisPrice(c);
        await rollStakeUpBinary(c.env.DB, res.member_id, memberUsd, price, { skipSelf: true });
      }
    } catch (e) {
      console.warn('[binary] post-placement rollup failed:', e);
    }
    return c.json({ ok: true, member_id: res.member_id, leg: res.leg });
  }
  const map: Record<string, { status: 400 | 403 | 404 | 409 | 500; message: string }> = {
    INVALID_LEG:       { status: 400, message: 'leg는 L 또는 R만 가능합니다.' },
    NOT_YOUR_DOWNLINE: { status: 403, message: '본인 직속 하부만 배치할 수 있습니다.' },
    ALREADY_PLACED:    { status: 409, message: '이미 좌/우가 확정된 회원입니다. (1회만 선택 가능)' },
    MEMBER_NOT_FOUND:  { status: 404, message: '해당 회원을 찾을 수 없습니다.' },
    ERROR:             { status: 500, message: '배치 처리 중 오류가 발생했습니다.' },
  };
  const e = map[res.code] || map.ERROR;
  return c.json({ error: res.code, message: e.message }, e.status);
});

export default app;
