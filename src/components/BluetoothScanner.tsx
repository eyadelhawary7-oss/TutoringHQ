'use client';

import { useRef, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

interface BluetoothScannerProps {
  onScan: (code: string) => void;
  isActive: boolean;
}

export default function BluetoothScanner({ onScan, isActive }: BluetoothScannerProps) {
  const t = useTranslations('scan');
  const inputRef = useRef<HTMLInputElement>(null);
  const [buffer, setBuffer] = useState('');

  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isActive]);

  // Re-focus on click anywhere (in case focus is lost)
  useEffect(() => {
    if (!isActive) return;

    const handleClick = () => {
      inputRef.current?.focus();
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [isActive]);

  const handleSubmit = () => {
    if (!buffer.trim()) return;
    const value = buffer.trim();
    setBuffer('');
    onScan(value);
    // Stay focused after scan so user can immediately scan next
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (!isActive) return null;

  return (
    <div className="w-full max-w-md">
      <input
        ref={inputRef}
        data-bluetooth-scanner-input
        type="text"
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
          }
        }}
        className="w-full px-5 py-4 rounded-xl border border-slate-300 bg-white text-slate-900 text-lg text-center focus:outline-none focus:ring-2 focus:ring-teal-500 placeholder:text-slate-400"
        placeholder={t('scanHere')}
        autoFocus
        autoComplete="off"
        dir="ltr"
      />
      <p className="text-xs text-slate-500 mt-2 text-center">{t('bluetoothMode')}</p>
    </div>
  );
}
