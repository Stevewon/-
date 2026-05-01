/**
 * QTA Native Mainnet client — Phase B (stub adapter).
 *
 * This module defines the abstract interface QuantaEX uses to talk to its own
 * post-quantum mainnet. A Mock adapter is provided so the rest of the stack
 * (DB schema, REST routes, admin UI, cron monitor) can be built and tested
 * end-to-end while the real RPC details are finalised.
 *
 * To switch to the real chain later, implement RealQtaChainClient (HTTP RPC
 * + Dilithium3 signing) and select it via env.QTA_CHAIN_DRIVER === 'real'.
 *
 * Defaults:
 *   - Signature scheme: CRYSTALS-Dilithium3 (NIST PQC)
 *   - Block time: 2,000 ms
 *   - Required deposit confirmations (mainnet): 12
 */

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
// Real adapter placeholder — to be filled in when mainnet RPC is published.
// Keep the surface identical so the routes don't change.
// ---------------------------------------------------------------------------
export class RealQtaChainClient implements QtaChainClient {
  network: QtaNetwork;
  signatureScheme = 'CRYSTALS-Dilithium3';
  blockTimeMs = 2000;
  requiredConfirmations: number;

  constructor(
    public readonly rpcUrl: string,
    public readonly hotWalletPrivKey: string, // PQ private key, base64 / hex
    network: QtaNetwork = 'qta-mainnet',
  ) {
    this.network = network;
    this.requiredConfirmations = network === 'qta-mainnet' ? 12 : 6;
  }

  // NOTE: All methods are intentionally not implemented yet. They throw a
  // descriptive error so we can't accidentally route prod traffic through an
  // unfinished adapter.
  async getHead(): Promise<QtaChainHead> {
    throw new Error('RealQtaChainClient.getHead not implemented yet');
  }
  async generateAddress(_userId: string): Promise<QtaAddress> {
    throw new Error('RealQtaChainClient.generateAddress not implemented yet');
  }
  async getBalance(_address: string): Promise<string> {
    throw new Error('RealQtaChainClient.getBalance not implemented yet');
  }
  async listIncomingTxs(_address: string, _fromBlock: number): Promise<QtaTx[]> {
    throw new Error('RealQtaChainClient.listIncomingTxs not implemented yet');
  }
  async signAndBroadcast(_params: { to: string; amount: string; memo?: string }) {
    throw new Error('RealQtaChainClient.signAndBroadcast not implemented yet');
  }
}

// ---------------------------------------------------------------------------
// Factory — picks the right driver based on env. Defaults to Mock so that
// preview/dev never accidentally hit a non-existent RPC.
// ---------------------------------------------------------------------------
export interface QtaChainEnv {
  QTA_CHAIN_DRIVER?: string;        // 'mock' | 'real'
  QTA_NETWORK?: string;             // 'qta-mainnet' | 'qta-testnet'
  QTA_RPC_URL?: string;
  QTA_HOT_WALLET_PRIVATE_KEY?: string;
}

export function getQtaChainClient(env: QtaChainEnv): QtaChainClient {
  const driver = (env.QTA_CHAIN_DRIVER || 'mock').toLowerCase();
  const network: QtaNetwork =
    (env.QTA_NETWORK as QtaNetwork) === 'qta-testnet' ? 'qta-testnet' : 'qta-mainnet';

  if (driver === 'real' && env.QTA_RPC_URL && env.QTA_HOT_WALLET_PRIVATE_KEY) {
    return new RealQtaChainClient(env.QTA_RPC_URL, env.QTA_HOT_WALLET_PRIVATE_KEY, network);
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
