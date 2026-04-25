-- Seed Coins
INSERT OR IGNORE INTO coins (id, symbol, name, icon, price_usd, sort_order) VALUES
  ('c-btc', 'BTC', 'Bitcoin', 'bitcoin', 67250.00, 0),
  ('c-eth', 'ETH', 'Ethereum', 'ethereum', 3450.00, 1),
  ('c-bnb', 'BNB', 'BNB', 'bnb', 605.00, 2),
  ('c-sol', 'SOL', 'Solana', 'solana', 172.50, 3),
  ('c-xrp', 'XRP', 'Ripple', 'ripple', 0.6250, 4),
  ('c-ada', 'ADA', 'Cardano', 'cardano', 0.4520, 5),
  ('c-doge', 'DOGE', 'Dogecoin', 'dogecoin', 0.0845, 6),
  ('c-dot', 'DOT', 'Polkadot', 'polkadot', 7.25, 7),
  ('c-avax', 'AVAX', 'Avalanche', 'avalanche', 38.75, 8),
  ('c-matic', 'MATIC', 'Polygon', 'polygon', 0.8650, 9),
  ('c-qta', 'QTA', 'Quantarium', 'quantarium', 0.0125, 10),
  ('c-usdt', 'USDT', 'Tether', 'tether', 1.00, 11),
  ('c-usdc', 'USDC', 'USD Coin', 'usdc', 1.00, 12);

-- Seed Markets (USDT pairs)
INSERT OR IGNORE INTO markets (id, base_coin, quote_coin, price_decimals, amount_decimals) VALUES
  ('m-btc-usdt', 'BTC', 'USDT', 2, 6),
  ('m-eth-usdt', 'ETH', 'USDT', 2, 6),
  ('m-bnb-usdt', 'BNB', 'USDT', 2, 6),
  ('m-sol-usdt', 'SOL', 'USDT', 2, 6),
  ('m-xrp-usdt', 'XRP', 'USDT', 4, 6),
  ('m-ada-usdt', 'ADA', 'USDT', 4, 6),
  ('m-doge-usdt', 'DOGE', 'USDT', 6, 6),
  ('m-dot-usdt', 'DOT', 'USDT', 4, 6),
  ('m-avax-usdt', 'AVAX', 'USDT', 2, 6),
  ('m-matic-usdt', 'MATIC', 'USDT', 4, 6),
  ('m-qta-usdt', 'QTA', 'USDT', 6, 6);

-- Seed Markets (USDC pairs) — global stablecoin alternative to USDT
INSERT OR IGNORE INTO markets (id, base_coin, quote_coin, price_decimals, amount_decimals) VALUES
  ('m-btc-usdc', 'BTC', 'USDC', 2, 6),
  ('m-eth-usdc', 'ETH', 'USDC', 2, 6),
  ('m-bnb-usdc', 'BNB', 'USDC', 2, 6),
  ('m-sol-usdc', 'SOL', 'USDC', 2, 6),
  ('m-xrp-usdc', 'XRP', 'USDC', 4, 6),
  ('m-ada-usdc', 'ADA', 'USDC', 4, 6),
  ('m-doge-usdc', 'DOGE', 'USDC', 6, 6),
  ('m-dot-usdc', 'DOT', 'USDC', 4, 6),
  ('m-avax-usdc', 'AVAX', 'USDC', 2, 6),
  ('m-matic-usdc', 'MATIC', 'USDC', 4, 6),
  ('m-qta-usdc', 'QTA', 'USDC', 6, 6);

-- Admin account (password: admin1234)
INSERT OR IGNORE INTO users (id, email, password, nickname, role) VALUES
  ('admin-001', 'admin@quantaex.io', '$2a$10$WuX/qd7nxB0x8V.BReFaWOtL1V5CaXnljDZlJOg2FpdrE2q1JWX5y', 'Admin', 'admin');

-- Admin wallets (used for ops, hot wallet seed funding, etc.)
INSERT OR IGNORE INTO wallets (id, user_id, coin_symbol, available) VALUES
  ('w-admin-usdt', 'admin-001', 'USDT', 1000000),
  ('w-admin-usdc', 'admin-001', 'USDC', 1000000),
  ('w-admin-btc', 'admin-001', 'BTC', 100),
  ('w-admin-eth', 'admin-001', 'ETH', 5000),
  ('w-admin-qta', 'admin-001', 'QTA', 100000000);
