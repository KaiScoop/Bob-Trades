import { TabList, TabListProps, TabSlot, TabTrigger, TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppColors, MaxContentWidth } from '@/constants/theme';

const TAB_BAR_HEIGHT = 64;

export default function AppTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs style={styles.tabs}>
      <TabSlot style={styles.slot} />
      <View style={[styles.tabBarSpacer, { height: TAB_BAR_HEIGHT + insets.bottom }]} />
      <TabList asChild>
        <CustomTabList bottomInset={insets.bottom}>
          <TabTrigger name="index" href="/" asChild><TabButton>Home</TabButton></TabTrigger>
          <TabTrigger name="positions" href="/positions" asChild><TabButton>Positions</TabButton></TabTrigger>
          <TabTrigger name="trade" href="/trade" asChild><TabButton>Trade</TabButton></TabTrigger>
          <TabTrigger name="activity" href="/activity" asChild><TabButton>Activity</TabButton></TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild><TabButton>Profile</TabButton></TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return <Pressable {...props} style={({ pressed }) => [styles.tabButton, isFocused && styles.focused, pressed && styles.pressed]}><Text numberOfLines={1} ellipsizeMode="clip" style={styles.tabText}>{children}</Text></Pressable>;
}

function CustomTabList({ bottomInset, ...props }: TabListProps & { bottomInset: number }) {
  return <View nativeID="app-tab-list" {...props} style={[styles.tabList, { paddingBottom: bottomInset + 8 }]}><View style={styles.inner}>{props.children}</View></View>;
}

const styles = StyleSheet.create({
  tabs: { flex: 1, width: '100%', minWidth: 0, overflow: 'hidden' },
  slot: { flex: 1, width: '100%', minWidth: 0 },
  tabBarSpacer: { flexShrink: 0 },
  tabList: { paddingHorizontal: 8, paddingTop: 8, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
  inner: { width: '100%', padding: 6, borderRadius: 999, backgroundColor: AppColors.surface, borderColor: AppColors.hairline, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 0, flexGrow: 1, maxWidth: MaxContentWidth, minWidth: 0 },
  tabButton: { paddingVertical: 8, paddingHorizontal: 3, borderRadius: 999, flex: 1, minWidth: 0, alignItems: 'center' },
  focused: { backgroundColor: AppColors.raised },
  tabText: { color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
