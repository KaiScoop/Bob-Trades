import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppText as Text } from '@/components/app-text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/theme';
import { NetworkSwitch } from '@/components/network-switch';
import { api, type OrderActivity, type OrderProduct, type OrderView } from '@/lib/api';

const PRODUCTS: { id: OrderProduct; label: string }[] = [
  { id: 'stocks', label: 'Stocks' },
  { id: 'spot', label: 'Spot' },
  { id: 'futures', label: 'Futures' },
  { id: 'options', label: 'Options' },
];

const VIEWS: { id: OrderView; label: string }[] = [
  { id: 'open', label: 'Open Orders' },
  { id: 'history', label: 'Order History' },
  { id: 'trades', label: 'Trade History' },
];

const ORDER_COLUMNS = [
  { key: 'symbol', label: 'Symbol', width: 118 },
  { key: 'side', label: 'Side', width: 76 },
  { key: 'orderType', label: 'Type', width: 94 },
  { key: 'qty', label: 'Quantity', width: 100 },
  { key: 'price', label: 'Price', width: 100 },
  { key: 'cumExecQty', label: 'Filled', width: 100 },
  { key: 'avgPrice', label: 'Avg. Price', width: 110 },
  { key: 'orderStatus', label: 'Status', width: 110 },
  { key: 'createdTime', label: 'Created', width: 170 },
];

const TRADE_COLUMNS = [
  { key: 'symbol', label: 'Symbol', width: 118 },
  { key: 'side', label: 'Side', width: 76 },
  { key: 'execType', label: 'Type', width: 94 },
  { key: 'execQty', label: 'Quantity', width: 100 },
  { key: 'execPrice', label: 'Price', width: 100 },
  { key: 'execValue', label: 'Value', width: 110 },
  { key: 'execFee', label: 'Fee', width: 100 },
  { key: 'execTime', label: 'Executed', width: 170 },
];

type OrderColumn = typeof ORDER_COLUMNS[number];

function getRecordKey(record: Record<string, unknown>, index: number) {
  return String(record.orderId ?? record.execId ?? record.orderLinkId ?? `${record.symbol ?? 'row'}-${index}`);
}

function formatValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '--';
  if (typeof value === 'object') return JSON.stringify(value);
  const stringValue = String(value);
  if (/(Time|time)$/.test(key) && /^\d{13}$/.test(stringValue)) {
    const timestamp = Number(stringValue);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toLocaleString();
  }
  return stringValue;
}

function recordColumns(view: OrderView): OrderColumn[] {
  return view === 'trades' ? TRADE_COLUMNS : ORDER_COLUMNS;
}

