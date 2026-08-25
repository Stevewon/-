// ============================================================================
// External-deposit SWEEP job — Phase B.
// ----------------------------------------------------------------------------
// Consolidates credited per-user deposit funds into the exchange hot wallet
// (or an operator-specified destination). This is the "forwarding" half of the
// Binance-style model: the user sends USDT to what they think is their own
// wallet (a per-user HD address, index 1..N); once we've credited their
// internal balance (ext-watcher.ts), this job MOVES the actual on-chain funds
// out to our real receiving wallet.
//
// The ERC-20 gas problem (same as TRC20): a freshly-received deposit address
// holds USDT but ZERO native ETH/BNB, so it cannot pay gas to send an ERC-20
// transfer. So sweeping an address is a TWO-STEP dance across ticks:
//
//   STEP 1 — GAS FUNDING: the hot wallet (index 0) sends a small amount of
//            native ETH/BNB to the user address (enough for one ERC-20
//            transfer). Recorded as status='funding'.
//   STEP 2 — SWEEP: once the user address has native gas, it signs an ERC-20
//            transfer of its ENTIRE USDT balance to the destination. Recorded
//            as status='swept' with the sweep tx hash.
//
// Destination address:
//   - default: HD index 0 (the exchange hot wallet derived from the mnemonic)
//   - override: EXT_SWEEP_DESTINATION (an operator-chosen receiving address,
//     e.g. a Binance/exchange deposit address). If set, funds go THERE instead.
//   Either way the per-user addresses' private keys come from the SAME mnemonic
//   (that's what lets us move their funds), so a mnemonic is always required.
//
// SAFETY / IDEMPOTENCY:
//   - We only sweep deposits already in status='credited' (balance already
//     given to the user — sweeping cannot affect their credit).
//   - One address is processed per tick per network (bounded, avoids nonce
//     races and keeps CPU/time budget small).
//   - Every broadcast is guarded by a status transition so a re-run can't
//     double-spend: 'credited'->'funding'->'sweeping'->'swept'.
//   - Signer is byte-verified against ethers (see ext-evm-signer.ts header).
//
// GATING: no-op unless EXT_DEPOSITS_ENABLED==='true' AND EXT_HD_WALLET_MNEMONIC
// is present AND the network is fully configured (RPC + USDT contract).
// ============================================================================

import {
  getNativeBalance,
  getNonce,
  suggestFees,
  erc20BalanceOf,
  encodeErc20Transfer,
  sendRawTransaction,
  type EvmRpcConfig,
} from './lib/qta-evm';
import {
  deriveEvmAccount,
  evmAddressIsValid,
  signEip1559Tx,
  type EvmAccount,
  type Eip1559Tx,
} from './lib/ext-evm-signer';

export interface ExtSweepEnv {
  DB: D1Database;
  EXT_DEPOSITS_ENABLED?: string;
  EXT_HD_WALLET_MNEMONIC?: string;
  /** Optional override receiving address. Default = HD index 0 (hot wallet). */
  EXT_SWEEP_DESTINATION?: string;
  /** Don't sweep dust below this USDT amount (default 1). */
  EXT_SWEEP_MIN_USDT?: string;

  // Ethereum (ERC-20)
  EXT_ETH_RPC_URL?: string;
  EXT_ETH_USDT_CONTRACT?: string;
  EXT_ETH_USDT_DECIMALS?: string;
  /** Native gas (wei) to top-up a user address before its ERC-20 sweep. */
  EXT_ETH_GAS_TOPUP_WEI?: string;

  // BSC (BEP-20)
  EXT_BSC_RPC_URL?: string;
  EXT_BSC_USDT_CONTRACT?: string;
  EXT_BSC_USDT_DECIMALS?: string;
  EXT_BSC_GAS_TOPUP_WEI?: string;
}

interface SweepNetCfg {
  chain: 'evm';
  network: string;        // 'erc20' | 'bep20'
  rpc: EvmRpcConfig;
  usdtContract: string;
  usdtDecimals: number;
  gasTopupWei: bigint;
  erc20GasLimit: bigint;  // gas limit for a token transfer
  nativeGasLimit: bigint; // gas limit for the native top-up send (21000)
}

export function extSweepEnabled(env: ExtSweepEnv): boolean {
  return String(env.EXT_DEPOSITS_ENABLED || '').toLowerCase() === 'true'
    && !!(env.EXT_HD_WALLET_MNEMONIC && env.EXT_HD_WALLET_MNEMONIC.trim());
}

