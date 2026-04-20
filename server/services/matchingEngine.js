import db from '../database.js';
import { v4 as uuidv4 } from 'uuid';

class MatchingEngine {
  constructor(io) {
    this.io = io;
  }

  processOrder(order) {
    const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(order.market_id);
    if (!market) throw new Error('Market not found');

    const trades = [];

    if (order.type === 'market') {
      this._matchMarketOrder(order, market, trades);
    } else {
      this._matchLimitOrder(order, market, trades);
    }

    // Execute trades
    trades.forEach(trade => this._executeTrade(trade, market));

    // Update candles
    if (trades.length > 0) {
      this._updateCandles(market.id, trades);
      this._updateCoinPrice(market, trades[trades.length - 1].price);
    }

    // Broadcast updates
    this._broadcastUpdates(market, trades, order);

    return { order, trades };
  }

  _matchMarketOrder(order, market, trades) {
    const oppositeSide = order.side === 'buy' ? 'sell' : 'buy';
    const priceOrder = order.side === 'buy' ? 'ASC' : 'DESC';

    const matchingOrders = db.prepare(
      `SELECT * FROM orders WHERE market_id = ? AND side = ? AND status IN ('open','partial') ORDER BY price ${priceOrder}, created_at ASC`
    ).all(market.id, oppositeSide);

    let remaining = order.remaining;

    for (const match of matchingOrders) {
      if (remaining <= 0) break;

      const tradeAmount = Math.min(remaining, match.remaining);
      const tradePrice = match.price;

      trades.push({
        id: uuidv4(),
        market_id: market.id,
        buy_order_id: order.side === 'buy' ? order.id : match.id,
        sell_order_id: order.side === 'sell' ? order.id : match.id,
        buyer_id: order.side === 'buy' ? order.user_id : match.user_id,
        seller_id: order.side === 'sell' ? order.user_id : match.user_id,
        price: tradePrice,
        amount: tradeAmount,
        total: tradePrice * tradeAmount,
        taker_order: order,
        maker_order: match,
      });

      remaining -= tradeAmount;
    }

    // Update order
    const filled = order.amount - remaining;
    const status = remaining <= 0 ? 'filled' : remaining < order.amount ? 'partial' : 'cancelled';
    db.prepare('UPDATE orders SET filled = ?, remaining = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(filled, remaining, status, order.id);

    order.filled = filled;
    order.remaining = remaining;
    order.status = status;
  }

  _matchLimitOrder(order, market, trades) {
    const oppositeSide = order.side === 'buy' ? 'sell' : 'buy';
    const priceCondition = order.side === 'buy' ? '<=' : '>=';
    const priceOrder = order.side === 'buy' ? 'ASC' : 'DESC';

    const matchingOrders = db.prepare(
      `SELECT * FROM orders WHERE market_id = ? AND side = ? AND status IN ('open','partial') AND price ${priceCondition} ? ORDER BY price ${priceOrder}, created_at ASC`
    ).all(market.id, oppositeSide, order.price);

    let remaining = order.remaining;

    for (const match of matchingOrders) {
      if (remaining <= 0) break;

      const tradeAmount = Math.min(remaining, match.remaining);
      const tradePrice = match.price; // maker price

      trades.push({
        id: uuidv4(),
        market_id: market.id,
        buy_order_id: order.side === 'buy' ? order.id : match.id,
        sell_order_id: order.side === 'sell' ? order.id : match.id,
        buyer_id: order.side === 'buy' ? order.user_id : match.user_id,
        seller_id: order.side === 'sell' ? order.user_id : match.user_id,
        price: tradePrice,
        amount: tradeAmount,
        total: tradePrice * tradeAmount,
        taker_order: order,
        maker_order: match,
      });

      remaining -= tradeAmount;
    }

    const filled = order.amount - remaining;
    const status = remaining <= 0 ? 'filled' : filled > 0 ? 'partial' : 'open';
    db.prepare('UPDATE orders SET filled = ?, remaining = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(filled, remaining, status, order.id);

    order.filled = filled;
    order.remaining = remaining;
    order.status = status;
  }

  _executeTrade(trade, market) {
    const buyerFee = trade.total * market.taker_fee;
    const sellerFee = trade.total * market.maker_fee;

    // Insert trade record
    db.prepare(`INSERT INTO trades (id, market_id, buy_order_id, sell_order_id, buyer_id, seller_id, price, amount, total, buyer_fee, seller_fee) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(trade.id, trade.market_id, trade.buy_order_id, trade.sell_order_id, trade.buyer_id, trade.seller_id, trade.price, trade.amount, trade.total, buyerFee, sellerFee);

    // Update maker order
    const maker = trade.maker_order;
    const makerRemaining = maker.remaining - trade.amount;
    const makerFilled = maker.filled + trade.amount;
    const makerStatus = makerRemaining <= 0 ? 'filled' : 'partial';
    db.prepare('UPDATE orders SET filled = ?, remaining = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(makerFilled, makerRemaining, makerStatus, maker.id);

    // Transfer funds
    // Buyer: gets base coin, pays quote coin
    this._addBalance(trade.buyer_id, market.base_coin, trade.amount);
    this._subtractLocked(trade.buyer_id, market.quote_coin, trade.total + buyerFee);

    // Seller: gets quote coin, pays base coin
    this._addBalance(trade.seller_id, market.quote_coin, trade.total - sellerFee);
    this._subtractLocked(trade.seller_id, market.base_coin, trade.amount);

    trade.buyer_fee = buyerFee;
    trade.seller_fee = sellerFee;
  }

  _addBalance(userId, coinSymbol, amount) {
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND coin_symbol = ?').get(userId, coinSymbol);
    if (wallet) {
      db.prepare('UPDATE wallets SET available = available + ? WHERE id = ?').run(amount, wallet.id);
    } else {
      db.prepare('INSERT INTO wallets (id, user_id, coin_symbol, available) VALUES (?,?,?,?)').run(uuidv4(), userId, coinSymbol, amount);
    }
  }

  _subtractLocked(userId, coinSymbol, amount) {
    db.prepare('UPDATE wallets SET locked = MAX(0, locked - ?) WHERE user_id = ? AND coin_symbol = ?').run(amount, userId, coinSymbol);
  }

  _updateCandles(marketId, trades) {
    const intervals = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
    const now = Math.floor(Date.now() / 1000);

    Object.entries(intervals).forEach(([interval, seconds]) => {
      const openTime = Math.floor(now / seconds) * seconds;
      const lastPrice = trades[trades.length - 1].price;
      const highPrice = Math.max(...trades.map(t => t.price));
      const lowPrice = Math.min(...trades.map(t => t.price));
      const totalVolume = trades.reduce((s, t) => s + t.amount, 0);

      const existing = db.prepare('SELECT * FROM candles WHERE market_id = ? AND interval = ? AND open_time = ?').get(marketId, interval, openTime);

      if (existing) {
        db.prepare('UPDATE candles SET high = MAX(high, ?), low = MIN(low, ?), close = ?, volume = volume + ? WHERE id = ?')
          .run(highPrice, lowPrice, lastPrice, totalVolume, existing.id);
      } else {
        const prevCandle = db.prepare('SELECT close FROM candles WHERE market_id = ? AND interval = ? AND open_time < ? ORDER BY open_time DESC LIMIT 1').get(marketId, interval, openTime);
        const openPrice = prevCandle ? prevCandle.close : trades[0].price;
        db.prepare('INSERT INTO candles (market_id, interval, open_time, open, high, low, close, volume) VALUES (?,?,?,?,?,?,?,?)')
          .run(marketId, interval, openTime, openPrice, highPrice, lowPrice, lastPrice, totalVolume);
      }
    });
  }

  _updateCoinPrice(market, price) {
    if (market.quote_coin === 'USDT') {
      db.prepare('UPDATE coins SET price_usd = ? WHERE symbol = ?').run(price, market.base_coin);
    }
    // Update 24h stats
    const since = Math.floor(Date.now() / 1000) - 86400;
    const stats = db.prepare(`
      SELECT SUM(amount) as volume, MAX(price) as high, MIN(price) as low
      FROM trades WHERE market_id = ? AND created_at >= datetime(?, 'unixepoch')
    `).get(market.id, since);

    if (stats) {
      const firstTrade = db.prepare(`SELECT price FROM trades WHERE market_id = ? AND created_at >= datetime(?, 'unixepoch') ORDER BY created_at ASC LIMIT 1`).get(market.id, since);
      const change = firstTrade ? ((price - firstTrade.price) / firstTrade.price * 100) : 0;
      db.prepare('UPDATE coins SET volume_24h = ?, high_24h = ?, low_24h = ?, change_24h = ? WHERE symbol = ?')
        .run(stats.volume || 0, stats.high || price, stats.low || price, change, market.base_coin);
    }
  }

  _broadcastUpdates(market, trades, order) {
    const symbol = `${market.base_coin}${market.quote_coin}`;

    // Broadcast trades
    if (trades.length > 0) {
      const tradeBroadcast = trades.map(t => ({
        id: t.id,
        price: t.price,
        amount: t.amount,
        total: t.total,
        side: order.side,
        time: new Date().toISOString(),
      }));
      this.io?.to(symbol)?.emit('trades', tradeBroadcast);
    }

    // Broadcast orderbook
    const orderbook = this.getOrderbook(market.id);
    this.io?.to(symbol)?.emit('orderbook', orderbook);

    // Broadcast ticker
    const ticker = this.getTicker(market.id);
    this.io?.emit('ticker', { symbol, ...ticker });
  }

  getOrderbook(marketId, depth = 25) {
    const bids = db.prepare(
      `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'buy' AND status IN ('open','partial') GROUP BY price ORDER BY price DESC LIMIT ?`
    ).all(marketId, depth);

    const asks = db.prepare(
      `SELECT price, SUM(remaining) as amount FROM orders WHERE market_id = ? AND side = 'sell' AND status IN ('open','partial') GROUP BY price ORDER BY price ASC LIMIT ?`
    ).all(marketId, depth);

    return { bids, asks };
  }

  getTicker(marketId) {
    const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);
    if (!market) return null;

    const lastTrade = db.prepare('SELECT price, amount FROM trades WHERE market_id = ? ORDER BY created_at DESC LIMIT 1').get(marketId);
    const since = Math.floor(Date.now() / 1000) - 86400;
    const stats = db.prepare(`
      SELECT SUM(amount) as volume, SUM(total) as quote_volume, MAX(price) as high, MIN(price) as low, COUNT(*) as count
      FROM trades WHERE market_id = ? AND created_at >= datetime(?, 'unixepoch')
    `).get(marketId, since);

    const firstTrade24h = db.prepare(`SELECT price FROM trades WHERE market_id = ? AND created_at >= datetime(?, 'unixepoch') ORDER BY created_at ASC LIMIT 1`).get(marketId, since);

    const lastPrice = lastTrade?.price || 0;
    const change = firstTrade24h ? ((lastPrice - firstTrade24h.price) / firstTrade24h.price * 100) : 0;

    return {
      last: lastPrice,
      high: stats?.high || lastPrice,
      low: stats?.low || lastPrice,
      volume: stats?.volume || 0,
      quoteVolume: stats?.quote_volume || 0,
      change: change,
      trades: stats?.count || 0,
    };
  }
}

export default MatchingEngine;
