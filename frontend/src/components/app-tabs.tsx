import { TabList, TabListProps, TabSlot, TabTrigger, TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText as Text } from '@/components/app-text';
import { AppColors, MaxContentWidth } from '@/constants/theme';

const TAB_BAR_HEIGHT = 64;
type TabIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export default function AppTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs style={styles.tabs}>
      <TabSlot style={styles.slot} />
      <View style={[styles.tabBarSpacer, { height: TAB_BAR_HEIGHT + insets.bottom }]} />
      <TabList asChild>
        <CustomTabList bottomInset={insets.bottom}>
          <TabTrigger name="index" href="/" asChild>
            <TabButton icon="home-variant-outline" selectedIcon="home-variant">Home</TabButton>
          </TabTrigger>
          <TabTrigger name="positions" href="/positions" asChild>
            <TabButton icon="chart-box-outline" selectedIcon="chart-box">Positions</TabButton>
          </TabTrigger>
          <TabTrigger name="trade" href="/trade" asChild>
            <TabButton icon="swap-horizontal" selectedIcon="swap-horizontal" isTrade>Trade</TabButton>
          </TabTrigger>
          <TabTrigger name="activity" href="/activity" asChild>
            <TabButton icon="chart-timeline-variant" selectedIcon="chart-timeline-variant">Activity</TabButton>
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton icon="account-circle-outline" selectedIcon="account-circle">Profile</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

function TabButton({ children, isFocused, icon, selectedIcon, isTrade, ...props }: TabTriggerSlotProps & {
  icon: TabIconName;
  selectedIcon: TabIconName;
  isTrade?: boolean;
}) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [styles.tabButton, isTrade && styles.tradeButton, pressed && styles.pressed]}>
      {isTrade ? (
        <View style={styles.tradeIcon}>
          <MaterialCommunityIcons name={icon} size={25} color="#FFFFFF" />
        </View>
      ) : (
        <MaterialCommunityIcons
          name={isFocused ? selectedIcon : icon}
          size={22}
          color={isFocused ? AppColors.accentEnd : AppColors.muted}
        />
      )}
      <Text style={[styles.tabText, isFocused && styles.focusedText]}>{children}</Text>
    </Pressable>
  );
}

function CustomTabList({ bottomInset, ...props }: TabListProps & { bottomInset: number }) {
  return (
    <View
      nativeID="app-tab-list"
      {...props}
      style={[styles.tabList, { paddingBottom: bottomInset + 5 }]}>
      <View style={styles.inner}>{props.children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flex: 1, width: '100%', minWidth: 0, overflow: 'hidden' },
  slot: { flex: 1, width: '100%', minWidth: 0 },
  tabBarSpacer: { flexShrink: 0 },
  tabList: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: 8,
    paddingTop: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: AppColors.surface,
    borderTopColor: AppColors.hairline,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    minWidth: 0,
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabButton: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tradeButton: { justifyContent: 'flex-end', paddingBottom: 2 },
  tradeIcon: {
    position: 'absolute',
    top: -21,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppColors.accentEnd,
  },
  tabText: { color: AppColors.muted, fontSize: 11, fontWeight: '500', textAlign: 'center' },
  focusedText: { color: AppColors.accentEnd },
  pressed: { opacity: 0.7 },
});
