import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppColors } from '@/constants/theme';
import type { MarketCandle } from '@/lib/api';
import MarketChartView from '@/components/market-chart-view';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

type MarketChartProps = {
  symbol: string;
  timeframe: string;
  onTimeframeChange: (timeframe: string) => void;
  candles: MarketCandle[];
  loading: boolean;
  unavailable: boolean;
};

export function MarketChart({ symbol, timeframe, onTimeframeChange, candles, loading, unavailable }: MarketChartProps) {
  const [fitContentKey, setFitContentKey] = useState(0);

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.timeframes}>
          {TIMEFRAMES.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected: timeframe === item }}
              onPress={() => onTimeframeChange(item)}
              style={[styles.timeframe, timeframe === item && styles.timeframeSelected]}
            >
              <Text style={[styles.timeframeText, timeframe === item && styles.timeframeTextSelected]}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fit chart to data"
          onPress={() => setFitContentKey((key) => key + 1)}
          style={styles.fitButton}
        >
          <Text style={styles.fitText}>FIT</Text>
        </Pressable>
      </View>
      <MarketChartView
        symbol={symbol}
        timeframe={timeframe}
        candles={candles}
        fitContentKey={fitContentKey}
        loading={loading}
        unavailable={unavailable}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: AppColors.surface, borderColor: AppColors.hairline, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  toolbar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, borderBottomWidth: 1, borderColor: AppColors.hairline },
  timeframes: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  timeframe: { minWidth: 37, alignItems: 'center', paddingVertical: 8, borderRadius: 5 },
  timeframeSelected: { backgroundColor: AppColors.raised },
  timeframeText: { color: AppColors.muted, fontSize: 11, fontWeight: '600' },
  timeframeTextSelected: { color: '#fff' },
  fitButton: { width: 36, height: 30, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderColor: AppColors.hairline },
  fitText: { color: AppColors.muted, fontSize: 9, fontWeight: '700' },
});