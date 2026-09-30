import { Link, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppText as Text } from '@/components/app-text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';

export default function CheckEmailScreen() {
	const { email } = useLocalSearchParams<{ email?: string }>();

	return (
		<SafeAreaView style={styles.container}>
			<View style={styles.content}>
				<View style={styles.iconHalo}>
					<View style={styles.iconCircle}>
						<MaterialCommunityIcons name="email-check-outline" size={28} color={AppColors.accentEnd} />
					</View>
				</View>
				<Text style={styles.title}>Check your email</Text>
				<Text style={styles.subtitle}>
					We sent a secure sign-in link to <Text style={styles.email}>{email ?? 'your inbox'}</Text>.
					{' '}Open it on this device to continue.
				</Text>
				<Link href="/welcome" style={styles.link}>Back to welcome</Link>
			</View>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: AppColors.background },
	content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
	iconHalo: {
		width: 88,
		height: 88,
		borderRadius: 44,
		backgroundColor: AppColors.raised,
		alignItems: 'center',
		justifyContent: 'center',
	},
	iconCircle: {
		width: 54,
		height: 54,
		borderRadius: 27,
		backgroundColor: AppColors.surface,
		borderWidth: 1,
		borderColor: AppColors.hairline,
		alignItems: 'center',
		justifyContent: 'center',
	},
	title: { color: '#FFFFFF', fontSize: 22, fontWeight: '600', marginTop: 22 },
	subtitle: { color: AppColors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 9 },
	email: { color: '#FFFFFF', fontWeight: '600' },
	link: {
		color: '#FFFFFF',
		backgroundColor: AppColors.accentEnd,
		fontSize: 14,
		fontWeight: '600',
		marginTop: 28,
		paddingVertical: 13,
		paddingHorizontal: 18,
		borderRadius: 8,
		overflow: 'hidden',
	},
});