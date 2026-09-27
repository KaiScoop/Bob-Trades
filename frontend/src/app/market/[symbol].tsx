import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/theme';
import { api, subscribeMarketPrices, type MarketCandle, type MarketTicker } from '@/lib/api';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

function formatPrice(value: number | string | undefined) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0
    ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 8 })}`
    : '--';
}

export default function MarketDetailScreen() {
  const { symbol: routeSymbol } = useLocalSearchParams<{ symbol: string }>();
  const symbol = (routeSymbol ?? 'BTCUSDT').toUpperCase();
  const [timeframe, setTimeframe] = useState('1m');
  const [ticker, setTicker] = useState<MarketTicker | null>(null);
  const [candles, setCandles] = useState<MarketCandle[]>([]);
  const [indicators, setIndicators] = useState<Record<string, number>>({});
  const [loadedTimeframe, setLoadedTimeframe] = useState<string | null>(null);
  const [dataUnavailable, setDataUnavailable] = useState(false);

  useEffect(() => subscribeMarketPrices([symbol], (prices) => {
    if (prices[symbol]) setTicker(prices[symbol]);
  }), [symbol]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([api.getCandles(symbol, timeframe), api.getIndicators(symbol, timeframe)])
      .then(([candleResult, indicatorResult]) => {
        if (!active) return;
        if (candleResult.status === 'fulfilled') setCandles(candleResult.value.candles.slice(-12).reverse());
        setDataUnavailable(candleResult.status === 'rejected');
        if (indicatorResult.status === 'fulfilled') setIndicators(indicatorResult.value.indicators);
      })
      .finally(() => {
        if (active) setLoadedTimeframe(timeframe);
      });
    return () => { active = false; };
  }, [symbol, timeframe]);

  const dailyChange = Number(ticker?.price24hPcnt);
  const dailyChangeText = Number.isFinite(dailyChange)
    ? `${dailyChange >= 0 ? '+' : ''}${(dailyChange * 100).toFixed(2)}%`
    : '--';
  const dailyChangeArrow = Number.isFinite(dailyChange) ? dailyChange < 0 ? '↓' : '↑' : '';
  const dailyChangeColor = Number.isFinite(dailyChange)
    ? dailyChange < 0 ? AppColors.danger : AppColors.success
    : AppColors.muted;
  const loading = loadedTimeframe !== timeframe;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backArrow}>‹</Text>
          </Pressable>
          <View>
            <Text style={styles.eyebrow}>SPOT MARKET</Text>
            <Text style={styles.title}>{symbol.replace('USDT', '')}<Text style={styles.quote}> / USDT</Text></Text>
          </View>
        </View>

        <View style={styles.quoteSection}>
          <Text style={styles.liveLabel}>LIVE PRICE</Text>
          <Text style={[styles.price, { color: dailyChangeColor }]}>{formatPrice(ticker?.lastPrice)}</Text>
          <Text style={[styles.change, { color: dailyChangeColor }]}>{dailyChangeArrow ? `${dailyChangeArrow} ` : ''}{dailyChangeText} <Text style={styles.changeCaption}>24h</Text></Text>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}><Text style={styles.statLabel}>24H HIGH</Text><Text style={styles.statValue}>{formatPrice(ticker?.highPrice24h)}</Text></View>
          <View style={styles.stat}><Text style={styles.statLabel}>24H LOW</Text><Text style={styles.statValue}>{formatPrice(ticker?.lowPrice24h)}</Text></View>
          <View style={styles.stat}><Text style={styles.statLabel}>TURNOVER</Text><Text style={styles.statValue}>{formatPrice(ticker?.turnover24h)}</Text></View>
        </View>

        <Text style={styles.sectionTitle}>PRICE HISTORY</Text>
        <View style={styles.timeframes}>
          {TIMEFRAMES.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected: timeframe === item }}
              onPress={() => setTimeframe(item)}
              style={[styles.timeframe, timeframe === item && styles.timeframeSelected]}
            >
              <Text style={[styles.timeframeText, timeframe === item && styles.timeframeTextSelected]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.indicators}>
          <Text style={styles.indicatorValue}>RSI14 <Text style={styles.indicatorNumber}>{indicators.rsi14?.toFixed(1) ?? indicators.rsi?.toFixed(1) ?? '--'}</Text></Text>
          <Text style={styles.indicatorValue}>EMA20 <Text style={styles.indicatorNumber}>{indicators.ema20?.toFixed(2) ?? '--'}</Text></Text>
        </View>

        <Text style={styles.sectionTitle}>RECENT CANDLES</Text>
        {candles.length > 0 && <View style={styles.candleHeader}><Text style={styles.candleHeading}>TIME</Text><Text style={styles.candleHeading}>OPEN</Text><Text style={styles.candleHeading}>HIGH</Text><Text style={styles.candleHeading}>LOW</Text><Text style={styles.candleHeading}>CLOSE</Text></View>}
        {loading ? <ActivityIndicator color={AppColors.accentEnd} style={styles.loader} /> : dataUnavailable ? (
          <Text style={styles.empty}>Market history is temporarily unavailable.</Text>
        ) : candles.length === 0 ? (
          <Text style={styles.empty}>Waiting for market data.</Text>
        ) : candles.map((candle) => (
          <View key={candle.ts} style={styles.candleRow}>
            <Text style={styles.candleTime}>{new Date(candle.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            <Text style={styles.candleValue}>{formatPrice(candle.open)}</Text>
            <Text style={styles.candleValue}>{formatPrice(candle.high)}</Text>
            <Text style={styles.candleValue}>{formatPrice(candle.low)}</Text>
            <Text style={styles.candleValue}>{formatPrice(candle.close)}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, paddingBottom: 26 },
  backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.hairline },
  backArrow: { color: '#fff', fontSize: 30, lineHeight: 32, marginTop: -3 },
  eyebrow: { color: AppColors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 3 },
  quote: { color: AppColors.muted, fontSize: 15, fontWeight: '500' },
  quoteSection: { paddingVertical: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: AppColors.hairline },
  liveLabel: { color: AppColors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.3 },
  price: { color: '#fff', fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 8 },
  change: { color: AppColors.success, fontSize: 14, fontWeight: '600', marginTop: 7 },
  changeCaption: { color: AppColors.muted, fontWeight: '400' },
  stats: { flexDirection: 'row', borderBottomWidth: 1, borderColor: AppColors.hairline, paddingVertical: 18, gap: 12 },
  stat: { flex: 1 },
  statLabel: { color: AppColors.faint, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  statValue: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 7 },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 24, marginBottom: 12 },
  timeframes: { flexDirection: 'row', backgroundColor: AppColors.surface, borderRadius: 8, padding: 4, gap: 2 },
  timeframe: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 6 },
  timeframeSelected: { backgroundColor: AppColors.accentEnd },
  timeframeText: { color: AppColors.muted, fontSize: 11, fontWeight: '600' },
  timeframeTextSelected: { color: '#fff' },
  indicators: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderColor: AppColors.hairline },
  indicatorValue: { color: AppColors.muted, fontSize: 12 },
  indicatorNumber: { color: '#fff', fontWeight: '600' },
  candleHeader: { flexDirection: 'row', paddingTop: 8 },
  candleHeading: { flex: 1, color: AppColors.faint, fontSize: 8, fontWeight: '700', textAlign: 'right' },
  candleRow: { flexDirection: 'row', paddingVertical: 11, borderBottomWidth: 1, borderColor: AppColors.hairline },
  candleTime: { flex: 1.2, color: AppColors.muted, fontSize: 9 },
  candleValue: { flex: 1, color: '#fff', fontSize: 9, fontVariant: ['tabular-nums'], textAlign: 'right' },
  loader: { marginTop: 22 },
  empty: { color: AppColors.muted, fontSize: 13, paddingVertical: 14 },
});