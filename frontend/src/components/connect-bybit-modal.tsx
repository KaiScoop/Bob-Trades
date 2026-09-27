import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppColors } from '@/constants/theme';
import { api, type BrokerStatus } from '@/lib/api';

type ConnectBybitModalProps = {
  visible: boolean;
  onClose: () => void;
  onConnected: (broker: BrokerStatus) => void;
};

type ConnectionMode = 'testnet' | 'mainnet';

export function ConnectBybitModal({ visible, onClose, onConnected }: ConnectBybitModalProps) {
  const [mode, setMode] = useState<ConnectionMode>('testnet');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const dismiss = () => {
    if (saving) return;
    setApiKey('');
    setApiSecret('');
    setError('');
    setMode('testnet');
    onClose();
  };

  const connect = async () => {
    const trimmedKey = apiKey.trim();
    const trimmedSecret = apiSecret.trim();
    if (!trimmedKey || !trimmedSecret) {
      setError('Enter both your Bybit API key and secret.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const result = await api.connectBybit({
        mode,
        api_key: trimmedKey,
        api_secret: trimmedSecret,
      });
      setApiKey('');
      setApiSecret('');
      setMode('testnet');
      onConnected({ connected: true, mode: result.mode, balance: result.balance });
      onClose();
    } catch (connectionError) {
      const message = connectionError instanceof Error ? connectionError.message : '';
      if (message.includes('Bybit credentials rejected')) {
        setError('Bybit rejected these credentials. Check the key, secret, and selected network.');
      } else if (message.includes('Bybit is unavailable')) {
        setError('Bybit is temporarily unavailable. Try again in a moment.');
      } else {
        setError('Could not connect. Check your internet connection and try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.scrim} onPress={dismiss} accessibilityLabel="Close dialog" />
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.eyebrow}>BROKER CONNECTION</Text>
            <Text style={styles.title}>Connect Bybit</Text>
            <Text style={styles.description}>
              Add an API key to connect your account. Withdrawal permission is not needed.
            </Text>

            <Text style={styles.label}>NETWORK</Text>
            <View style={styles.modeSelector}>
              {(['testnet', 'mainnet'] as const).map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === option }}
                  onPress={() => setMode(option)}
                  style={[styles.modeOption, mode === option && styles.modeSelected]}
                >
                  <Text style={[styles.modeText, mode === option && styles.modeTextSelected]}>
                    {option === 'testnet' ? 'Testnet' : 'Mainnet'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>API KEY</Text>
            <TextInput
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="Enter API key"
              placeholderTextColor={AppColors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={!saving}
              style={styles.input}
              textContentType="none"
              autoComplete="off"
              accessibilityLabel="Bybit API key"
            />

            <Text style={styles.label}>API SECRET</Text>
            <TextInput
              value={apiSecret}
              onChangeText={setApiSecret}
              placeholder="Enter API secret"
              placeholderTextColor={AppColors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={!saving}
              style={styles.input}
              textContentType="none"
              autoComplete="off"
              returnKeyType="done"
              onSubmitEditing={connect}
              accessibilityLabel="Bybit API secret"
            />

            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={connect}
              style={[styles.connectButton, saving && styles.disabledButton]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.connectText}>Verify and connect</Text>
              )}
            </Pressable>
            <Pressable disabled={saving} onPress={dismiss} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.72)' },
  scrim: { ...StyleSheet.absoluteFill },
  sheet: {
    maxHeight: '92%',
    backgroundColor: AppColors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderColor: AppColors.hairline,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 28,
  },
  eyebrow: { color: AppColors.accentEnd, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: '#fff', fontSize: 25, fontWeight: '700', marginTop: 8 },
  description: { color: AppColors.muted, fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 24 },
  label: { color: AppColors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 },
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: AppColors.raised,
    borderRadius: 8,
    padding: 4,
    marginBottom: 22,
  },
  modeOption: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 6 },
  modeSelected: { backgroundColor: AppColors.accentEnd },
  modeText: { color: AppColors.muted, fontSize: 13, fontWeight: '600' },
  modeTextSelected: { color: '#fff' },
  input: {
    color: '#fff',
    backgroundColor: AppColors.raised,
    borderColor: AppColors.hairline,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 18,
  },
  error: { color: AppColors.danger, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  connectButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: AppColors.accentEnd,
    marginTop: 4,
  },
  disabledButton: { opacity: 0.65 },
  connectText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cancelButton: { alignItems: 'center', paddingVertical: 14 },
  cancelText: { color: AppColors.muted, fontSize: 14, fontWeight: '600' },
});