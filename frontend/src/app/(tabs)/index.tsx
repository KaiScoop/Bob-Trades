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
import { NetworkSwitch } from '@/components/network-switch';
import { api, subscribeMarketPrices, type BrokerStatus, type MarketTicker } from '@/lib/api';
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

function trendColor(change: number | null) {
  if (change === null) return AppColors.muted;
  return change < 0 ? AppColors.danger : AppColors.success;
}

export default function HomeScreen() {
  const [symbols, setSymbols] = useState<string[]>([]);
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
    Promise.allSettled([api.getMarkets(), api.getBrokerStatus()])
      .then(([marketsResult, brokerResult]) => {
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
  const topMovers = [...symbols]
    .filter((symbol) => dailyChange(prices, symbol) !== null)
    .sort((left, right) => Math.abs(dailyChange(prices, right) ?? 0) - Math.abs(dailyChange(prices, left) ?? 0))
    .slice(0, 3);
  const visibleSymbols = showAllMarkets ? symbols : symbols.slice(0, 4);
  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.mark}><View style={styles.markPill} /><View style={styles.markPill} /></View>
            <View><Text style={styles.eyebrow}>BOB TRADES</Text><Text style={styles.greeting}>Hey, {username}</Text></View>
            <NetworkSwitch />
          </View>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Watchlist</Text>
            <Text style={styles.muted}>{watchlistSymbols.length} saved</Text>
          </View>
          {watchlistSymbols.length ? (
            <View style={styles.watchlist}>
              {watchlistSymbols.map((symbol) => (
                <WatchlistRow
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
            <Text style={styles.sectionTitle}>Top Movers</Text>
            <Text style={styles.muted}>24h change</Text>
          </View>
          {loading ? (
            <ActivityIndicator color={AppColors.accentEnd} style={styles.loader} />
          ) : topMovers.length ? (
            <View style={styles.watchlist}>
              {topMovers.map((symbol) => (
                <WatchlistRow
                  key={`mover-${symbol}`}
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
          ) : (
            <Text style={styles.emptyWatchlist}>Live movers will appear when price data is available.</Text>
          )}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Markets</Text>
            <View style={styles.marketActions}>
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
              {visibleSymbols.map((symbol, index) => (
                <MarketCard
                  key={`market-${symbol}`}
                  symbol={symbol}
                  price={prices[symbol]?.lastPrice}
                  change={dailyChange(prices, symbol)}
                  sparkline={sparklineData[symbol] ?? []}
                  fullWidth={index === visibleSymbols.length - 1 && visibleSymbols.length % 2 === 1}
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
          }}
        />
      </SafeAreaView>
    </View>
  );
}

function MarketCard({
  symbol,
  price,
  change,
  sparkline,
  fullWidth = false,
  isSaved,
  onToggleSaved,
  onOpen,
}: {
  symbol: string;
  price?: string;
  change: number | null;
  sparkline: number[];
  fullWidth?: boolean;
  isSaved: boolean;
  onToggleSaved: () => void;
  onOpen: () => void;
}) {
  const changeColor = trendColor(change);
  const formattedChange = change === null
    ? '--'
    : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`;
  const logo = cryptoLogoUrl(symbol);

  return (
    <View style={[styles.marketCard, fullWidth && styles.marketCardFull]}>
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
            <Sparkline values={sparkline} color={changeColor} />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function WatchlistRow({
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
  const changeColor = trendColor(change);
  const formattedChange = change === null
    ? '--'
    : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`;
  const logo = cryptoLogoUrl(symbol);

  return (
    <View style={styles.watchlistRow}>
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.watchlistMain}>
        <View style={styles.coin}>
          {logo ? (
            <Image source={logo} style={styles.coinImage} contentFit="contain" accessibilityLabel={`${assetName(symbol)} logo`} />
          ) : (
            <Text style={styles.coinText}>{symbol.slice(0, 1)}</Text>
          )}
        </View>
        <View style={styles.watchlistName}>
          <Text numberOfLines={1} style={styles.assetName}>{assetName(symbol)}</Text>
          <Text style={styles.symbol}>{symbol.replace('USDT', '')} / USDT</Text>
        </View>
        <View style={styles.watchlistQuote}>
          <Text numberOfLines={1} style={styles.watchlistPrice}>{formatPrice(price)}</Text>
          <Text style={[styles.watchlistChange, { color: changeColor }]}>{formattedChange}</Text>
        </View>
        <Sparkline values={sparkline} color={changeColor} width={58} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${isSaved ? 'Remove' : 'Add'} ${assetName(symbol)} ${isSaved ? 'from' : 'to'} watchlist`}
        onPress={onToggleSaved}
        style={styles.watchButton}>
        <MaterialCommunityIcons name={isSaved ? 'star' : 'star-outline'} size={19} color={isSaved ? AppColors.accentEnd : AppColors.muted} />
      </Pressable>
    </View>
  );
}

function Sparkline({ values, color, width = SPARKLINE_WIDTH }: { values: number[]; color: string; width?: number }) {
  if (values.length < 2) return <View style={styles.sparklineEmpty} />;

  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * width,
    y: SPARKLINE_HEIGHT - 3 - ((value - min) / range) * (SPARKLINE_HEIGHT - 6),
  }));

  return (
    <View accessibilityLabel="Last 30 one-minute candles" style={[styles.sparkline, { width }]}>
      {points.slice(1).map((end, index) => {
        const start = points[index];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        return (
          <View
            key={index}
            style={[
              styles.sparklineSegment,
              {
                left: (start.x + end.x - length - 1) / 2,
                top: (start.y + end.y) / 2 - 1,
                width: length + 1,
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
  sectionLabel: { color: AppColors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  cardMuted: { color: '#C7D2FE', fontSize: 13 },
  connectBanner: { backgroundColor: AppColors.surface, borderColor: AppColors.hairline, borderWidth: 1, borderRadius: 8, padding: 16, position: 'relative', marginTop: 8 },
  connectTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 5 },
  arrow: { position: 'absolute', right: 18, top: 22, color: '#fff', fontSize: 28 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, minHeight: 28 },
  sectionTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  marketActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seeAll: { color: AppColors.accentEnd, fontSize: 12, fontWeight: '600' },
  muted: { color: AppColors.muted, fontSize: 13 },
  emptyWatchlist: { color: AppColors.muted, fontSize: 13, paddingVertical: 8 },
  watchlistError: { color: AppColors.danger, fontSize: 12 },
  watchlist: { gap: 0 },
  watchlistRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AppColors.hairline },
  watchlistMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  watchlistName: { flex: 1, minWidth: 55 },
  watchlistQuote: { alignItems: 'flex-end', minWidth: 66 },
  watchlistPrice: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  watchlistChange: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'], marginTop: 3 },
  marketPrice: { color: '#fff', fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  marketChange: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'], marginTop: 4 },
  loader: { marginTop: 12 },
  marketGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  marketCard: { flexBasis: '48%', flexGrow: 1, minWidth: 0, maxWidth: 240, padding: 12, borderRadius: 8, backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.hairline },
  marketCardFull: { flexBasis: '100%', flexGrow: 1, maxWidth: '100%' },
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
  sparkline: { height: SPARKLINE_HEIGHT, overflow: 'hidden' },
  sparklineEmpty: { width: SPARKLINE_WIDTH, height: SPARKLINE_HEIGHT, borderBottomWidth: 1, borderColor: AppColors.hairline },
  sparklineSegment: { position: 'absolute', height: 2, borderRadius: 1 },
});
