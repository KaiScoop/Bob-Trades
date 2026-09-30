import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '@/components/app-text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/theme';
import { api } from '@/lib/api';

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!email.trim()) return setError('Enter your email address.');
    setBusy(true); setError('');
    try { await (mode === 'sign-in' ? api.signIn(email.trim()) : api.signUp(email.trim())); router.push({ pathname: '/check-email', params: { email: email.trim() } }); } catch { setError('We could not send the link. Check the email and try again.'); } finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.container}><View style={styles.content}><Text style={styles.kicker}>BOB TRADES</Text><Text style={styles.title}>{mode === 'sign-in' ? 'Welcome back.' : 'Start with email.'}</Text><Text style={styles.subtitle}>We’ll send a secure magic link. No password needed.</Text><TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={AppColors.faint} value={email} onChangeText={setEmail} style={styles.input} /><Text style={styles.error}>{error}</Text><Pressable disabled={busy} onPress={submit} style={styles.button}><Text style={styles.buttonText}>{busy ? 'Sending…' : 'Send magic link'}</Text></Pressable></View></SafeAreaView>;
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: AppColors.background }, content: { padding: 24, paddingTop: 72 }, kicker: { color: AppColors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 }, title: { color: '#fff', fontSize: 38, fontWeight: '700', marginTop: 18 }, subtitle: { color: AppColors.muted, fontSize: 16, lineHeight: 24, marginTop: 12 }, input: { color: '#fff', borderColor: AppColors.hairline, borderWidth: 1, borderRadius: 14, padding: 16, fontSize: 16, marginTop: 32 }, error: { color: AppColors.danger, minHeight: 24, marginTop: 8 }, button: { backgroundColor: AppColors.accentEnd, borderRadius: 24, padding: 17, alignItems: 'center', marginTop: 8 }, buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' } });