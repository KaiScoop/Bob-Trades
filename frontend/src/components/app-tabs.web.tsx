import { TabList, TabListProps, TabSlot, TabTrigger, TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppColors, MaxContentWidth } from '@/constants/theme';

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
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
  return <Pressable {...props} style={({ pressed }) => [styles.tabButton, isFocused && styles.focused, pressed && styles.pressed]}><Text style={styles.tabText}>{children}</Text></Pressable>;
}

function CustomTabList(props: TabListProps) {
  return <View {...props} style={styles.tabList}><View style={styles.inner}>{props.children}</View></View>;
}

const styles = StyleSheet.create({
  tabList: { position: 'absolute', width: '100%', padding: 12, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
  inner: { padding: 8, borderRadius: 999, backgroundColor: AppColors.surface, borderColor: AppColors.hairline, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 4, flexGrow: 1, maxWidth: MaxContentWidth },
  tabButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 999, flex: 1, alignItems: 'center' },
  focused: { backgroundColor: AppColors.raised },
  tabText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
