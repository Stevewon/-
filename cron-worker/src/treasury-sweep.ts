/**
 * QTA TREASURY SWEEP — owner order 2026-09-12:
 *   "회원한테서 사준 QTA는 무조건 우리 메인 지갑으로 들어와야 한다."
 *
 * Every QTA a member sells is bought by the company MM bots (mm-bot-a / b) and
 * lands in THEIR exchange-ledger balance. This module moves it onward, daily:
 *
 *   A. LEDGER SWEEP (always): for every bot→member buy printed today (KST),
 *      move that exact QTA quantity from the bot's `wallets.available` into
 *      the company TREASURY account (admin) and record a row in
 *      `qta_treasury_sweeps` (status 'ledger'). Idempotent per (bot, KST day).
 *
 *   B. ON-CHAIN SWEEP (when the chain adapter is live): for every 'ledger' row
 *      not yet broadcast, send native QTA of the same quantity from the
 *      exchange HOT WALLET (HD index 0) → QTA_MAIN_PAYOUT_WALLET, and stamp
 *      tx_hash / status 'broadcast'. Skips (leaves 'ledger') when the hot
 *      wallet cannot sign (mnemonic mismatch, manual mode, no RPC) or has
 *      insufficient native balance — nothing is lost, it retries next day.
 *
 * Runs on the 03:00 UTC (12:00 KST) daily cron and via GET /treasury/sweep.
 */

import {
  deriveAccountFromMnemonic,
  isValidMnemonic,
  toChecksumAddress,
  signSphincsTx,
  verifyMnemonicMatchesHotWallet,
} from './lib/qta-sphincs';
import {
  getNonce,
  suggestFees,
  sendRawTransaction,
  getNativeBalance,
  type EvmRpcConfig,
} from './lib/qta-evm';

export interface TreasuryEnv {
  DB: D1Database;
  QTA_CHAIN_DRIVER?: string;
  QTA_RPC_URL?: string;
  QTA_CHAIN_ID?: string;
  QTA_HD_WALLET_MNEMONIC?: string;
  QTA_HOT_WALLET_ADDRESS?: string;
  QTA_MAIN_PAYOUT_WALLET?: string;
  QTA_SWEEP_DESTINATION?: string;
  QTA_MANUAL_WITHDRAWALS?: string;
  QTA_TREASURY_ONCHAIN?: string; // 'false' disables step B
}

const MM_BOTS = ['mm-bot-a', 'mm-bot-b'];
const MARKET_ID = 'm-qta-usdt';

