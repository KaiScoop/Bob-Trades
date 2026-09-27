import { DarkTheme, Stack, ThemeProvider, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const segments = useSegments();
  const isAuthRoute = ['welcome', 'sign-in', 'sign-up', 'check-email', 'onboarding'].includes(segments[0] ?? '');

  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <AnimatedSplashOverlay />
      {isAuthRoute ? <Stack screenOptions={{ headerShown: false }} /> : <AppTabs />}
    </ThemeProvider>
  );
}
