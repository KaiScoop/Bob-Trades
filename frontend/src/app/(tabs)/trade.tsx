import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '@/components/app-text';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';
import { NetworkSwitch } from '@/components/network-switch';
import { api } from '@/lib/api';
import { MarketChart } from '@/components/market-chart';
import { useLiveMarketChart } from '@/hooks/use-live-market-chart';

const RISKS = ['low', 'medium', 'high'];
export default function TradeScreen() {
  const { symbol: symbolParam } = useLocalSearchParams<{ symbol?: string }>();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('1m');
  const [risk, setRisk] = useState('medium');
  const [capitalPct, setCapitalPct] = useState(20);
  const [indicators, setIndicators] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const { candles, ticker, loading, unavailable } = useLiveMarketChart(symbol, timeframe);

  useEffect(() => {
    if (symbolParam) {
      const next = String(symbolParam).toUpperCase();
      if (next) setSymbol(next);
    }
  }, [symbolParam]);

  useEffect(() => {
    api.getMarkets()
      .then((result) => {
        setSymbols(result.symbols);
        if (result.symbols[0]) setSymbol(result.symbols[0]);
      })
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    api.getIndicators(symbol, timeframe).then((result) => setIndicators(result.indicators)).catch(() => setIndicators({}));
  }, [symbol, timeframe]);

  const start = () => {
    setMessage('');
    api.startAgent({ symbol, risk, max_position_pct: capitalPct / 100, arm_live: false })
      .then(() => { setRunning(true); setMessage('Bob is running.'); })
      .catch(() => setMessage('Connect Bybit before starting Bob.'));
  };
  const stop = () => api.stopAgent().then(() => { setRunning(false); setMessage('Bob stopped.'); });
  const livePrice = Number(ticker?.lastPrice);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>Configure Bob</Text>
            <Text style={styles.subtitle}>Capital allocation and risk profile</Text>
          </View>
          <NetworkSwitch />
        </View>

        <View style={styles.panel}>
          <Text style={styles.label}>ASSET</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assetList}>
            {(symbols.length ? symbols : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']).map((item) => (
              <Pressable key={item} onPress={() => setSymbol(item)} style={[styles.chip, symbol === item && styles.chipSelected]}>
                <Text style={styles.chipText}>{item}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.chartHeading}>
          <View>
            <Text style={styles.chartSymbol}>{symbol}</Text>
            <Text style={styles.chartSubtitle}>{busy ? 'Loading markets…' : 'SPOT MARKET'}</Text>
          </View>
          <Text style={styles.price}>
            {Number.isFinite(livePrice) && livePrice > 0 ? `$${livePrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}` : '--'}
          </Text>
        </View>
        <MarketChart
          symbol={symbol}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          candles={candles}
          loading={loading}
          unavailable={unavailable}
        />
        <View style={styles.indicatorRow}>
          <Text style={styles.muted}>RSI14 <Text style={styles.indicatorValue}>{indicators.rsi14?.toFixed(1) ?? '--'}</Text></Text>
          <Text style={styles.muted}>EMA20 <Text style={styles.indicatorValue}>{indicators.ema20?.toFixed(2) ?? '--'}</Text></Text>
        </View>

        <View style={styles.panel}>
          <View style={styles.allocationHeader}>
            <Text style={styles.label}>CAPITAL PER TRADE</Text>
            <Text style={styles.allocationValue}>{capitalPct}%</Text>
          </View>
          <Slider
            accessibilityLabel="Capital allocated per trade"
            disabled={running}
            minimumValue={1}
            maximumValue={100}
            step={1}
            value={capitalPct}
            onValueChange={setCapitalPct}
            minimumTrackTintColor={AppColors.accentEnd}
            maximumTrackTintColor={AppColors.hairline}
            thumbTintColor="#fff"
            style={styles.slider}
          />
          <View style={styles.allocationBounds}>
            <Text style={styles.muted}>1%</Text>
            <Text style={styles.muted}>100%</Text>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.label}>RISK PROFILE</Text>
          <View style={styles.wrap}>
            {RISKS.map((item) => (
              <Pressable key={item} onPress={() => setRisk(item)} style={[styles.chip, risk === item && styles.chipSelected]}>
                <Text style={styles.chipText}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <Pressable onPress={running ? stop : start} style={[styles.action, running && styles.stop]}>
          <Text style={styles.actionText}>{running ? 'Stop Bob' : 'Start Bob'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background, paddingHorizontal: 20 },
  content: { paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 16, marginBottom: 22 },
  titleWrap: { flex: 1 },
  title: { color: '#fff', fontSize: 27, fontWeight: '700' },
  subtitle: { color: AppColors.muted, fontSize: 12, marginTop: 4 },
  label: { color: AppColors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginTop: 20, marginBottom: 10 },
  panel: { backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.hairline, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, marginTop: 14 },
  assetList: { gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderColor: AppColors.hairline, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipSelected: { backgroundColor: AppColors.accent, borderColor: AppColors.accentEnd },
  chipText: { color: '#fff', fontSize: 13, textTransform: 'capitalize' },
  chartHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 12 },
  chartSymbol: { color: '#fff', fontSize: 17, fontWeight: '700' },
  chartSubtitle: { color: AppColors.faint, fontSize: 9, fontWeight: '700', marginTop: 4, letterSpacing: 1 },
  price: { color: '#fff', fontSize: 19, fontWeight: '700', fontVariant: ['tabular-nums'] },
  indicatorRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingBottom: 16, borderBottomWidth: 1, borderColor: AppColors.hairline },
  muted: { color: AppColors.muted, fontSize: 12 },
  indicatorValue: { color: '#fff', fontWeight: '600' },
  allocationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  allocationValue: { color: '#fff', fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  slider: { width: '100%', height: 36, marginTop: 2 },
  allocationBounds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2 },
  message: { color: AppColors.muted, marginTop: 18 },
  action: { backgroundColor: AppColors.accentEnd, alignItems: 'center', padding: 17, borderRadius: 12, marginTop: 20 },
  stop: { backgroundColor: AppColors.danger },
  actionText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
