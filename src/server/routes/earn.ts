import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { authMiddleware } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Earn / Staking API
//
// Products are admin-curated (staking_products). Users subscribe by moving
// `principal` out of their spot wallet (available -= principal) into a
// staking_positions row. Interest accrues daily at APR (simple daily accrual,
// recomputed lazily whenever positions are read or mutated).
//
// Fund-safety notes (consistent with the rest of the exchange):
//  - Subscribe: atomic conditional UPDATE on wallets.available >= amount, so
//    two concurrent subscribes cannot over-commit the same balance.
//  - Redeem: claim-first (UPDATE ... WHERE id=? AND status='active'); only the
//    winning caller credits the wallet, so a position can't be redeemed twice.
//  - Interest paid on redeem is credited as company-issued (bumps
//    available_initial) so yield stays internal and is not externally
//    withdrawable — matches the "company-issued locked credit" rule.
// ---------------------------------------------------------------------------

const app = new Hono<AppEnv>();

const uuid = () => crypto.randomUUID();
const MS_PER_DAY = 86_400_000;

// Recompute accrued interest for a single active position up to `now`.
// Simple interest: principal * apr * (elapsed_days / 365).
function accrueValue(p: {
  principal: number;
  apr: number;
  accrued_interest: number;
  last_accrued_at: string | null;
}, nowMs: number): { accrued: number; lastIso: string } {
  const last = p.last_accrued_at ? Date.parse(p.last_accrued_at) : nowMs;
  const elapsedMs = Math.max(0, nowMs - (isNaN(last) ? nowMs : last));
  const days = elapsedMs / MS_PER_DAY;
  const add = p.principal * p.apr * (days / 365);
  return {
    accrued: (p.accrued_interest || 0) + (isFinite(add) ? add : 0),
    lastIso: new Date(nowMs).toISOString(),
  };
}

// --------------------------------------------------------------------------
// GET /products — public catalog of active earn products.
// --------------------------------------------------------------------------
app.get('/products', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.coin_symbol, p.kind, p.apr, p.lock_days, p.min_amount,
            p.max_amount, p.total_cap, p.total_staked, p.sort_order,
            c.name AS coin_name, c.price_usd
       FROM staking_products p
       LEFT JOIN coins c ON c.symbol = p.coin_symbol
      WHERE p.is_active = 1
      ORDER BY p.sort_order ASC, p.apr DESC`
  ).all();
  return c.json({ products: results || [] });
});

// --------------------------------------------------------------------------
// GET /positions — the signed-in user's positions (accrual refreshed).
// --------------------------------------------------------------------------
app.get('/positions', authMiddleware, async (c) => {
  const user = c.get('user');
  const now = Date.now();

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM staking_positions
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at DESC`
  ).bind(user.id).all();

  const positions = (results || []) as any[];

  // Lazily persist fresh accrual for active positions.
  const updates = c.env.DB;
  for (const p of positions) {
    const { accrued, lastIso } = accrueValue(p, now);
    if (accrued !== p.accrued_interest) {
      p.accrued_interest = accrued;
      p.last_accrued_at = lastIso;
      await updates.prepare(
        `UPDATE staking_positions SET accrued_interest = ?, last_accrued_at = ?
          WHERE id = ? AND status = 'active'`
      ).bind(accrued, lastIso, p.id).run();
    }
    p.unlocked = !p.unlock_at || Date.parse(p.unlock_at) <= now;
  }

  // Also return a compact summary
  const totalPrincipal = positions.reduce((s, p) => s + (p.principal || 0), 0);
  const totalAccrued = positions.reduce((s, p) => s + (p.accrued_interest || 0), 0);

  return c.json({ positions, summary: { totalPrincipal, totalAccrued } });
});

