import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';
import { api, type AgentLog } from '@/lib/api';

export default function ActivityScreen() {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); api.getLogs().then((result) => setLogs(result.logs)).finally(() => setLoading(false)); };
  useEffect(() => { api.getLogs().then((result) => setLogs(result.logs)).finally(() => setLoading(false)); }, []);
  return <SafeAreaView style={styles.container}><View style={styles.header}><Text style={styles.title}>Activity</Text><Pressable onPress={load}><Text style={styles.refresh}>Refresh</Text></Pressable></View>{loading ? <ActivityIndicator color={AppColors.accentEnd} /> : logs.length ? <ScrollView>{logs.map((log) => <View key={log.id} style={styles.row}><View style={styles.rowTop}><Text style={styles.time}>{new Date(log.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text><Text style={styles.latency}>{log.latency_ms} ms</Text></View><Text style={styles.reason}>{log.reason}</Text><View style={styles.pills}><Text style={styles.pill}>intended {log.intended ? 'yes' : 'no'}</Text><Text style={styles.pill}>executed {log.executed ? 'yes' : 'no'}</Text></View></View>)}</ScrollView> : <View style={styles.empty}><Text style={styles.emptyTitle}>No decisions yet.</Text><Text style={styles.muted}>Bob is quiet. Start a session from Trade.</Text></View>}</SafeAreaView>;
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: AppColors.background, padding: 20 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 28 }, title: { color: '#fff', fontSize: 32, fontWeight: '700' }, refresh: { color: '#8EA8FF', fontSize: 14 }, row: { paddingVertical: 16, borderBottomColor: AppColors.hairline, borderBottomWidth: 1 }, rowTop: { flexDirection: 'row', justifyContent: 'space-between' }, time: { color: '#fff', fontWeight: '600' }, latency: { color: AppColors.muted, fontSize: 13 }, reason: { color: AppColors.muted, marginTop: 8 }, pills: { flexDirection: 'row', gap: 8, marginTop: 10 }, pill: { color: AppColors.muted, backgroundColor: AppColors.surface, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 }, muted: { color: AppColors.muted, fontSize: 14 } });
