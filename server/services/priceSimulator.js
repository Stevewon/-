import db from '../database.js';
import { v4 as uuidv4 } from 'uuid';

class PriceSimulator {
  constructor(io) {
    this.io = io;
    this.intervals = [];
  }

  start() {
    // Update prices every 2 seconds for realistic feel
    const tickInterval = setInterval(() => this._tick(), 2000);
    // Update candles every minute
    const candleInterval = setInterval(() => this._updateAllCandles(), 60000);
    this.intervals.push(tickInterval, candleInterval);
    console.log('Price simulator started');
  }

  stop() {
    this.intervals.forEach(i => clearInterval(i));
  }

  _tick() {
    const markets = db.prepare('SELECT m.*, c.price_usd FROM markets m JOIN coins c ON c.symbol = m.base_coin WHERE m.is_active = 1').all();

    markets.forEach(market => {
      const symbol = `${market.base_coin}${market.quote_coin}`;
      const basePrice = market.quote_coin === 'KRW' ? market.price_usd * 1350 : market.price_usd;

      // Random walk
      const volatility = 0.001 + Math.random() * 0.003;
      const direction = Math.random() - 0.48; // slight upward bias
      const change = direction * volatility;
      const newPrice = basePrice * (1 + change);

      // Generate simulated trade
      const amount = Math.random() * (basePrice > 1000 ? 0.5 : basePrice > 1 ? 50 : 50000);

      const side = Math.random() > 0.5 ? 'buy' : 'sell';

      // Broadcast ticker update
      const prevClose = db.prepare('SELECT close FROM candles WHERE market_id = ? AND interval = ? ORDER BY open_time DESC LIMIT 1 OFFSET 1')
        .get(market.id, '1d');
      const change24h = prevClose ? ((newPrice - prevClose.close) / prevClose.close * 100) : (Math.random() - 0.5) * 5;

      this.io?.emit('ticker', {
        symbol,
        last: newPrice,
        change: change24h,
        volume: Math.random() * 10000,
        high: newPrice * 1.02,
        low: newPrice * 0.98,
      });

      // Broadcast simulated trade for activity
      this.io?.to(symbol)?.emit('trades', [{
        id: uuidv4(),
        price: newPrice,
        amount: amount,
        total: newPrice * amount,
        side,
        time: new Date().toISOString(),
        simulated: true,
      }]);

      // Update coin price
      if (market.quote_coin === 'USDT') {
        db.prepare('UPDATE coins SET price_usd = ?, change_24h = ? WHERE symbol = ?')
          .run(newPrice, change24h, market.base_coin);
      }
    });
  }

  _updateAllCandles() {
    const markets = db.prepare('SELECT m.*, c.price_usd FROM markets m JOIN coins c ON c.symbol = m.base_coin WHERE m.is_active = 1').all();
    const now = Math.floor(Date.now() / 1000);
    const intervals = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

    markets.forEach(market => {
      const basePrice = market.quote_coin === 'KRW' ? market.price_usd * 1350 : market.price_usd;

      Object.entries(intervals).forEach(([interval, seconds]) => {
        const openTime = Math.floor(now / seconds) * seconds;
        const existing = db.prepare('SELECT * FROM candles WHERE market_id = ? AND interval = ? AND open_time = ?')
          .get(market.id, interval, openTime);

        if (!existing) {
          const prev = db.prepare('SELECT close FROM candles WHERE market_id = ? AND interval = ? ORDER BY open_time DESC LIMIT 1')
            .get(market.id, interval);
          const open = prev?.close || basePrice;
          const vol = 0.003;
          const close = basePrice;
          const high = Math.max(open, close) * (1 + Math.random() * vol);
          const low = Math.min(open, close) * (1 - Math.random() * vol);
          const volume = Math.random() * 100;

          db.prepare('INSERT OR IGNORE INTO candles (market_id, interval, open_time, open, high, low, close, volume) VALUES (?,?,?,?,?,?,?,?)')
            .run(market.id, interval, openTime, open, high, low, close, volume);
        } else {
          const vol = 0.002;
          const newClose = basePrice;
          db.prepare('UPDATE candles SET close = ?, high = MAX(high, ?), low = MIN(low, ?), volume = volume + ? WHERE id = ?')
            .run(newClose, newClose * (1 + vol), newClose * (1 - vol), Math.random() * 10, existing.id);
        }
      });

      // Broadcast candle update
      const symbol = `${market.base_coin}${market.quote_coin}`;
      const latestCandle = db.prepare('SELECT * FROM candles WHERE market_id = ? AND interval = ? ORDER BY open_time DESC LIMIT 1')
        .get(market.id, '1m');
      if (latestCandle) {
        this.io?.to(symbol)?.emit('candle', {
          time: latestCandle.open_time,
          open: latestCandle.open,
          high: latestCandle.high,
          low: latestCandle.low,
          close: latestCandle.close,
          volume: latestCandle.volume,
        });
      }
    });
  }
}

export default PriceSimulator;
