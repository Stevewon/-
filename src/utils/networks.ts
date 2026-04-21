/**
 * Supported blockchain networks per coin.
 * In production these would come from backend. For now, a curated static list
 * approximating real exchange data.
 */

export interface NetworkInfo {
  id: string;               // internal key, e.g. 'ERC20'
  name: string;             // display name, e.g. 'Ethereum (ERC20)'
  shortName: string;        // short, e.g. 'ERC20'
  addressRegex: RegExp;     // validator for address format
  addressExample: string;   // example placeholder
  memoRequired?: boolean;   // needs a memo/tag (XRP, XLM, etc.)
  memoLabel?: string;       // label for memo field
  withdrawFee: number;      // fee in coin units
  minWithdraw: number;      // minimum withdrawal amount
  minDeposit: number;       // minimum deposit to credit
  confirmations: number;    // block confirmations
  estimateMin: number;      // estimated confirmation time (minutes)
}

export const NETWORKS: Record<string, NetworkInfo[]> = {
  BTC: [
    {
      id: 'BTC',
      name: 'Bitcoin',
      shortName: 'BTC',
      addressRegex: /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/,
      addressExample: 'bc1q...',
      withdrawFee: 0.0002,
      minWithdraw: 0.001,
      minDeposit: 0.0001,
      confirmations: 2,
      estimateMin: 30,
    },
  ],
  ETH: [
    {
      id: 'ERC20',
      name: 'Ethereum (ERC20)',
      shortName: 'ERC20',
      addressRegex: /^0x[a-fA-F0-9]{40}$/,
      addressExample: '0x...',
      withdrawFee: 0.004,
      minWithdraw: 0.01,
      minDeposit: 0.001,
      confirmations: 12,
      estimateMin: 3,
    },
    {
      id: 'ARBITRUM',
      name: 'Arbitrum One',
      shortName: 'ARBITRUM',
      addressRegex: /^0x[a-fA-F0-9]{40}$/,
      addressExample: '0x...',
      withdrawFee: 0.0002,
      minWithdraw: 0.005,
      minDeposit: 0.0001,
      confirmations: 20,
      estimateMin: 1,
    },
  ],
  USDT: [
    {
      id: 'TRC20',
      name: 'Tron (TRC20)',
      shortName: 'TRC20',
      addressRegex: /^T[a-zA-HJ-NP-Z0-9]{33}$/,
      addressExample: 'T...',
      withdrawFee: 1,
      minWithdraw: 5,
      minDeposit: 1,
      confirmations: 19,
      estimateMin: 2,
    },
    {
      id: 'ERC20',
      name: 'Ethereum (ERC20)',
      shortName: 'ERC20',
      addressRegex: /^0x[a-fA-F0-9]{40}$/,
      addressExample: '0x...',
      withdrawFee: 8,
      minWithdraw: 20,
      minDeposit: 5,
      confirmations: 12,
      estimateMin: 3,
    },
    {
      id: 'BEP20',
      name: 'BNB Chain (BEP20)',
      shortName: 'BEP20',
      addressRegex: /^0x[a-fA-F0-9]{40}$/,
      addressExample: '0x...',
      withdrawFee: 0.5,
      minWithdraw: 5,
      minDeposit: 1,
      confirmations: 15,
      estimateMin: 1,
    },
  ],
  BNB: [
    {
      id: 'BEP20',
      name: 'BNB Chain (BEP20)',
      shortName: 'BEP20',
      addressRegex: /^0x[a-fA-F0-9]{40}$/,
      addressExample: '0x...',
      withdrawFee: 0.0005,
      minWithdraw: 0.01,
      minDeposit: 0.001,
      confirmations: 15,
      estimateMin: 1,
    },
  ],
  SOL: [
    {
      id: 'SOL',
      name: 'Solana',
      shortName: 'SOL',
      addressRegex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
      addressExample: 'So1a...',
      withdrawFee: 0.01,
      minWithdraw: 0.02,
      minDeposit: 0.01,
      confirmations: 1,
      estimateMin: 1,
    },
  ],
  XRP: [
    {
      id: 'XRP',
      name: 'XRP Ledger',
      shortName: 'XRP',
      addressRegex: /^r[0-9a-zA-Z]{24,34}$/,
      addressExample: 'r...',
      memoRequired: true,
      memoLabel: 'Destination Tag',
      withdrawFee: 0.25,
      minWithdraw: 22,
      minDeposit: 20,
      confirmations: 1,
      estimateMin: 1,
    },
  ],
  ADA: [
    {
      id: 'ADA',
      name: 'Cardano',
      shortName: 'ADA',
      addressRegex: /^addr1[a-z0-9]{50,}$/,
      addressExample: 'addr1...',
      withdrawFee: 1,
      minWithdraw: 2,
      minDeposit: 1,
      confirmations: 15,
      estimateMin: 5,
    },
  ],
  DOGE: [
    {
      id: 'DOGE',
      name: 'Dogecoin',
      shortName: 'DOGE',
      addressRegex: /^D[5-9A-HJ-NP-U1-9A-HJ-NP-Za-km-z]{33}$/,
      addressExample: 'D...',
      withdrawFee: 5,
      minWithdraw: 10,
      minDeposit: 2,
      confirmations: 6,
      estimateMin: 10,
    },
  ],
  DOT: [
    {
      id: 'DOT',
      name: 'Polkadot',
      shortName: 'DOT',
      addressRegex: /^1[a-km-zA-HJ-NP-Z1-9]{46,47}$/,
      addressExample: '1...',
      withdrawFee: 0.1,
      minWithdraw: 1,
      minDeposit: 1,
      confirmations: 2,
      estimateMin: 5,
    },
  ],
  AVAX: [
    {
      id: 'AVAXC',
      name: 'Avalanche C-Chain',
      shortName: 'AVAX-C',
      addressRegex: /^0x[a-fA-F0-9]{40}$/,
      addressExample: '0x...',
      withdrawFee: 0.01,
      minWithdraw: 0.05,
      minDeposit: 0.01,
      confirmations: 12,
      estimateMin: 1,
    },
  ],
  MATIC: [
    {
      id: 'POLYGON',
      name: 'Polygon',
      shortName: 'POLYGON',
      addressRegex: /^0x[a-fA-F0-9]{40}$/,
      addressExample: '0x...',
      withdrawFee: 0.1,
      minWithdraw: 1,
      minDeposit: 0.1,
      confirmations: 128,
      estimateMin: 4,
    },
  ],
  QTA: [
    {
      id: 'ERC20',
      name: 'QuantaEX Chain (ERC20)',
      shortName: 'ERC20',
      addressRegex: /^0x[a-fA-F0-9]{40}$/,
      addressExample: '0x...',
      withdrawFee: 1,
      minWithdraw: 10,
      minDeposit: 1,
      confirmations: 12,
      estimateMin: 3,
    },
  ],
  KRW: [
    {
      id: 'BANK',
      name: 'Bank Transfer',
      shortName: 'BANK',
      addressRegex: /^[0-9\-]{10,20}$/,
      addressExample: 'Bank-Account-Number',
      withdrawFee: 1000,
      minWithdraw: 10000,
      minDeposit: 10000,
      confirmations: 0,
      estimateMin: 10,
    },
  ],
};