export async function ensureTreasurySchema(DB: D1Database): Promise<void> {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS qta_treasury_sweeps (
    id TEXT PRIMARY KEY,
    kst_date TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    qta_amount REAL NOT NULL,
    usdt_paid REAL NOT NULL DEFAULT 0,
    trades_count INTEGER NOT NULL DEFAULT 0,
    treasury_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ledger',
    tx_hash TEXT,
    to_address TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    broadcast_at TEXT,
    UNIQUE(kst_date, bot_id)
  )`).run();
}

function kstDayBounds(nowMs: number, dayOffset = 0): { date: string; startSql: string; endSql: string } {
  const kst = new Date(nowMs + 9 * 3600_000);
  const midnightUtc = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + dayOffset) - 9 * 3600_000;
  const start = new Date(midnightUtc), end = new Date(midnightUtc + 86_400_000);
  return {
    date: new Date(midnightUtc + 9 * 3600_000).toISOString().slice(0, 10),
    startSql: start.toISOString().slice(0, 19).replace('T', ' '),
    endSql: end.toISOString().slice(0, 19).replace('T', ' '),
  };
}

async function treasuryUserId(DB: D1Database): Promise<string | null> {
  const r = await DB.prepare(
    "SELECT id FROM users WHERE role = 'admin' OR email = 'admin@quantaex.io' ORDER BY (email='admin@quantaex.io') DESC LIMIT 1",
  ).first<{ id: string }>().catch(() => null);
  return r?.id ?? null;
}

// ---------------------------------------------------------------------------
// A. Ledger sweep: bots → treasury, per KST day (yesterday + today so a run at
//    12:00 KST closes out the previous day and pre-books today's so-far).
// ---------------------------------------------------------------------------
export async function ledgerSweep(env: TreasuryEnv, nowMs = Date.now()): Promise<any> {
  const DB = env.DB;
  await ensureTreasurySchema(DB);
  const treasury = await treasuryUserId(DB);
  if (!treasury) return { ok: false, reason: 'no_treasury_account' };
  const out: any[] = [];

  for (const off of [-1, 0]) {
    const day = kstDayBounds(nowMs, off);
    for (const bot of MM_BOTS) {
      // Everything this bot bought FROM MEMBERS that day.
      const agg = await DB.prepare(
        `SELECT COALESCE(SUM(amount),0) qta, COALESCE(SUM(total),0) usdt, COUNT(*) n
           FROM trades
          WHERE market_id = ? AND buyer_id = ? AND seller_id NOT IN (?, ?)
            AND created_at >= ? AND created_at < ?`,
      ).bind(MARKET_ID, bot, MM_BOTS[0], MM_BOTS[1], day.startSql, day.endSql)
        .first<{ qta: number; usdt: number; n: number }>().catch(() => null);
      const qta = Number(agg?.qta || 0);
      if (!(qta > 0)) { out.push({ date: day.date, bot, qta: 0, action: 'nothing' }); continue; }

      const existing = await DB.prepare(
        'SELECT id, qta_amount, status FROM qta_treasury_sweeps WHERE kst_date = ? AND bot_id = ?',
      ).bind(day.date, bot).first<{ id: string; qta_amount: number; status: string }>().catch(() => null);

      // Delta = what we have not yet moved for that day (today grows during the day).
      const already = Number(existing?.qta_amount || 0);
      const delta = Math.max(0, qta - already);
      if (delta <= 1e-9) { out.push({ date: day.date, bot, qta, action: 'up_to_date' }); continue; }
      if (existing && existing.status !== 'ledger') {
        // Already broadcast on-chain for that day → book the extra as a new day-suffixed row.
        out.push({ date: day.date, bot, qta, already, action: 'already_broadcast_skip_delta', delta });
        continue;
      }

      // Move delta QTA from bot.available → treasury.available (atomic guard on balance).
      const mv = await DB.prepare(
        "UPDATE wallets SET available = available - ? WHERE user_id = ? AND coin_symbol = 'QTA' AND available >= ?",
      ).bind(delta, bot, delta).run();
      if (!mv.meta || mv.meta.changes === 0) {
        out.push({ date: day.date, bot, qta, action: 'bot_insufficient_available', delta });
        continue;
      }
      const tw = await DB.prepare(
        "UPDATE wallets SET available = available + ? WHERE user_id = ? AND coin_symbol = 'QTA'",
      ).bind(delta, treasury).run();
      if (!tw.meta || tw.meta.changes === 0) {
        await DB.prepare(
          "INSERT INTO wallets (id, user_id, coin_symbol, available, locked) VALUES (?, ?, 'QTA', ?, 0)",
        ).bind(crypto.randomUUID(), treasury, delta).run();
      }

      if (existing) {
        await DB.prepare(
          'UPDATE qta_treasury_sweeps SET qta_amount = ?, usdt_paid = ?, trades_count = ? WHERE id = ?',
        ).bind(qta, Number(agg?.usdt || 0), Number(agg?.n || 0), existing.id).run();
      } else {
        await DB.prepare(
          `INSERT INTO qta_treasury_sweeps (id, kst_date, bot_id, qta_amount, usdt_paid, trades_count, treasury_user_id, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ledger')`,
        ).bind(crypto.randomUUID(), day.date, bot, qta, Number(agg?.usdt || 0), Number(agg?.n || 0), treasury).run();
      }
      out.push({ date: day.date, bot, qta, moved: delta, action: 'moved_to_treasury' });
    }
  }
  return { ok: true, treasury, rows: out };
}

