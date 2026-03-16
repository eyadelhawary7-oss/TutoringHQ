'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import CameraScanner from '@/components/CameraScanner';

interface Step4ScannerProps {
  isActive: boolean;
  onScanSuccess: () => void;
}

export default function Step4Scanner({ isActive, onScanSuccess }: Step4ScannerProps) {
  const t = useTranslations('onboarding');
  const hasScanned = useRef(false);

  const handleScan = (code: string) => {
    if (hasScanned.current) return;
    hasScanned.current = true;
    onScanSuccess();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">{t('step4Title')}</h2>
        <p className="text-sm text-slate-500 mt-1">{t('step4Desc')}</p>
      </div>

      <div className="relative aspect-square max-w-[280px] mx-auto rounded-xl overflow-hidden bg-slate-900 border-2 border-slate-700">
        {isActive && (
          <CameraScanner
            onScan={handleScan}
            isActive={isActive}
            fillContainer
          />
        )}
      </div>
    </div>
  );
}
