// Real-time updates via SSE (Server-Sent Events) for Cloudflare Workers
// Falls back to polling when SSE is not available

let eventSource: EventSource | null = null;
let tickerCallbacks: ((data: Record<string, any>) => void)[] = [];
let pollingInterval: ReturnType<typeof setInterval> | null = null;

function getApiBase(): string {
  // In production, API is at the same origin via Cloudflare Pages Functions
  // In development, Vite proxy handles /api
  return '';
}

export function connectTickerStream() {
  if (eventSource) return;

  try {
    eventSource = new EventSource(`${getApiBase()}/api/stream/ticker`);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'tickers' && parsed.data) {
          tickerCallbacks.forEach(cb => cb(parsed.data));
        }
      } catch { /* ignore parse errors */ }
    };

    eventSource.onerror = () => {
      // SSE disconnected, fall back to polling
      disconnectTickerStream();
      startPolling();
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
    } catch { /* ignore */ }
  }, 3000);
}

export function disconnectTickerStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

export function onTickerUpdate(callback: (data: Record<string, any>) => void) {
  tickerCallbacks.push(callback);
  return () => {
    tickerCallbacks = tickerCallbacks.filter(cb => cb !== callback);
  };
}

// Compatibility shims for components that used socket.io
export function subscribeToMarket(_symbol: string) {
  connectTickerStream();
}

export function unsubscribeFromMarket(_symbol: string) {
  // Keep stream alive for other markets
}

export function getSocket(): any {
  // Return a mock socket object for backward compatibility
  return {
    on: (_event: string, _callback: (...args: any[]) => void) => {},
    off: (_event: string, _callback: (...args: any[]) => void) => {},
    emit: (_event: string, ..._args: any[]) => {},
  };
}
