import { useEffect, useRef, useState } from 'react';

import { api, subscribeMarketPrices, type MarketCandle, type MarketTicker } from '@/lib/api';

const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

export function useLiveMarketChart(symbol: string, timeframe: string) {
  const queryKey = `${symbol}:${timeframe}`;
  const [chartState, setChartState] = useState<{
    key: string;
    candles: MarketCandle[];
    loading: boolean;
    unavailable: boolean;
  }>({ key: '', candles: [], loading: true, unavailable: false });
  const [tickerState, setTickerState] = useState<{ symbol: string; ticker: MarketTicker } | null>(null);
  const candlesRef = useRef<MarketCandle[]>([]);

  useEffect(() => {
    let active = true;
    candlesRef.current = [];

    api.getCandles(symbol, timeframe)
      .then(({ candles: history }) => {
        if (!active) return;
        const ordered = [...history].sort((left, right) => left.ts - right.ts);
        candlesRef.current = ordered;
        setChartState({ key: queryKey, candles: ordered, loading: false, unavailable: ordered.length === 0 });
      })
      .catch(() => {
        if (active) setChartState({ key: queryKey, candles: [], loading: false, unavailable: true });
      })

    return () => { active = false; };
  }, [queryKey, symbol, timeframe]);

  useEffect(() => {
    const interval = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS['1m'];
    return subscribeMarketPrices([symbol], (prices) => {
      const nextTicker = prices[symbol];
      const price = Number(nextTicker?.lastPrice);
      if (!nextTicker || !Number.isFinite(price) || price <= 0) return;
      setTickerState({ symbol, ticker: nextTicker });

      const bucket = Math.floor(Date.now() / interval) * interval;
      const current = candlesRef.current;
      const latest = current[current.length - 1];
      if (latest && latest.ts > bucket) return;

      let next: MarketCandle[];
      if (latest?.ts === bucket) {
        next = [...current.slice(0, -1), {
          ...latest,
          high: Math.max(latest.high, price),
          low: Math.min(latest.low, price),
          close: price,
        }];
      } else {
        const open = latest?.close ?? price;
        next = latest ? [...current] : [];
        if (latest) {
          for (let timestamp = latest.ts + interval; timestamp < bucket; timestamp += interval) {
            next.push({ ts: timestamp, open, high: open, low: open, close: open, volume: 0 });
          }
        }
        next.push({
          ts: bucket,
          open,
          high: Math.max(open, price),
          low: Math.min(open, price),
          close: price,
          volume: 0,
        });
      }

      candlesRef.current = next;
      setChartState((currentState) => currentState.key === queryKey
        ? { ...currentState, candles: next, unavailable: false }
        : currentState);
    });
  }, [queryKey, symbol, timeframe]);

  const currentChart = chartState.key === queryKey ? chartState : null;
  const ticker = tickerState?.symbol === symbol ? tickerState.ticker : null;

  return {
    candles: currentChart?.candles ?? [],
    ticker,
    loading: currentChart?.loading ?? true,
    unavailable: currentChart?.unavailable ?? false,
  };
}