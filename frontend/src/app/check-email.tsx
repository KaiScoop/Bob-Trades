import { Link, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';

export default function CheckEmailScreen() { const { email } = useLocalSearchParams<{ email?: string }>(); return <SafeAreaView style={styles.container}><View style={styles.content}><Text style={styles.mark}>✉</Text><Text style={styles.title}>Check your email.</Text><Text style={styles.subtitle}>We sent a magic link to {email ?? 'your inbox'}. Open it on this device to continue.</Text><Link href="/welcome" style={styles.link}>Back to welcome</Link></View></SafeAreaView>; }
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: AppColors.background }, content: { padding: 24, paddingTop: 100 }, mark: { color: '#fff', fontSize: 48 }, title: { color: '#fff', fontSize: 36, fontWeight: '700', marginTop: 24 }, subtitle: { color: AppColors.muted, fontSize: 16, lineHeight: 24, marginTop: 14 }, link: { color: '#8EA8FF', fontSize: 16, marginTop: 36 } });