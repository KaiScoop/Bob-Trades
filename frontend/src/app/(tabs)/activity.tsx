import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppText as Text } from '@/components/app-text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';
import { NetworkSwitch } from '@/components/network-switch';
import { api, type AgentLog } from '@/lib/api';

const formatTitle = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatClock = (value: string) => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const pickValue = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
};
const formatMetricValue = (value: unknown) => {
  if (typeof value === 'number') {
    if (Math.abs(value) >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    if (value % 1 !== 0) return value.toFixed(2);
    return String(value);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return '—';
};
const toPercent = (value: unknown) => {
  if (typeof value === 'number') return Math.min(100, Math.max(0, value * 100));
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/%/g, ''));
    if (Number.isFinite(parsed)) return Math.min(100, Math.max(0, parsed));
  }
  return null;
};
const getSignalText = (log: AgentLog) => {
  const request = asRecord(log.request_json);
  const response = asRecord(log.response_json);
  const symbol = pickValue({ ...request, ...response }, ['symbol', 'pair', 'market', 'ticker']) ?? 'Market';
  const action = pickValue(response, ['action', 'decision', 'event', 'status']) ?? pickValue(request, ['action', 'decision']) ?? (log.executed ? 'Execution' : log.intended ? 'Planned' : 'Hold');
  return `${String(symbol)} · ${String(action)}`;
};
const getProgress = (log: AgentLog) => {
  if (log.executed) return 100;
  if (log.intended) return 72;
  return 28;
};
const getDecisionMetrics = (log: AgentLog) => {
  const request = asRecord(log.request_json);
  const response = asRecord(log.response_json);
  const metrics: Array<{ label: string; value: string; progress?: number }> = [];
  const symbol = pickValue({ ...request, ...response }, ['symbol', 'pair', 'market']);
  const action = pickValue(response, ['action', 'decision', 'event', 'status']) ?? pickValue(request, ['action', 'decision']) ?? null;
  const side = pickValue(response, ['side', 'direction', 'intent']) ?? pickValue(request, ['side', 'direction']) ?? null;
  const quantity = pickValue(response, ['quantity', 'qty', 'size', 'amount']) ?? pickValue(request, ['quantity', 'qty', 'size', 'amount']) ?? null;
  const price = pickValue(response, ['price', 'entry_price', 'last_price', 'target', 'stop']) ?? pickValue(request, ['price', 'entry_price', 'last_price']) ?? null;
  const confidence = pickValue(response, ['confidence', 'score', 'probability']) ?? pickValue(request, ['confidence', 'score', 'probability']) ?? null;

  if (symbol !== null) metrics.push({ label: 'Symbol', value: String(symbol) });
  if (action !== null) metrics.push({ label: 'Outcome', value: String(action) });
  if (side !== null) metrics.push({ label: 'Side', value: String(side) });
  if (quantity !== null) metrics.push({ label: 'Size', value: formatMetricValue(quantity) });
  if (price !== null) metrics.push({ label: 'Price', value: formatMetricValue(price) });
  if (confidence !== null) {
    const percent = toPercent(confidence) ?? (log.executed ? 100 : log.intended ? 72 : 28);
    metrics.push({ label: 'Confidence', value: `${Math.round(percent)}%`, progress: percent });
  }

  if (!metrics.length) {
    metrics.push({ label: 'Latency', value: `${log.latency_ms} ms` });
    metrics.push({ label: 'Reason', value: formatTitle(log.reason || 'Decision') });
  }

  return metrics.slice(0, 4);
};

