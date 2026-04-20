-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  nickname TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'user',
  kyc_status TEXT DEFAULT 'none',
  kyc_name TEXT,
  kyc_phone TEXT,
  kyc_id_number TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Coins
CREATE TABLE IF NOT EXISTS coins (
  id TEXT PRIMARY KEY,
  symbol TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  decimals INTEGER DEFAULT 8,
  price_usd REAL DEFAULT 0,
  change_24h REAL DEFAULT 0,
  volume_24h REAL DEFAULT 0,
  high_24h REAL DEFAULT 0,
  low_24h REAL DEFAULT 0,
  market_cap REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Markets (trading pairs)
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  base_coin TEXT NOT NULL,
  quote_coin TEXT NOT NULL,
  min_order_amount REAL DEFAULT 0.0001,
  min_order_total REAL DEFAULT 1,
  price_decimals INTEGER DEFAULT 2,
  amount_decimals INTEGER DEFAULT 6,
  maker_fee REAL DEFAULT 0.001,
  taker_fee REAL DEFAULT 0.001,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(base_coin, quote_coin)
);

-- Wallets
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  coin_symbol TEXT NOT NULL,
  available REAL DEFAULT 0,
  locked REAL DEFAULT 0,
  address TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, coin_symbol)
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  price REAL,
  amount REAL NOT NULL,
  filled REAL DEFAULT 0,
  remaining REAL NOT NULL,
  total REAL DEFAULT 0,
  fee REAL DEFAULT 0,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Trades
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  buy_order_id TEXT NOT NULL,
  sell_order_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  price REAL NOT NULL,
  amount REAL NOT NULL,
  total REAL NOT NULL,
  buyer_fee REAL DEFAULT 0,
  seller_fee REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Candles (OHLCV)
CREATE TABLE IF NOT EXISTS candles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  interval TEXT NOT NULL,
  open_time INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(market_id, interval, open_time)
);

-- Deposits
CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  coin_symbol TEXT NOT NULL,
  amount REAL NOT NULL,
  tx_hash TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Withdrawals
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  coin_symbol TEXT NOT NULL,
  amount REAL NOT NULL,
  fee REAL DEFAULT 0,
  address TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_market ON orders(market_id, status, side, price);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id, created_at);
CREATE INDEX IF NOT EXISTS idx_candles_lookup ON candles(market_id, interval, open_time);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
