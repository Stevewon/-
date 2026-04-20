interface Props {
  size?: number;
  showText?: boolean;
  className?: string;
}

export default function QuantaLogo({ size = 32, showText = true, className = '' }: Props) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Background */}
        <rect width="40" height="40" rx="10" fill="url(#logo-gradient)" />
        {/* Q shape */}
        <path
          d="M20 8C13.373 8 8 13.373 8 20C8 26.627 13.373 32 20 32C23.314 32 26.314 30.657 28.486 28.486L31 31L33 29L30.486 26.486C31.81 24.628 32.585 22.372 32.585 19.94C32.585 13.343 27.212 8 20 8ZM20 28C15.582 28 12 24.418 12 20C12 15.582 15.582 12 20 12C24.418 12 28 15.582 28 20C28 22.21 27.107 24.21 25.658 25.658L22 22L20 24L23.658 27.658C22.552 28.21 21.314 28 20 28Z"
          fill="#0B0E11"
          fillOpacity="0.9"
        />
        {/* Inner accent line */}
        <path
          d="M20 14C16.686 14 14 16.686 14 20C14 23.314 16.686 26 20 26"
          stroke="#0B0E11"
          strokeWidth="1.5"
          strokeOpacity="0.3"
          fill="none"
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="logo-gradient" x1="0" y1="0" x2="40" y2="40">
            <stop stopColor="#F0B90B" />
            <stop offset="1" stopColor="#F8D12F" />
          </linearGradient>
        </defs>
      </svg>
      {showText && (
        <div className="flex items-baseline">
          <span className="text-lg font-bold text-exchange-text tracking-tight">Quanta</span>
          <span className="text-lg font-bold text-exchange-yellow tracking-tight">EX</span>
        </div>
      )}
    </div>
  );
}
