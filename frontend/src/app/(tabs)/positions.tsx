import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';
import { api, type Position } from '@/lib/api';

function getLoadErrorMessage(error: unknown) {
  const isMissingBroker = error instanceof Error
    && error.message.includes('API 404')
    && (error.message.includes('/positions') || error.message.includes('/orders'));
  return isMissingBroker
    ? 'Connect your Bybit account to view positions and orders.'
    : 'Could not load positions and orders. Try again.';
}

export default function PositionsScreen() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const load = () => {
    setBusy(true);
    setError('');
    Promise.all([api.getPositions(), api.getOrders()])
      .then(([positionsResponse, ordersResponse]) => {
      setPositions(positionsResponse.positions);
      setOrders(ordersResponse.orders);
      })
      .catch((requestError: unknown) => setError(getLoadErrorMessage(requestError)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    let active = true;
    Promise.all([api.getPositions(), api.getOrders()])
      .then(([positionsResponse, ordersResponse]) => {
        if (!active) return;
        setPositions(positionsResponse.positions);
        setOrders(ordersResponse.orders);
      })
      .catch((requestError: unknown) => {
        if (active) setError(getLoadErrorMessage(requestError));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, []);

  return <SafeAreaView style={styles.container}><Text style={styles.title}>Positions</Text><View style={styles.tabs}><Pressable onPress={() => setTab('active')} style={[styles.tab, tab === 'active' && styles.selected]}><Text style={styles.tabText}>Active</Text></Pressable><Pressable onPress={() => setTab('history')} style={[styles.tab, tab === 'history' && styles.selected]}><Text style={styles.tabText}>History</Text></Pressable></View>{busy ? <ActivityIndicator color={AppColors.accentEnd} /> : error ? <View style={styles.empty}><Text style={styles.emptyTitle}>Connect Bybit</Text><Text style={styles.muted}>{error}</Text><Pressable onPress={load}><Text style={styles.retry}>Retry</Text></Pressable></View> : <ScrollView>{tab === 'active' ? positions.length ? positions.map((position) => <View key={position.symbol} style={styles.row}><View><Text style={styles.symbol}>{position.symbol}</Text><Text style={styles.muted}>{position.side} · {position.size}</Text></View><Pressable onPress={() => api.closePosition(position.symbol).then(load)} style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable></View>) : <View style={styles.empty}><Text style={styles.emptyTitle}>No open positions.</Text><Text style={styles.muted}>Bob hasn’t opened anything yet.</Text></View> : orders.length ? orders.map((order, index) => <View key={index} style={styles.row}><Text style={styles.symbol}>{String(order.symbol ?? 'Order')}</Text><Text style={styles.muted}>{String(order.status ?? order.orderStatus ?? 'Recent')}</Text></View>) : <View style={styles.empty}><Text style={styles.emptyTitle}>No recent orders.</Text></View>}</ScrollView>}</SafeAreaView>;
}
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: AppColors.background, padding: 20 }, title: { color: '#fff', fontSize: 32, fontWeight: '700', marginTop: 16 }, tabs: { flexDirection: 'row', backgroundColor: AppColors.surface, borderRadius: 999, padding: 4, marginVertical: 24 }, tab: { flex: 1, alignItems: 'center', padding: 11, borderRadius: 999 }, selected: { backgroundColor: AppColors.raised }, tabText: { color: '#fff', fontWeight: '600' }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomColor: AppColors.hairline, borderBottomWidth: 1 }, symbol: { color: '#fff', fontSize: 16, fontWeight: '700' }, muted: { color: AppColors.muted, fontSize: 13, marginTop: 5 }, close: { borderColor: AppColors.danger, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }, closeText: { color: AppColors.danger, fontWeight: '700' }, empty: { alignItems: 'center', marginTop: 120 }, emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700' }, retry: { color: '#8EA8FF', fontWeight: '700', marginTop: 16 } });