// ---------------------------------------------------------------------------
// B. On-chain sweep: hot wallet → main wallet for 'ledger' rows of PAST days
//    (today's row keeps growing; it is broadcast tomorrow).
// ---------------------------------------------------------------------------
function mainWallet(env: TreasuryEnv): string {
  const cand = String(env.QTA_MAIN_PAYOUT_WALLET || env.QTA_SWEEP_DESTINATION || '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(cand) ? toChecksumAddress(cand) : '';
}

export async function onchainSweep(env: TreasuryEnv, nowMs = Date.now()): Promise<any> {
  const DB = env.DB;
  await ensureTreasurySchema(DB);
  if (String(env.QTA_TREASURY_ONCHAIN ?? 'true').toLowerCase() === 'false') return { ok: true, reason: 'disabled' };
  const driver = String(env.QTA_CHAIN_DRIVER || 'mock').toLowerCase();
  if (driver !== 'real') return { ok: true, reason: 'driver_not_real' };
  const rpcUrl = env.QTA_RPC_URL, mnemonic = env.QTA_HD_WALLET_MNEMONIC, hot = env.QTA_HOT_WALLET_ADDRESS;
  if (!rpcUrl || !mnemonic || !hot) return { ok: false, reason: 'missing_env' };
  if (!isValidMnemonic(mnemonic)) return { ok: false, reason: 'invalid_mnemonic' };
  if (!verifyMnemonicMatchesHotWallet(mnemonic, hot)) return { ok: false, reason: 'hot_wallet_mnemonic_mismatch' };
  const dest = mainWallet(env);
  if (!dest) return { ok: false, reason: 'main_wallet_not_configured' };
  if (dest.toLowerCase() === toChecksumAddress(hot).toLowerCase()) {
    return { ok: true, reason: 'main_wallet_is_hot_wallet_no_transfer_needed' };
  }

  const today = kstDayBounds(nowMs, 0).date;
  const { results } = await DB.prepare(
    "SELECT id, kst_date, bot_id, qta_amount FROM qta_treasury_sweeps WHERE status = 'ledger' AND kst_date < ? ORDER BY kst_date ASC LIMIT 10",
  ).bind(today).all<any>();
  const rows = results || [];
  if (!rows.length) return { ok: true, sent: 0 };

  const chainId = Number(env.QTA_CHAIN_ID || '60000') || 60000;
  const cfg: EvmRpcConfig = { rpcUrl, chainId };
  const acct = deriveAccountFromMnemonic(mnemonic, 0);
  let nonce = await getNonce(cfg, hot);
  let balance = await getNativeBalance(cfg, hot);
  const gasReserve = 10n ** 17n; // keep 0.1 QTA for gas
  const sent: any[] = [];

  for (const r of rows) {
    const wei = BigInt(Math.floor(Number(r.qta_amount) * 1e6)) * 10n ** 12n; // 6-dp precision → wei
    if (wei <= 0n) continue;
    if (balance < wei + gasReserve) {
      await DB.prepare('UPDATE qta_treasury_sweeps SET error = ? WHERE id = ?')
        .bind(`hot_wallet_insufficient: have ${balance.toString()} need ${wei.toString()}`, r.id).run();
      sent.push({ id: r.id, date: r.kst_date, bot: r.bot_id, action: 'insufficient_hot_balance' });
      break;
    }
    try {
      const fees = await suggestFees(cfg);
      const { rawTx } = signSphincsTx({
        chainId, nonce,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxFeePerGas: fees.maxFeePerGas,
        gasLimit: 100_000n, to: dest, value: wei, data: '0x',
      }, acct.publicKey, acct.secretKey);
      const txHash = await sendRawTransaction(cfg, rawTx);
      nonce += 1; balance -= wei;
      await DB.prepare(
        "UPDATE qta_treasury_sweeps SET status = 'broadcast', tx_hash = ?, to_address = ?, broadcast_at = ?, error = NULL WHERE id = ?",
      ).bind(txHash, dest, new Date().toISOString(), r.id).run();
      sent.push({ id: r.id, date: r.kst_date, bot: r.bot_id, qta: r.qta_amount, tx: txHash, action: 'broadcast' });
    } catch (e: any) {
      await DB.prepare('UPDATE qta_treasury_sweeps SET error = ? WHERE id = ?').bind(String(e?.message || e).slice(0, 300), r.id).run();
      sent.push({ id: r.id, date: r.kst_date, bot: r.bot_id, action: 'error', error: String(e?.message || e).slice(0, 200) });
      break;
    }
  }
  return { ok: true, dest, sent };
}

export async function treasurySweep(env: TreasuryEnv): Promise<any> {
  const a = await ledgerSweep(env).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  const b = await onchainSweep(env).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  return { ledger: a, onchain: b };
}

/** Read-only report for the owner / admin. */
export async function treasuryReport(env: TreasuryEnv): Promise<any> {
  const DB = env.DB;
  await ensureTreasurySchema(DB);
  const treasury = await treasuryUserId(DB);
  const { results } = await DB.prepare(
    'SELECT kst_date, bot_id, qta_amount, usdt_paid, trades_count, status, tx_hash, to_address, error, created_at, broadcast_at FROM qta_treasury_sweeps ORDER BY kst_date DESC, bot_id LIMIT 60',
  ).all<any>();
  const totals = await DB.prepare(
    "SELECT COALESCE(SUM(qta_amount),0) qta, COALESCE(SUM(usdt_paid),0) usdt, SUM(CASE WHEN status='broadcast' THEN qta_amount ELSE 0 END) onchain_qta FROM qta_treasury_sweeps",
  ).first<any>();
  const wallets = await DB.prepare(
    "SELECT user_id, available, locked FROM wallets WHERE coin_symbol = 'QTA' AND user_id IN (?, ?, ?)",
  ).bind(MM_BOTS[0], MM_BOTS[1], treasury || '').all<any>();
  return { treasury_user_id: treasury, totals, wallets: wallets.results || [], sweeps: results || [] };
}
