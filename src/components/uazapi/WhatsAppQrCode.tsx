import { QRCodeSVG } from 'qrcode.react';

interface WhatsAppQrCodeProps {
  value: string;
  className?: string;
  size?: number;
}

function isBase64Image(value: string) {
  const normalized = value.trim().replace(/\s/g, '');
  return normalized.length > 200 &&
    /^[A-Za-z0-9+/=]+$/.test(normalized) &&
    /^(iVBORw0KGgo|\/9j\/|R0lGODlh|R0lGODdh|UklGR)/.test(normalized);
}

function getImageSrc(value: string) {
  const normalized = value.trim();
  if (normalized.startsWith('data:image/')) return normalized;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (isBase64Image(normalized)) return `data:image/png;base64,${normalized}`;
  return null;
}

export function WhatsAppQrCode({ value, className, size = 256 }: WhatsAppQrCodeProps) {
  const imageSrc = getImageSrc(value);

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt="QR Code WhatsApp"
        className={className}
      />
    );
  }

  return (
    <QRCodeSVG
      value={value}
      size={size}
      level="M"
      marginSize={4}
      className={className}
      title="QR Code WhatsApp"
    />
  );
}
