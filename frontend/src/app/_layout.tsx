import { DarkTheme, router, Stack, ThemeProvider, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { api } from '@/lib/api';
import { clearTokens, getAccessToken, getRefreshToken } from '@/lib/secure';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const segments = useSegments();
  const routeName = segments[0] ?? '';
  const isStackRoute = ['welcome', 'sign-in', 'sign-up', 'check-email', 'onboarding'].includes(routeName);
  const requiresSession = !['welcome', 'sign-in', 'sign-up', 'check-email'].includes(routeName);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getAccessToken(), getRefreshToken()])
      .then(async ([accessToken, refreshToken]) => {
        if (!active) return;
        let validSession = Boolean(accessToken && refreshToken);
        if (validSession && requiresSession) {
          try {
            await api.getSession();
          } catch {
            validSession = false;
            await clearTokens().catch(() => {});
          }
        }
        if (!active) return;
        setHasSession(validSession);
        if (!validSession && requiresSession) router.replace('/welcome');
      })
      .catch(() => {
        if (!active) return;
        setHasSession(false);
        if (requiresSession) router.replace('/welcome');
      });

    return () => {
      active = false;
    };
  }, [requiresSession]);

  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <AnimatedSplashOverlay />
      {requiresSession && hasSession !== true ? null : isStackRoute ? <Stack screenOptions={{ headerShown: false }} /> : <AppTabs />}
    </ThemeProvider>
  );
}
