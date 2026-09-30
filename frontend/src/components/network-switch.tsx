import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { ConnectBybitModal } from '@/components/connect-bybit-modal';
import { AppColors } from '@/constants/theme';
import { api, type BrokerStatus } from '@/lib/api';

type NetworkMode = 'testnet' | 'mainnet';

export function NetworkSwitch() {
  const [broker, setBroker] = useState<BrokerStatus | null>(null);
  const [connectMode, setConnectMode] = useState<NetworkMode>('testnet');
  const [connectOpen, setConnectOpen] = useState(false);
  const mode: NetworkMode = broker?.mode === 'mainnet' ? 'mainnet' : 'testnet';
  const isMainnet = mode === 'mainnet';

  useEffect(() => {
    let active = true;
    api.getBrokerStatus()
      .then((status) => { if (active) setBroker(status); })
      .catch(() => { if (active) setBroker({ connected: false, mode: null, balance: 0 }); });
    return () => { active = false; };
  }, []);

  const toggle = () => {
    const nextMode = isMainnet ? 'testnet' : 'mainnet';
    if (broker?.mode === nextMode) return;
    setConnectMode(nextMode);
    setConnectOpen(true);
  };

  return (
    <>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Trading network"
        accessibilityState={{ checked: isMainnet }}
        onPress={toggle}
        style={styles.track}>
        <View style={[styles.knob, isMainnet ? styles.mainKnob : styles.testKnob]}>
          <Text style={[styles.label, isMainnet && styles.mainLabel]}>{isMainnet ? 'MAIN' : 'TEST'}</Text>
        </View>
      </Pressable>
      <ConnectBybitModal
        key={connectMode}
        visible={connectOpen}
        initialMode={connectMode}
        onClose={() => setConnectOpen(false)}
        onConnected={setBroker}
      />
    </>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 84,
    height: 34,
    borderRadius: 17,
    padding: 3,
    backgroundColor: AppColors.raised,
    borderWidth: 1,
    borderColor: AppColors.hairline,
    justifyContent: 'center',
  },
  knob: { width: 48, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  testKnob: { alignSelf: 'flex-start', backgroundColor: '#24242A' },
  mainKnob: { alignSelf: 'flex-end', backgroundColor: AppColors.accentEnd },
  label: { color: AppColors.muted, fontSize: 10, fontWeight: '700' },
  mainLabel: { color: '#FFFFFF' },
});
