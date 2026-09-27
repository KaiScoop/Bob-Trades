import { getAccessToken, getRefreshToken, saveTokens } from '@/lib/secure';
import { Platform } from 'react-native';

const API_URL = Platform.OS === 'web'
  ? (process.env.EXPO_PUBLIC_WEB_API_URL ?? 'http://localhost:8080')
  : (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080');

export type Portfolio = { mode: string; balance: number; asset: string };
export type BrokerStatus = { connected: boolean; mode: string | null; balance: number };
export type Session = { user_id: string; email: string };
export type Profile = { user_id: string; username: string | null; dob: string | null };
export type Position = { symbol: string; side: string; size: number; free?: number };
export type AgentLog = { id: number; ts: string; latency_ms: number; request_json: Record<string, unknown>; response_json: Record<string, unknown>; intended: boolean; executed: boolean; reason: string };
export type MarketTicker = { lastPrice?: string; price24hPcnt?: string; highPrice24h?: string; lowPrice24h?: string; turnover24h?: string };
export type MarketCandle = { ts: number; close: number; open: number; high: number; low: number; volume: number };

export function subscribeMarketPrices(
  symbols: string[],
  onPrices: (prices: Record<string, MarketTicker>) => void,
): () => void {
  let stopped = false;
  let connection: XMLHttpRequest | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (stopped) return;
    const request = new XMLHttpRequest();
    connection = request;
    let offset = 0;
    let pending = '';

    const readEvents = () => {
      const responseText = request.responseText ?? '';
      pending += responseText.slice(offset);
      offset = responseText.length;
      const blocks = pending.split(/\r?\n\r?\n/);
      pending = blocks.pop() ?? '';

      for (const block of blocks) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        try {
          const event = JSON.parse(data) as { markets?: { symbol: string; ticker: MarketTicker }[] };
          const prices = Object.fromEntries(
            (event.markets ?? []).map(({ symbol, ticker }) => [symbol, ticker]),
          );
          if (Object.keys(prices).length > 0) onPrices(prices);
        } catch {
          continue;
        }
      }
    };

    const scheduleReconnect = () => {
      if (stopped || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, 2500);
    };

    request.open('GET', `${API_URL}/stream?symbols=${encodeURIComponent(symbols.join(','))}`);
    request.setRequestHeader('Accept', 'text/event-stream');
    request.onprogress = readEvents;
    request.onerror = scheduleReconnect;
    request.onreadystatechange = () => {
      if (request.readyState === XMLHttpRequest.DONE) {
        readEvents();
        scheduleReconnect();
      }
    };
    request.send();
  };

  connect();
  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    connection?.abort();
  };
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
  if (response.status === 401 && retry && path !== '/auth/refresh') {
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      const refreshed = await request<{ access_token: string; refresh_token: string }>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }, false);
      await saveTokens(refreshed.access_token, refreshed.refresh_token);
      return request<T>(path, init, false);
    }
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = typeof payload?.detail === 'string' ? `: ${payload.detail}` : '';
    throw new Error(`API ${response.status} ${init?.method?.toUpperCase() ?? 'GET'} ${path}${detail}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  signUp: (email: string) => request('/auth/signup', { method: 'POST', body: JSON.stringify({ email }) }),
  signIn: (email: string) => request('/auth/signin', { method: 'POST', body: JSON.stringify({ email }) }),
  refresh: (refreshToken: string) => request<{ access_token: string; refresh_token: string }>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }),
  getSession: () => request<Session>('/auth/session'),
  getProfile: () => request<Profile>('/me'),
  updateProfile: (profile: { username: string; dob?: string }) => request<Profile>('/me', { method: 'PATCH', body: JSON.stringify(profile) }),
  connectBybit: (payload: { mode: 'testnet' | 'mainnet'; api_key: string; api_secret: string }) => request<{ status: 'connected'; mode: string; balance: number }>('/broker/bybit', { method: 'POST', body: JSON.stringify(payload) }),
  disconnectBybit: () => request<{ deleted: boolean }>('/broker/bybit', { method: 'DELETE' }),
  getPositions: () => request<{ positions: Position[]; count: number }>('/positions'),
  getOrders: () => request<{ orders: Record<string, unknown>[]; count: number }>('/orders'),
  closePosition: (symbol: string) => request(`/positions/${symbol}/close`, { method: 'POST' }),
  updateTpsl: (symbol: string, tp: number, sl: number) => request(`/positions/${symbol}/tpsl`, { method: 'POST', body: JSON.stringify({ tp, sl }) }),
  getLogs: (limit = 50) => request<{ logs: AgentLog[] }>(`/agent/logs?limit=${limit}`),
  startAgent: (payload: { symbol: string; risk: string; max_position_pct: number; arm_live: boolean }) => request('/agent/start', { method: 'POST', body: JSON.stringify(payload) }),
  stopAgent: () => request('/agent/stop', { method: 'POST' }),
  getCandles: (symbol: string, tf: string) => request<{ candles: MarketCandle[] }>(`/markets/${symbol}/candles?tf=${tf}`),
  getIndicators: (symbol: string, tf: string) => request<{ indicators: Record<string, number> }>(`/markets/${symbol}/indicators?tf=${tf}`),
  getMarkets: () => request<{ symbols: string[] }>('/markets'),
  getPortfolio: () => request<Portfolio>('/portfolio'),
  getBrokerStatus: () => request<BrokerStatus>('/broker/status'),
};