/**
 * Quantarium chain client — SPHINCS+ real adapter live.
 *
 * On-chain reality (confirmed 2026-08-13 via cloned go-Quantarium source at
 * https://github.com/OfficialQTA/go-Quantarium — a go-ethereum v1.13.15
 * fork with SPHINCS+ integration):
 *   - chain_id: 60000
 *   - Consensus: EVM-compatible Geth fork (Clique)
 *   - Block signatures: SPHINCS+-SHA2-128s (SLH-DSA)
 *   - Transaction signatures: SPHINCS+-SHA2-128s via new typed tx 0x7f
 *     (NOT standard ECDSA — this was our misunderstanding for a day)
 *   - Addresses: 20-byte EVM (0x...), computed as keccak256(SPHINCS+ pubkey)[-20:]
 *   - Native coin: QTA (18 decimals)
 *   - Reference tokens: QX (ERC-20), QKEY (ERC-20)
 *   - Explorer: https://scan.quantarium.io (Blockscout v2 API)
 *   - RPC:      https://rpc.quantarium.io
 *
 * Exchange hot wallet (dedicated account derived from HD index 0):
 *   0xdeB6BFE50EeE8D753313988c6d1E77f95322527b
 *   (adopted 2026-08-17 — the owner-controlled account whose 12-word
 *    mnemonic lives ONLY in the QTA_HD_WALLET_MNEMONIC secret and was
 *    verified index-0 == this address. Replaces 0x496EE…4E97 (mnemonic did
 *    not derive to it, index-0 was 0xF4aE…47c87) and the earlier 0x4B35…938Cb
 *    (mnemonic lost, unspendable) — do NOT reuse either.)
 *
 * Custody model (Option 2 — server-held HD mnemonic, no bot dependency):
 *   Server holds a single 12-word BIP-39 mnemonic (Cloudflare Pages secret
 *   `QTA_HD_WALLET_MNEMONIC`). Each user gets a deterministic SPHINCS+ keypair
 *   via HKDF-based derivation (see lib/qta-sphincs.ts for full doc). Index 0
 *   is the hot wallet — the exchange's withdrawal source and sweep
 *   destination. Indices 1..N are per-user deposit addresses, allocated
 *   monotonically in the qta_hd_indexes table (migration 0036).
 *
 * NOTE: The MockQtaChainClient below still uses the OLD placeholder shape
 * (qta1... bech32 addresses, Dilithium3 label) because previous route/DB
 * code was written against it. This is retained ONLY as a compile-time
 * placeholder; the /chain/qta/* routes hard-guard against issuing mock
 * addresses to real users (see routes/chain.ts).
 *
 * Required deposit confirmations (mainnet): 12
 */

// -----------------------------------------------------------------------------
// Quantarium chain constants (single source of truth for real-adapter work).
// -----------------------------------------------------------------------------
export const QUANTARIUM_CHAIN = {
  chainId: 60000,
  name: 'Quantarium',
  rpcUrl: 'https://rpc.quantarium.io',
  explorerUrl: 'https://scan.quantarium.io',
  blockSignatureScheme: 'SPHINCS+-SHA2-128s (SLH-DSA)',
  txSignatureScheme: 'SPHINCS+-SHA2-128s (typed tx 0x7f)',
  nativeSymbol: 'QTA',
  nativeDecimals: 18,
  requiredConfirmations: 12,
  // Exchange hot wallet (SPHINCS+ HD account index 0).
  exchangeHotWallet: '0xdeB6BFE50EeE8D753313988c6d1E77f95322527b',
  tokens: {
    QX:   { address: '0xad447d42fB065a5b505772235F0c96d27501e6Fb', decimals: 18 },
    QKEY: { address: '0x216621D3b3dB600F35DBf6c5709486dDC8882a16', decimals: 18 },
  },
} as const;

/** Returns true if a string is a well-formed 20-byte EVM address (0x + 40 hex). */
export function isEvmAddress(s: string): boolean {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
}

export type QtaNetwork = 'qta-mainnet' | 'qta-testnet';

export interface QtaAddress {
  address: string;
  pubkey: string;       // hex / base58 of post-quantum public key
  derivation?: string;  // HD derivation path or KMS key id
}

export interface QtaTx {
  hash: string;
  from: string;
  to: string;
  amount: string;        // string-encoded decimal to avoid float drift
  blockHeight: number;
  confirmations: number;
  timestamp: number;     // unix seconds
}