export default function OrdersScreen() {
  const [product, setProduct] = useState<OrderProduct>('spot');
  const [view, setView] = useState<OrderView>('open');
  const [activity, setActivity] = useState<OrderActivity | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    api.getOrderActivity(product, view)
      .then((result) => {
        if (!active) return;
        setActivity(result);
        setError('');
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setActivity(null);
        const message = requestError instanceof Error ? requestError.message : '';
        setError(message.includes('API 404')
          ? 'Connect your Bybit account in Profile to view order activity.'
          : 'Could not load order activity. Try again.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [product, refreshKey, view]);

  const selectProduct = (nextProduct: OrderProduct) => {
    if (nextProduct === product) return;
    setProduct(nextProduct);
    setActivity(null);
    setError('');
    setLoading(true);
  };

  const selectView = (nextView: OrderView) => {
    if (nextView === view) return;
    setView(nextView);
    setActivity(null);
    setError('');
    setLoading(true);
  };

  const refresh = () => {
    setLoading(true);
    setError('');
    setRefreshKey((key) => key + 1);
  };

  const loadMore = async () => {
    if (!activity?.next_cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const nextPage = await api.getOrderActivity(product, view, activity.next_cursor);
      setActivity((current) => current ? {
        ...nextPage,
        records: [...current.records, ...nextPage.records],
        count: current.count + nextPage.count,
      } : nextPage);
    } catch {
      setError('Could not load the next page. Try again.');
    } finally {
      setLoadingMore(false);
    }
  };

  const columns = recordColumns(view);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Orders</Text>
          <View style={styles.headerActions}>
            <NetworkSwitch />
            <Pressable accessibilityRole="button" accessibilityLabel="Refresh orders" onPress={refresh} style={styles.refresh}>
              <MaterialCommunityIcons name="refresh" size={20} color={AppColors.accentEnd} />
            </Pressable>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productTabs}>
          {PRODUCTS.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: product === item.id }}
              onPress={() => selectProduct(item.id)}
              style={[styles.productTab, product === item.id && styles.productTabSelected]}>
              <Text style={[styles.productText, product === item.id && styles.productTextSelected]}>{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.viewTabs}>
          {VIEWS.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === item.id }}
              onPress={() => selectView(item.id)}
              style={[styles.viewTab, view === item.id && styles.viewTabSelected]}>
              <Text numberOfLines={1} style={[styles.viewText, view === item.id && styles.viewTextSelected]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.tableHeading}>
          <Text style={styles.resultCount}>{activity?.supported ? `${activity.count} records` : 'Bybit activity'}</Text>
          <Text style={styles.exchangeLabel}>BYBIT</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={AppColors.accentEnd} style={styles.loading} />
        ) : error ? (
          <View style={styles.state}>
            <Text style={styles.stateTitle}>Activity unavailable</Text>
            <Text style={styles.stateMessage}>{error}</Text>
            <Pressable onPress={refresh} style={styles.stateButton}><Text style={styles.stateButtonText}>Retry</Text></Pressable>
          </View>
        ) : activity && !activity.supported ? (
          <View style={styles.state}>
            <MaterialCommunityIcons name="information-outline" size={24} color={AppColors.accentEnd} />
            <Text style={styles.stateTitle}>Stocks unavailable</Text>
            <Text style={styles.stateMessage}>{activity.message}</Text>
          </View>
        ) : activity?.records.length ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroller}>
              <View>
                <View style={styles.tableHeader}>
                  {columns.map((column) => <Text key={column.key} style={[styles.columnHeader, { width: column.width }]}>{column.label}</Text>)}
                  <Text style={[styles.columnHeader, styles.detailsHeader]}>Details</Text>
                </View>
                {activity.records.map((record, index) => (
                  <Pressable
                    key={getRecordKey(record, index)}
                    accessibilityRole="button"
                    accessibilityLabel={`View all fields for ${String(record.symbol ?? 'order')}`}
                    onPress={() => setSelectedRecord(record)}
                    style={({ pressed }) => [styles.tableRow, pressed && styles.rowPressed]}>
                    {columns.map((column) => (
                      <Text key={column.key} numberOfLines={1} style={[styles.cell, { width: column.width }]}>
                        {formatValue(column.key, record[column.key])}
                      </Text>
                    ))}
                    <View style={styles.detailsCell}>
                      <MaterialCommunityIcons name="open-in-new" size={15} color={AppColors.accentEnd} />
                    </View>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            {activity.next_cursor ? (
              <Pressable accessibilityRole="button" disabled={loadingMore} onPress={loadMore} style={styles.loadMore}>
                {loadingMore ? <ActivityIndicator color={AppColors.accentEnd} /> : <Text style={styles.loadMoreText}>Load more</Text>}
              </Pressable>
            ) : null}
          </>
        ) : (
          <View style={styles.state}>
            <MaterialCommunityIcons name="text-box-search-outline" size={26} color={AppColors.muted} />
            <Text style={styles.stateTitle}>No records</Text>
            <Text style={styles.stateMessage}>There are no {VIEWS.find((item) => item.id === view)?.label.toLowerCase()} for this product.</Text>
          </View>
        )}
      </ScrollView>

      <Modal transparent animationType="slide" visible={selectedRecord !== null} onRequestClose={() => setSelectedRecord(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.detailSheet}>
            <View style={styles.detailHeader}>
              <View style={styles.detailHeading}>
                <Text style={styles.detailEyebrow}>BYBIT RESPONSE</Text>
                <Text numberOfLines={1} style={styles.detailTitle}>{String(selectedRecord?.symbol ?? selectedRecord?.orderId ?? 'Record details')}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close record details" onPress={() => setSelectedRecord(null)} style={styles.dismiss}>
                <MaterialCommunityIcons name="close" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
            <ScrollView style={styles.detailList}>
              {Object.entries(selectedRecord ?? {}).map(([key, value]) => (
                <View key={key} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{key}</Text>
                  <Text selectable style={styles.detailValue}>{formatValue(key, value)}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { color: '#FFFFFF', fontSize: 26, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  refresh: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: AppColors.surface },
  productTabs: { gap: 7, paddingBottom: 12 },
  productTab: { minWidth: 76, height: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 7, backgroundColor: AppColors.surface },
  productTabSelected: { backgroundColor: AppColors.accentEnd },
  productText: { color: AppColors.muted, fontSize: 12, fontWeight: '600' },
  productTextSelected: { color: '#FFFFFF' },
  viewTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: AppColors.hairline },
  viewTab: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', minHeight: 42, paddingHorizontal: 3, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  viewTabSelected: { borderBottomColor: AppColors.accentEnd },
  viewText: { color: AppColors.muted, fontSize: 10, fontWeight: '500' },
  viewTextSelected: { color: '#FFFFFF', fontWeight: '600' },
  tableHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13 },
  resultCount: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  exchangeLabel: { color: AppColors.faint, fontSize: 9, fontWeight: '700' },
  loading: { marginTop: 52 },
  tableScroller: { flexGrow: 0, borderWidth: 1, borderColor: AppColors.hairline, borderRadius: 8 },
  tableHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 38, backgroundColor: AppColors.surface, borderBottomWidth: 1, borderBottomColor: AppColors.hairline },
  columnHeader: { paddingHorizontal: 10, color: AppColors.muted, fontSize: 10, fontWeight: '600' },
  detailsHeader: { width: 70 },
  tableRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AppColors.hairline },
  rowPressed: { backgroundColor: AppColors.raised },
  cell: { paddingHorizontal: 10, color: '#FFFFFF', fontSize: 11, fontVariant: ['tabular-nums'] },
  detailsCell: { width: 70, alignItems: 'center', justifyContent: 'center' },
  loadMore: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 10, borderRadius: 7, backgroundColor: AppColors.surface },
  loadMoreText: { color: AppColors.accentEnd, fontSize: 12, fontWeight: '600' },
  state: { minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 22, borderRadius: 8, backgroundColor: AppColors.surface, gap: 8 },
  stateTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  stateMessage: { color: AppColors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  stateButton: { minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 4, borderRadius: 6, backgroundColor: AppColors.accentEnd },
  stateButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.68)' },
  detailSheet: { maxHeight: '84%', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 28, backgroundColor: AppColors.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderWidth: 1, borderColor: AppColors.hairline },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: AppColors.hairline },
  detailHeading: { flex: 1, minWidth: 0 },
  detailEyebrow: { color: AppColors.accentEnd, fontSize: 9, fontWeight: '700' },
  detailTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginTop: 4 },
  dismiss: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: AppColors.raised },
  detailList: { marginTop: 4 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AppColors.hairline },
  detailLabel: { flex: 1, color: AppColors.muted, fontSize: 11 },
  detailValue: { flex: 1.5, color: '#FFFFFF', fontSize: 11, textAlign: 'right' },
});
