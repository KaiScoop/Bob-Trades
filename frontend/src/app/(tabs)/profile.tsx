import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppText as Text } from '@/components/app-text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AppColors } from '@/constants/theme';
import { ConnectBybitModal } from '@/components/connect-bybit-modal';
import { api, type BrokerStatus, type Portfolio, type Profile as ProfileData, type Session } from '@/lib/api';
import { clearTokens } from '@/lib/secure';

export default function ProfileScreen() {
	const [session, setSession] = useState<Session | null>(null);
	const [profile, setProfile] = useState<ProfileData | null>(null);
	const [broker, setBroker] = useState<BrokerStatus | null>(null);
	const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
	const [loading, setLoading] = useState(true);
	const [portfolioLoading, setPortfolioLoading] = useState(true);
	const [portfolioError, setPortfolioError] = useState('');
	const [portfolioRequest, setPortfolioRequest] = useState(0);
	const [connectOpen, setConnectOpen] = useState(false);

	useEffect(() => {
		let active = true;
		Promise.all([api.getSession(), api.getProfile(), api.getBrokerStatus()])
			.then(([sessionResponse, profileResponse, brokerResponse]) => {
				if (!active) return;
				setSession(sessionResponse);
				setProfile(profileResponse);
				setBroker(brokerResponse);
			})
			.catch(() => {
				if (active) setBroker({ connected: false, mode: null, balance: 0 });
			})
			.finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, []);

	useEffect(() => {
		if (!broker?.connected) return;
		let active = true;
		api.getPortfolio()
			.then((result) => {
				if (!active) return;
				setPortfolio(result);
				setPortfolioError('');
			})
			.catch(() => {
				if (!active) return;
				setPortfolio(null);
				setPortfolioError('Portfolio data is unavailable right now.');
			})
			.finally(() => { if (active) setPortfolioLoading(false); });
		return () => { active = false; };
	}, [broker?.connected, broker?.mode, portfolioRequest]);

	const signOut = () => clearTokens().then(() => router.replace('/welcome'));
	const disconnect = async () => {
		await api.disconnectBybit();
		setBroker({ connected: false, mode: null, balance: 0 });
		setPortfolio(null);
	};
	const refreshPortfolio = () => {
		setPortfolioLoading(true);
		setPortfolioError('');
		setPortfolioRequest((request) => request + 1);
	};

	if (loading) {
		return <SafeAreaView style={styles.loading}><ActivityIndicator color={AppColors.accentEnd} /></SafeAreaView>;
	}

	return (
		<SafeAreaView style={styles.container}>
			<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
				<Text style={styles.title}>Profile</Text>
				<View style={styles.identity}>
					<View style={styles.avatar}>
						<Text style={styles.avatarText}>{(profile?.username ?? session?.email ?? 'B').slice(0, 1).toUpperCase()}</Text>
					</View>
					<View style={styles.identityText}>
						<Text style={styles.name}>{profile?.username ?? 'Set your username'}</Text>
						<Text style={styles.muted}>{session?.email}</Text>
					</View>
				</View>

				<View style={styles.sectionHeader}>
					<Text style={styles.sectionTitle}>Portfolio</Text>
					{broker?.connected ? (
						<Pressable accessibilityRole="button" accessibilityLabel="Refresh portfolio" onPress={refreshPortfolio} style={styles.refresh}>
							<MaterialCommunityIcons name="refresh" size={19} color={AppColors.accentEnd} />
						</Pressable>
					) : null}
				</View>

				{broker?.connected ? (
					<>
						<View style={styles.portfolioCard}>
							<View style={styles.portfolioCardTop}>
								<Text style={styles.portfolioEyebrow}>ACCOUNT EQUITY</Text>
								<View style={styles.modeBadge}><Text style={styles.modeText}>{broker.mode}</Text></View>
							</View>
							{portfolioLoading ? (
								<ActivityIndicator color="#FFFFFF" style={styles.portfolioLoader} />
							) : (
								<Text style={styles.equity}>{portfolio?.equity === null || portfolio?.equity === undefined ? '--' : formatUsd(portfolio.equity)}</Text>
							)}
							<View style={styles.availableRow}>
								<Text style={styles.availableLabel}>Available {portfolio?.asset ?? 'USDT'}</Text>
								<Text style={styles.availableValue}>{portfolio ? formatUsd(portfolio.balance) : '--'}</Text>
							</View>
						</View>

						<View style={styles.holdingsHeader}>
							<Text style={styles.sectionTitle}>Assets</Text>
							<Text style={styles.muted}>{portfolio?.assets.length ?? 0} holdings</Text>
						</View>
						{portfolioError ? (
							<View style={styles.emptyState}>
								<Text style={styles.muted}>{portfolioError}</Text>
								<Pressable onPress={refreshPortfolio} style={styles.retryButton}>
									<Text style={styles.retryText}>Try again</Text>
								</Pressable>
							</View>
						) : portfolioLoading ? null : portfolio?.assets.length ? (
							<View style={styles.assetsList}>
								{portfolio.assets.map((asset) => (
									<View key={asset.currency} style={styles.assetRow}>
										<View style={styles.assetIdentity}>
											<Text style={styles.assetCurrency}>{asset.currency}</Text>
											<Text style={styles.assetTotal}>{formatQuantity(asset.total)} total</Text>
										</View>
										<View style={styles.assetAmounts}>
											<Text style={styles.assetValue}>{asset.usd_value === null ? '--' : formatUsd(asset.usd_value)}</Text>
											<Text style={styles.assetAvailable}>{formatQuantity(asset.available)} available</Text>
											{asset.locked > 0 ? <Text style={styles.assetLocked}>{formatQuantity(asset.locked)} locked</Text> : null}
										</View>
									</View>
								))}
							</View>
						) : (
							<View style={styles.emptyState}><Text style={styles.muted}>No assets with a balance yet.</Text></View>
						)}
					</>
				) : (
					<View style={styles.emptyState}>
						<Text style={styles.emptyTitle}>Connect Bybit</Text>
						<Text style={styles.muted}>Connect your account to see your portfolio and asset balances.</Text>
						<Pressable onPress={() => setConnectOpen(true)} style={styles.connectButton}>
							<Text style={styles.connectText}>Connect account</Text>
						</Pressable>
					</View>
				)}

				<View style={styles.brokerSection}>
					<View style={styles.brokerInfo}>
						<Text style={styles.brokerTitle}>Broker</Text>
						<Text style={styles.muted}>{broker?.connected ? `Bybit · ${broker.mode}` : 'Not connected'}</Text>
					</View>
					{broker?.connected ? (
						<Pressable onPress={disconnect} style={styles.outline}>
							<Text style={styles.danger}>Disconnect</Text>
						</Pressable>
					) : null}
				</View>

				<Pressable onPress={signOut} style={styles.signOut}>
					<Text style={styles.danger}>Sign out</Text>
				</Pressable>
			</ScrollView>
			<ConnectBybitModal
				visible={connectOpen}
				initialMode={broker?.mode === 'mainnet' ? 'mainnet' : 'testnet'}
				onClose={() => setConnectOpen(false)}
				onConnected={setBroker}
			/>
		</SafeAreaView>
	);
}

function formatUsd(value: number) {
	return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQuantity(value: number) {
	return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

const styles = StyleSheet.create({
	loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.background },
	container: { flex: 1, backgroundColor: AppColors.background },
	content: { padding: 20, paddingBottom: 48 },
	title: { color: '#FFFFFF', fontSize: 28, fontWeight: '700', marginTop: 12, marginBottom: 20 },
	identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 24 },
	avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: AppColors.accentEnd, alignItems: 'center', justifyContent: 'center' },
	avatarText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
	identityText: { flex: 1, minWidth: 0 },
	name: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
	muted: { color: AppColors.muted, fontSize: 12, marginTop: 4 },
	sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
	sectionTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
	refresh: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
	portfolioCard: { padding: 18, borderRadius: 10, backgroundColor: AppColors.accentEnd },
	portfolioCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
	portfolioEyebrow: { color: '#DCEBFF', fontSize: 10, fontWeight: '700' },
	modeBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, backgroundColor: 'rgba(0,0,0,0.2)' },
	modeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
	equity: { color: '#FFFFFF', fontSize: 30, fontWeight: '700', marginTop: 12, fontVariant: ['tabular-nums'] },
	portfolioLoader: { alignSelf: 'flex-start', marginTop: 19, marginBottom: 5 },
	availableRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, marginTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.25)' },
	availableLabel: { color: '#DCEBFF', fontSize: 12 },
	availableValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
	holdingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 26, marginBottom: 6 },
	assetsList: { borderTopWidth: 1, borderTopColor: AppColors.hairline },
	assetRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: AppColors.hairline },
	assetIdentity: { flex: 1, minWidth: 0 },
	assetCurrency: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
	assetTotal: { color: AppColors.muted, fontSize: 11, marginTop: 3 },
	assetAmounts: { alignItems: 'flex-end' },
	assetValue: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
	assetAvailable: { color: AppColors.muted, fontSize: 10, marginTop: 3, fontVariant: ['tabular-nums'] },
	assetLocked: { color: AppColors.muted, fontSize: 10, marginTop: 3, fontVariant: ['tabular-nums'] },
	emptyState: { paddingVertical: 18 },
	emptyTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
	retryButton: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 8 },
	retryText: { color: AppColors.accentEnd, fontSize: 12, fontWeight: '600' },
	connectButton: { alignSelf: 'flex-start', marginTop: 14, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 7, backgroundColor: AppColors.accentEnd },
	connectText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
	brokerSection: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: AppColors.hairline, paddingVertical: 16, marginTop: 20 },
	brokerInfo: { flex: 1 },
	brokerTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
	outline: { borderColor: AppColors.hairline, borderWidth: 1, borderRadius: 7, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
	danger: { color: AppColors.danger, fontSize: 12, fontWeight: '600' },
	signOut: { alignItems: 'center', padding: 14, marginTop: 10 },
});