function resolveSweepNetworks(env: ExtSweepEnv): SweepNetCfg[] {
  const out: SweepNetCfg[] = [];
  if (env.EXT_ETH_RPC_URL && env.EXT_ETH_USDT_CONTRACT) {
    out.push({
      chain: 'evm', network: 'erc20',
      rpc: { rpcUrl: env.EXT_ETH_RPC_URL, chainId: 1 },
      usdtContract: env.EXT_ETH_USDT_CONTRACT,
      usdtDecimals: Number(env.EXT_ETH_USDT_DECIMALS || '6') || 6,
      // Default top-up: 0.0006 ETH. Operator should tune via env for gas price.
      gasTopupWei: BigInt(env.EXT_ETH_GAS_TOPUP_WEI || '600000000000000'),
      erc20GasLimit: 90000n,
      nativeGasLimit: 21000n,
    });
  }
  if (env.EXT_BSC_RPC_URL && env.EXT_BSC_USDT_CONTRACT) {
    out.push({
      chain: 'evm', network: 'bep20',
      rpc: { rpcUrl: env.EXT_BSC_RPC_URL, chainId: 56 },
      usdtContract: env.EXT_BSC_USDT_CONTRACT,
      usdtDecimals: Number(env.EXT_BSC_USDT_DECIMALS || '18') || 18,
      // Default top-up: 0.0008 BNB.
      gasTopupWei: BigInt(env.EXT_BSC_GAS_TOPUP_WEI || '800000000000000'),
      erc20GasLimit: 90000n,
      nativeGasLimit: 21000n,
    });
  }
  return out;
}

function decimalToWei(amount: string, decimals: number): bigint {
  const s = (amount || '0').trim();
  const neg = s.startsWith('-');
  const [intPart, fracRaw = ''] = (neg ? s.slice(1) : s).split('.');
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
  const v = BigInt((intPart || '0') + frac);
  return neg ? -v : v;
}

/**
 * Sweep ONE address per network per tick.
 *
 * Selection: the oldest user address (index >= 1) that has at least one
 * 'credited' deposit not yet swept. We then check its live on-chain balances:
 *   - if it has a token balance but no gas → fund gas (STEP 1), stop.
 *   - if it has gas and a token balance → sweep the whole token balance (STEP 2).
 *   - mark all that address's 'credited' deposits 'swept' after a successful sweep.
 */
