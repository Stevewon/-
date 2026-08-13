/**
 * Asset routing — the single source of truth for "which wallet handles which
 * coin" across QuantaEX.
 *
 * QuantaEX bridges TWO worlds:
 *
 *   1. Quantarium-native assets — the QTA coin plus every token QuantaEX
 *      issues on the Quantarium chain (QX, QKEY, ...). These are sent and
 *      received through OUR OWN Quantarium wallet: a server-held SPHINCS+ HD
 *      wallet (chain_id 60000, post-quantum SLH-DSA-SHA2-128s, typed tx 0x7f).
 *      On-chain deposit addresses are derived per-user from the HD mnemonic
 *      and withdrawals are signed + broadcast by the exchange hot wallet.
 *
 *   2. Everything else (BTC, ETH, BNB, SOL, USDT, USDC, ...) — standard,
 *      externally-issued coins that travel on THEIR OWN native chains and are
 *      handled by the corresponding standard wallets (EVM-compatible for the
 *      ERC-20 / EVM family, and each coin's own network otherwise).
 *
 * Any code that needs to decide "Quantarium wallet vs. standard wallet"
 * MUST call isQuantariumAsset() here rather than hard-coding the symbol set,
 * so the split stays consistent between the deposit-address issuer, the
 * withdrawal router, the cron broadcaster, and the UI.
 */

/**
 * The set of Quantarium-native assets routed through the QuantaEX Quantarium
 * wallet. QTA is the native coin; QX / QKEY are ERC-20 tokens QuantaEX issued
 * on the Quantarium chain. Add future in-house tokens here (and nowhere else).
 */
export const QUANTARIUM_ASSETS = ['QTA', 'QX', 'QKEY'] as const;

export type QuantariumAsset = (typeof QUANTARIUM_ASSETS)[number];

const QUANTARIUM_ASSET_SET: ReadonlySet<string> = new Set(QUANTARIUM_ASSETS);

/**
 * True when `symbol` is a Quantarium-native asset (QTA / QX / QKEY) that must
 * be sent/received through the QuantaEX Quantarium wallet. Case-insensitive.
 */
export function isQuantariumAsset(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return QUANTARIUM_ASSET_SET.has(symbol.toUpperCase());
}

/**
 * True when `symbol` is a standard, externally-issued coin (BTC, ETH, USDT, …)
 * handled by its own native/standard wallet rather than our Quantarium wallet.
 * This is simply the complement of isQuantariumAsset().
 */
export function isStandardAsset(symbol: string | null | undefined): boolean {
  return !isQuantariumAsset(symbol);
}

/**
 * Kind of a Quantarium-native asset on the Quantarium chain:
 *   - 'native' → QTA, the chain's gas coin (sent via a value transfer)
 *   - 'erc20'  → QX / QKEY, ERC-20 contracts (sent via transfer() calldata)
 * Returns null for non-Quantarium assets.
 */
export function quantariumAssetKind(
  symbol: string | null | undefined,
): 'native' | 'erc20' | null {
  if (!symbol) return null;
  const s = symbol.toUpperCase();
  if (s === 'QTA') return 'native';
  if (s === 'QX' || s === 'QKEY') return 'erc20';
  return null;
}

/** Canonical network id used by Quantarium-native assets. */
export const QUANTARIUM_NETWORK_ID = 'QTA';