/**
 * Get available networks for a coin.
 * If not registered, returns a default ERC20-like entry.
 */
export function getNetworks(coin: string): NetworkInfo[] {
  return NETWORKS[coin] || [
    {
      id: 'ERC20',
      name: 'Ethereum (ERC20)',
      shortName: 'ERC20',
      addressRegex: /^0x[a-fA-F0-9]{40}$/,
      addressExample: '0x...',
      withdrawFee: 1,
      minWithdraw: 1,
      minDeposit: 0.1,
      confirmations: 12,
      estimateMin: 3,
    },
  ];
}

/**
 * Generate a deterministic-looking deposit address for a user+coin+network.
 * This is a simulation — real exchanges generate unique per-user addresses.
 */
export function generateDepositAddress(userId: string, coin: string, network: string): string {
  // Deterministic based on (userId, coin, network)
  const seed = `${userId}-${coin}-${network}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h) + seed.charCodeAt(i);
    h |= 0;
  }
  const hex = Math.abs(h).toString(16).padStart(8, '0');
  const long = (hex + hex + hex + hex + hex).slice(0, 40);

  // Format based on network
  switch (network) {
    case 'TRC20':
      return 'T' + long.slice(0, 33).toUpperCase().replace(/[^A-HJ-NP-Z0-9]/g, 'X');
    case 'BTC':
      return 'bc1q' + long.slice(0, 38);
    case 'SOL':
      return long.slice(0, 44);
    case 'XRP':
      return 'r' + long.slice(0, 32).toUpperCase().replace(/[^A-HJ-NP-Z0-9]/g, 'X');
    case 'ADA':
      return 'addr1' + long;
    case 'DOGE':
      return 'D' + long.slice(0, 33).toUpperCase().replace(/[^5-9A-HJ-NP-U1-9A-HJ-NP-Za-km-z]/g, 'A');
    case 'DOT':
      return '1' + long.slice(0, 47);
    case 'BANK':
      return '3333-01-' + hex.slice(0, 7);
    default:
      return '0x' + long;
  }
}

/**
 * Generate a destination tag / memo for networks that require one.
 */
export function generateMemo(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = ((h << 5) - h) + userId.charCodeAt(i);
    h |= 0;
  }
  return String(Math.abs(h) % 9999999 + 1000000);
}
