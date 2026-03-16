'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { QrCode } from 'lucide-react';

interface Step3QRProps {
  studentName?: string;
  studentNumber?: string;
  qrDataUrl?: string | null;
  centerName?: string;
  onPrint: () => void;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}

export default function Step3QR({
  studentName,
  studentNumber,
  qrDataUrl,
  centerName,
  onPrint,
  checked,
  onCheckedChange,
}: Step3QRProps) {
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center">
          <QrCode className="w-6 h-6 text-teal-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">{t('step3Title')}</h2>
          <p className="text-sm text-slate-500">{t('step3Desc')}</p>
        </div>
      </div>

      {/* QR card preview */}
      <div
        className="w-full max-w-[200px] mx-auto aspect-[85.6/54] rounded-xl overflow-hidden shadow-lg"
        style={{
          background: 'linear-gradient(135deg, #0D9488 0%, #1E293B 100%)',
          color: 'white',
        }}
      >
        <div className="h-full flex flex-col items-center justify-center p-3">
          <div className="w-16 h-16 bg-white rounded-lg flex items-center justify-center mb-2">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR" className="w-12 h-12" />
            ) : (
              <QrCode className="w-8 h-8 text-slate-400" />
            )}
          </div>
          <div className="text-sm font-bold text-center truncate w-full">{studentName || '—'}</div>
          <div className="text-xs font-mono opacity-80">{studentNumber || '—'}</div>
          <div className="text-[10px] opacity-60 mt-1">{centerName || 'CenterHQ'}</div>
        </div>
      </div>

      <button
        onClick={onPrint}
        className="w-full py-3 rounded-xl text-sm font-semibold text-teal-600 border-2 border-teal-500 hover:bg-teal-50 transition-colors"
      >
        {t('step3Print')}
      </button>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span className="text-sm font-medium text-foreground">{t('step3Checkbox')}</span>
      </label>
    </div>
  );
}
