/**
 * QTA auto-return — OWNER_RULES §11 (2026-09-21)
 * ----------------------------------------------------------------------------
 * "버튼 한 번으로 메인지갑에서 자동 반환 송금까지 붙여줘! 아닌 사람은 바로 반환이
 *  되게끔."
 *
 * Native QTA that arrived from a NON-shareholder is not credited. Instead of
 * sitting in 'held' forever, the row is queued as 'return_pending' and this
 * module sends the exact amount back to the ORIGINAL sender wallet
 * (qta_deposits.from_address) from the company hot/main wallet (HD index 0),
 * then records the return tx on the row + notifies the member + writes an
 * audit row. Admins can also push a 'held' row into the queue with one click
 * (POST /admin/qta-deposits/:id/auto-return).
 *
 * Safety:
 *   • ONE return per invocation (SPHINCS+ signing is CPU-heavy on Workers).
 *   • Status-guarded UPDATEs → a racing tick can never double-send.
 *   • Bounded retries (return_attempts ≤ MAX_ATTEMPTS) → then back to 'held'
 *     with return_error so the admin sees why.
 *   • Never returns to one of OUR OWN addresses (hot wallet / any member
 *     deposit address) — that would loop.
 *   • Hot wallet must match the mnemonic (verifyMnemonicMatchesHotWallet).
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

export interface ReturnEnv {
  DB: D1Database;
  QTA_CHAIN_DRIVER?: string;
  QTA_RPC_URL?: string;
  QTA_CHAIN_ID?: string;
  QTA_HD_WALLET_MNEMONIC?: string;
  QTA_HOT_WALLET_ADDRESS?: string;
  QTA_NETWORK?: string;
}

export const AUTO_RETURN_KEY = 'qta_auto_return'; // system_state: 'on' (default) | 'off'
const MAX_ATTEMPTS = 3;
const GAS_RESERVE_WEI = 10n ** 17n; // keep 0.1 QTA in the hot wallet for gas

export async function autoReturnEnabled(DB: D1Database): Promise<boolean> {
  try {
    const r = await DB.prepare(`SELECT value FROM system_state WHERE key = ?`).bind(AUTO_RETURN_KEY).first<{ value: string }>();
    return String(r?.value ?? 'on').toLowerCase() !== 'off';
  } catch {
    return true;
  }
}

function toWei(amount: string): bigint {
  const s = String(amount || '0').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return 0n;
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(18)).slice(0, 18);
  return BigInt(i) * 10n ** 18n + BigInt(frac || '0');
}

export interface ReturnResult {
  ok: boolean;
  picked: number;
  id?: string;
  action?: string;
  tx_hash?: string;
  to?: string;
  amount?: string;
  reason?: string;
}

export async function processQtaReturns(env: ReturnEnv): Promise<ReturnResult> {
  const DB = env.DB;
  const driver = String(env.QTA_CHAIN_DRIVER || 'mock').toLowerCase();
  if (driver !== 'real' && driver !== 'live') return { ok: true, picked: 0, reason: 'driver_not_real' };

  const rpcUrl = env.QTA_RPC_URL, mnemonic = env.QTA_HD_WALLET_MNEMONIC, hot = env.QTA_HOT_WALLET_ADDRESS;
  if (!rpcUrl || !mnemonic || !hot) return { ok: false, picked: 0, reason: 'missing_env' };
  if (!isValidMnemonic(mnemonic)) return { ok: false, picked: 0, reason: 'invalid_mnemonic' };
  if (!verifyMnemonicMatchesHotWallet(mnemonic, hot)) return { ok: false, picked: 0, reason: 'hot_wallet_mnemonic_mismatch' };

  const network = env.QTA_NETWORK === 'qta-testnet' ? 'qta-testnet' : 'qta-mainnet';

  // Pick ONE queued return (oldest first).
  let row: any;
  try {
    row = await DB.prepare(
      `SELECT d.id, d.user_id, d.amount, d.tx_hash, d.address,
              COALESCE(d.from_address, json_extract(d.raw_meta,'$.from')) AS from_address,
              COALESCE(d.return_attempts, 0) AS return_attempts,
              u.email, u.nickname
         FROM qta_deposits d LEFT JOIN users u ON u.id = d.user_id
        WHERE d.status = 'return_pending' AND COALESCE(d.asset,'QTA') = 'QTA' AND d.network = ?
        ORDER BY d.updated_at ASC LIMIT 1`,
    ).bind(network).first<any>();
  } catch (e: any) {
    return { ok: false, picked: 0, reason: 'query_failed: ' + String(e?.message || e) };
  }
  if (!row) return { ok: true, picked: 0 };

  const nowIso = new Date().toISOString();
  const fail = async (reason: string, terminal: boolean) => {
    const attempts = Number(row.return_attempts || 0) + 1;
    const backToHeld = terminal || attempts >= MAX_ATTEMPTS;
    await DB.prepare(
      `UPDATE qta_deposits SET return_attempts = ?, return_error = ?, updated_at = ?${backToHeld ? ", status = 'held'" : ''}
        WHERE id = ? AND status = 'return_pending'`,
    ).bind(attempts, reason.slice(0, 300), nowIso, row.id).run().catch(() => {});
    return { ok: false, picked: 1, id: row.id, action: backToHeld ? 'moved_to_held' : 'retry_later', reason } as ReturnResult;
  };

  // Destination = original sender.
  const to = String(row.from_address || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return fail('sender_address_unknown', true);
  const toCk = toChecksumAddress(to);
  if (toCk.toLowerCase() === toChecksumAddress(hot).toLowerCase()) return fail('sender_is_hot_wallet', true);
  try {
    const own = await DB.prepare(`SELECT 1 AS x FROM qta_addresses WHERE lower(address) = lower(?) LIMIT 1`).bind(toCk).first<any>();
    if (own) return fail('sender_is_exchange_deposit_address', true);
  } catch { /* ignore */ }

  const wei = toWei(String(row.amount));
  if (wei <= 0n) return fail('invalid_amount', true);

  const chainId = Number(env.QTA_CHAIN_ID || '60000') || 60000;
  const cfg: EvmRpcConfig = { rpcUrl, chainId };

  try {
    const acct = deriveAccountFromMnemonic(mnemonic, 0);
    const [nonce, fees, balance] = await Promise.all([getNonce(cfg, hot), suggestFees(cfg), getNativeBalance(cfg, hot)]);
    if (balance < wei + GAS_RESERVE_WEI) {
      return fail(`hot_wallet_insufficient: have ${balance.toString()} need ${(wei + GAS_RESERVE_WEI).toString()}`, false);
    }
    const { rawTx } = signSphincsTx(
      {
        chainId, nonce,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxFeePerGas: fees.maxFeePerGas,
        gasLimit: 100_000n, to: toCk, value: wei, data: '0x',
      },
      acct.publicKey, acct.secretKey,
    );
    const txHash = await sendRawTransaction(cfg, rawTx);

    // Status-guarded finalisation: only the invocation that flips the row wins.
    const upd = await DB.prepare(
      `UPDATE qta_deposits
          SET status = 'returned', resolution = 'auto_return', resolved_at = ?, resolved_by = 'system:auto-return',
              return_tx_hash = ?, return_to = ?, return_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'return_pending'`,
    ).bind(nowIso, txHash, toCk, nowIso, row.id).run();
    const changed = Number((upd as any)?.meta?.changes ?? 0) > 0;

    if (changed) {
      const who = row.nickname || row.email || row.user_id;
      await DB.prepare(
        `INSERT INTO notifications (id, user_id, type, title, message, data, is_read, created_at)
         VALUES (?, ?, 'deposit', 'QTA Returned', ?, ?, 0, ?)`,
      ).bind(
        crypto.randomUUID(), row.user_id,
        `${row.amount} QTA you sent has been returned to your wallet ${toCk}. QTA deposits are not credited to regular accounts. Tx: ${txHash}`,
        JSON.stringify({ coin: 'QTA', amount: Number(row.amount), deposit_id: row.id, return_tx_hash: txHash, to: toCk, auto: true }),
        nowIso,
      ).run().catch(() => {});
      await DB.prepare(
        `INSERT INTO admin_audit_logs (id, admin_id, admin_email, action, target_type, target_id, payload, created_at)
         VALUES (?, 'system:auto-return', 'system@quantaex.io', 'qta_deposit.auto_returned', 'user', ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), row.user_id,
        JSON.stringify({ depositor: who, user_id: row.user_id, email: row.email, nickname: row.nickname, amount: row.amount,
          deposit_tx: row.tx_hash, deposit_address: row.address, returned_to: toCk, return_tx_hash: txHash, rule: 'OWNER_RULES §11' }),
        nowIso,
      ).run().catch(() => {});
    }
    console.log(`[qta-return] returned ${row.amount} QTA → ${toCk} tx=${txHash} (deposit ${row.id})`);
    return { ok: true, picked: 1, id: row.id, action: 'returned', tx_hash: txHash, to: toCk, amount: String(row.amount) };
  } catch (e: any) {
    return fail('send_failed: ' + String(e?.message || e), false);
  }
}
