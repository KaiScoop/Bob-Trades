import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppColors } from '@/constants/theme';
import type { MarketCandle } from '@/lib/api';

type MarketChartViewProps = {
  symbol: string;
  timeframe: string;
  candles: MarketCandle[];
  fitContentKey: number;
  loading: boolean;
  unavailable: boolean;
};

const CHART_HEIGHT = 280;
const PLOT_HEIGHT = 220;
const CANDLE_STEP = 12;

export default function MarketChartView({ symbol, timeframe, candles, fitContentKey, loading, unavailable }: MarketChartViewProps) {
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const initialScrollRef = useRef(false);
  const visibleCandles = useMemo(() => candles.slice(-100), [candles]);
  const bounds = useMemo(() => {
    if (!visibleCandles.length) return { min: 0, max: 1, maxVolume: 1 };
    return {
      min: Math.min(...visibleCandles.map((candle) => candle.low)),
      max: Math.max(...visibleCandles.map((candle) => candle.high)),
      maxVolume: Math.max(1, ...visibleCandles.map((candle) => candle.volume)),
    };
  }, [visibleCandles]);
  const priceRange = bounds.max - bounds.min || Math.max(bounds.max * 0.01, 1);
  const candleWidth = Math.max(viewportWidth, visibleCandles.length * CANDLE_STEP);

  useEffect(() => {
    initialScrollRef.current = false;
  }, [symbol, timeframe, fitContentKey]);

  useEffect(() => {
    if (visibleCandles.length > 0 && !initialScrollRef.current) {
      scrollRef.current?.scrollToEnd({ animated: false });
      initialScrollRef.current = true;
    }
  }, [visibleCandles.length, fitContentKey, symbol, timeframe]);

  const message = loading ? 'Loading chart…' : unavailable && visibleCandles.length === 0 ? 'Market history is unavailable.' : null;

  return (
    <View style={styles.frame} onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}>
      {visibleCandles.length > 0 ? (
        <ScrollView
          key={`${symbol}:${timeframe}:${fitContentKey}`}
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ width: candleWidth, height: CHART_HEIGHT }}
        >
          <View style={[styles.plot, { width: candleWidth }]}>
            {visibleCandles.map((candle, index) => {
              const x = index * CANDLE_STEP + 3;
              const color = candle.close >= candle.open ? AppColors.success : AppColors.danger;
              const yFor = (price: number) => 10 + ((bounds.max - price) / priceRange) * (PLOT_HEIGHT - 24);
              const top = yFor(Math.max(candle.open, candle.close));
              const bottom = yFor(Math.min(candle.open, candle.close));
              const volumeHeight = Math.max(1, (candle.volume / bounds.maxVolume) * 26);
              return (
                <View key={candle.ts} pointerEvents="none">
                  <View style={[styles.wick, { left: x + 3, top: yFor(candle.high), height: Math.max(1, yFor(candle.low) - yFor(candle.high)), backgroundColor: color }]} />
                  <View style={[styles.body, { left: x + 1, top, height: Math.max(2, bottom - top), backgroundColor: color }]} />
                  <View style={[styles.volume, { left: x, height: volumeHeight, backgroundColor: color }]} />
                </View>
              );
            })}
            <View pointerEvents="none" style={styles.axisLabels}>
              <Text style={[styles.axisText, { top: 0 }]}>{bounds.max.toLocaleString(undefined, { maximumFractionDigits: 4 })}</Text>
              <Text style={[styles.axisText, { bottom: 0 }]}>{bounds.min.toLocaleString(undefined, { maximumFractionDigits: 4 })}</Text>
            </View>
            {visibleCandles.length > 0 ? (
              <View pointerEvents="none" style={styles.timeLabels}>
                {[0, Math.floor((visibleCandles.length - 1) / 2), visibleCandles.length - 1].map((index) => (
                  <Text key={`${index}-${visibleCandles[index].ts}`} style={[styles.axisText, { left: index * CANDLE_STEP }]}>
                    {new Date(visibleCandles[index].ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>
      ) : null}
      {message ? <View pointerEvents="none" style={styles.message}><Text style={styles.messageText}>{message}</Text></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: CHART_HEIGHT, position: 'relative', overflow: 'hidden' },
  plot: { height: CHART_HEIGHT, position: 'relative' },
  wick: { position: 'absolute', width: 1 },
  body: { position: 'absolute', width: 6, borderRadius: 1 },
  volume: { position: 'absolute', bottom: 34, width: 6, opacity: 0.35 },
  axisLabels: { position: 'absolute', top: 8, right: 6, bottom: 55, justifyContent: 'space-between' },
  timeLabels: { position: 'absolute', left: 4, right: 4, bottom: 12 },
  axisText: { position: 'absolute', color: AppColors.muted, fontSize: 9, fontVariant: ['tabular-nums'] },
  message: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10, 10, 10, 0.72)' },
  messageText: { color: AppColors.muted, fontSize: 12 },
});