export interface QtaChainHead {
  height: number;
  timestamp: number;
  validatorsOnline: number;
}

export interface QtaBroadcastResult {
  hash: string;
  acceptedAt: number;
}

export interface QtaChainClient {
  network: QtaNetwork;
  signatureScheme: string;
  blockTimeMs: number;
  requiredConfirmations: number;

  /** Returns chain tip info (height, timestamp, validators online). */
  getHead(): Promise<QtaChainHead>;

  /** Generates a new deposit address bound to a userId (deterministic per user). */
  generateAddress(userId: string): Promise<QtaAddress>;

  /** Returns native QTA balance of an address, as a decimal string. */
  getBalance(address: string): Promise<string>;

  /**
   * Returns deposit transactions to `address` since `fromBlock`.
   * Mock returns nothing; real impl would query the chain indexer.
   */
  listIncomingTxs(address: string, fromBlock: number): Promise<QtaTx[]>;

  /**
   * Sign a withdrawal payload with the hot-wallet PQ private key and
   * broadcast to the network. Returns the resulting tx hash.
   */
  signAndBroadcast(params: {
    to: string;
    amount: string;
    memo?: string;
  }): Promise<QtaBroadcastResult>;
}

// ---------------------------------------------------------------------------
// MockQtaChainClient — used in dev/preview and as a placeholder until the
// real RPC + PQ signer are wired in. All methods are deterministic and side-
// effect free, so cron / routes can run safely against it.
// ---------------------------------------------------------------------------
export class MockQtaChainClient implements QtaChainClient {
  network: QtaNetwork;
  signatureScheme = 'CRYSTALS-Dilithium3';
  blockTimeMs = 2000;
  requiredConfirmations: number;

  constructor(network: QtaNetwork = 'qta-mainnet') {
    this.network = network;
    this.requiredConfirmations = network === 'qta-mainnet' ? 12 : 6;
  }

  async getHead(): Promise<QtaChainHead> {
    // Synthetic head height: seconds-since-epoch / blockTime.
    const now = Math.floor(Date.now() / 1000);
    return {
      height: Math.floor(now / 2),
      timestamp: now,
      validatorsOnline: 21,
    };
  }

  async generateAddress(userId: string): Promise<QtaAddress> {
    // Deterministic mock address: stable across calls so tests are repeatable.
    // Format: qta1<32 hex>  (real impl will use bech32 from PQ pubkey hash)
    const hex = await sha256Hex(`qta-mock:${userId}:${this.network}`);
    return {
      address: 'qta1' + hex.slice(0, 32),
      pubkey: 'pq:dilithium3:' + hex,
      derivation: `m/44'/9999'/0'/0/${shortNum(userId)}`,
    };
  }

  async getBalance(_address: string): Promise<string> {
    return '0';
  }

  async listIncomingTxs(_address: string, _fromBlock: number): Promise<QtaTx[]> {
    return [];
  }

  async signAndBroadcast(params: {
    to: string;
    amount: string;
    memo?: string;
  }): Promise<QtaBroadcastResult> {
    const hash = 'mock-' + (await sha256Hex(
      `${params.to}:${params.amount}:${Date.now()}:${params.memo ?? ''}`,
    ));
    return { hash, acceptedAt: Math.floor(Date.now() / 1000) };
  }
}

