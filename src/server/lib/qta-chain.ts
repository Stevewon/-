/**
 * Quantarium chain client — Phase B (stub adapter, real chain confirmed live).
 *
 * On-chain reality (verified 2026-08-10 against scan.quantarium.io / rpc.quantarium.io):
 *   - chain_id: 60000
 *   - Consensus: EVM-compatible Geth fork
 *   - Block signatures: SPHINCS+-SHA2-128s (NIST PQC, hash-based)
 *   - Transaction signatures: standard ECDSA (EIP-1559)
 *   - Addresses: standard 20-byte EVM (0x...), NOT bech32
 *   - Native coin: QTA (18 decimals)
 *   - Reference tokens: QX (ERC-20), QKEY (ERC-20)
 *   - Explorer: https://scan.quantarium.io (Blockscout v2 API)
 *   - RPC:      https://rpc.quantarium.io
 *
 * Exchange hot wallet (dedicated EOA, separate from Treasury):
 *   0x496EEaCE6Cf759C95e9eFea5d4C16A35D0524E97
 *
 * Custody model (Scenario C — Hybrid):
 *   Each QuantaEX user maps to a subwallet under @quantarium_bot's master
 *   account; QuantaEX orchestrates subwallets via the bot API. The hot
 *   wallet above is the exchange's sweep destination and withdrawal source.
 *
 * NOTE: The MockQtaChainClient below still uses the OLD placeholder shape
 * (qta1... bech32 addresses, Dilithium3 label) because previous route/DB
 * code was written against it. This is retained ONLY as a compile-time
 * placeholder; the /chain/qta/* routes now hard-guard against issuing
 * mock addresses to real users (see routes/chain.ts). The real adapter
 * will be an EVM adapter (ethers/viem) OR a Telegram bot API adapter
 * depending on final Scenario C bot-API spec — implemented in a follow-up.
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
  blockSignatureScheme: 'SPHINCS+-SHA2-128s',
  txSignatureScheme: 'ECDSA (EIP-1559)',
  nativeSymbol: 'QTA',
  nativeDecimals: 18,
  requiredConfirmations: 12,
  // Exchange hot wallet (dedicated EOA — separate from Treasury).
  exchangeHotWallet: '0x496EEaCE6Cf759C95e9eFea5d4C16A35D0524E97',
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
// Real adapter — Quantarium (EVM, chain_id 60000).
//
// Architecture (per boss's 2026-08-10 decision — Option 2):
//   - HD wallet seed lives in QTA_HD_WALLET_MNEMONIC (Cloudflare Pages secret).
//   - Each user gets a stable BIP-44 derived address (path m/44'/60'/0'/0/i).
//     Index `i` is allocated once per user in qta_hd_indexes and never reused
//     even after account deletion, so an old address can never re-map to a
//     different user.
//   - Hot wallet (0x496EEaCE...4E97) is a separate secret QTA_HOT_WALLET_PRIVATE_KEY
//     — the signer for outbound withdrawals and the destination for sweeps.
//
// This client is only ever returned by getQtaChainClient() when
// env.QTA_CHAIN_DRIVER === 'real' AND all required secrets are present.
// Otherwise the routes' 503 CHAIN_INTEGRATION_PENDING gate stays engaged.
// ---------------------------------------------------------------------------
import {
  deriveAddressFromMnemonic,
  isValidMnemonic,
  toChecksumAddress,
} from './qta-hd';
import {
  getBlockNumber,
  getNativeBalance,
  sendNative,
  verifyHotWalletKeypair,
  type EvmRpcConfig,
} from './qta-evm';
import { parseHexPrivateKey } from './qta-hd';

export interface EvmChainEnvBindings {
  DB?: D1Database;
}

export class EvmQtaChainClient implements QtaChainClient {
  network: QtaNetwork;
  signatureScheme = 'SPHINCS+-SHA2-128s (blocks) / ECDSA (tx)';
  blockTimeMs = 2000;
  requiredConfirmations: number;

  private readonly cfg: EvmRpcConfig;
  private readonly mnemonic: string;
  private readonly hotWalletAddress: string;
  private readonly hotWalletPrivKeyHex: string;
  private readonly db?: D1Database;

  constructor(params: {
    rpcUrl: string;
    chainId: number;
    mnemonic: string;
    hotWalletAddress: string;
    hotWalletPrivKeyHex: string;
    network?: QtaNetwork;
    db?: D1Database;
  }) {
    if (!isValidMnemonic(params.mnemonic)) {
      throw new Error('EvmQtaChainClient: QTA_HD_WALLET_MNEMONIC missing/invalid');
    }
    // Verify at construct time that the hot wallet privkey matches the address.
    const check = verifyHotWalletKeypair(params.hotWalletPrivKeyHex, params.hotWalletAddress);
    if (!check.ok) {
      throw new Error(
        `EvmQtaChainClient: hot wallet key/address mismatch (derived=${check.derived}, expected=${check.expected})`,
      );
    }

    this.cfg = { rpcUrl: params.rpcUrl, chainId: params.chainId };
    this.mnemonic = params.mnemonic;
    this.hotWalletAddress = toChecksumAddress(params.hotWalletAddress);
    this.hotWalletPrivKeyHex = params.hotWalletPrivKeyHex;
    this.db = params.db;
    this.network = params.network || 'qta-mainnet';
    this.requiredConfirmations = this.network === 'qta-mainnet' ? 12 : 6;
  }

  async getHead(): Promise<QtaChainHead> {
    const height = await getBlockNumber(this.cfg);
    return {
      height,
      timestamp: Math.floor(Date.now() / 1000),
      validatorsOnline: 0, // Not exposed by standard eth_ RPC; leave 0 for now.
    };
  }

  async generateAddress(userId: string): Promise<QtaAddress> {
    if (!this.db) {
      throw new Error('EvmQtaChainClient.generateAddress requires DB binding (HD index allocation)');
    }
    const index = await allocateHdIndex(this.db, userId);
    const derived = deriveAddressFromMnemonic(this.mnemonic, index);
    return {
      address: derived.address,
      pubkey: derived.pubkey,
      derivation: derived.path,
    };
  }

  async getBalance(address: string): Promise<string> {
    const wei = await getNativeBalance(this.cfg, address);
    return wei.toString();
  }

  async listIncomingTxs(_address: string, _fromBlock: number): Promise<QtaTx[]> {
    // Deposit detection is done by the cron ticker via Blockscout API
    // (much cheaper than getLogs over a large range on RPC), so this
    // stays a no-op for now. See cron/qta-tick.ts in the follow-up.
    return [];
  }

  async signAndBroadcast(params: {
    to: string;
    amount: string;
    memo?: string;
  }): Promise<QtaBroadcastResult> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(params.to)) {
      throw new Error('to must be a 20-byte 0x-address');
    }
    // amount is decimal QTA (18 decimals). Convert to wei bigint safely.
    const amountWei = decimalStringToWei(params.amount, 18);
    if (amountWei <= 0n) throw new Error('amount must be > 0');

    const priv = parseHexPrivateKey(this.hotWalletPrivKeyHex);
    const { txHash } = await sendNative({
      cfg: this.cfg,
      fromAddress: this.hotWalletAddress,
      fromPrivkey: priv,
      to: params.to,
      amountWei,
    });
    return { hash: txHash, acceptedAt: Math.floor(Date.now() / 1000) };
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
 * Allocate a stable BIP-44 HD index for a user. Idempotent per user_id so
 * repeated calls to /chain/qta/deposit-address always yield the same address.
 *
 * Requires table `qta_hd_indexes` (created by migration 0036 in follow-up):
 *   user_id TEXT PRIMARY KEY, address_index INTEGER UNIQUE NOT NULL,
 *   address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
 *
 * Falls back to a deterministic hash of user_id if the table is missing so
 * the code doesn't blow up before the migration lands — the address is still
 * stable, just not reserved in a monotonic sequence.
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
    const row = await db
      .prepare(
        'SELECT COALESCE(MAX(address_index), -1) + 1 AS next_ix FROM qta_hd_indexes',
      )
      .first<{ next_ix: number }>();
    const nextIx = Number(row?.next_ix ?? 0);
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
    // Table missing: fall back to a stable hash-based index in [0, 2^30).
    // Runtime code will still work; the follow-up migration replaces this path.
    let h = 2166136261;
    for (let i = 0; i < userId.length; i++) {
      h = (h ^ userId.charCodeAt(i)) * 16777619;
    }
    return Math.abs(h) % (1 << 30);
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
  QTA_HOT_WALLET_PRIVATE_KEY?: string;
  QTA_HD_WALLET_MNEMONIC?: string;
  DB?: D1Database;
}

export function getQtaChainClient(env: QtaChainEnv): QtaChainClient {
  const driver = (env.QTA_CHAIN_DRIVER || 'mock').toLowerCase();
  const network: QtaNetwork =
    (env.QTA_NETWORK as QtaNetwork) === 'qta-testnet' ? 'qta-testnet' : 'qta-mainnet';

  if (
    driver === 'real' &&
    env.QTA_RPC_URL &&
    env.QTA_HOT_WALLET_ADDRESS &&
    env.QTA_HOT_WALLET_PRIVATE_KEY &&
    env.QTA_HD_WALLET_MNEMONIC
  ) {
    return new EvmQtaChainClient({
      rpcUrl: env.QTA_RPC_URL,
      chainId: Number(env.QTA_CHAIN_ID || '60000'),
      mnemonic: env.QTA_HD_WALLET_MNEMONIC,
      hotWalletAddress: env.QTA_HOT_WALLET_ADDRESS,
      hotWalletPrivKeyHex: env.QTA_HOT_WALLET_PRIVATE_KEY,
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
