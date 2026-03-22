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
        <h2 className="text-xl font-bold text-[var(--color-text-primary)]">{t('step4Title')}</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">{t('step4Desc')}</p>
      </div>

      <div className="relative aspect-square max-w-[280px] mx-auto rounded-xl overflow-hidden bg-[var(--color-surface-0)] border-2 border-[var(--color-border-default)]">
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
