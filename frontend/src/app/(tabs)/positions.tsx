import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '@/components/app-text';
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
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [busy, setBusy] = useState(true);
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null);
  const [closeError, setCloseError] = useState('');
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
  const closePosition = async (position: Position) => {
    setSelectedPosition(position);
    setClosingSymbol(position.symbol);
    setCloseError('');
    try {
      await api.closePosition(position.symbol);
      setSelectedPosition(null);
      load();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Could not close this position.';
      setCloseError(message.replace(/^API \d+ POST \/positions\/[^:]+:\s*/, '') || 'Could not close this position.');
    } finally {
      setClosingSymbol(null);
    }
  };

  const extraDetails = selectedPosition
    ? Object.entries(selectedPosition).filter(([key, value]) => !['symbol', 'side', 'size'].includes(key) && value !== null && value !== undefined)
    : [];

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

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Positions</Text>
      <View style={styles.tabs}>
        <Pressable onPress={() => setTab('active')} style={[styles.tab, tab === 'active' && styles.selected]}><Text style={styles.tabText}>Active</Text></Pressable>
        <Pressable onPress={() => setTab('history')} style={[styles.tab, tab === 'history' && styles.selected]}><Text style={styles.tabText}>History</Text></Pressable>
      </View>
      {busy ? <ActivityIndicator color={AppColors.accentEnd} /> : error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Connect Bybit</Text>
          <Text style={styles.muted}>{error}</Text>
          <Pressable onPress={load}><Text style={styles.retry}>Retry</Text></Pressable>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {tab === 'active' ? positions.length ? positions.map((position) => (
            <View key={position.symbol} style={styles.row}>
              <Pressable accessibilityRole="button" accessibilityLabel={`View ${position.symbol} position details`} onPress={() => { setSelectedPosition(position); setCloseError(''); }} style={styles.positionSummary}>
                <Text style={styles.symbol}>{position.symbol}</Text>
                <Text style={styles.muted}>{position.side} · {position.size}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={closingSymbol === position.symbol} onPress={() => closePosition(position)} style={styles.close}>
                <Text style={styles.closeText}>{closingSymbol === position.symbol ? 'Closing…' : 'Close'}</Text>
              </Pressable>
            </View>
          )) : (
            <View style={styles.empty}><Text style={styles.emptyTitle}>No open positions.</Text><Text style={styles.muted}>Bob hasn’t opened anything yet.</Text></View>
          ) : orders.length ? orders.map((order, index) => (
            <View key={String(order.orderId ?? order.id ?? index)} style={styles.row}>
              <Text style={styles.symbol}>{String(order.symbol ?? 'Order')}</Text>
              <Text style={styles.muted}>{String(order.status ?? order.orderStatus ?? 'Recent')}</Text>
            </View>
          )) : (
            <View style={styles.empty}><Text style={styles.emptyTitle}>No recent orders.</Text></View>
          )}
        </ScrollView>
      )}

      <Modal transparent animationType="slide" visible={selectedPosition !== null} onRequestClose={() => setSelectedPosition(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalEyebrow}>POSITION DETAILS</Text>
                <Text style={styles.modalTitle}>{selectedPosition?.symbol}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close position details" onPress={() => setSelectedPosition(null)} style={styles.dismiss}>
                <Text style={styles.dismissText}>×</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.detailList}>
              <DetailRow label="Direction" value={selectedPosition?.side} />
              <DetailRow label="Size" value={selectedPosition?.size} />
              {extraDetails.map(([key, value]) => <DetailRow key={key} label={formatLabel(key)} value={value} />)}
            </ScrollView>
            {closeError ? <Text accessibilityRole="alert" style={styles.closeError}>{closeError}</Text> : null}
            {selectedPosition ? (
              <Pressable accessibilityRole="button" disabled={closingSymbol === selectedPosition.symbol} onPress={() => closePosition(selectedPosition)} style={[styles.closeAction, closingSymbol === selectedPosition.symbol && styles.disabled]}>
                <Text style={styles.closeActionText}>{closingSymbol === selectedPosition.symbol ? 'Closing position…' : 'Close Position'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  const displayValue = typeof value === 'number'
    ? value.toLocaleString(undefined, { maximumFractionDigits: 8 })
    : typeof value === 'string' || typeof value === 'boolean'
      ? String(value)
      : JSON.stringify(value);
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text selectable style={styles.detailValue}>{displayValue}</Text></View>;
}

function formatLabel(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background, padding: 20 },
  title: { color: '#fff', fontSize: 32, fontWeight: '700', marginTop: 16 },
  tabs: { flexDirection: 'row', backgroundColor: AppColors.surface, borderRadius: 8, padding: 4, marginVertical: 24 },
  tab: { flex: 1, alignItems: 'center', padding: 11, borderRadius: 6 },
  selected: { backgroundColor: AppColors.raised },
  tabText: { color: '#fff', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomColor: AppColors.hairline, borderBottomWidth: 1 },
  positionSummary: { flex: 1, paddingVertical: 2 },
  symbol: { color: '#fff', fontSize: 16, fontWeight: '700' },
  muted: { color: AppColors.muted, fontSize: 13, marginTop: 5 },
  close: { borderColor: AppColors.danger, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  closeText: { color: AppColors.danger, fontWeight: '700' },
  empty: { alignItems: 'center', marginTop: 120 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  retry: { color: '#8EA8FF', fontWeight: '700', marginTop: 16 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.72)' },
  modal: { maxHeight: '82%', backgroundColor: AppColors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderColor: AppColors.hairline, borderWidth: 1, padding: 20, paddingBottom: 28 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, borderBottomWidth: 1, borderColor: AppColors.hairline },
  modalEyebrow: { color: AppColors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  modalTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 5 },
  dismiss: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: AppColors.raised },
  dismissText: { color: '#fff', fontSize: 26, lineHeight: 28 },
  detailList: { flexGrow: 0, marginTop: 6 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: AppColors.hairline },
  detailLabel: { color: AppColors.muted, fontSize: 13, flex: 1 },
  detailValue: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'right', flex: 1 },
  closeError: { color: AppColors.danger, fontSize: 13, marginTop: 14 },
  closeAction: { alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: 16, backgroundColor: AppColors.danger, borderRadius: 10 },
  closeActionText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.55 },
});