// ---------------------------------------------------------------------------
// Real adapter — Quantarium (SPHINCS+ typed tx 0x7f, chain_id 60000).
//
// Architecture (Option 2, revised per PQ revelation on 2026-08-13):
//   - Server holds ONE 12-word BIP-39 mnemonic (secret QTA_HD_WALLET_MNEMONIC).
//   - Custom HKDF-based HD derivation (BIP-32 not applicable to SPHINCS+):
//     each account_index maps to a deterministic SLH-DSA-SHA2-128s keypair.
//   - Index 0 = exchange hot wallet (0x4B35C556...938Cb).
//     Indices 1..N = per-user deposit addresses, allocated monotonically in
//     qta_hd_indexes and never reused after account deletion.
//   - Transaction signing uses the SPHINCS+ typed tx envelope 0x7f (NOT the
//     standard EIP-1559 0x02) with pubkey + 7856-byte signature in the RLP
//     payload. See lib/qta-sphincs.ts for wire format + performance notes.
//   - Withdrawal signing is CPU-intensive (~6-10 s per signature). The
//     signAndBroadcast() method below performs the sign synchronously; on
//     Cloudflare Pages Workers this MUST run inside a queue consumer or
//     scheduled task, not a user-facing HTTP handler, because Workers have
//     a per-request CPU budget (10 ms free, 30 s paid) that a synchronous
//     sign would blow through and starve concurrent requests.
//
// This client is only ever returned by getQtaChainClient() when
// env.QTA_CHAIN_DRIVER === 'real' AND QTA_HD_WALLET_MNEMONIC is present.
// Otherwise the routes' 503 CHAIN_INTEGRATION_PENDING gate stays engaged.
//
// ⚠️ QTA_HOT_WALLET_PRIVATE_KEY is DEPRECATED — SPHINCS+ has no 32-byte
// ECDSA private key equivalent. The hot wallet's SPHINCS+ secret key (64
// bytes) is derived from the mnemonic at index 0, not stored separately.
// The env is still read for backwards compat but no longer required.
// ---------------------------------------------------------------------------
import {
  deriveAccountFromMnemonic,
  isValidMnemonic,
  toChecksumAddress,
  signSphincsTx,
  toHex,
  verifyMnemonicMatchesHotWallet,
  type SphincsAccount,
} from './qta-sphincs';
import {
  getBlockNumber,
  getNativeBalance,
  getNonce,
  suggestFees,
  encodeErc20Transfer,
  sendRawTransaction,
  type EvmRpcConfig,
} from './qta-evm';

export interface SphincsChainEnvBindings {
  DB?: D1Database;
}

export class SphincsQtaChainClient implements QtaChainClient {
  network: QtaNetwork;
  signatureScheme = 'SPHINCS+-SHA2-128s (SLH-DSA, typed tx 0x7f)';
  blockTimeMs = 2000;
  requiredConfirmations: number;

  private readonly cfg: EvmRpcConfig;
  private readonly mnemonic: string;
  private readonly hotWalletAddress: string;
  private readonly hotAccount: SphincsAccount; // cached — 32-byte pubkey + 64-byte secret
  private readonly db?: D1Database;

  constructor(params: {
    rpcUrl: string;
    chainId: number;
    mnemonic: string;
    hotWalletAddress: string;
    network?: QtaNetwork;
    db?: D1Database;
  }) {
    if (!isValidMnemonic(params.mnemonic)) {
      throw new Error('SphincsQtaChainClient: QTA_HD_WALLET_MNEMONIC missing/invalid');
    }
    // Construct-time keypair verification: index-0 derived from the mnemonic
    // MUST match the declared exchange hot wallet. If not, the operator has
    // registered the wrong mnemonic and every withdrawal would fail; fail
    // FAST at construction so the safety gate stays engaged.
    const check = verifyMnemonicMatchesHotWallet(params.mnemonic, params.hotWalletAddress);
    if (!check.ok) {
      throw new Error(
        `SphincsQtaChainClient: mnemonic index-0 does not match hot wallet ` +
        `(derived=${check.derived}, expected=${check.expected})`,
      );
    }

    this.cfg = { rpcUrl: params.rpcUrl, chainId: params.chainId };
    this.mnemonic = params.mnemonic;
    this.hotWalletAddress = toChecksumAddress(params.hotWalletAddress);
    this.hotAccount = deriveAccountFromMnemonic(params.mnemonic, 0);
    this.db = params.db;
    this.network = params.network || 'qta-mainnet';
    this.requiredConfirmations = this.network === 'qta-mainnet' ? 12 : 6;
  }

  async getHead(): Promise<QtaChainHead> {
    const height = await getBlockNumber(this.cfg);
    return {
      height,
      timestamp: Math.floor(Date.now() / 1000),
      validatorsOnline: 0, // Clique validators — not exposed via eth_ RPC.
    };
  }

  async generateAddress(userId: string): Promise<QtaAddress> {
    if (!this.db) {
      throw new Error('SphincsQtaChainClient.generateAddress requires DB binding (HD index allocation)');
    }
    const index = await allocateHdIndex(this.db, userId);
    const acc = deriveAccountFromMnemonic(this.mnemonic, index);
    return {
      address: acc.address,
      pubkey: '0x' + toHex(acc.publicKey),
      derivation: `sphincs-hd-wallet-v1/${index}`,
    };
  }

  async getBalance(address: string): Promise<string> {
    const wei = await getNativeBalance(this.cfg, address);
    return wei.toString();
  }

