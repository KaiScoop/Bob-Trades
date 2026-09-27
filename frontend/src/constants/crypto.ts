const ICONS: Record<string, string> = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  SOLUSDT: 'solana',
  BNBUSDT: 'binancecoin',
  XRPUSDT: 'ripple',
  ADAUSDT: 'cardano',
  LINKUSDT: 'chainlink',
};

export const cryptoLogoUrl = (symbol: string) => {
  const icon = ICONS[symbol];
  return icon ? `https://cdn.jsdelivr.net/gh/simplr-sh/coin-logos/images/${icon}/standard.png` : null;
};