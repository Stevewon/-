/**
 * Ethereum bridge client — Sprint 4 Phase G (stub adapter).
 *
 * Mirrors the shape of src/server/lib/qta-chain.ts: an abstract
 * EthBridgeClient interface plus a Mock implementation so the rest of
 * the stack (DB schema, REST routes, admin UI) can be built end-to-end
 * before the real qQTA ERC-20 contract is finalised.
 *
 * Real driver (follow-up commit) will:
 *   - Sign EIP-1559 transactions via @noble/secp256k1 + custom RLP
 *   - Call qQTA.mint(to, amount) on bridge wallet -> user
 *   - Call qQTA.burnFrom(from, amount) on user-signed approval
 *   - Submit via JSON-RPC fetch to env.ETH_RPC_URL
 *
 * Switch via env.BRIDGE_DRIVER === 'real'.
 *
 * qQTA token spec
 *   - Standard: ERC-20
 *   - Decimals: 18
 *   - Symbol:   qQTA
 *   - Name:     QuantaEX Wrapped QTA
 *   - 1 qQTA == 1 QTA (minus bridge fee)
 */

export type EthNetwork = 'mainnet' | 'sepolia';

export interface EthMintResult {
  txHash: string;
  acceptedAt: number;     // unix seconds
  ethBlock: number;       // 0 for mock until included
}

export interface EthBurnResult {
  txHash: string;
  acceptedAt: number;
  ethBlock: number;
  burnedAmount: string;
}

export interface EthBridgeClient {
  network: EthNetwork;
  qqtaContractAddr: string | null;
  custodyAddr: string | null;

  /** Bridge custody: lock QTA on QTA chain (mock — actual lock is in chain.ts). */
  mintQQTA(toEthAddress: string, amount: string): Promise<EthMintResult>;

  /** Bridge custody: burn qQTA from user's wallet (requires prior approval). */
  burnQQTA(fromEthAddress: string, amount: string): Promise<EthBurnResult>;

  /** Latest indexed ETH block height (for cron sync). */
  getHeadBlock(): Promise<number>;
}

// ---------------------------------------------------------------------------
// MockEthBridgeClient — deterministic test double
// ---------------------------------------------------------------------------
export class MockEthBridgeClient implements EthBridgeClient {
  network: EthNetwork;
  qqtaContractAddr: string;
  custodyAddr: string;
  private head: number;

  constructor(network: EthNetwork = 'mainnet') {
    this.network = network;
    // Deterministic mock addresses (clearly not real — start with 0xdead)
    this.qqtaContractAddr = '0xdead0000000000000000000000000000qQTA' + (network === 'mainnet' ? '01' : '02');
    this.custodyAddr      = '0xdead00000000000000000000000000Custody' + (network === 'mainnet' ? '01' : '02');
    this.head = 18_500_000; // realistic-ish ETH mainnet block as a starting marker
  }

  async mintQQTA(toEthAddress: string, amount: string): Promise<EthMintResult> {
    if (!isHexAddress(toEthAddress)) throw new Error('invalid_eth_address');
    if (!isPositiveDecimal(amount)) throw new Error('invalid_amount');
    return {
      txHash: mockTxHash('mint', toEthAddress, amount),
      acceptedAt: Math.floor(Date.now() / 1000),
      ethBlock: 0, // mock: actual block assigned post-include
    };
  }

  async burnQQTA(fromEthAddress: string, amount: string): Promise<EthBurnResult> {
    if (!isHexAddress(fromEthAddress)) throw new Error('invalid_eth_address');
    if (!isPositiveDecimal(amount)) throw new Error('invalid_amount');
    return {
      txHash: mockTxHash('burn', fromEthAddress, amount),
      acceptedAt: Math.floor(Date.now() / 1000),
      ethBlock: 0,
      burnedAmount: amount,
    };
  }

  async getHeadBlock(): Promise<number> {
    // Increment per-call so tests can observe progress
    this.head += 1;
    return this.head;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers (shared by routes/bridge.ts)
// ---------------------------------------------------------------------------

/** Strict 0x-prefixed 40-hex-char (case-insensitive) Ethereum address. */
export function isHexAddress(s: string): boolean {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
}

/** Positive decimal string (no scientific notation, no leading +/-). */
export function isPositiveDecimal(s: string): boolean {
  if (typeof s !== 'string') return false;
  if (!/^\d+(\.\d+)?$/.test(s)) return false;
  return Number(s) > 0;
}

/** Validates a QTA chain address (qta1... bech32-style for the stub). */
export function isQtaAddress(s: string): boolean {
  return typeof s === 'string' && /^qta1[0-9a-z]{8,80}$/.test(s);
}

// Pseudo-deterministic mock tx hash so admin UIs / audits show *something*
function mockTxHash(prefix: string, addr: string, amount: string): string {
  const seed = `${prefix}:${addr.toLowerCase()}:${amount}:${Date.now()}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  // 32-byte ETH-style hash: 64 hex chars after 0x. Pad with deterministic noise.
  return ('0x' + hex.repeat(8)).slice(0, 66);
}

// ---------------------------------------------------------------------------
// Driver selection
// ---------------------------------------------------------------------------
export function getEthBridgeClient(env: any): EthBridgeClient {
  const driver = (env?.BRIDGE_DRIVER || 'mock').toLowerCase();
  const network: EthNetwork = env?.BRIDGE_NETWORK === 'sepolia' ? 'sepolia' : 'mainnet';
  if (driver === 'real') {
    // Real RPC driver lands in a follow-up. Fall back to mock for now so
    // the rest of the stack stays functional even if the env var is set
    // prematurely.
    console.warn('[eth-bridge] real driver not yet implemented; falling back to mock');
  }
  return new MockEthBridgeClient(network);
}

export function bridgeNetworkFromEnv(env: any): EthNetwork {
  return env?.BRIDGE_NETWORK === 'sepolia' ? 'sepolia' : 'mainnet';
}