  async listIncomingTxs(_address: string, _fromBlock: number): Promise<QtaTx[]> {
    // Deposit detection is done by the cron ticker via Blockscout API
    // (cheaper than eth_getLogs over long ranges), so this stays a no-op
    // here. See cron/qta-tick.ts in the follow-up.
    return [];
  }

  /**
   * Sign a native-QTA withdrawal with the hot wallet's SPHINCS+ key (index 0)
   * and broadcast to the network. Returns the resulting tx hash.
   *
   * ⚠️ SPHINCS+ signing is expensive (~6-10 s per tx). This call MUST NOT be
   * awaited from a user-facing HTTP handler — always dispatch via a queue
   * consumer / scheduled worker. The safety gate in /wallet/withdraw already
   * returns 503 CHAIN_INTEGRATION_PENDING when driver!=real, and once real
   * mode is enabled the withdraw route should enqueue instead of awaiting.
   */
  async signAndBroadcast(params: {
    to: string;
    amount: string;
    memo?: string;
  }): Promise<QtaBroadcastResult> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(params.to)) {
      throw new Error('to must be a 20-byte 0x-address');
    }
    const amountWei = decimalStringToWei(params.amount, 18);
    if (amountWei <= 0n) throw new Error('amount must be > 0');

    const [nonce, fees] = await Promise.all([
      getNonce(this.cfg, this.hotWalletAddress),
      suggestFees(this.cfg),
    ]);

    const { rawTx } = signSphincsTx(
      {
        chainId: this.cfg.chainId,
        nonce,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        maxFeePerGas: fees.maxFeePerGas,
        gasLimit: 100_000n, // native transfer with PQ signature — larger tx size, higher gas headroom
        to: params.to,
        value: amountWei,
        data: '0x',
      },
      this.hotAccount.publicKey,
      this.hotAccount.secretKey,
    );

    const broadcastHash = await sendRawTransaction(this.cfg, rawTx);
    return { hash: broadcastHash, acceptedAt: Math.floor(Date.now() / 1000) };
  }

  /**
   * ERC-20 (QX / QKEY) withdrawal. Same signing constraints as signAndBroadcast
   * above — expect ~6-10 s per signature. Exposed as a public method so that a
   * future admin/queue worker can drive token withdrawals directly.
   */
  async signAndBroadcastErc20(params: {
    tokenContract: string;
    to: string;
    amountWei: bigint;
  }): Promise<QtaBroadcastResult> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(params.tokenContract)) {
      throw new Error('tokenContract must be a 20-byte 0x-address');
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(params.to)) {
      throw new Error('to must be a 20-byte 0x-address');
    }
    if (params.amountWei <= 0n) throw new Error('amount must be > 0');

    const [nonce, fees] = await Promise.all([
      getNonce(this.cfg, this.hotWalletAddress),
      suggestFees(this.cfg),
    ]);

    const data = encodeErc20Transfer(params.to, params.amountWei);
    const { rawTx } = signSphincsTx(
      {
        chainId: this.cfg.chainId,
        nonce,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        maxFeePerGas: fees.maxFeePerGas,
        gasLimit: 200_000n,
        to: params.tokenContract,
        value: 0n,
        data,
      },
      this.hotAccount.publicKey,
      this.hotAccount.secretKey,
    );

    const broadcastHash = await sendRawTransaction(this.cfg, rawTx);
    return { hash: broadcastHash, acceptedAt: Math.floor(Date.now() / 1000) };
  }
}

/**
 * Convert a decimal string like "1.5" to wei-scale bigint at `decimals` (18 for QTA).
 * Rejects negative / NaN / more decimals than allowed to avoid silent truncation.
 */
function decimalStringToWei(s: string, decimals: number): bigint {
  if (typeof s !== 'string') throw new Error('amount must be string');
  const trimmed = s.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`invalid amount: ${s}`);
  const [intPart, fracRaw = ''] = trimmed.split('.');
  if (fracRaw.length > decimals) {
    throw new Error(`amount has more than ${decimals} decimals`);
  }
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

/**
 * Allocate a stable HD index (>= 1) for a user. Idempotent per user_id so
 * repeated calls to /chain/qta/deposit-address always yield the same address.
 *
 * Index 0 is reserved for the exchange hot wallet — never issued to users.
 *
 * Requires table `qta_hd_indexes` (created by migration 0036):
 *   user_id TEXT PRIMARY KEY, address_index INTEGER UNIQUE NOT NULL,
 *   address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
 *
 * Falls back to a deterministic hash of user_id (shifted into [1, 2^30 + 1))
 * if the table is missing so the code doesn't blow up before the migration
 * lands — the address is still stable, just not reserved in a monotonic
 * sequence.
 */
