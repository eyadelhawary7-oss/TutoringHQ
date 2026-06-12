'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';

/**
 * Client-side QR renderer with a PNG download. Draws `value` onto a canvas via
 * the `qrcode` package; high-contrast dark-on-white so it always scans.
 */
export default function QrCodeBlock({
  value,
  size = 160,
  downloadLabel,
  fileName,
}: {
  value: string;
  size?: number;
  downloadLabel: string;
  fileName: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      color: { dark: '#13322e', light: '#ffffff' },
    })
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
        <canvas ref={canvasRef} width={size} height={size} />
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={!ready}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brass)] transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        <Download size={14} aria-hidden />
        {downloadLabel}
      </button>
    </div>
  );
}
