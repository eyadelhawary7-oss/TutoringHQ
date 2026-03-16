'use client';

import { useTranslations } from 'next-intl';
import { Building2 } from 'lucide-react';

interface Step1ProfileProps {
  centerName: string;
  centerPhone?: string | null;
  onNameChange: (name: string) => void;
  onPhoneChange: (phone: string) => void;
}

export default function Step1Profile({ centerName, centerPhone, onNameChange, onPhoneChange }: Step1ProfileProps) {
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center">
          <Building2 className="w-6 h-6 text-teal-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">{t('step1Title')}</h2>
          <p className="text-sm text-slate-500">{t('step1Desc')}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">{tCommon('name')}</label>
          <input
            type="text"
            value={centerName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Center name"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">{tCommon('phone')}</label>
          <input
            type="tel"
            value={centerPhone ?? ''}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="01XXXXXXXXX"
            dir="ltr"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>
      </div>

      {/* Video placeholder */}
      <div className="aspect-video rounded-xl bg-slate-100 flex items-center justify-center border border-slate-200">
        <div className="text-center text-slate-400 text-sm">
          <div className="w-16 h-16 rounded-full bg-slate-200 mx-auto mb-2 flex items-center justify-center">
            <span className="text-2xl">▶</span>
          </div>
          <p>Video placeholder</p>
        </div>
      </div>
    </div>
  );
}
