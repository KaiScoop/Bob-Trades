import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '@/components/app-text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/theme';
import { NetworkSwitch } from '@/components/network-switch';
import { MarketChart } from '@/components/market-chart';
import { api } from '@/lib/api';
import { useLiveMarketChart } from '@/hooks/use-live-market-chart';

function formatNumber(value: number | string | undefined, options?: Intl.NumberFormatOptions) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return new Intl.NumberFormat('en-US', options).format(numeric);
}

function formatPrice(value: number | string | undefined) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0
    ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 8 })}`
    : '--';
}

function formatSignedPct(value: number | string | undefined, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(digits)}%`;
}

function formatCompactMoney(value: number | string | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  const compact = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(numeric);
  return `$${compact}`;
}

export default function MarketDetailScreen() {
  const { symbol: routeSymbol } = useLocalSearchParams<{ symbol: string }>();
  const symbol = (routeSymbol ?? 'BTCUSDT').toUpperCase();
  const [timeframe, setTimeframe] = useState('1m');
  const [indicators, setIndicators] = useState<Record<string, number>>({});
  const [book, setBook] = useState<Record<string, number>>({});
  const { candles, ticker, loading, unavailable } = useLiveMarketChart(symbol, timeframe);

  useEffect(() => {
    let active = true;
    api.getIndicators(symbol, timeframe)
      .then((result) => {
        if (!active) return;
        setIndicators(result.indicators);
      })
      .catch(() => { if (active) setIndicators({}); });

    api.getBook(symbol)
      .then((result) => {
        if (!active) return;
        setBook(result.book as Record<string, number>);
      })
      .catch(() => { if (active) setBook({}); });

    return () => { active = false; };
  }, [symbol, timeframe]);

  const dailyChange = Number(ticker?.price24hPcnt);
  const dailyChangeText = Number.isFinite(dailyChange)
    ? formatSignedPct(dailyChange * 100, 2)
    : '--';
  const dailyChangeArrow = Number.isFinite(dailyChange) ? dailyChange < 0 ? '↓' : '↑' : '';
  const dailyChangeColor = Number.isFinite(dailyChange)
    ? dailyChange < 0 ? AppColors.danger : AppColors.success
    : AppColors.muted;

  const statCards = [
    { label: '24H HIGH', value: formatPrice(ticker?.highPrice24h) },
    { label: '24H LOW', value: formatPrice(ticker?.lowPrice24h) },
    { label: '24H VOLUME', value: formatNumber(ticker?.volume24h, { maximumFractionDigits: 2 }) },
    { label: 'TURNOVER', value: formatCompactMoney(ticker?.turnover24h) },
    { label: 'OPEN', value: formatPrice(ticker?.openPrice) },
    { label: 'PREV CLOSE', value: formatPrice(ticker?.prevPrice24h) },
    { label: 'INDEX', value: formatPrice(ticker?.indexPrice ?? ticker?.usdIndexPrice) },
    { label: 'MARK', value: formatPrice(ticker?.markPrice) },
  ];

  const marketCards = [
    { label: 'BID', value: formatPrice(ticker?.bid1Price) },
    { label: 'ASK', value: formatPrice(ticker?.ask1Price) },
    { label: 'SPREAD', value: book.spread_bps != null ? `${Number(book.spread_bps).toFixed(2)} bps` : '--' },
    { label: 'BOOK IMBALANCE', value: book.book_imbalance != null ? `${(Number(book.book_imbalance) * 100).toFixed(2)}%` : '--' },
    { label: 'DEPTH L1 BID', value: book.bid_depth_usdt_l1 != null ? formatCompactMoney(book.bid_depth_usdt_l1) : '--' },
    { label: 'DEPTH L1 ASK', value: book.ask_depth_usdt_l1 != null ? formatCompactMoney(book.ask_depth_usdt_l1) : '--' },
    { label: 'DEPTH L10 BID', value: book.bid_depth_usdt_l10 != null ? formatCompactMoney(book.bid_depth_usdt_l10) : '--' },
    { label: 'DEPTH L10 ASK', value: book.ask_depth_usdt_l10 != null ? formatCompactMoney(book.ask_depth_usdt_l10) : '--' },
  ];

  const rsiValue = indicators.rsi14 ?? indicators.rsi;
  const indicatorCards = [
    { label: 'RSI14', value: rsiValue != null ? formatNumber(rsiValue, { maximumFractionDigits: 1 }) : '--' },
    { label: 'EMA20', value: indicators.ema20 != null ? formatNumber(indicators.ema20, { maximumFractionDigits: 2 }) : '--' },
    { label: 'EMA50', value: indicators.ema_50 != null ? formatNumber(indicators.ema_50, { maximumFractionDigits: 2 }) : '--' },
    { label: 'SMA50', value: indicators.sma50 != null ? formatNumber(indicators.sma50, { maximumFractionDigits: 2 }) : '--' },
    { label: 'MACD', value: indicators.macd != null ? formatNumber(indicators.macd, { maximumFractionDigits: 4 }) : '--' },
    { label: 'SIGNAL', value: indicators.signal != null ? formatNumber(indicators.signal, { maximumFractionDigits: 4 }) : '--' },
    { label: 'ATR14', value: indicators.atr14 != null ? formatNumber(indicators.atr14, { maximumFractionDigits: 4 }) : '--' },
    { label: 'ATR %', value: indicators.atr_pct != null ? `${(Number(indicators.atr_pct) * 100).toFixed(2)}%` : '--' },
    { label: 'VOLATILITY', value: indicators.realized_vol_20 != null ? formatNumber(indicators.realized_vol_20, { maximumFractionDigits: 4 }) : '--' },
    { label: 'VWMA20', value: indicators.vwma_20 != null ? formatNumber(indicators.vwma_20, { maximumFractionDigits: 2 }) : '--' },
    { label: 'ADX14', value: indicators.average_directional_index_14 != null ? formatNumber(indicators.average_directional_index_14, { maximumFractionDigits: 1 }) : '--' },
    { label: 'MOMENTUM', value: indicators.momentum_10 != null ? formatNumber(indicators.momentum_10, { maximumFractionDigits: 4 }) : '--' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backArrow}>‹</Text>
          </Pressable>
          <View style={styles.marketHeading}>
            <Text style={styles.eyebrow}>SPOT MARKET</Text>
            <Text style={styles.title}>{symbol.replace('USDT', '')}<Text style={styles.quote}> / USDT</Text></Text>
          </View>
          <NetworkSwitch />
        </View>

        <View style={styles.quoteSection}>
          <Text style={styles.liveLabel}>LIVE PRICE</Text>
          <Text style={[styles.price, { color: dailyChangeColor }]}>{formatPrice(ticker?.lastPrice)}</Text>
          <Text style={[styles.change, { color: dailyChangeColor }]}>{dailyChangeArrow ? `${dailyChangeArrow} ` : ''}{dailyChangeText} <Text style={styles.changeCaption}>24h</Text></Text>
        </View>

        <View style={styles.statsGrid}>
          {statCards.map((item) => (
            <View key={item.label} style={styles.statCell}>
              <Text style={styles.statLabel}>{item.label}</Text>
              <Text style={styles.statValue}>{item.value}</Text>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/(tabs)/trade', params: { symbol } })}
          style={styles.tradeButton}
        >
          <Text style={styles.tradeButtonText}>Trade {symbol}</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>PRICE HISTORY</Text>
        <MarketChart
          symbol={symbol}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          candles={candles}
          loading={loading}
          unavailable={unavailable}
        />

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>MARKET DEPTH</Text>
        </View>
        <View style={styles.statsGrid}>
          {marketCards.map((item) => (
            <View key={item.label} style={styles.statCell}>
              <Text style={styles.statLabel}>{item.label}</Text>
              <Text style={styles.statValue}>{item.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>INDICATORS</Text>
        </View>
        <View style={styles.statsGrid}>
          {indicatorCards.map((item) => (
            <View key={item.label} style={styles.statCell}>
              <Text style={styles.statLabel}>{item.label}</Text>
              <Text style={styles.statValue}>{item.value}</Text>
            </View>
          ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, paddingBottom: 26 },
  marketHeading: { flex: 1, minWidth: 0 },
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
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 18, gap: 12 },
  statCell: { width: '48%', backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.hairline, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  statLabel: { color: AppColors.faint, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  statValue: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 7, fontVariant: ['tabular-nums'] },
  tradeButton: { backgroundColor: AppColors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginTop: 18, marginBottom: 8 },
  tradeButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 24, marginBottom: 12 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});