import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { AppColors } from '@/constants/theme';

export default function WelcomeScreen() {
  return <SafeAreaView style={styles.container}><View style={styles.content}><View style={styles.mark}><View style={styles.pill} /><View style={styles.pill} /></View><Text style={styles.title}>Let Bob{`\n`}Trade</Text><Text style={styles.subtitle}>You set the risk. Bob takes the tape.</Text><View style={styles.actions}><Link href="/sign-up" asChild><LinearGradient colors={[AppColors.accent, AppColors.accentEnd]} style={styles.primary}><Text style={styles.primaryText}>Sign up</Text></LinearGradient></Link><Link href="/sign-in" asChild><View style={styles.secondary}><Text style={styles.secondaryText}>Sign in</Text></View></Link></View></View></SafeAreaView>;
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: AppColors.background }, content: { flex: 1, padding: 28, justifyContent: 'center' }, mark: { width: 96, height: 96, borderRadius: 28, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 40 }, pill: { width: 14, height: 48, borderRadius: 9, backgroundColor: '#000' }, title: { color: '#fff', fontSize: 56, lineHeight: 58, fontWeight: '700', letterSpacing: -1 }, subtitle: { color: AppColors.muted, fontSize: 17, marginTop: 18 }, actions: { gap: 12, marginTop: 48 }, primary: { borderRadius: 24, padding: 17, alignItems: 'center' }, primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' }, secondary: { borderColor: AppColors.hairline, borderWidth: 1, borderRadius: 24, padding: 17, alignItems: 'center' }, secondaryText: { color: '#fff', fontSize: 16, fontWeight: '600' } });