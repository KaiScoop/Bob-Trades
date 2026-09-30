import { DarkTheme, router, Stack, ThemeProvider, usePathname, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { GoogleSansFlex_400Regular } from '@expo-google-fonts/google-sans-flex/400Regular';
import { GoogleSansFlex_500Medium } from '@expo-google-fonts/google-sans-flex/500Medium';
import { GoogleSansFlex_600SemiBold } from '@expo-google-fonts/google-sans-flex/600SemiBold';
import { GoogleSansFlex_700Bold } from '@expo-google-fonts/google-sans-flex/700Bold';
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';
import { InstrumentSans_700Bold } from '@expo-google-fonts/instrument-sans/700Bold';
import { api } from '@/lib/api';
import { clearTokens, getAccessToken, getRefreshToken, storeMagicLinkFromUrl } from '@/lib/secure';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const [fontsLoaded, fontError] = useFonts({
    GoogleSansFlex_400Regular,
    GoogleSansFlex_500Medium,
    GoogleSansFlex_600SemiBold,
    GoogleSansFlex_700Bold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });
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

  if (!fontsLoaded && !fontError) return null;

  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="welcome" options={authScreenOptions} />
        <Stack.Protected guard={hasSession === true}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="market/[symbol]" />
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={hasSession !== true}>
          <Stack.Screen name="sign-in" options={authScreenOptions} />
          <Stack.Screen name="sign-up" options={authScreenOptions} />
          <Stack.Screen name="check-email" options={authScreenOptions} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

const authScreenOptions = {
  animation: 'slide_from_right' as const,
  contentStyle: { backgroundColor: '#000000' },
};
