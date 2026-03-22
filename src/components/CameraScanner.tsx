'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Normal "no QR in frame" messages from html5-qrcode - suppress these (not real errors). */
const SUPPRESS_ERROR_PATTERNS = [
  'No MultiFormat Readers',
  'No barcode or QR code detected',
  'NotFoundException',
  'FormatException',
];

/** Real camera/initialization failures - only show banner for these. */
const SHOW_ERROR_PATTERNS = [
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'Camera access denied',
];

function isRealCameraError(msg: string): boolean {
  return SHOW_ERROR_PATTERNS.some((p) => msg.includes(p));
}

function isSuppressibleScanError(msg: string): boolean {
  return SUPPRESS_ERROR_PATTERNS.some((p) => msg.includes(p));
}

interface CameraScannerProps {
  onScan: (code: string) => void;
  isActive: boolean;
  /** When true, fills parent container for embedded viewport */
  fillContainer?: boolean;
}

export default function CameraScanner({ onScan, isActive, fillContainer }: CameraScannerProps) {
  const t = useTranslations('scan');
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const [error, setError] = useState('');
  const startedRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

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
            onScanRef.current(decodedText);
          },
          (errorMessage: string) => {
            // Suppress normal "no QR in frame" errors (fired every frame when nothing to decode)
            if (isSuppressibleScanError(errorMessage)) return;
            // Only show banner for actual camera/initialization failures
            if (isRealCameraError(errorMessage)) {
              setError(t('scanError'));
            }
          }
        );
        startedRef.current = true;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // Only show banner for actual camera/initialization failures
        if (isRealCameraError(errMsg) || errMsg.includes('device not found')) {
          setError(errMsg.includes('NotFoundError') ? t('scanError') + ' (No camera found)' : t('scanError'));
        } else {
          console.error('Camera error:', errMsg);
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
  }, [isActive, t]);

  if (!isActive) return null;

  return (
    <div className={fillContainer ? 'absolute inset-0 w-full h-full min-h-0 [&_#qr-reader]:!w-full [&_#qr-reader]:!h-full' : 'w-full max-w-md mx-auto'}>
      <div id="qr-reader" className={fillContainer ? 'w-full h-full min-h-0' : 'rounded-xl overflow-hidden'} />
      {error && (
        <p className="text-center text-red-500 mt-2 text-sm">{error}</p>
      )}
      <p className="text-center text-text-secondary mt-3 text-sm">
        {t('scanning')}
      </p>
    </div>
  );
}
