import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    setBusy(true); setError('');
    try {
      await (mode === 'sign-in' ? api.signIn(email.trim()) : api.signUp(email.trim()));
      router.push({ pathname: '/check-email', params: { email: email.trim() } });
    } catch {
      setError('We could not send the link. Check the email and try again.');
    } finally {
      setBusy(false);
    }
  };
  const isSignIn = mode === 'sign-in';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Go back">
            <MaterialCommunityIcons name="chevron-left" size={28} color={AppColors.accentEnd} />
          </Pressable>
          <Text style={styles.headerTitle}>Email Address</Text>
          <Pressable onPress={() => router.replace('/welcome')} hitSlop={12} accessibilityLabel="Close">
            <MaterialCommunityIcons name="close" size={23} color={AppColors.accentEnd} />
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.iconHalo}>
            <View style={styles.iconCircle}>
              <MaterialCommunityIcons name="email-outline" size={25} color={AppColors.accentEnd} />
            </View>
          </View>
          <Text style={styles.title}>{isSignIn ? 'Welcome back' : 'Get started with email'}</Text>
          <Text style={styles.subtitle}>Enter your email address to receive a secure sign-in link.</Text>
          <View style={styles.divider} />
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={AppColors.faint}
            returnKeyType="send"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={submit}
            style={styles.input}
          />
          <Text style={styles.error}>{error}</Text>
          <Pressable
            disabled={busy}
            onPress={submit}
            style={[styles.button, busy && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>{busy ? 'Sending link…' : 'Send magic link'}</Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace(isSignIn ? '/sign-up' : '/sign-in')}
            style={styles.modeSwitch}
          >
            <Text style={styles.modeSwitchText}>
              {isSignIn ? 'New to Bob? ' : 'Already have an account? '}
              <Text style={styles.modeSwitchAction}>{isSignIn ? 'Create account' : 'Log in'}</Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  page: { flex: 1, paddingHorizontal: 16 },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 440,
    marginTop: 'auto',
    marginBottom: 'auto',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.hairline,
    backgroundColor: AppColors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 4,
  },
  iconHalo: {
    width: 72,
    height: 72,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 36,
    backgroundColor: AppColors.raised,
    marginBottom: 15,
  },
  iconCircle: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    backgroundColor: AppColors.surface,
    borderWidth: 1,
    borderColor: AppColors.hairline,
  },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  subtitle: { color: AppColors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 },
  divider: { borderBottomWidth: 1, borderColor: AppColors.hairline, borderStyle: 'dashed', marginVertical: 16 },
  label: { color: '#E4E4E7', fontSize: 13, marginBottom: 7 },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: AppColors.hairline,
    borderRadius: 7,
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontSize: 14,
  },
  error: { color: AppColors.danger, minHeight: 18, marginTop: 5, fontSize: 12 },
  button: {
    minHeight: 42,
    borderRadius: 7,
    backgroundColor: AppColors.accentEnd,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    overflow: 'hidden',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  modeSwitch: { alignItems: 'center', paddingTop: 15 },
  modeSwitchText: { color: AppColors.muted, fontSize: 12 },
  modeSwitchAction: { color: '#FFFFFF', fontWeight: '600' },
});