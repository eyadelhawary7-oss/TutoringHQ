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
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;

    const startScanner = async () => {
      // Wait for the DOM element to be available
      await new Promise(resolve => requestAnimationFrame(resolve));

      if (cancelled) return;

      const element = document.getElementById('qr-reader');
      if (!element) {
        console.error('CameraScanner: qr-reader element not found');
        return;
      }

      try {
        const { Html5Qrcode } = await import('html5-qrcode');

        if (cancelled) return;

        const html5QrCode = new Html5Qrcode('qr-reader');
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
        startedRef.current = true;
      } catch (err: any) {
        const errMsg = String(err);
        if (errMsg.includes('NotFoundError') || errMsg.includes('device not found')) {
          setError(t('scanError') + ' (No camera found)');
        } else {
          console.error('Camera error:', err);
          setError(t('scanError'));
        }
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner && startedRef.current) {
        scanner.stop().then(() => {
          startedRef.current = false;
          scannerRef.current = null;
        }).catch(() => {
          startedRef.current = false;
          scannerRef.current = null;
        });
      } else {
        scannerRef.current = null;
      }
    };
  }, [isActive, onScan, t]);

  if (!isActive) return null;

  return (
    <div className="w-full max-w-md mx-auto">
      <div id="qr-reader" className="rounded-xl overflow-hidden" />
      {error && (
        <p className="text-center text-red-500 mt-2 text-sm">{error}</p>
      )}
      <p className="text-center text-text-secondary mt-3 text-sm">
        {t('scanning')}
      </p>
    </div>
  );
}
