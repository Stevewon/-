import { create } from 'zustand';
import type { User, Market, Ticker, Orderbook, Trade, Order, Wallet } from '../types';
import api from '../utils/api';

interface ExchangeStore {
  // Auth
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  loadAuth: () => void;

  // Market
  markets: Market[];
  currentMarket: string;
  tickers: Record<string, Ticker>;
  orderbook: Orderbook;
  recentTrades: Trade[];
  setCurrentMarket: (symbol: string) => void;
  fetchMarkets: () => Promise<void>;
  fetchOrderbook: (symbol: string) => Promise<void>;
  fetchRecentTrades: (symbol: string) => Promise<void>;
  updateTicker: (symbol: string, data: Ticker) => void;
  updateOrderbook: (data: Orderbook) => void;
  addTrades: (trades: Trade[]) => void;

  // Orders
  openOrders: Order[];
  orderHistory: Order[];
  fetchOpenOrders: (market?: string) => Promise<void>;
  fetchOrderHistory: () => Promise<void>;

  // Wallet
  wallets: Wallet[];
  fetchWallets: () => Promise<void>;
}

const useStore = create<ExchangeStore>((set, get) => ({
  user: null,
  token: null,
  setAuth: (user, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ user, token });
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({ user: null, token: null });
  },
  loadAuth: () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      set({ token, user: JSON.parse(userStr) });
    }
  },

  markets: [],
  currentMarket: 'BTC-USDT',
  tickers: {},
  orderbook: { bids: [], asks: [] },
  recentTrades: [],

  setCurrentMarket: (symbol) => set({ currentMarket: symbol }),

  fetchMarkets: async () => {
    try {
      const [marketsRes, tickersRes] = await Promise.all([
        api.get('/market/markets'),
        api.get('/market/tickers'),
      ]);
      set({ markets: marketsRes.data, tickers: tickersRes.data });
    } catch (e) { console.error(e); }
  },

  fetchOrderbook: async (symbol) => {
    try {
      const res = await api.get(`/market/orderbook/${symbol}`);
      set({ orderbook: res.data });
    } catch (e) { console.error(e); }
  },

  fetchRecentTrades: async (symbol) => {
    try {
      const res = await api.get(`/market/trades/${symbol}`);
      set({ recentTrades: res.data });
    } catch (e) { console.error(e); }
  },

  updateTicker: (symbol, data) => {
    set((state) => ({
      tickers: { ...state.tickers, [symbol]: data },
    }));
  },

  updateOrderbook: (data) => set({ orderbook: data }),

  addTrades: (trades) => {
    set((state) => ({
      recentTrades: [...trades, ...state.recentTrades].slice(0, 100),
    }));
  },

  openOrders: [],
  orderHistory: [],

  fetchOpenOrders: async (market) => {
    try {
      const params = market ? `?status=open&market=${market}` : '?status=open';
      const res = await api.get(`/orders/my${params}`);
      set({ openOrders: res.data });
    } catch (e) { console.error(e); }
  },

  fetchOrderHistory: async () => {
    try {
      const res = await api.get('/orders/my?status=closed');
      set({ orderHistory: res.data });
    } catch (e) { console.error(e); }
  },

  wallets: [],
  fetchWallets: async () => {
    try {
      const res = await api.get('/wallet');
      set({ wallets: res.data });
    } catch (e) { console.error(e); }
  },
}));

export default useStore;
