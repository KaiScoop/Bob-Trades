import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppText as Text } from '@/components/app-text';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/theme';
import { cryptoLogoUrl } from '@/constants/crypto';
import { ConnectBybitModal } from '@/components/connect-bybit-modal';
import { api, subscribeMarketPrices, type BrokerStatus, type MarketTicker, type Portfolio } from '@/lib/api';
import { loadWatchlist, saveWatchlist } from '@/lib/watchlist';

const ASSET_NAMES: Record<string, string> = {
  BTCUSDT: 'Bitcoin',
  ETHUSDT: 'Ethereum',
  SOLUSDT: 'Solana',
  BNBUSDT: 'BNB',
  XRPUSDT: 'XRP',
  ADAUSDT: 'Cardano',
  LINKUSDT: 'Chainlink',
};

type NetworkMode = 'testnet' | 'mainnet';

function assetName(symbol: string) {
  return ASSET_NAMES[symbol] ?? symbol.replace('USDT', '');
}

function formatPrice(value: string | number | undefined) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0
    ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 8 })}`
    : '--';
}

function dailyChange(prices: Record<string, MarketTicker>, symbol: string) {
  const value = Number(prices[symbol]?.price24hPcnt);
  return Number.isFinite(value) ? value : null;
}

export default function HomeScreen() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [broker, setBroker] = useState<BrokerStatus | null>(null);
  const [username, setUsername] = useState('');
  const [userId, setUserId] = useState('');
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchlistError, setWatchlistError] = useState('');
  const [sparklineData, setSparklineData] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectMode, setConnectMode] = useState<NetworkMode>('testnet');
  const [showAllMarkets, setShowAllMarkets] = useState(false);
  const [showMovers, setShowMovers] = useState(false);
  const [prices, setPrices] = useState<Record<string, MarketTicker>>({});

  useEffect(() => {
    let active = true;
    const restore = async () => {
      const profile = await api.getProfile().catch(() => null);
      if (!active) return;
      if (!profile?.username) {
        router.replace('/onboarding');
        return;
      }
      setUsername(profile.username);
      setUserId(profile.user_id);
      setSessionReady(true);
    };
    restore();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    loadWatchlist(userId)
      .then((savedSymbols) => { if (active) setWatchlist(savedSymbols); })
      .catch(() => { if (active) setWatchlistError('Your watchlist could not be loaded.'); });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (!sessionReady) return;
    let active = true;
    Promise.allSettled([api.getMarkets(), api.getPortfolio(), api.getBrokerStatus()])
      .then(([marketsResult, portfolioResult, brokerResult]) => {
        if (!active) return;
        if (marketsResult.status === 'fulfilled') {
          const availableSymbols = marketsResult.value.symbols;
          setSymbols(availableSymbols);
          void Promise.allSettled(availableSymbols.map(async (symbol) => {
            const result = await api.getCandles(symbol, '1m');
            return [symbol, result.candles.slice(-30).map((candle) => candle.close)] as const;
          })).then((candleResults) => {
            if (!active) return;
            setSparklineData(Object.fromEntries(candleResults.flatMap((result) => (
              result.status === 'fulfilled' ? [result.value] : []
            ))));
          });
        } else {
          setError(true);
        }
        if (portfolioResult.status === 'fulfilled') setPortfolio(portfolioResult.value);
        if (brokerResult.status === 'fulfilled') setBroker(brokerResult.value);
        else setBroker({ connected: false, mode: null, balance: 0 });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sessionReady]);

  useEffect(() => {
    if (!sessionReady || symbols.length === 0) return;
    return subscribeMarketPrices(symbols, setPrices);
  }, [sessionReady, symbols]);

  const toggleWatchlist = (symbol: string) => {
    if (!userId) return;
    const previousWatchlist = watchlist;
    const nextWatchlist = watchlist.includes(symbol)
      ? watchlist.filter((item) => item !== symbol)
      : [...watchlist, symbol];
    setWatchlist(nextWatchlist);
    setWatchlistError('');
    void saveWatchlist(userId, nextWatchlist).catch(() => {
      setWatchlist(previousWatchlist);
      setWatchlistError('Your watchlist could not be saved. Try again.');
    });
  };

  const openNetwork = (mode: NetworkMode) => {
    if (broker?.mode === mode) return;
    setConnectMode(mode);
    setConnectOpen(true);
  };

  if (!sessionReady) return <View style={styles.container} />;

  const watchlistSymbols = watchlist.filter((symbol) => symbols.includes(symbol));
  const orderedSymbols = showMovers
    ? [...symbols].sort((left, right) => Math.abs(dailyChange(prices, right) ?? 0) - Math.abs(dailyChange(prices, left) ?? 0))
    : symbols;
  const visibleSymbols = showAllMarkets ? orderedSymbols : orderedSymbols.slice(0, 4);
  const activeMode: NetworkMode = broker?.mode === 'mainnet' ? 'mainnet' : 'testnet';

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.mark}><View style={styles.markPill} /><View style={styles.markPill} /></View>
            <View><Text style={styles.eyebrow}>BOB TRADES</Text><Text style={styles.greeting}>Hey, {username}</Text></View>
            <NetworkSwitch
              mode={activeMode}
              onToggle={() => openNetwork(activeMode === 'mainnet' ? 'testnet' : 'mainnet')}
            />
          </View>
          <Text style={styles.sectionLabel}>PORTFOLIO</Text>
          <View style={styles.portfolioCard}>
            <Text style={styles.cardMuted}>Available balance</Text>
            <Text style={styles.balance}>{portfolio ? `$${portfolio.balance.toFixed(2)}` : '--'}</Text>
            <Text style={styles.asset}>{portfolio?.asset ?? 'USDT'}</Text>
          </View>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Watchlist</Text>
            <Text style={styles.muted}>{watchlistSymbols.length} saved</Text>
          </View>
          {watchlistSymbols.length ? (
            <View style={styles.marketGrid}>
              {watchlistSymbols.map((symbol) => (
                <MarketCard
                  key={`watch-${symbol}`}
                  symbol={symbol}
                  price={prices[symbol]?.lastPrice}
                  change={dailyChange(prices, symbol)}
                  sparkline={sparklineData[symbol] ?? []}
                  isSaved
                  onToggleSaved={() => toggleWatchlist(symbol)}
                  onOpen={() => router.push({ pathname: '/market/[symbol]', params: { symbol } })}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyWatchlist}>Star an asset in Markets to add it to your watchlist.</Text>
          )}
          {watchlistError ? <Text style={styles.watchlistError}>{watchlistError}</Text> : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Markets</Text>
            <View style={styles.marketActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: showMovers }}
                onPress={() => setShowMovers((current) => !current)}
                style={[styles.moversButton, showMovers && styles.moversButtonActive]}>
                <Text style={[styles.moversText, showMovers && styles.moversTextActive]}>Movers</Text>
              </Pressable>
              {symbols.length > 4 ? (
                <Pressable accessibilityRole="button" onPress={() => setShowAllMarkets((current) => !current)}>
                  <Text style={styles.seeAll}>{showAllMarkets ? 'Show less' : 'See all'}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          {loading ? <ActivityIndicator color={AppColors.accentEnd} style={styles.loader} /> : error ? (
            <Text style={styles.muted}>Markets are warming up. Pull to try again.</Text>
          ) : (
            <View style={styles.marketGrid}>
              {visibleSymbols.map((symbol) => (
                <MarketCard
                  key={`market-${symbol}`}
                  symbol={symbol}
                  price={prices[symbol]?.lastPrice}
                  change={dailyChange(prices, symbol)}
                  sparkline={sparklineData[symbol] ?? []}
                  isSaved={watchlist.includes(symbol)}
                  onToggleSaved={() => toggleWatchlist(symbol)}
                  onOpen={() => router.push({ pathname: '/market/[symbol]', params: { symbol } })}
                />
              ))}
            </View>
          )}
          {!loading && !broker?.connected ? (
            <Pressable accessibilityRole="button" onPress={() => openNetwork('testnet')} style={styles.connectBanner}>
              <Text style={styles.connectTitle}>Connect Bybit</Text>
              <Text style={styles.cardMuted}>Connect your account to let Bob trade safely.</Text>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        <ConnectBybitModal
          key={connectMode}
          visible={connectOpen}
          initialMode={connectMode}
          onClose={() => setConnectOpen(false)}
          onConnected={(connection) => {
            setBroker(connection);
            setPortfolio({ mode: connection.mode ?? 'testnet', balance: connection.balance, asset: 'USDT' });
          }}
        />
      </SafeAreaView>
    </View>
  );
}

function NetworkSwitch({ mode, onToggle }: { mode: NetworkMode; onToggle: () => void }) {
  const isMainnet = mode === 'mainnet';
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Trading network"
      accessibilityState={{ checked: isMainnet }}
      onPress={onToggle}
      style={styles.networkTrack}>
      <View style={[styles.networkKnob, isMainnet ? styles.networkKnobMain : styles.networkKnobTest]}>
        <Text style={[styles.networkText, isMainnet && styles.networkTextMain]}>
          {isMainnet ? 'MAIN' : 'TEST'}
        </Text>
      </View>
    </Pressable>
  );
}

function MarketCard({
  symbol,
  price,
  change,
  sparkline,
  isSaved,
  onToggleSaved,
  onOpen,
}: {
  symbol: string;
  price?: string;
  change: number | null;
  sparkline: number[];
  isSaved: boolean;
  onToggleSaved: () => void;
  onOpen: () => void;
}) {
  const changeColor = change === null
    ? AppColors.muted
    : change < 0 ? AppColors.danger : AppColors.success;
  const formattedChange = change === null
    ? '--'
    : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`;
  const logo = cryptoLogoUrl(symbol);

  return (
    <View style={styles.marketCard}>
      <View style={styles.marketCardHeader}>
        <View style={styles.coin}>
          {logo ? (
            <Image source={logo} style={styles.coinImage} contentFit="contain" accessibilityLabel={`${assetName(symbol)} logo`} />
          ) : (
            <Text style={styles.coinText}>{symbol.slice(0, 1)}</Text>
          )}
        </View>
        <View style={styles.marketName}>
          <Text numberOfLines={1} style={styles.assetName}>{assetName(symbol)}</Text>
          <Text style={styles.symbol}>{symbol.replace('USDT', '')} / USDT</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${isSaved ? 'Remove' : 'Add'} ${assetName(symbol)} ${isSaved ? 'from' : 'to'} watchlist`}
          onPress={onToggleSaved}
          style={styles.watchButton}>
          <MaterialCommunityIcons name={isSaved ? 'star' : 'star-outline'} size={19} color={isSaved ? AppColors.accentEnd : AppColors.muted} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${assetName(symbol)} market details`} onPress={onOpen}>
        <View style={styles.marketCardQuote}>
          <Text numberOfLines={1} style={styles.marketPrice}>{formatPrice(price)}</Text>
          <View style={styles.marketCardChartRow}>
            <Text style={[styles.marketChange, { color: changeColor }]}>{formattedChange}</Text>
            <Sparkline values={sparkline} color={change !== null && change < 0 ? AppColors.danger : AppColors.accentEnd} />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <View style={styles.sparklineEmpty} />;

  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * SPARKLINE_WIDTH,
    y: SPARKLINE_HEIGHT - 3 - ((value - min) / range) * (SPARKLINE_HEIGHT - 6),
  }));

  return (
    <View accessibilityLabel="Last 30 one-minute candles" style={styles.sparkline}>
      {points.slice(1).map((end, index) => {
        const start = points[index];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        return (
          <View
            key={index}
            style={[
              styles.sparklineSegment,
              {
                left: start.x,
                top: start.y - 1,
                width: Math.sqrt(dx * dx + dy * dy),
                backgroundColor: color,
                transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const SPARKLINE_WIDTH = 82;
const SPARKLINE_HEIGHT = 28;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  safeArea: { flex: 1, paddingHorizontal: 20 },
  content: { paddingBottom: 48, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, paddingBottom: 16 },
  mark: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  markPill: { width: 5, height: 16, borderRadius: 4, backgroundColor: '#000' },
  eyebrow: { color: AppColors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  greeting: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 2 },
  networkTrack: { marginLeft: 'auto', width: 84, height: 34, borderRadius: 17, padding: 3, backgroundColor: AppColors.raised, borderWidth: 1, borderColor: AppColors.hairline, justifyContent: 'center' },
  networkKnob: { width: 48, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  networkKnobTest: { alignSelf: 'flex-start', backgroundColor: '#24242A' },
  networkKnobMain: { alignSelf: 'flex-end', backgroundColor: AppColors.accentEnd },
  networkText: { color: AppColors.muted, fontSize: 10, fontWeight: '700' },
  networkTextMain: { color: '#FFFFFF' },
  sectionLabel: { color: AppColors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  portfolioCard: { borderRadius: 12, padding: 20, minHeight: 142, backgroundColor: AppColors.accentEnd },
  cardMuted: { color: '#C7D2FE', fontSize: 13 },
  balance: { color: '#fff', fontSize: 36, fontWeight: '700', marginTop: 12 },
  asset: { color: '#C7D2FE', fontSize: 13, marginTop: 4 },
  connectBanner: { backgroundColor: AppColors.surface, borderColor: AppColors.hairline, borderWidth: 1, borderRadius: 8, padding: 16, position: 'relative', marginTop: 8 },
  connectTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 5 },
  arrow: { position: 'absolute', right: 18, top: 22, color: '#fff', fontSize: 28 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, minHeight: 28 },
  sectionTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  marketActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  moversButton: { minHeight: 28, justifyContent: 'center', paddingHorizontal: 9, borderRadius: 6, backgroundColor: AppColors.surface },
  moversButtonActive: { backgroundColor: AppColors.accentEnd },
  moversText: { color: AppColors.muted, fontSize: 11, fontWeight: '600' },
  moversTextActive: { color: '#FFFFFF' },
  seeAll: { color: AppColors.accentEnd, fontSize: 12, fontWeight: '600' },
  muted: { color: AppColors.muted, fontSize: 13 },
  emptyWatchlist: { color: AppColors.muted, fontSize: 13, paddingVertical: 8 },
  watchlistError: { color: AppColors.danger, fontSize: 12 },
  marketPrice: { color: '#fff', fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  marketChange: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'], marginTop: 4 },
  loader: { marginTop: 12 },
  marketGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  marketCard: { flexBasis: '48%', flexGrow: 1, minWidth: 0, maxWidth: 240, padding: 12, borderRadius: 8, backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.hairline },
  marketCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  coin: { width: 30, height: 30, borderRadius: 15, backgroundColor: AppColors.raised, alignItems: 'center', justifyContent: 'center' },
  coinText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  coinImage: { width: 23, height: 23 },
  marketName: { flex: 1, minWidth: 0 },
  assetName: { color: '#FFFFFF', fontWeight: '600', fontSize: 12 },
  symbol: { color: AppColors.muted, fontSize: 10, marginTop: 3 },
  watchButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  marketCardQuote: { gap: 8, marginTop: 12 },
  marketCardChartRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  sparkline: { width: SPARKLINE_WIDTH, height: SPARKLINE_HEIGHT, overflow: 'hidden' },
  sparklineEmpty: { width: SPARKLINE_WIDTH, height: SPARKLINE_HEIGHT, borderBottomWidth: 1, borderColor: AppColors.hairline },
  sparklineSegment: { position: 'absolute', height: 2, borderRadius: 1 },
});