export async function sweepExtDeposits(env: ExtSweepEnv): Promise<{
  ok: boolean; network?: string; action?: string; address?: string;
  txHash?: string; reason?: string;
}> {
  if (!extSweepEnabled(env)) return { ok: true, reason: 'disabled' };
  const nets = resolveSweepNetworks(env);
  if (nets.length === 0) return { ok: true, reason: 'no_network_config' };

  const mnemonic = env.EXT_HD_WALLET_MNEMONIC as string;
  const minUsdt = Number(env.EXT_SWEEP_MIN_USDT || '1') || 1;

  for (const net of nets) {
    // Pick the oldest address with un-swept deposits. Include BOTH:
    //   'credited' — not yet gas-funded (STEP 1 will gas-fund this tick), and
    //   'funding'  — already gas-funded on a PRIOR tick (STEP 2 sweeps now).
    // The two-step gas-fund → sweep flow spans multiple ticks in production
    // (gas top-up must confirm before the USDT transfer can pay for gas), so
    // the candidate query MUST re-pick 'funding' rows or they'd be stranded.
    const cand = await env.DB.prepare(
      `SELECT d.user_id, d.address, MIN(a.address_index) AS idx
         FROM ext_deposits d
         JOIN ext_addresses a
           ON a.user_id = d.user_id AND a.chain = d.chain AND a.network = d.network
        WHERE d.chain = ? AND d.network = ? AND d.status IN ('credited','funding')
        GROUP BY d.address
        ORDER BY MIN(d.created_at) ASC
        LIMIT 1`
    ).bind(net.chain, net.network).first<{ user_id: string; address: string; idx: number }>();

    if (!cand) continue; // nothing to sweep on this network this tick

    const idx = Number(cand.idx);
    if (!Number.isInteger(idx) || idx < 1) {
      console.warn(`[ext-sweep] bad index for ${cand.address}; skipping`);
      continue;
    }

    // Derive the user's deposit account (holds the funds) + destination.
    let userAcct: EvmAccount;
    try {
      userAcct = deriveEvmAccount(mnemonic, idx);
    } catch (e) {
      console.error('[ext-sweep] derive user acct failed:', (e as any)?.message || e);
      continue;
    }
    // Sanity: the derived address MUST match the stored one (mnemonic mismatch guard).
    if (userAcct.address.toLowerCase() !== cand.address.toLowerCase()) {
      console.error(`[ext-sweep] derived ${userAcct.address} != stored ${cand.address} — mnemonic mismatch; ABORT network`);
      continue;
    }

    const destination = (env.EXT_SWEEP_DESTINATION && evmAddressIsValid(env.EXT_SWEEP_DESTINATION))
      ? env.EXT_SWEEP_DESTINATION
      : deriveEvmAccount(mnemonic, 0).address; // hot wallet (index 0)

    // Live on-chain balances of the user address.
    let tokenBal: bigint;
    let nativeBal: bigint;
    try {
      [tokenBal, nativeBal] = await Promise.all([
        erc20BalanceOf(net.rpc, net.usdtContract, userAcct.address),
        getNativeBalance(net.rpc, userAcct.address),
      ]);
    } catch (e) {
      console.warn(`[ext-sweep] balance read failed for ${userAcct.address}:`, (e as any)?.message || e);
      continue;
    }

    const minWei = decimalToWei(String(minUsdt), net.usdtDecimals);
    if (tokenBal < minWei) {
      // Dust or already moved — close out the rows so we don't re-pick. Cover
      // both 'credited' and 'funding' (an already-gas-funded addr whose token
      // balance is now below the min, e.g. already swept out-of-band).
      await env.DB.prepare(
        `UPDATE ext_deposits SET status='swept', swept_at=?, updated_at=?
          WHERE chain=? AND network=? AND address=? AND status IN ('credited','funding')`
      ).bind(new Date().toISOString(), new Date().toISOString(), net.chain, net.network, cand.address).run();
      return { ok: true, network: net.network, action: 'dust_closed', address: userAcct.address };
    }

    // Fee suggestion for gas math.
    let fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
    try {
      fees = await suggestFees(net.rpc);
    } catch (e) {
      console.warn('[ext-sweep] suggestFees failed:', (e as any)?.message || e);
      continue;
    }

    // Estimated worst-case gas cost of the ERC-20 sweep.
    const sweepGasCost = fees.maxFeePerGas * net.erc20GasLimit;

    // ── STEP 1: gas funding (user address can't pay for the ERC-20 transfer) ──
    if (nativeBal < sweepGasCost) {
      const hot = deriveEvmAccount(mnemonic, 0);
      // Top-up amount: max(configured topup, needed). Keep it bounded.
      const topup = net.gasTopupWei > sweepGasCost ? net.gasTopupWei : sweepGasCost + (sweepGasCost / 2n);

      // Hot wallet must itself have enough for topup + its own gas.
      let hotBal: bigint, hotNonce: number;
      try {
        [hotBal, hotNonce] = await Promise.all([
          getNativeBalance(net.rpc, hot.address),
          getNonce(net.rpc, hot.address),
        ]);
      } catch (e) {
        console.warn('[ext-sweep] hot wallet read failed:', (e as any)?.message || e);
        continue;
      }
      const hotSendGas = fees.maxFeePerGas * net.nativeGasLimit;
      if (hotBal < topup + hotSendGas) {
        console.warn(`[ext-sweep] hot wallet ${hot.address} underfunded for gas top-up (need ${topup + hotSendGas}, have ${hotBal})`);
        return { ok: true, network: net.network, action: 'hot_wallet_underfunded', address: userAcct.address };
      }

      const fundTx: Eip1559Tx = {
        chainId: net.rpc.chainId, nonce: hotNonce,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxFeePerGas: fees.maxFeePerGas,
        gasLimit: net.nativeGasLimit,
        to: userAcct.address, value: topup, data: '0x',
      };
      const { rawTx } = signEip1559Tx(fundTx, hot.privateKey);
      try {
        const txHash = await sendRawTransaction(net.rpc, rawTx);
        // Mark the address's credited deposits as 'funding' so we don't re-fund
        // it every tick while the gas tx confirms.
        await env.DB.prepare(
          `UPDATE ext_deposits SET status='funding', updated_at=?
            WHERE chain=? AND network=? AND address=? AND status='credited'`
        ).bind(new Date().toISOString(), net.chain, net.network, cand.address).run();
        return { ok: true, network: net.network, action: 'gas_funded', address: userAcct.address, txHash };
      } catch (e) {
        console.error('[ext-sweep] gas funding broadcast failed:', (e as any)?.message || e);
        return { ok: false, network: net.network, action: 'gas_fund_failed', address: userAcct.address, reason: (e as any)?.message };
      }
    }

    // ── STEP 2: sweep the entire token balance to the destination ────────────
    let userNonce: number;
    try {
      userNonce = await getNonce(net.rpc, userAcct.address);
    } catch (e) {
      console.warn('[ext-sweep] user nonce read failed:', (e as any)?.message || e);
      continue;
    }
    const data = encodeErc20Transfer(destination, tokenBal);
    const sweepTx: Eip1559Tx = {
      chainId: net.rpc.chainId, nonce: userNonce,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxFeePerGas: fees.maxFeePerGas,
      gasLimit: net.erc20GasLimit,
      to: net.usdtContract, value: 0n, data,
    };
    const { rawTx } = signEip1559Tx(sweepTx, userAcct.privateKey);
    try {
      const txHash = await sendRawTransaction(net.rpc, rawTx);
      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE ext_deposits SET status='swept', swept_tx_hash=?, swept_at=?, updated_at=?
          WHERE chain=? AND network=? AND address=? AND status IN ('credited','funding')`
      ).bind(txHash, now, now, net.chain, net.network, cand.address).run();
      return { ok: true, network: net.network, action: 'swept', address: userAcct.address, txHash };
    } catch (e) {
      console.error('[ext-sweep] sweep broadcast failed:', (e as any)?.message || e);
      return { ok: false, network: net.network, action: 'sweep_failed', address: userAcct.address, reason: (e as any)?.message };
    }
  }

  return { ok: true, reason: 'nothing_to_sweep' };
}