// --------------------------------------------------------------------------
// POST /subscribe { product_id, amount }
// Moves `amount` from wallet.available into a new active position.
// --------------------------------------------------------------------------
app.post('/subscribe', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const productId = String(body.product_id || '');
  const amount = Number(body.amount);

  if (!productId) return c.json({ error: 'product_id required' }, 400);
  if (!isFinite(amount) || amount <= 0) return c.json({ error: 'Invalid amount' }, 400);

  const product = await c.env.DB.prepare(
    `SELECT * FROM staking_products WHERE id = ? AND is_active = 1`
  ).bind(productId).first<any>();
  if (!product) return c.json({ error: 'Product not found' }, 404);

  if (amount < (product.min_amount || 0)) {
    return c.json({ error: `Minimum is ${product.min_amount} ${product.coin_symbol}` }, 400);
  }
  if (product.max_amount != null && amount > product.max_amount) {
    return c.json({ error: `Maximum is ${product.max_amount} ${product.coin_symbol}` }, 400);
  }
  if (product.total_cap != null && (product.total_staked || 0) + amount > product.total_cap) {
    return c.json({ error: 'Product pool is full' }, 400);
  }

  // Atomic balance lock: only succeeds if the user truly has the balance.
  const lockRes = await c.env.DB.prepare(
    `UPDATE wallets SET available = available - ?
      WHERE user_id = ? AND coin_symbol = ? AND available >= ?`
  ).bind(amount, user.id, product.coin_symbol, amount).run();

  if (!lockRes.meta || lockRes.meta.changes === 0) {
    return c.json({ error: 'Insufficient balance' }, 400);
  }

  const nowIso = new Date().toISOString();
  const unlockAt = product.lock_days > 0
    ? new Date(Date.now() + product.lock_days * MS_PER_DAY).toISOString()
    : null;
  const posId = uuid();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO staking_positions
        (id, user_id, product_id, coin_symbol, kind, apr, principal,
         accrued_interest, status, lock_days, unlock_at, last_accrued_at, created_at)
       VALUES (?,?,?,?,?,?,?,0,'active',?,?,?,?)`
    ).bind(posId, user.id, product.id, product.coin_symbol, product.kind,
           product.apr, amount, product.lock_days, unlockAt, nowIso, nowIso),
    c.env.DB.prepare(
      `UPDATE staking_products SET total_staked = COALESCE(total_staked,0) + ?, updated_at = ?
        WHERE id = ?`
    ).bind(amount, nowIso, product.id),
  ]);

  return c.json({ ok: true, position_id: posId, unlock_at: unlockAt });
});

// --------------------------------------------------------------------------
// POST /redeem { position_id }
// Returns principal to available; grants accrued interest as company-issued
// (available_initial bumped so yield can't be externally withdrawn).
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
  if (pos.unlock_at && Date.parse(pos.unlock_at) > now) {
    return c.json({ error: 'Position is still locked', unlock_at: pos.unlock_at }, 400);
  }

  // Final accrual snapshot.
  const { accrued } = accrueValue(pos, now);
  const principal = pos.principal || 0;
  const interest = Math.max(0, accrued);
  const nowIso = new Date(now).toISOString();

  // Claim-first: only the winning caller flips status → prevents double redeem.
  const claim = await c.env.DB.prepare(
    `UPDATE staking_positions
        SET status = 'redeemed', accrued_interest = ?, redeemed_at = ?, last_accrued_at = ?
      WHERE id = ? AND status = 'active'`
  ).bind(interest, nowIso, nowIso, positionId).run();

  if (!claim.meta || claim.meta.changes === 0) {
    return c.json({ error: 'Already redeemed' }, 409);
  }

  // Credit wallet: principal → available; interest → available + available_initial
  // (company-issued so it stays internal).
  const total = principal + interest;
  const walletUpd = await c.env.DB.prepare(
    `UPDATE wallets
        SET available = available + ?,
            available_initial = COALESCE(available_initial, 0) + ?
      WHERE user_id = ? AND coin_symbol = ?`
  ).bind(total, interest, user.id, pos.coin_symbol).run();

  if (!walletUpd.meta || walletUpd.meta.changes === 0) {
    // Wallet row missing (edge case) — create it.
    await c.env.DB.prepare(
      `INSERT INTO wallets (id, user_id, coin_symbol, available, available_initial)
       VALUES (?,?,?,?,?)`
    ).bind(uuid(), user.id, pos.coin_symbol, total, interest).run();
  }

  await c.env.DB.prepare(
    `UPDATE staking_products SET total_staked = MAX(0, COALESCE(total_staked,0) - ?), updated_at = ?
      WHERE id = ?`
  ).bind(principal, nowIso, pos.product_id).run();

  return c.json({ ok: true, principal, interest, credited: total });
});

export default app;
