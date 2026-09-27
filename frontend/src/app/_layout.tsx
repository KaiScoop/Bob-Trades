import { DarkTheme, router, Stack, ThemeProvider, usePathname, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { api } from '@/lib/api';
import { clearTokens, getAccessToken, getRefreshToken, storeMagicLinkFromUrl } from '@/lib/secure';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const segments = useSegments();
  const routeName = segments[0] ?? '';
  const routerPathname = usePathname();
  const pathname = typeof window !== 'undefined' ? window.location.pathname : routerPathname;
  const isPublicPath = ['/welcome', '/sign-in', '/sign-up', '/check-email'].includes(pathname);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const browserUrl = typeof window !== 'undefined' ? window.location.href : null;
    Promise.resolve(browserUrl ?? Linking.getInitialURL())
      .then(storeMagicLinkFromUrl)
      .then(() => Promise.all([getAccessToken(), getRefreshToken()]))
      .then(async ([accessToken, refreshToken]) => {
        if (!active) return;
        let validSession = Boolean(accessToken && refreshToken);
        if (validSession) {
          try {
            await api.getSession();
          } catch {
            validSession = false;
            await clearTokens().catch(() => {});
          }
        }
        if (!active) return;
        setHasSession(validSession);
      })
      .catch(async () => {
        if (!active) return;
        await clearTokens().catch(() => {});
        if (!active) return;
        setHasSession(false);
      });

    return () => {
      active = false;
    };
  }, [routeName]);

  useEffect(() => {
    if (hasSession === false && !isPublicPath) {
      router.replace('/welcome');
    } else if (hasSession && (pathname === '/welcome' || routeName === 'welcome')) {
      router.replace('/');
    }
  }, [hasSession, isPublicPath, pathname, routeName]);

  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="welcome" />
        <Stack.Protected guard={hasSession === true}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={hasSession !== true}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="sign-up" />
          <Stack.Screen name="check-email" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
