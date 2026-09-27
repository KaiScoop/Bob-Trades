import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AppColors } from '@/constants/theme';
import { api } from '@/lib/api';

export default function OnboardingScreen() {
  const [username, setUsername] = useState('');
  const [dob, setDob] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!username.trim()) { setError('Enter a username.'); return; }
    setBusy(true); setError('');
    try { await api.updateProfile({ username: username.trim(), ...(dob.trim() ? { dob: dob.trim() } : {}) }); router.replace('/'); } catch { setError('Could not save your profile. Check the date format.'); } finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.container}><View style={styles.content}><Text style={styles.kicker}>ONE LAST THING</Text><Text style={styles.title}>What should Bob call you?</Text><Text style={styles.subtitle}>Set up your profile before entering the app.</Text><TextInput value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor={AppColors.faint} autoCapitalize="none" style={styles.input} /><TextInput value={dob} onChangeText={setDob} placeholder="Date of birth · YYYY-MM-DD (optional)" placeholderTextColor={AppColors.faint} style={styles.input} /><Text style={styles.error}>{error}</Text><Pressable onPress={submit} disabled={busy} style={styles.button}><Text style={styles.buttonText}>{busy ? 'Saving…' : 'Continue'}</Text></Pressable></View></SafeAreaView>;
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: AppColors.background }, content: { padding: 24, paddingTop: 72 }, kicker: { color: AppColors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 }, title: { color: '#fff', fontSize: 38, fontWeight: '700', marginTop: 18 }, subtitle: { color: AppColors.muted, fontSize: 16, lineHeight: 24, marginTop: 12 }, input: { color: '#fff', borderColor: AppColors.hairline, borderWidth: 1, borderRadius: 14, padding: 16, fontSize: 16, marginTop: 18 }, error: { color: AppColors.danger, minHeight: 24, marginTop: 8 }, button: { backgroundColor: AppColors.accentEnd, borderRadius: 24, padding: 17, alignItems: 'center', marginTop: 8 }, buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' } });