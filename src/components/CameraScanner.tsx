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
  /** Camera tab has focus - controls permission CTA visibility */
  cameraTabActive: boolean;
  onRequestManual?: () => void;
}

type PermissionState = 'idle' | 'granted' | 'denied';

export default function CameraScanner({
  onScan,
  isActive,
  fillContainer,
  cameraTabActive,
  onRequestManual,
}: CameraScannerProps) {
  const t = useTranslations('scanner.camera');
  const tScan = useTranslations('scan');
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const [error, setError] = useState('');
  const startedRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [permission, setPermission] = useState<PermissionState>('idle');

  useEffect(() => {
    if (!cameraTabActive || !isActive) return;
    if (permission !== 'idle') return;
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: 'camera' as PermissionName })
      .then((status) => {
        if (cancelled) return;
        if (status.state === 'granted') setPermission('granted');
        if (status.state === 'denied') setPermission('denied');
        status.onchange = () => {
          if (status.state === 'granted') setPermission('granted');
          if (status.state === 'denied') setPermission('denied');
        };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cameraTabActive, isActive, permission]);

  const requestCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      stream.getTracks().forEach((tr) => tr.stop());
      setPermission('granted');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('NotAllowed') || errMsg.includes('Permission')) {
        setPermission('denied');
      } else if (isRealCameraError(errMsg) || errMsg.includes('device not found')) {
        setError(t('hardwareError'));
        setPermission('denied');
      } else {
        console.error('Camera permission:', errMsg);
        setPermission('denied');
      }
    }
  };

  useEffect(() => {
    if (!isActive || permission !== 'granted') return;

    let cancelled = false;

    const startScanner = async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));

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
            if (isSuppressibleScanError(errorMessage)) return;
            if (isRealCameraError(errorMessage)) {
              setError(t('hardwareError'));
            }
          },
        );
        startedRef.current = true;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (isRealCameraError(errMsg) || errMsg.includes('device not found')) {
          setError(errMsg.includes('NotFoundError') ? t('noCamera') : t('hardwareError'));
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
        scanner
          .stop()
          .then(() => {
            startedRef.current = false;
            scannerRef.current = null;
          })
          .catch(() => {
            startedRef.current = false;
            scannerRef.current = null;
          });
      } else {
        scannerRef.current = null;
      }
    };
  }, [isActive, permission, t]);

  if (!isActive) return null;

  const wrapClass = fillContainer
    ? 'absolute inset-0 w-full h-full min-h-0 [&_#qr-reader]:!w-full [&_#qr-reader]:!h-full'
    : 'w-full max-w-md mx-auto';

  if (permission !== 'granted') {
    return (
      <div className={wrapClass}>
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-8">
          {permission === 'denied' ? (
            <>
              <p className="text-center text-sm text-[var(--color-text-secondary)]">{t('deniedHint')}</p>
              {onRequestManual && (
                <button
                  type="button"
                  onClick={onRequestManual}
                  className="rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white"
                >
                  {t('switchManual')}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void requestCamera()}
                className="rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white"
              >
                {t('enableCamera')}
              </button>
              <p className="max-w-xs text-center text-xs leading-relaxed text-[var(--color-text-secondary)]">{t('privacyExplainer')}</p>
            </>
          )}
          {error ? <p className="text-center text-sm text-red-500">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={wrapClass}>
      <div id="qr-reader" className={fillContainer ? 'w-full h-full min-h-0' : 'rounded-xl overflow-hidden'} />
      {error && <p className="text-center text-red-500 mt-2 text-sm">{error}</p>}
      <p className="text-center text-[var(--color-text-secondary)] mt-3 text-sm">{tScan('scanning')}</p>
    </div>
  );
}
