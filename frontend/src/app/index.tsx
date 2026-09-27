import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/theme';
import { cryptoLogoUrl } from '@/constants/crypto';
import { api, type BrokerStatus, type Portfolio } from '@/lib/api';
import { getAccessToken, storeMagicLinkFromUrl } from '@/lib/secure';
import * as Linking from 'expo-linking';

export default function HomeScreen() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [broker, setBroker] = useState<BrokerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const restore = async () => {
      const browserUrl = typeof window !== 'undefined' ? window.location.href : null;
      await storeMagicLinkFromUrl(browserUrl ?? await Linking.getInitialURL());
      const token = await getAccessToken();
      if (!token) {
        router.replace('/welcome');
        return;
      }
      await api.getSession();
      const profile = await api.getProfile().catch(() => null);
      if (!profile?.username) {
        router.replace('/onboarding');
        return;
      }
      setSessionReady(true);
    };
    restore();
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    Promise.allSettled([api.getMarkets(), api.getPortfolio(), api.getBrokerStatus()])
      .then(([marketsResult, portfolioResult, brokerResult]) => {
        if (marketsResult.status === 'fulfilled') setSymbols(marketsResult.value.symbols);
        else setError(true);
        if (portfolioResult.status === 'fulfilled') setPortfolio(portfolioResult.value);
        if (brokerResult.status === 'fulfilled') setBroker(brokerResult.value);
        else setBroker({ connected: false, mode: null, balance: 0 });
      })
      .finally(() => setLoading(false));
  }, [sessionReady]);

  if (!sessionReady) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.mark}><View style={styles.markPill} /><View style={styles.markPill} /></View>
            <View><Text style={styles.eyebrow}>BOB TRADES</Text><Text style={styles.greeting}>Good morning, Bob</Text></View>
            <View style={styles.modePill}><Text style={styles.modeText}>{broker?.mode ?? 'offline'}</Text></View>
          </View>
          <Text style={styles.sectionLabel}>PORTFOLIO</Text>
          <LinearGradient colors={[AppColors.accent, AppColors.accentEnd]} style={styles.portfolioCard}>
            <Text style={styles.cardMuted}>Available balance</Text>
            <Text style={styles.balance}>{portfolio ? `$${portfolio.balance.toFixed(2)}` : '--'}</Text>
            <Text style={styles.asset}>{portfolio?.asset ?? 'USDT'}</Text>
          </LinearGradient>
          {!loading && !broker?.connected && <Pressable style={styles.connectBanner}><Text style={styles.connectTitle}>Connect Bybit</Text><Text style={styles.cardMuted}>Connect your account to let Bob trade safely.</Text><Text style={styles.arrow}>›</Text></Pressable>}
          <View style={styles.sectionHeader}><Text style={styles.sectionLabel}>MARKETS</Text><Text style={styles.muted}>{symbols.length} tracked</Text></View>
          {loading ? <ActivityIndicator color={AppColors.accentEnd} style={styles.loader} /> : error ? <Text style={styles.muted}>Markets are warming up. Pull to try again.</Text> : symbols.map((symbol) => <View key={symbol} style={styles.marketRow}><View style={styles.coin}>{cryptoLogoUrl(symbol) ? <Image source={cryptoLogoUrl(symbol) as string} style={styles.coinImage} contentFit="contain" accessibilityLabel={`${symbol} logo`} /> : <Text style={styles.coinText}>{symbol.slice(0, 1)}</Text>}</View><View style={styles.marketName}><Text style={styles.symbol}>{symbol}</Text><Text style={styles.muted}>Spot market</Text></View><Text style={styles.muted}>--</Text></View>)}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  safeArea: { flex: 1, paddingHorizontal: 20 },
  content: { paddingBottom: 48, gap: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, paddingBottom: 24 },
  mark: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  markPill: { width: 5, height: 16, borderRadius: 4, backgroundColor: '#000' },
  eyebrow: { color: AppColors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  greeting: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 2 },
  modePill: { marginLeft: 'auto', borderColor: AppColors.hairline, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  modeText: { color: AppColors.muted, fontSize: 11, textTransform: 'capitalize' },
  sectionLabel: { color: AppColors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  portfolioCard: { borderRadius: 16, padding: 22, minHeight: 145 },
  cardMuted: { color: '#C7D2FE', fontSize: 13 },
  balance: { color: '#fff', fontSize: 36, fontWeight: '700', marginTop: 12 },
  asset: { color: '#C7D2FE', fontSize: 13, marginTop: 4 },
  connectBanner: { backgroundColor: AppColors.surface, borderColor: AppColors.hairline, borderWidth: 1, borderRadius: 16, padding: 18, position: 'relative' },
  connectTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 5 },
  arrow: { position: 'absolute', right: 18, top: 22, color: '#fff', fontSize: 28 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  muted: { color: AppColors.muted, fontSize: 13 },
  loader: { marginTop: 22 },
  marketRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomColor: AppColors.hairline, borderBottomWidth: 1 },
  coin: { width: 38, height: 38, borderRadius: 19, backgroundColor: AppColors.raised, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  coinText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  coinImage: { width: 28, height: 28 },
  marketName: { flex: 1 },
  symbol: { color: '#fff', fontWeight: '700', fontSize: 15, marginBottom: 3 },
});
