const ICONS: Record<string, string> = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  SOLUSDT: 'solana',
  BNBUSDT: 'binancecoin',
  XRPUSDT: 'ripple',
  ADAUSDT: 'cardano',
  LINKUSDT: 'chainlink',
  USDT: 'tether',
  USDC: 'usd-coin',
  DOGEUSDT: 'dogecoin',
  DOTUSDT: 'polkadot',
  LTCUSDT: 'litecoin',
  TRXUSDT: 'tron',
  AVAXUSDT: 'avalanche',
  TONUSDT: 'toncoin',
  BCHUSDT: 'bitcoin-cash',
  ATOMUSDT: 'cosmos',
};

export const cryptoLogoUrl = (symbol: string) => {
  const icon = ICONS[symbol];
  return icon ? `https://cdn.jsdelivr.net/gh/simplr-sh/coin-logos/images/${icon}/standard.png` : null;
};