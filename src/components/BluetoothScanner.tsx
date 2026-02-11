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

  if (!isActive) return null;

  return (
    <div className="w-full max-w-md mx-auto text-center">
      {/* Hidden input that captures bluetooth scanner keyboard input */}
      <input
        ref={inputRef}
        type="text"
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && buffer.trim()) {
            onScan(buffer.trim());
            setBuffer('');
          }
        }}
        className="opacity-0 absolute w-0 h-0"
        autoFocus
        autoComplete="off"
      />

      {/* Visual indicator */}
      <div className="py-12">
        <div className="w-24 h-24 mx-auto bg-indigo-100 dark:bg-indigo-900 rounded-full flex items-center justify-center mb-6 animate-pulse">
          <svg className="w-12 h-12 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-lg text-gray-700 dark:text-gray-300 font-medium">
          {t('scanning')}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {t('bluetoothMode')}
        </p>
      </div>
    </div>
  );
}