async function allocateHdIndex(db: D1Database, userId: string): Promise<number> {
  try {
    const existing = await db
      .prepare('SELECT address_index FROM qta_hd_indexes WHERE user_id = ?')
      .bind(userId)
      .first<{ address_index: number }>();
    if (existing && Number.isInteger(existing.address_index)) {
      return existing.address_index;
    }
    // Start at 1 (index 0 reserved for the hot wallet). If no rows yet,
    // COALESCE(MAX, 0) + 1 = 1; otherwise the next monotonic slot.
    const row = await db
      .prepare(
        'SELECT COALESCE(MAX(address_index), 0) + 1 AS next_ix FROM qta_hd_indexes',
      )
      .first<{ next_ix: number }>();
    const nextIx = Math.max(1, Number(row?.next_ix ?? 1));
    await db
      .prepare(
        `INSERT INTO qta_hd_indexes (user_id, address_index, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .bind(userId, nextIx)
      .run();
    // Re-read in case of ON CONFLICT race so we always return the winning row.
    const finalRow = await db
      .prepare('SELECT address_index FROM qta_hd_indexes WHERE user_id = ?')
      .bind(userId)
      .first<{ address_index: number }>();
    return Number(finalRow?.address_index ?? nextIx);
  } catch (_e) {
    // Table missing: fall back to a stable hash-based index in [1, 2^30 + 1).
    // Runtime code will still work; the follow-up migration replaces this path.
    // Never returns 0 — that slot belongs to the hot wallet.
    let h = 2166136261;
    for (let i = 0; i < userId.length; i++) {
      h = (h ^ userId.charCodeAt(i)) * 16777619;
    }
    return (Math.abs(h) % (1 << 30)) + 1;
  }
}

// ---------------------------------------------------------------------------
// Factory — picks the right driver based on env. Defaults to Mock so that
// preview/dev never accidentally hit a non-existent RPC.
// ---------------------------------------------------------------------------
export interface QtaChainEnv {
  QTA_CHAIN_DRIVER?: string;        // 'mock' | 'real'
  QTA_NETWORK?: string;             // 'qta-mainnet' | 'qta-testnet'
  QTA_CHAIN_ID?: string;
  QTA_RPC_URL?: string;
  QTA_HOT_WALLET_ADDRESS?: string;
  QTA_HD_WALLET_MNEMONIC?: string;
  /**
   * @deprecated SPHINCS+ has no 32-byte ECDSA private key equivalent. Hot
   * wallet secret key (64 bytes) is derived from the mnemonic at index 0.
   * Kept in the type for backwards-compat with the diagnostic env-check
   * endpoint but no longer required by the real adapter.
   */
  QTA_HOT_WALLET_PRIVATE_KEY?: string;
  DB?: D1Database;
}

export function getQtaChainClient(env: QtaChainEnv): QtaChainClient {
  const driver = (env.QTA_CHAIN_DRIVER || 'mock').toLowerCase();
  const network: QtaNetwork =
    (env.QTA_NETWORK as QtaNetwork) === 'qta-testnet' ? 'qta-testnet' : 'qta-mainnet';

  // Real adapter activates only when driver=real AND all required secrets
  // are present. Note: QTA_HOT_WALLET_PRIVATE_KEY is no longer required — the
  // hot wallet key is derived from the mnemonic at index 0.
  if (
    driver === 'real' &&
    env.QTA_RPC_URL &&
    env.QTA_HOT_WALLET_ADDRESS &&
    env.QTA_HD_WALLET_MNEMONIC
  ) {
    return new SphincsQtaChainClient({
      rpcUrl: env.QTA_RPC_URL,
      chainId: Number(env.QTA_CHAIN_ID || '60000'),
      mnemonic: env.QTA_HD_WALLET_MNEMONIC,
      hotWalletAddress: env.QTA_HOT_WALLET_ADDRESS,
      network,
      db: env.DB,
    });
  }
  return new MockQtaChainClient(network);
}

// ---------------------------------------------------------------------------
// Helpers (no external deps — uses Web Crypto available in Workers)
// ---------------------------------------------------------------------------
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function shortNum(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 1_000_000;
}
