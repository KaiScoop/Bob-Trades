import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const WATCHLIST_KEY_PREFIX = 'bob_watchlist_';

function watchlistKey(userId: string) {
  return `${WATCHLIST_KEY_PREFIX}${userId}`;
}

export async function loadWatchlist(userId: string): Promise<string[]> {
  const key = watchlistKey(userId);
  const stored = Platform.OS === 'web'
    ? localStorage.getItem(key)
    : await SecureStore.getItemAsync(key);
  if (!stored) return [];

  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((symbol): symbol is string => typeof symbol === 'string'))]
      : [];
  } catch {
    return [];
  }
}

export async function saveWatchlist(userId: string, symbols: string[]) {
  const key = watchlistKey(userId);
  const value = JSON.stringify([...new Set(symbols)]);
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}