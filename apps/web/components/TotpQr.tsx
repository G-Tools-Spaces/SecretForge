'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Render an otpauth:// URL as a scannable QR code.
 *
 * The QR is generated entirely in the browser with the `qrcode` library —
 * the TOTP secret never leaves the page, so no third-party QR service can
 * see it (important for a secrets vault).
 */
export default function TotpQr({ value, size = 176 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#101014', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'QR generation failed');
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return <p className="muted" style={{ fontSize: 12 }}>Could not render QR code — use manual entry below.</p>;
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        background: '#ffffff',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 0 0 1px var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="Two-factor authentication QR code" width={size - 16} height={size - 16} />
      ) : (
        <span className="spinner" />
      )}
    </div>
  );
}