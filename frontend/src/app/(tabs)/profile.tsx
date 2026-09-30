import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppText as Text } from '@/components/app-text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AppColors } from '@/constants/theme';
import { cryptoLogoUrl } from '@/constants/crypto';
import { ConnectBybitModal } from '@/components/connect-bybit-modal';
import { NetworkSwitch } from '@/components/network-switch';
import { api, type BrokerStatus, type Portfolio, type Profile as ProfileData, type Session } from '@/lib/api';
import { clearTokens, getLocalSetting, setLocalSetting } from '@/lib/secure';

const PROFILE_PREFERENCES_KEY = 'bob_profile_preferences';
const DEFAULT_PREFERENCES = { hideBalances: false, hideSmallBalances: false };
type ProfilePreferences = typeof DEFAULT_PREFERENCES;

function AssetLogo({ currency }: { currency: string }) {
	const [failedCurrency, setFailedCurrency] = useState('');
	const logoSymbol = currency === 'USDT' || currency === 'USDC' ? currency : `${currency}USDT`;
	const logo = cryptoLogoUrl(logoSymbol);

	return (
		<View style={styles.assetLogo}>
			{logo && failedCurrency !== currency ? (
				<Image source={{ uri: logo }} style={styles.assetLogoImage} onError={() => setFailedCurrency(currency)} />
			) : (
				<Text style={styles.assetLogoFallback}>{currency.slice(0, 1)}</Text>
			)}
		</View>
	);
}

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
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [preferences, setPreferences] = useState<ProfilePreferences>(DEFAULT_PREFERENCES);

	useEffect(() => {
		let active = true;
		getLocalSetting(PROFILE_PREFERENCES_KEY)
			.then((stored) => {
				if (!active || !stored) return;
				const parsed = JSON.parse(stored) as Partial<ProfilePreferences>;
				setPreferences({
					hideBalances: parsed.hideBalances === true,
					hideSmallBalances: parsed.hideSmallBalances === true,
				});
			})
			.catch(() => undefined);
		return () => { active = false; };
	}, []);

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
	const updatePreferences = (next: ProfilePreferences) => {
		setPreferences(next);
		setLocalSetting(PROFILE_PREFERENCES_KEY, JSON.stringify(next)).catch(() => undefined);
	};
	const refreshPortfolio = () => {
		setPortfolioLoading(true);
		setPortfolioError('');
		setPortfolioRequest((request) => request + 1);
	};
	const knownAssetValue = portfolio?.assets.reduce((total, asset) => total + (asset.usd_value ?? 0), 0) ?? 0;
	const equity = portfolio?.equity ?? (knownAssetValue > 0 ? knownAssetValue : null);
	const cryptoValue = portfolio?.assets
		.filter((asset) => asset.currency !== 'USDT')
		.reduce((total, asset) => total + (asset.usd_value ?? 0), 0) ?? 0;
	const assets = (portfolio?.assets ?? [])
		.filter((asset) => !preferences.hideSmallBalances || asset.usd_value === null || asset.usd_value >= 1)
		.sort((left, right) => (right.usd_value ?? -1) - (left.usd_value ?? -1));
	const displayMoney = (value: number | null | undefined) => preferences.hideBalances
		? '••••••'
		: value === null || value === undefined ? '--' : formatUsd(value);
	const displayQuantity = (value: number) => preferences.hideBalances ? '••••' : formatQuantity(value);

	if (loading) {
		return <SafeAreaView style={styles.loading}><ActivityIndicator color={AppColors.accentEnd} /></SafeAreaView>;
	}

	return (
		<SafeAreaView style={styles.container}>
			<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
				<View style={styles.pageHeader}>
					<Text style={styles.title}>Profile</Text>
					<View style={styles.headerActions}>
						<Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => setSettingsOpen(true)} style={styles.settingsButton}>
							<MaterialCommunityIcons name="cog-outline" size={21} color={AppColors.muted} />
						</Pressable>
					</View>
				</View>
				<View style={styles.identity}>
					<View style={styles.avatar}>
						{profile?.avatar_url ? (
							<Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
						) : (
							<Text style={styles.avatarText}>{(profile?.username ?? session?.email ?? 'B').slice(0, 1).toUpperCase()}</Text>
						)}
					</View>
					<View style={styles.identityText}>
						<Text style={styles.name}>{profile?.username ?? 'Set your username'}</Text>
						<Text style={styles.muted}>{session?.email}</Text>
					</View>
				</View>

				<View style={styles.sectionHeader}>
					<View>
						<Text style={styles.sectionTitle}>Portfolio</Text>
						<Text style={styles.sectionCaption}>Account value and asset balances</Text>
					</View>
					{broker?.connected ? (
						<Pressable accessibilityRole="button" accessibilityLabel="Refresh portfolio" onPress={refreshPortfolio} style={styles.refresh}>
							<MaterialCommunityIcons name="refresh" size={19} color={AppColors.accentEnd} />
						</Pressable>
					) : null}
				</View>

				{broker?.connected ? (
					<>
						<View style={styles.equityPanel}>
							<View style={styles.portfolioCardTop}>
								<View style={styles.equityLabelRow}>
									<Text style={styles.portfolioEyebrow}>TOTAL ACCOUNT EQUITY</Text>
									<Pressable accessibilityRole="button" accessibilityLabel={preferences.hideBalances ? 'Show balances' : 'Hide balances'} onPress={() => updatePreferences({ ...preferences, hideBalances: !preferences.hideBalances })} style={styles.visibilityButton}>
										<MaterialCommunityIcons name={preferences.hideBalances ? 'eye-off-outline' : 'eye-outline'} size={17} color="#A1A1AA" />
									</Pressable>
								</View>
								<View style={styles.modeBadge}>
									<View style={[styles.modeDot, broker.mode === 'mainnet' && styles.liveDot]} />
									<Text style={styles.modeText}>{broker.mode === 'mainnet' ? 'LIVE' : 'TESTNET'}</Text>
								</View>
							</View>
							{portfolioLoading ? (
								<ActivityIndicator color="#FFFFFF" style={styles.portfolioLoader} />
							) : (
								<Text style={styles.equity}>{displayMoney(equity)}</Text>
							)}
							<View style={styles.summaryDivider} />
							<View style={styles.summaryMetrics}>
								<View style={styles.summaryMetric}>
									<Text style={styles.summaryLabel}>AVAILABLE USDT</Text>
									<Text style={styles.summaryValue}>{displayMoney(portfolio?.balance)}</Text>
								</View>
								<View style={styles.metricDivider} />
								<View style={styles.summaryMetric}>
									<Text style={styles.summaryLabel}>OTHER ASSETS</Text>
									<Text style={styles.summaryValue}>{displayMoney(cryptoValue)}</Text>
								</View>
							</View>
						</View>

						<View style={styles.holdingsHeader}>
							<View>
								<Text style={styles.sectionTitle}>Your assets</Text>
								<Text style={styles.sectionCaption}>Sorted by market value</Text>
							</View>
							<Text style={styles.holdingCount}>{assets.length} {assets.length === 1 ? 'asset' : 'assets'}</Text>
						</View>
						{portfolioError ? (
							<View style={styles.emptyState}>
								<Text style={styles.muted}>{portfolioError}</Text>
								<Pressable onPress={refreshPortfolio} style={styles.retryButton}>
									<Text style={styles.retryText}>Try again</Text>
								</Pressable>
							</View>
						) : portfolioLoading ? null : assets.length ? (
							<View style={styles.assetsList}>
								{assets.map((asset) => {
									const share = equity && asset.usd_value !== null ? Math.min(asset.usd_value / equity, 1) : 0;
									return (
										<View key={asset.currency} style={styles.assetRow}>
											<View style={styles.assetMainRow}>
												<AssetLogo currency={asset.currency} />
												<View style={styles.assetIdentity}>
													<Text style={styles.assetCurrency}>{asset.currency}</Text>
													<Text style={styles.assetTotal}>{displayQuantity(asset.total)} {asset.currency}</Text>
												</View>
												<View style={styles.assetAmounts}>
													<Text style={styles.assetValue}>{displayMoney(asset.usd_value)}</Text>
													<Text style={styles.assetShare}>{share > 0 ? `${(share * 100).toFixed(1)}% of equity` : 'Value unavailable'}</Text>
												</View>
											</View>
											<View style={styles.assetDetailsRow}>
												<Text style={styles.assetDetail}>Available {displayQuantity(asset.available)}</Text>
												<Text style={styles.assetDetail}>Locked {displayQuantity(asset.locked)}</Text>
											</View>
											<View style={styles.shareTrack}>
												<View style={[styles.shareFill, { width: `${share * 100}%` }]} />
											</View>
										</View>
									);
								})}
							</View>
						) : (
							<View style={styles.emptyState}><Text style={styles.muted}>{preferences.hideSmallBalances ? 'No assets above $1.00.' : 'No assets with a balance yet.'}</Text></View>
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
			<Modal visible={settingsOpen} transparent animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
				<View style={styles.modalBackdrop}>
					<Pressable style={styles.modalScrim} onPress={() => setSettingsOpen(false)} accessibilityLabel="Close settings" />
					<ScrollView style={styles.settingsSheet} contentContainerStyle={styles.settingsSheetContent} showsVerticalScrollIndicator={false}>
						<View style={styles.settingsHeader}>
							<View>
								<Text style={styles.settingsEyebrow}>PREFERENCES</Text>
								<Text style={styles.settingsTitle}>Settings</Text>
							</View>
							<Pressable accessibilityRole="button" accessibilityLabel="Close settings" onPress={() => setSettingsOpen(false)} style={styles.settingsClose}>
								<MaterialCommunityIcons name="close" size={20} color={AppColors.muted} />
							</Pressable>
						</View>
						<Text style={styles.settingsSection}>PRIVACY & DISPLAY</Text>
						<SettingRow
							icon="eye-off-outline"
							title="Hide balances"
							description="Mask portfolio values and quantities on this device."
							value={preferences.hideBalances}
							onChange={(hideBalances) => updatePreferences({ ...preferences, hideBalances })}
						/>
						<SettingRow
							icon="filter-outline"
							title="Hide small balances"
							description="Hide assets valued below $1.00."
							value={preferences.hideSmallBalances}
							onChange={(hideSmallBalances) => updatePreferences({ ...preferences, hideSmallBalances })}
						/>
						<Text style={styles.settingsSection}>ACCOUNT</Text>
						<View style={styles.settingsAccountRow}>
							<View style={styles.settingsIcon}><MaterialCommunityIcons name="swap-horizontal" size={18} color={AppColors.accentEnd} /></View>
							<View style={styles.settingsAccountText}>
								<Text style={styles.settingTitle}>Trading network</Text>
								<Text style={styles.settingDescription}>{broker?.connected ? `Bybit ${broker.mode === 'mainnet' ? 'Mainnet' : 'Testnet'}` : 'No broker connected'}</Text>
							</View>
							<NetworkSwitch />
						</View>
						<Pressable onPress={() => { setSettingsOpen(false); setConnectOpen(true); }} style={styles.settingsActionRow}>
							<MaterialCommunityIcons name={broker?.connected ? 'key-outline' : 'link-variant'} size={18} color={AppColors.accentEnd} />
							<Text style={styles.settingsActionText}>{broker?.connected ? 'Update Bybit credentials' : 'Connect a Bybit account'}</Text>
							<MaterialCommunityIcons name="chevron-right" size={20} color={AppColors.faint} />
						</Pressable>
						{broker?.connected ? (
							<Pressable onPress={async () => { await disconnect(); setSettingsOpen(false); }} style={styles.settingsActionRow}>
								<MaterialCommunityIcons name="link-off" size={18} color={AppColors.danger} />
								<Text style={[styles.settingsActionText, styles.danger]}>Disconnect Bybit</Text>
							</Pressable>
						) : null}
						<Pressable onPress={() => { setSettingsOpen(false); signOut(); }} style={[styles.settingsActionRow, styles.signOutRow]}>
							<MaterialCommunityIcons name="logout" size={18} color={AppColors.danger} />
							<Text style={[styles.settingsActionText, styles.danger]}>Sign out</Text>
						</Pressable>
					</ScrollView>
				</View>
			</Modal>
			<ConnectBybitModal
				visible={connectOpen}
				initialMode={broker?.mode === 'mainnet' ? 'mainnet' : 'testnet'}
				onClose={() => setConnectOpen(false)}
				onConnected={setBroker}
			/>
		</SafeAreaView>
	);
}

function SettingRow({
	icon,
	title,
	description,
	value,
	onChange,
}: {
	icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
	title: string;
	description: string;
	value: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<View style={styles.settingRow}>
			<View style={styles.settingsIcon}><MaterialCommunityIcons name={icon} size={18} color={AppColors.accentEnd} /></View>
			<View style={styles.settingCopy}>
				<Text style={styles.settingTitle}>{title}</Text>
				<Text style={styles.settingDescription}>{description}</Text>
			</View>
			<Switch
				accessibilityLabel={title}
				value={value}
				onValueChange={onChange}
				trackColor={{ false: AppColors.hairline, true: AppColors.accent }}
				thumbColor="#FFFFFF"
			/>
		</View>
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
	pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 20 },
	headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
	settingsButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.surface, borderRadius: 9, borderWidth: 1, borderColor: AppColors.hairline },
	title: { color: '#FFFFFF', fontSize: 28, fontWeight: '700' },
	identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 24 },
	avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: AppColors.accentEnd, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
	avatarImage: { width: '100%', height: '100%', borderRadius: 26 },
	avatarText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
	identityText: { flex: 1, minWidth: 0 },
	name: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
	muted: { color: AppColors.muted, fontSize: 12, marginTop: 4 },
	sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
	sectionTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
	sectionCaption: { color: AppColors.faint, fontSize: 11, marginTop: 4 },
	refresh: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
	equityPanel: { padding: 18, borderRadius: 12, backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.hairline, borderTopColor: AppColors.accent },
	portfolioCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
	equityLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
	portfolioEyebrow: { color: AppColors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 0.9 },
	visibilityButton: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
	modeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 5, backgroundColor: AppColors.raised },
	modeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: AppColors.accent },
	liveDot: { backgroundColor: AppColors.success },
	modeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
	equity: { color: '#FFFFFF', fontSize: 30, fontWeight: '700', marginTop: 12, fontVariant: ['tabular-nums'] },
	portfolioLoader: { alignSelf: 'flex-start', marginTop: 19, marginBottom: 5 },
	summaryDivider: { height: 1, backgroundColor: AppColors.hairline, marginTop: 17, marginBottom: 15 },
	summaryMetrics: { flexDirection: 'row', alignItems: 'center' },
	summaryMetric: { flex: 1 },
	metricDivider: { width: 1, height: 32, backgroundColor: AppColors.hairline, marginHorizontal: 14 },
	summaryLabel: { color: AppColors.faint, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
	summaryValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', marginTop: 6, fontVariant: ['tabular-nums'] },
	holdingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 26, marginBottom: 12 },
	holdingCount: { color: AppColors.muted, fontSize: 11, fontWeight: '600' },
	assetsList: { borderTopWidth: 1, borderTopColor: AppColors.hairline },
	assetRow: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: AppColors.hairline },
	assetMainRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 11 },
	assetLogo: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: AppColors.raised, borderWidth: 1, borderColor: AppColors.hairline },
	assetLogoImage: { width: 23, height: 23 },
	assetLogoFallback: { color: AppColors.muted, fontSize: 14, fontWeight: '700' },
	assetIdentity: { flex: 1, minWidth: 0 },
	assetCurrency: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
	assetTotal: { color: AppColors.muted, fontSize: 10, marginTop: 3, fontVariant: ['tabular-nums'] },
	assetAmounts: { alignItems: 'flex-end', maxWidth: '42%' },
	assetValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
	assetShare: { color: AppColors.muted, fontSize: 10, marginTop: 3 },
	assetDetailsRow: { flexDirection: 'row', gap: 16, marginLeft: 45, marginTop: 8 },
	assetDetail: { color: AppColors.faint, fontSize: 10, fontVariant: ['tabular-nums'] },
	shareTrack: { height: 3, backgroundColor: AppColors.raised, borderRadius: 2, marginTop: 10, marginLeft: 45, overflow: 'hidden' },
	shareFill: { height: '100%', backgroundColor: AppColors.accent, borderRadius: 2 },
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
	modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.72)' },
	modalScrim: { ...StyleSheet.absoluteFill },
	settingsSheet: { maxHeight: '90%', backgroundColor: AppColors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: AppColors.hairline },
	settingsSheetContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 16 },
	settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
	settingsEyebrow: { color: AppColors.accent, fontSize: 9, fontWeight: '700', letterSpacing: 1.4 },
	settingsTitle: { color: '#FFFFFF', fontSize: 23, fontWeight: '700', marginTop: 5 },
	settingsClose: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: AppColors.raised },
	settingsSection: { color: AppColors.faint, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginTop: 18, marginBottom: 6 },
	settingRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: AppColors.hairline },
	settingsIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: AppColors.raised },
	settingCopy: { flex: 1, minWidth: 0 },
	settingTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
	settingDescription: { color: AppColors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
	settingsAccountRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: AppColors.hairline },
	settingsAccountText: { flex: 1 },
	settingsActionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: AppColors.hairline },
	settingsActionText: { flex: 1, color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
	signOutRow: { borderBottomWidth: 0, marginTop: 4 },
});
