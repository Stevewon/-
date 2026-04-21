import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'exchange.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== SCHEMA =====
db.exec(`
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (base_coin) REFERENCES coins(symbol),
    FOREIGN KEY (quote_coin) REFERENCES coins(symbol),
    UNIQUE(base_coin, quote_coin)
  );

  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    coin_symbol TEXT NOT NULL,
    available REAL DEFAULT 0,
    locked REAL DEFAULT 0,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (coin_symbol) REFERENCES coins(symbol),
    UNIQUE(user_id, coin_symbol)
  );

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (market_id) REFERENCES markets(id)
  );

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (market_id) REFERENCES markets(id)
  );

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(market_id, interval, open_time)
  );

  CREATE TABLE IF NOT EXISTS deposits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    coin_symbol TEXT NOT NULL,
    amount REAL NOT NULL,
    tx_hash TEXT,
    status TEXT DEFAULT 'pending',
    network TEXT,
    memo TEXT,
    from_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    coin_symbol TEXT NOT NULL,
    amount REAL NOT NULL,
    fee REAL DEFAULT 0,
    address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT DEFAULT 'pending',
    network TEXT,
    memo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    data TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    label TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    api_secret_hash TEXT NOT NULL,
    permissions TEXT DEFAULT 'read',
    ip_whitelist TEXT,
    is_active INTEGER DEFAULT 1,
    last_used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_orders_market ON orders(market_id, status, side, price);
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_candles_market ON candles(market_id, interval, open_time);
  CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, is_active);
`);

// Add columns to existing tables if they don't exist (safe migration)
function addColumnIfMissing(table, column, definition) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  } catch (e) {
    // Table might not exist yet — ignore
  }
}

addColumnIfMissing('deposits', 'network', 'TEXT');
addColumnIfMissing('deposits', 'memo', 'TEXT');
addColumnIfMissing('deposits', 'from_address', 'TEXT');
addColumnIfMissing('withdrawals', 'network', 'TEXT');
addColumnIfMissing('withdrawals', 'memo', 'TEXT');

// Profile & security columns on users
addColumnIfMissing('users', 'two_factor_enabled', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'two_factor_secret', 'TEXT');
addColumnIfMissing('users', 'kyc_address', 'TEXT');
addColumnIfMissing('users', 'kyc_id_document_url', 'TEXT');
addColumnIfMissing('users', 'kyc_address_document_url', 'TEXT');
addColumnIfMissing('users', 'kyc_submitted_at', 'DATETIME');
addColumnIfMissing('users', 'kyc_reviewed_at', 'DATETIME');
addColumnIfMissing('users', 'avatar_url', 'TEXT');

// Login history & sessions
db.exec(`
  CREATE TABLE IF NOT EXISTS login_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    device TEXT,
    location TEXT,
    status TEXT DEFAULT 'success',
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_id TEXT UNIQUE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    device TEXT,
    last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, last_active_at DESC);
`);

