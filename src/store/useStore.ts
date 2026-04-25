import { create } from 'zustand';
import type { User, Market, Ticker, Orderbook, Trade, Order, Wallet } from '../types';
import api from '../utils/api';

interface ExchangeStore {
  // Auth
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
  loadAuth: () => void;

  // Market
  markets: Market[];
  currentMarket: string;
  tickers: Record<string, Ticker>;
  prevTickers: Record<string, Ticker>;
  orderbook: Orderbook;
  recentTrades: Trade[];
  isLoadingOrderbook: boolean;
  isLoadingTrades: boolean;
  isLoadingMarkets: boolean;
  setCurrentMarket: (symbol: string) => void;
  fetchMarkets: () => Promise<void>;
  fetchOrderbook: (symbol: string) => Promise<void>;
  fetchRecentTrades: (symbol: string) => Promise<void>;
  updateTicker: (symbol: string, data: Ticker) => void;
  updateAllTickers: (data: Record<string, Ticker>) => void;
  updateOrderbook: (data: Orderbook) => void;
  addTrades: (trades: Trade[]) => void;
  setRecentTrades: (trades: Trade[]) => void;

  // Orders
  openOrders: Order[];
  orderHistory: Order[];
  tradeHistory: Trade[];
  fetchOpenOrders: (market?: string) => Promise<void>;
  fetchOrderHistory: () => Promise<void>;
  fetchTradeHistory: () => Promise<void>;

  // Wallet
  wallets: Wallet[];
  fetchWallets: () => Promise<void>;
}

// Hydrate auth state from localStorage SYNCHRONOUSLY at module load so the
// very first render of <ProtectedRoute> already sees the logged-in user.
// Previously we relied on App's useEffect → loadAuth(), but useEffect only
// runs *after* the first render, by which point ProtectedRoute had already
// redirected to /login. That's why typing a deep URL (/admin, /wallet, …) and
// hitting Enter always bounced you to the login screen even with a valid token.
function hydrateAuth(): { user: User | null; token: string | null } {
  if (typeof localStorage === 'undefined') return { user: null, token: null };
  try {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      return { token, user: JSON.parse(userStr) as User };
    }
  } catch {
    /* corrupted localStorage — fall through to logged-out state */
  }
  return { user: null, token: null };
}

const __initialAuth = hydrateAuth();

const useStore = create<ExchangeStore>((set, get) => ({
  user: __initialAuth.user,
  token: __initialAuth.token,
  setAuth: (user, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ user, token });
  },
  setUser: (user) => {
    localStorage.setItem('user', JSON.stringify(user));
    set({ user });
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({ user: null, token: null });
  },
  loadAuth: () => {
    // Kept for backward compatibility — useStore is already hydrated above,
    // but App.tsx still calls this on mount. Re-read in case localStorage
    // changed in another tab.
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      try { set({ token, user: JSON.parse(userStr) as User }); } catch { /* noop */ }
    }
  },

  markets: [],
  currentMarket: 'BTC-USDT',
  tickers: {},
  prevTickers: {},
  orderbook: { bids: [], asks: [] },
  recentTrades: [],
  isLoadingOrderbook: true,
  isLoadingTrades: true,
  isLoadingMarkets: true,

  setCurrentMarket: (symbol) => set({ currentMarket: symbol }),

  fetchMarkets: async () => {
    // Render the table as soon as /markets returns, even if /tickers is still
    // in flight. Previously we awaited Promise.all, so the slowest call
    // (tickers, ~700-900 ms on cold cache) dictated time-to-first-paint.
    // Splitting them lets the markets list show up almost immediately and
    // tickers fill in shortly after.
    set({ isLoadingMarkets: true });
    let marketsLoaded = false;

    api.get('/market/markets')
      .then(res => {
        marketsLoaded = true;
        set({ markets: res.data, isLoadingMarkets: false });
      })
      .catch(e => {
        marketsLoaded = true;
        set({ isLoadingMarkets: false });
        console.error('fetchMarkets:', e);
      });

    api.get('/market/tickers')
      .then(res => set({ tickers: res.data }))
      .catch(e => console.error('fetchTickers:', e));

    // Failsafe: if neither resolves within 8 s (network failure, etc.),
    // drop the skeleton so the user sees an empty state instead of a
    // perpetual loader.
    setTimeout(() => {
      if (!marketsLoaded) set({ isLoadingMarkets: false });
    }, 8000);
  },

  fetchOrderbook: async (symbol) => {
    try {
      set({ isLoadingOrderbook: true });
      const res = await api.get(`/stream/orderbook/${symbol}`);
      set({ orderbook: res.data, isLoadingOrderbook: false });
    } catch (e) {
      set({ isLoadingOrderbook: false });
      console.error(e);
    }
  },

  fetchRecentTrades: async (symbol) => {
    try {
      set({ isLoadingTrades: true });
      const res = await api.get(`/stream/trades/${symbol}`);
      set({ recentTrades: res.data, isLoadingTrades: false });
    } catch (e) {
      set({ isLoadingTrades: false });
      console.error(e);
    }
  },

  updateTicker: (symbol, data) => {
    set((state) => ({
      prevTickers: { ...state.prevTickers, [symbol]: state.tickers[symbol] },
      tickers: { ...state.tickers, [symbol]: data },
    }));
  },

  updateAllTickers: (data) => {
    set((state) => ({
      prevTickers: { ...state.tickers },
      tickers: { ...state.tickers, ...data },
    }));
  },

  updateOrderbook: (data) => set({ orderbook: data, isLoadingOrderbook: false }),

  addTrades: (trades) => {
    set((state) => ({
      recentTrades: [...trades, ...state.recentTrades].slice(0, 50),
      isLoadingTrades: false,
    }));
  },

  setRecentTrades: (trades) => set({ recentTrades: trades, isLoadingTrades: false }),

  openOrders: [],
  orderHistory: [],
  tradeHistory: [],

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

  fetchTradeHistory: async () => {
    try {
      const res = await api.get('/orders/my/trades');
      set({ tradeHistory: res.data });
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
