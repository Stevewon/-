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
  ('c-krw', 'KRW', 'Korean Won', 'krw', 1.00, 12);

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

-- Seed Markets (KRW pairs)
INSERT OR IGNORE INTO markets (id, base_coin, quote_coin, price_decimals, amount_decimals) VALUES
  ('m-btc-krw', 'BTC', 'KRW', 0, 6),
  ('m-eth-krw', 'ETH', 'KRW', 0, 6),
  ('m-bnb-krw', 'BNB', 'KRW', 0, 6),
  ('m-sol-krw', 'SOL', 'KRW', 0, 6),
  ('m-xrp-krw', 'XRP', 'KRW', 2, 6),
  ('m-ada-krw', 'ADA', 'KRW', 2, 6),
  ('m-doge-krw', 'DOGE', 'KRW', 2, 6),
  ('m-dot-krw', 'DOT', 'KRW', 0, 6),
  ('m-avax-krw', 'AVAX', 'KRW', 0, 6),
  ('m-matic-krw', 'MATIC', 'KRW', 2, 6),
  ('m-qta-krw', 'QTA', 'KRW', 4, 6);

-- Admin account (password: admin1234)
INSERT OR IGNORE INTO users (id, email, password, nickname, role) VALUES
  ('admin-001', 'admin@quantaex.io', '$2a$10$rQXfV5sWJOqGr6Pf1xQAzeKk8KL0f.5g7wXFqJ1LK5Fy7Ls3FN3vC', 'Admin', 'admin');

-- Admin wallets
INSERT OR IGNORE INTO wallets (id, user_id, coin_symbol, available) VALUES
  ('w-admin-usdt', 'admin-001', 'USDT', 1000000),
  ('w-admin-krw', 'admin-001', 'KRW', 1000000000),
  ('w-admin-btc', 'admin-001', 'BTC', 100),
  ('w-admin-eth', 'admin-001', 'ETH', 5000),
  ('w-admin-qta', 'admin-001', 'QTA', 100000000);
