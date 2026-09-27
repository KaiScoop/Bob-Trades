import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';
import { api } from '@/lib/api';
import { MarketChart } from '@/components/market-chart';
import { useLiveMarketChart } from '@/hooks/use-live-market-chart';

const RISKS = ['low', 'medium', 'high'];
export default function TradeScreen() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('1m');
  const [risk, setRisk] = useState('medium');
  const [indicators, setIndicators] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const { candles, ticker, loading, unavailable } = useLiveMarketChart(symbol, timeframe);

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
    api.startAgent({ symbol, risk, max_position_pct: 0.2, arm_live: false })
      .then(() => { setRunning(true); setMessage('Bob is running.'); })
      .catch(() => setMessage('Connect Bybit before starting Bob.'));
  };
  const stop = () => api.stopAgent().then(() => { setRunning(false); setMessage('Bob stopped.'); });
  const livePrice = Number(ticker?.lastPrice);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Configure Bob</Text>
        <Text style={styles.label}>ASSET</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assetList}>
          {(symbols.length ? symbols : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']).map((item) => (
            <Pressable key={item} onPress={() => setSymbol(item)} style={[styles.chip, symbol === item && styles.chipSelected]}>
              <Text style={styles.chipText}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>

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

        <Text style={styles.label}>RISK PROFILE</Text>
        <View style={styles.wrap}>
          {RISKS.map((item) => (
            <Pressable key={item} onPress={() => setRisk(item)} style={[styles.chip, risk === item && styles.chipSelected]}>
              <Text style={styles.chipText}>{item}</Text>
            </Pressable>
          ))}
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
  title: { color: '#fff', fontSize: 30, fontWeight: '700', marginTop: 16, marginBottom: 22 },
  label: { color: AppColors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginTop: 20, marginBottom: 10 },
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
  message: { color: AppColors.muted, marginTop: 18 },
  action: { backgroundColor: AppColors.accentEnd, alignItems: 'center', padding: 17, borderRadius: 12, marginTop: 20 },
  stop: { backgroundColor: AppColors.danger },
  actionText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
