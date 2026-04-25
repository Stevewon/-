const COIN_COLORS: Record<string, { bg: string; text: string }> = {
  BTC: { bg: '#F7931A', text: '#FFF' },
  ETH: { bg: '#627EEA', text: '#FFF' },
  BNB: { bg: '#F3BA2F', text: '#000' },
  SOL: { bg: '#9945FF', text: '#FFF' },
  XRP: { bg: '#23292F', text: '#FFF' },
  ADA: { bg: '#0033AD', text: '#FFF' },
  DOGE: { bg: '#C2A633', text: '#FFF' },
  DOT: { bg: '#E6007A', text: '#FFF' },
  AVAX: { bg: '#E84142', text: '#FFF' },
  MATIC: { bg: '#8247E5', text: '#FFF' },
  QTA: { bg: '#F0B90B', text: '#000' },
  USDT: { bg: '#26A17B', text: '#FFF' },
  USDC: { bg: '#2775CA', text: '#FFF' },
};

const COIN_SYMBOLS: Record<string, string> = {
  BTC: '\u20BF',
  ETH: '\u039E',
  BNB: 'B',
  SOL: 'S',
  XRP: 'X',
  ADA: 'A',
  DOGE: 'D',
  DOT: '\u25CF',
  AVAX: 'A',
  MATIC: 'M',
  QTA: 'Q',
  USDT: '$',
  USDC: '$',
};

interface Props {
  symbol: string;
  size?: number;
  className?: string;
}

export default function CoinIcon({ symbol, size = 28, className = '' }: Props) {
  const colors = COIN_COLORS[symbol] || { bg: '#5E6673', text: '#FFF' };
  const displayChar = COIN_SYMBOLS[symbol] || symbol.slice(0, 1);
  const fontSize = size < 24 ? size * 0.4 : size * 0.38;

  return (
    <div
      className={`inline-flex items-center justify-center rounded-full shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${colors.bg}, ${colors.bg}dd)`,
        color: colors.text,
        fontSize: `${fontSize}px`,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: `0 2px 8px ${colors.bg}40`,
      }}
    >
      {displayChar}
    </div>
  );
}
