import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { AppText as Text } from '@/components/app-text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.intro}>
          <Image
            source={require('@/assets/images/bob-trades-logo.png')}
            contentFit="contain"
            style={styles.logo}
            accessibilityLabel="Bob Trades logo"
          />
          <Text style={styles.title}>Your Journey Starts Here</Text>
          <Text style={styles.subtitle}>
            Discover a beginner-friendly platform built for simple, secure, and smart investing.
          </Text>
        </View>

        <Link href="/sign-up" asChild>
          <Pressable accessibilityRole="button" style={styles.button}>
            <Text style={styles.buttonText}>Get Started</Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  content: { flex: 1, paddingHorizontal: 18, paddingTop: 32, paddingBottom: 14 },
  logo: { width: 260, height: 260, marginBottom: 12 },
  intro: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  title: { color: '#FFFFFF', fontSize: 23, lineHeight: 30, fontWeight: '600', textAlign: 'center' },
  subtitle: {
    color: AppColors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 330,
  },
  button: {
    minHeight: 50,
    borderRadius: 8,
    backgroundColor: AppColors.accentEnd,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});