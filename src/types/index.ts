export interface User {
  id: string;
  email: string;
  nickname: string;
  role: string;
  kyc_status: string;
  kyc_name?: string;
  kyc_phone?: string;
  kyc_address?: string;
  kyc_submitted_at?: string;
  kyc_reviewed_at?: string;
  two_factor_enabled?: number;
  email_verified_at?: string | null;
  avatar_url?: string;
  created_at: string;
}

export interface LoginHistoryEntry {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  device: string | null;
  location: string | null;
  status: 'success' | 'failed';
  reason: string | null;
  created_at: string;
}

export type ApiKeySignatureAlg = 'hmac-sha256' | 'dilithium2' | 'hybrid';

export interface ApiKey {
  id: string;
  user_id: string;
  label: string;
  api_key: string;
  permissions: string; // comma-separated: read,trade,withdraw
  ip_whitelist: string | null;
  is_active: number;
  last_used_at: string | null;
  created_at: string;
  expires_at: string | null;
  // Sprint 4 Phase H2 — PQ fields (nullable for legacy rows)
  signature_alg?: ApiKeySignatureAlg;
  public_key?: string | null;
  pq_key_version?: number;
  last_pq_verify_at?: number | null;
}

export interface Coin {
  id: string;
  symbol: string;
  name: string;
  icon: string;
  price_usd: number;
  change_24h: number;
  volume_24h: number;
  high_24h: number;
  low_24h: number;
}

export interface Market {
  id: string;
  base_coin: string;
  quote_coin: string;
  base_name: string;
  base_price: number;
  base_icon: string;
  change_24h: number;
  volume_24h: number;
  price_decimals: number;
  amount_decimals: number;
  maker_fee: number;
  taker_fee: number;
}

export interface OrderbookEntry {
  price: number;
  amount: number;
}

export interface Orderbook {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
}

export interface Trade {
  id: string;
  price: number;
  amount: number;
  total: number;
  side: 'buy' | 'sell';
  time: string;
  created_at?: string;
}

export interface Order {
  id: string;
  user_id: string;
  market_id: string;
  base_coin: string;
  quote_coin: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: number;
  amount: number;
  filled: number;
  remaining: number;
  total: number;
  status: string;
  created_at: string;
}

export interface Wallet {
  id: string;
  coin_symbol: string;
  coin_name: string;
  available: number;
  locked: number;
  price_usd: number;
  icon: string;
  change_24h: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  symbol: string;
  last: number;
  change: number;
  volume: number;
  high: number;
  low: number;
}
