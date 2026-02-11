'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

interface CameraScannerProps {
  onScan: (code: string) => void;
  isActive: boolean;
}

export default function CameraScanner({ onScan, isActive }: CameraScannerProps) {
  const t = useTranslations('scan');
  const scannerRef = useRef<any>(null);
  const [error, setError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive) return;

    let html5QrCode: any = null;

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        html5QrCode = new Html5Qrcode('qr-reader');
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText: string) => {
            onScan(decodedText);
          },
          () => {
            // Ignore scan failures (expected when no QR in frame)
          }
        );
      } catch (err) {
        console.error('Camera error:', err);
        setError(t('scanError'));
      }
    };

    startScanner();

    return () => {
      if (html5QrCode) {
        html5QrCode.stop().catch(() => {});
      }
    };
  }, [isActive, onScan, t]);

  if (!isActive) return null;

  return (
    <div ref={containerRef} className="w-full max-w-md mx-auto">
      <div id="qr-reader" className="rounded-xl overflow-hidden" />
      {error && (
        <p className="text-center text-red-500 mt-2 text-sm">{error}</p>
      )}
      <p className="text-center text-gray-500 dark:text-gray-400 mt-3 text-sm">
        {t('scanning')}
      </p>
    </div>
  );
}
