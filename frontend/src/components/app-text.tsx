import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

import { Fonts } from '@/constants/theme';

type TypographyVariant = 'body' | 'display';

type AppTextProps = TextProps & {
  variant?: TypographyVariant;
};

function fontFamilyFor(variant: TypographyVariant, fontWeight: number) {
  if (variant === 'display') {
    if (fontWeight >= 650) return Fonts.displayBold;
    if (fontWeight >= 550) return Fonts.displaySemiBold;
    if (fontWeight >= 450) return Fonts.displayMedium;
    return Fonts.display;
  }

  if (fontWeight >= 650) return Fonts.sansBold;
  if (fontWeight >= 550) return Fonts.sansSemiBold;
  if (fontWeight >= 450) return Fonts.sansMedium;
  return Fonts.sans;
}

export function AppText({ style, variant, ...props }: AppTextProps) {
  const flattenedStyle = StyleSheet.flatten(style);
  const fontSize = typeof flattenedStyle?.fontSize === 'number' ? flattenedStyle.fontSize : 0;
  const styleWeight = flattenedStyle?.fontWeight;
  const fontWeight = styleWeight === 'bold'
    ? 700
    : styleWeight === 'normal'
      ? 400
      : Number.parseInt(String(styleWeight ?? 400), 10) || 400;
  const resolvedVariant = variant ?? (fontSize >= 24 ? 'display' : 'body');
  const fontFamily = fontFamilyFor(resolvedVariant, fontWeight);

  return <NativeText {...props} style={[{ fontFamily }, style]} />;
}

export function AppTextInput({ style, ...props }: TextInputProps) {
  return <NativeTextInput {...props} style={[styles.input, style]} />;
}

const styles = StyleSheet.create({
  input: { fontFamily: Fonts.sans },
});