// ===== SEED DATA =====
function seedData() {
  const coinCount = db.prepare('SELECT COUNT(*) as cnt FROM coins').get();
  if (coinCount.cnt > 0) return;

  const coins = [
    { symbol: 'BTC', name: 'Bitcoin', price: 67250.00, icon: 'bitcoin' },
    { symbol: 'ETH', name: 'Ethereum', price: 3450.00, icon: 'ethereum' },
    { symbol: 'BNB', name: 'BNB', price: 605.00, icon: 'bnb' },
    { symbol: 'SOL', name: 'Solana', price: 172.50, icon: 'solana' },
    { symbol: 'XRP', name: 'Ripple', price: 0.6250, icon: 'ripple' },
    { symbol: 'ADA', name: 'Cardano', price: 0.4520, icon: 'cardano' },
    { symbol: 'DOGE', name: 'Dogecoin', price: 0.0845, icon: 'dogecoin' },
    { symbol: 'DOT', name: 'Polkadot', price: 7.25, icon: 'polkadot' },
    { symbol: 'AVAX', name: 'Avalanche', price: 38.75, icon: 'avalanche' },
    { symbol: 'MATIC', name: 'Polygon', price: 0.8650, icon: 'polygon' },
    { symbol: 'QTA', name: 'Quantarium', price: 0.0125, icon: 'quantarium' },
    { symbol: 'USDT', name: 'Tether', price: 1.00, icon: 'tether' },
    { symbol: 'KRW', name: 'Korean Won', price: 1.00, icon: 'krw' },
  ];

  const insertCoin = db.prepare(`INSERT INTO coins (id, symbol, name, price_usd, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);
  coins.forEach((c, i) => insertCoin.run(uuidv4(), c.symbol, c.name, c.price, c.icon, i));

  // Markets: pair with USDT and KRW
  const quoteCoins = ['USDT', 'KRW'];
  const baseCoins = coins.filter(c => !['USDT', 'KRW'].includes(c.symbol));
  const insertMarket = db.prepare(`INSERT INTO markets (id, base_coin, quote_coin, price_decimals, amount_decimals, maker_fee, taker_fee) VALUES (?, ?, ?, ?, ?, ?, ?)`);

  baseCoins.forEach(base => {
    quoteCoins.forEach(quote => {
      const priceDec = base.price > 100 ? 2 : base.price > 1 ? 4 : 6;
      insertMarket.run(uuidv4(), base.symbol, quote, priceDec, 6, 0.001, 0.001);
    });
  });

  // Create admin
  const adminId = uuidv4();
  const hashedPw = bcrypt.hashSync('admin1234', 10);
  db.prepare(`INSERT INTO users (id, email, password, nickname, role) VALUES (?, ?, ?, ?, ?)`).run(adminId, 'admin@cryptox.com', hashedPw, 'Admin', 'admin');

  // Give admin some coins
  const adminCoins = [
    { symbol: 'USDT', amount: 1000000 },
    { symbol: 'KRW', amount: 1000000000 },
    { symbol: 'BTC', amount: 100 },
    { symbol: 'ETH', amount: 5000 },
    { symbol: 'QTA', amount: 100000000 },
  ];
  const insertWallet = db.prepare(`INSERT INTO wallets (id, user_id, coin_symbol, available) VALUES (?, ?, ?, ?)`);
  adminCoins.forEach(w => insertWallet.run(uuidv4(), adminId, w.symbol, w.amount));

  // Generate initial candle data for all markets
  generateInitialCandles();

  console.log('Database seeded successfully!');
}

function generateInitialCandles() {
  const markets = db.prepare('SELECT m.id, m.base_coin, m.quote_coin, c.price_usd FROM markets m JOIN coins c ON c.symbol = m.base_coin').all();
  const insertCandle = db.prepare(`INSERT OR IGNORE INTO candles (market_id, interval, open_time, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  const now = Math.floor(Date.now() / 1000);
  const intervals = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

  markets.forEach(market => {
    let basePrice = market.quote_coin === 'KRW' ? market.price_usd * 1350 : market.price_usd;

    Object.entries(intervals).forEach(([interval, seconds]) => {
      const count = interval === '1d' ? 90 : interval === '4h' ? 180 : 200;
      let price = basePrice * (0.85 + Math.random() * 0.1);

      for (let i = count; i >= 0; i--) {
        const time = Math.floor((now - i * seconds) / seconds) * seconds;
        const volatility = 0.005 + Math.random() * 0.015;
        const change = (Math.random() - 0.48) * volatility;
        const open = price;
        const close = price * (1 + change);
        const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.5);
        const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.5);
        const volume = (Math.random() * 100 + 10) * (basePrice > 1000 ? 0.1 : basePrice > 1 ? 10 : 10000);

        insertCandle.run(market.id, interval, time, open, high, low, close, volume);
        price = close;
      }
    });

    // Update coin price from latest candle
    if (market.quote_coin === 'USDT') {
      const latest = db.prepare('SELECT close FROM candles WHERE market_id = ? AND interval = ? ORDER BY open_time DESC LIMIT 1').get(market.id, '1m');
      if (latest) {
        db.prepare('UPDATE coins SET price_usd = ? WHERE symbol = ?').run(latest.close, market.base_coin);
      }
    }
  });
}

seedData();

export default db;
