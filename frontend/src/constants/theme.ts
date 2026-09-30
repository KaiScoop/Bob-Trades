/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#FFFFFF',
    background: '#000000',
    backgroundElement: '#0A0A0A',
    backgroundSelected: '#111111',
    textSecondary: '#A1A1AA',
  },
  dark: {
    text: '#FFFFFF',
    background: '#000000',
    backgroundElement: '#0A0A0A',
    backgroundSelected: '#111111',
    textSecondary: '#A1A1AA',
  },
} as const;

export const AppColors = {
  background: '#000000',
  surface: '#0A0A0A',
  raised: '#111111',
  hairline: '#1F1F1F',
  muted: '#A1A1AA',
  faint: '#71717A',
  accent: '#0081FB',
  accentEnd: '#0081FB',
  success: '#22C55E',
  danger: '#EF4444',
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'GoogleSansFlex_400Regular',
    sansMedium: 'GoogleSansFlex_500Medium',
    sansSemiBold: 'GoogleSansFlex_600SemiBold',
    sansBold: 'GoogleSansFlex_700Bold',
    display: 'InstrumentSans_400Regular',
    displayMedium: 'InstrumentSans_500Medium',
    displaySemiBold: 'InstrumentSans_600SemiBold',
    displayBold: 'InstrumentSans_700Bold',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'GoogleSansFlex_400Regular',
    sansMedium: 'GoogleSansFlex_500Medium',
    sansSemiBold: 'GoogleSansFlex_600SemiBold',
    sansBold: 'GoogleSansFlex_700Bold',
    display: 'InstrumentSans_400Regular',
    displayMedium: 'InstrumentSans_500Medium',
    displaySemiBold: 'InstrumentSans_600SemiBold',
    displayBold: 'InstrumentSans_700Bold',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-sans)',
    sansMedium: 'GoogleSansFlex_500Medium',
    sansSemiBold: 'GoogleSansFlex_600SemiBold',
    sansBold: 'GoogleSansFlex_700Bold',
    display: 'var(--font-display)',
    displayMedium: 'InstrumentSans_500Medium',
    displaySemiBold: 'InstrumentSans_600SemiBold',
    displayBold: 'InstrumentSans_700Bold',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
