import { useEffect, useState } from 'react';
import QRCodeLib from 'qrcode';

interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
  level?: 'L' | 'M' | 'Q' | 'H';
}

/**
 * QRCode component - renders a QR code as a data URL image.
 * Uses the `qrcode` package with dark-theme friendly colors.
 */
export default function QRCode({ value, size = 180, className = '', level = 'M' }: QRCodeProps) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    if (!value) return;
    QRCodeLib.toDataURL(value, {
      errorCorrectionLevel: level,
      margin: 2,
      width: size * 2, // render at 2x for crispness on retina
      color: {
        dark: '#0B0E11',
        light: '#F5F5F5',
      },
    }).then(setDataUrl).catch(() => setDataUrl(''));
  }, [value, size, level]);

  if (!dataUrl) {
    return (
      <div
        className={`flex items-center justify-center bg-exchange-hover/40 rounded-lg ${className}`}
        style={{ width: size, height: size }}
      >
        <span className="text-xs text-exchange-text-third">Loading...</span>
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt="QR Code"
      className={`rounded-lg border border-exchange-border bg-[#F5F5F5] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
