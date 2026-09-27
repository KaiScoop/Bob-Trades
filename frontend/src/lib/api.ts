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
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

export const api = {
  signUp: (email: string) => request('/auth/signup', { method: 'POST', body: JSON.stringify({ email }) }),
  signIn: (email: string) => request('/auth/signin', { method: 'POST', body: JSON.stringify({ email }) }),
  refresh: (refreshToken: string) => request<{ access_token: string; refresh_token: string }>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }),
  getSession: () => request<Session>('/auth/session'),
  getProfile: () => request<Profile>('/me'),
  updateProfile: (profile: { username: string; dob?: string }) => request<Profile>('/me', { method: 'PATCH', body: JSON.stringify(profile) }),
  connectBybit: (payload: { mode: 'testnet' | 'mainnet'; api_key: string; api_secret: string }) => request('/broker/bybit', { method: 'POST', body: JSON.stringify(payload) }),
  disconnectBybit: () => request<{ deleted: boolean }>('/broker/bybit', { method: 'DELETE' }),
  getPositions: () => request<{ positions: Position[]; count: number }>('/positions'),
  getOrders: () => request<{ orders: Record<string, unknown>[]; count: number }>('/orders'),
  closePosition: (symbol: string) => request(`/positions/${symbol}/close`, { method: 'POST' }),
  updateTpsl: (symbol: string, tp: number, sl: number) => request(`/positions/${symbol}/tpsl`, { method: 'POST', body: JSON.stringify({ tp, sl }) }),
  getLogs: (limit = 50) => request<{ logs: AgentLog[] }>(`/agent/logs?limit=${limit}`),
  startAgent: (payload: { symbol: string; risk: string; max_position_pct: number; arm_live: boolean }) => request('/agent/start', { method: 'POST', body: JSON.stringify(payload) }),
  stopAgent: () => request('/agent/stop', { method: 'POST' }),
  getCandles: (symbol: string, tf: string) => request<{ candles: { ts: number; close: number; open: number; high: number; low: number; volume: number }[] }>(`/markets/${symbol}/candles?tf=${tf}`),
  getIndicators: (symbol: string, tf: string) => request<{ indicators: Record<string, number> }>(`/markets/${symbol}/indicators?tf=${tf}`),
  getMarkets: () => request<{ symbols: string[] }>('/markets'),
  getPortfolio: () => request<Portfolio>('/portfolio'),
  getBrokerStatus: () => request<BrokerStatus>('/broker/status'),
};