export default function ActivityScreen() {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.getLogs();
      setLogs(result.logs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Activity</Text>
        <View style={styles.headerActions}>
          <NetworkSwitch />
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh activity" onPress={() => void load()} style={styles.refresh}>
            <MaterialCommunityIcons name="refresh" size={20} color={AppColors.accentEnd} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={AppColors.accentEnd} />
      ) : logs.length ? (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {logs.map((log) => {
            const expanded = expandedId === log.id;
            const progress = getProgress(log);
            const title = formatTitle(log.reason || 'Decision');

            const metrics = getDecisionMetrics(log);

            return (
              <Pressable key={log.id} onPress={() => setExpandedId(expanded ? null : log.id)} style={styles.card}>
                <View style={styles.rowTop}>
                  <View>
                    <Text style={styles.time}>{formatClock(log.ts)}</Text>
                    <Text style={styles.reason}>{title}</Text>
                  </View>
                  <Text style={styles.latency}>{log.latency_ms} ms</Text>
                </View>

                <Text style={styles.summary}>{getSignalText(log)}</Text>

                <View style={styles.statusRow}>
                  <Text style={[styles.badge, log.executed ? styles.badgeSuccess : styles.badgeNeutral]}>{log.executed ? 'Executed' : log.intended ? 'Planned' : 'Skipped'}</Text>
                  <Text style={[styles.badge, log.intended ? styles.badgeInfo : styles.badgeNeutral]}>{log.intended ? 'Intended' : 'Hold'}</Text>
                </View>

                <View style={styles.gaugeTrack}>
                  <View style={[styles.gaugeFill, { width: `${progress}%` }, log.executed ? styles.gaugeSuccess : log.intended ? styles.gaugeInfo : styles.gaugeNeutral]} />
                </View>

                {expanded ? (
                  <View style={styles.detailPanel}>
                    <View style={styles.metricGrid}>
                      {metrics.map((metric) => (
                        <View key={`${log.id}-${metric.label}`} style={styles.metricCard}>
                          <Text style={styles.metricLabel}>{metric.label}</Text>
                          <Text style={styles.metricValue}>{metric.value}</Text>
                          {typeof metric.progress === 'number' ? (
                            <View style={styles.miniTrack}>
                              <View style={[styles.miniFill, { width: `${metric.progress}%` }]} />
                            </View>
                          ) : null}
                        </View>
                      ))}
                    </View>

                    <View style={styles.outputBlock}>
                      <Text style={styles.outputLabel}>Decision output</Text>
                      <View style={styles.outputRow}>
                        <Text style={styles.outputKey}>Status</Text>
                        <Text style={styles.outputValue}>{log.executed ? 'Filled' : log.intended ? 'Queued' : 'No action'}</Text>
                      </View>
                      <View style={styles.outputRow}>
                        <Text style={styles.outputKey}>Reason</Text>
                        <Text style={styles.outputValue}>{formatTitle(log.reason || 'Decision')}</Text>
                      </View>
                      <View style={styles.outputRow}>
                        <Text style={styles.outputKey}>Latency</Text>
                        <Text style={styles.outputValue}>{log.latency_ms} ms</Text>
                      </View>
                    </View>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No decisions yet.</Text>
          <Text style={styles.muted}>Bob is quiet. Start a session from Trade.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 20 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  refresh: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 24 },
  card: { backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.hairline, borderRadius: 18, padding: 16, marginBottom: 12 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  time: { color: '#fff', fontSize: 12, fontWeight: '600' },
  latency: { color: AppColors.muted, fontSize: 12 },
  reason: { color: AppColors.muted, marginTop: 6, fontSize: 13, textTransform: 'capitalize' },
  summary: { color: '#fff', marginTop: 12, fontSize: 14, fontWeight: '600' },
  statusRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  badgeSuccess: { backgroundColor: 'rgba(34, 197, 94, 0.12)', color: AppColors.success },
  badgeInfo: { backgroundColor: 'rgba(0, 129, 251, 0.12)', color: AppColors.accent },
  badgeNeutral: { backgroundColor: 'rgba(161, 161, 170, 0.08)', color: AppColors.muted },
  gaugeTrack: { height: 8, backgroundColor: AppColors.hairline, borderRadius: 999, overflow: 'hidden', marginTop: 14 },
  gaugeFill: { height: '100%', borderRadius: 999 },
  gaugeSuccess: { backgroundColor: AppColors.success },
  gaugeInfo: { backgroundColor: AppColors.accent },
  gaugeNeutral: { backgroundColor: AppColors.muted },
  detailPanel: { marginTop: 16, borderTopWidth: 1, borderTopColor: AppColors.hairline, paddingTop: 14 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCard: { flexBasis: '48%', backgroundColor: AppColors.background, borderWidth: 1, borderColor: AppColors.hairline, borderRadius: 12, padding: 10 },
  metricLabel: { color: AppColors.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
  metricValue: { color: '#fff', marginTop: 8, fontSize: 14, fontWeight: '700' },
  miniTrack: { height: 5, backgroundColor: AppColors.hairline, borderRadius: 999, overflow: 'hidden', marginTop: 8 },
  miniFill: { height: '100%', backgroundColor: AppColors.accent, borderRadius: 999 },
  outputBlock: { marginTop: 16, backgroundColor: AppColors.background, borderWidth: 1, borderColor: AppColors.hairline, borderRadius: 12, padding: 12 },
  outputLabel: { color: AppColors.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  outputRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: AppColors.hairline },
  outputKey: { color: AppColors.muted, fontSize: 12, flex: 1 },
  outputValue: { color: '#fff', fontSize: 12, fontWeight: '600', flex: 1, textAlign: 'right' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  muted: { color: AppColors.muted, fontSize: 14 },
});
