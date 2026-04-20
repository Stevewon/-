// Real-time updates via SSE (Server-Sent Events) for Cloudflare Workers
// Enhanced: multi-event SSE (tickers, orderbook, trades) with auto-reconnect

type TickerCallback = (data: Record<string, any>) => void;
type OrderbookCallback = (data: { bids: any[]; asks: any[] }) => void;
type TradesCallback = (data: any[]) => void;

let tickerSource: EventSource | null = null;
let tickerCallbacks: TickerCallback[] = [];
let orderbookCallbacks: OrderbookCallback[] = [];
let tradesCallbacks: TradesCallback[] = [];
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let subscribedMarket = '';
const MAX_RECONNECT_DELAY = 30000;

function getApiBase(): string {
  return '';
}

function getReconnectDelay(): number {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
  return delay + Math.random() * 1000;
}

export function connectTickerStream(market?: string) {
  // If market subscription changed, reconnect
  if (market && market !== subscribedMarket) {
    subscribedMarket = market;
    disconnectTickerStream();
  }

  if (tickerSource && tickerSource.readyState !== EventSource.CLOSED) return;
  if (reconnectTimer) return;

  try {
    const url = subscribedMarket
      ? `${getApiBase()}/api/stream/ticker?market=${subscribedMarket}`
      : `${getApiBase()}/api/stream/ticker`;

    tickerSource = new EventSource(url);

    tickerSource.onopen = () => {
      reconnectAttempt = 0;
      stopPolling();
    };

    // Handle named events
    tickerSource.addEventListener('tickers', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        tickerCallbacks.forEach(cb => cb(data));
      } catch {}
    });

    tickerSource.addEventListener('orderbook', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        orderbookCallbacks.forEach(cb => cb(data));
      } catch {}
    });

    tickerSource.addEventListener('trades', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        tradesCallbacks.forEach(cb => cb(data));
      } catch {}
    });

    // Also handle generic message (backward compat)
    tickerSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'tickers' && parsed.data) {
          tickerCallbacks.forEach(cb => cb(parsed.data));
        }
      } catch {}
    };

    tickerSource.onerror = () => {
      disconnectTickerStream();
      startPolling();
      reconnectAttempt++;
      const delay = getReconnectDelay();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectTickerStream();
      }, delay);
    };
  } catch {
    startPolling();
  }
}

function startPolling() {
  if (pollingInterval) return;
  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/market/tickers`);
      const data = await res.json();
      tickerCallbacks.forEach(cb => cb(data));
    } catch {}

    // Also poll orderbook/trades if subscribed
    if (subscribedMarket) {
      try {
        const [obRes, trRes] = await Promise.all([
          fetch(`${getApiBase()}/api/stream/orderbook/${subscribedMarket}`),
          fetch(`${getApiBase()}/api/stream/trades/${subscribedMarket}`),
        ]);
        const obData = await obRes.json();
        const trData = await trRes.json();
        orderbookCallbacks.forEach(cb => cb(obData));
        tradesCallbacks.forEach(cb => cb(trData));
      } catch {}
    }
  }, 2000);

  // Immediate fetch
  fetch(`${getApiBase()}/api/market/tickers`)
    .then(r => r.json())
    .then(data => tickerCallbacks.forEach(cb => cb(data)))
    .catch(() => {});
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

export function disconnectTickerStream() {
  if (tickerSource) {
    tickerSource.close();
    tickerSource = null;
  }
}

// Ticker updates
export function onTickerUpdate(callback: TickerCallback) {
  tickerCallbacks.push(callback);
  if (tickerCallbacks.length === 1 && orderbookCallbacks.length === 0 && tradesCallbacks.length === 0) {
    connectTickerStream();
  }
  return () => {
    tickerCallbacks = tickerCallbacks.filter(cb => cb !== callback);
    cleanupIfNoListeners();
  };
}

// Orderbook updates
export function onOrderbookUpdate(callback: OrderbookCallback) {
  orderbookCallbacks.push(callback);
  return () => {
    orderbookCallbacks = orderbookCallbacks.filter(cb => cb !== callback);
    cleanupIfNoListeners();
  };
}

// Trades updates
export function onTradesUpdate(callback: TradesCallback) {
  tradesCallbacks.push(callback);
  return () => {
    tradesCallbacks = tradesCallbacks.filter(cb => cb !== callback);
    cleanupIfNoListeners();
  };
}

function cleanupIfNoListeners() {
  if (tickerCallbacks.length === 0 && orderbookCallbacks.length === 0 && tradesCallbacks.length === 0) {
    disconnectTickerStream();
    stopPolling();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    subscribedMarket = '';
  }
}

// Subscribe to a specific market (reconnects SSE with market param)
export function subscribeToMarket(symbol: string) {
  subscribedMarket = symbol;
  // Force reconnect with new market param
  disconnectTickerStream();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  connectTickerStream(symbol);
}

export function unsubscribeFromMarket(_symbol: string) {
  subscribedMarket = '';
  // Reconnect without market param
  disconnectTickerStream();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  if (tickerCallbacks.length > 0) {
    connectTickerStream();
  }
}

// Dedup fetch
const pendingFetches = new Map<string, Promise<any>>();

export async function fetchWithDedup(url: string, ttl = 1000): Promise<any> {
  const cacheKey = url;
  if (pendingFetches.has(cacheKey)) {
    return pendingFetches.get(cacheKey);
  }
  const promise = fetch(`${getApiBase()}${url}`)
    .then(r => r.json())
    .finally(() => {
      setTimeout(() => pendingFetches.delete(cacheKey), ttl);
    });
  pendingFetches.set(cacheKey, promise);
  return promise;
}

// Compatibility shim
export function getSocket(): any {
  return {
    on: (_event: string, _callback: (...args: any[]) => void) => {},
    off: (_event: string, _callback: (...args: any[]) => void) => {},
    emit: (_event: string, ..._args: any[]) => {},
  };
}
