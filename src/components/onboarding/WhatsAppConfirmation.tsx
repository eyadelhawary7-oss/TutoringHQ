'use client';

import { useTranslations, useLocale } from 'next-intl';
import { formatTime } from '@/lib/formatNumber';

type Props = {
  sent: boolean;
  centerName: string;
  phoneNumber: string;
};

export function WhatsAppConfirmation({ sent, centerName, phoneNumber }: Props) {
  const t = useTranslations('onboarding');
  const locale = useLocale();

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] text-center">
        {t('whatsapp_title')}
      </h3>
      <p className="text-xs text-[var(--color-text-tertiary)]">{t('whatsapp_preview_label')}</p>

      <div
        className="relative w-48 rounded-[2rem] border-4 border-[var(--color-surface-3)] bg-[var(--color-surface-1)] overflow-hidden shadow-lg"
        aria-label={phoneNumber ? `${t('whatsapp_subtitle')} ${phoneNumber}` : t('whatsapp_subtitle')}
      >
        <div className="px-3 py-2 flex items-center gap-2" style={{ background: '#075E54' }}>
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.2)' }}
          >
            <svg width="14" height="14" fill="white" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.134.298-.347.446-.521.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
            </svg>
          </div>
          <span className="text-xs font-medium truncate" style={{ color: '#ffffff' }}>
            {centerName}
          </span>
        </div>

        <div className="p-3 min-h-[80px] flex items-end" style={{ background: '#ECE5DD' }}>
          <div className="rounded-lg p-2.5 max-w-[85%] shadow-sm" style={{ background: '#ffffff' }}>
            <p className="text-[11px] leading-relaxed" style={{ color: '#1f2937' }}>
              {`مرحباً بك في ${centerName}! 🎉`}
            </p>
            <div className="flex items-center justify-end gap-1 mt-1">
              <span className="text-[9px]" style={{ color: '#9CA3AF' }}>
                {formatTime(new Date(), locale)}
              </span>
              <svg width="14" height="8" viewBox="0 0 16 9" fill="none" aria-hidden="true">
                <path
                  d="M1 4L4 7L9 1"
                  stroke={sent ? '#34B7F1' : '#9CA3AF'}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={sent ? 'whatsapp-tick' : ''}
                />
                <path
                  d="M6 4L9 7L14 1"
                  stroke={sent ? '#34B7F1' : '#9CA3AF'}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={sent ? 'whatsapp-tick' : ''}
                  style={{ animationDelay: '0.15s' }}
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${sent ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'}`}
        />
        <span className="text-sm text-[var(--color-text-secondary)]">
          {sent ? t('whatsapp_sent') : t('whatsapp_pending')}
        </span>
      </div>

      <p className="text-xs text-[var(--color-text-tertiary)] text-center">{t('whatsapp_subtitle')}</p>
    </div>
  );
}
