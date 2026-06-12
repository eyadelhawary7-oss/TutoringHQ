'use client';

import { useTranslations } from 'next-intl';
import { CheckCircle2, MessageCircle } from 'lucide-react';
import CopyButton from './CopyButton';
import QrCodeBlock from './QrCodeBlock';

const JOIN_BASE = 'https://centerhq.app/join/g';

/**
 * Full-screen celebration shown once, right after a teacher creates their very
 * first private group. Hands them the share surface (join link + QR + WhatsApp)
 * so the next action is getting students in - not staring at an empty roster.
 */
export default function FirstGroupCelebration({
  group,
  onGoToGroup,
  onClose,
}: {
  group: { id: string; name: string | null };
  onGoToGroup: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('teacherPortal.celebration');

  const joinUrl = `${JOIN_BASE}/${group.id}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(`${t('whatsappMessage')} ${joinUrl}`)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[var(--radius-modal)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <CheckCircle2 size={56} className="mx-auto mb-4 text-[var(--color-teal-deep)]" aria-hidden />
        <h2 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">{t('heading')}</h2>
        <p className="mb-5 text-sm text-[var(--color-text-secondary)]">{t('subtext')}</p>

        <div className="mb-4 flex flex-col items-stretch gap-2">
          <span className="text-start text-xs font-semibold text-[var(--color-text-muted)]">
            {t('joinLinkLabel')}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
            >
              {joinUrl}
            </code>
            <CopyButton value={joinUrl} label={t('copy')} copiedLabel={t('copied')} />
          </div>
        </div>

        <div className="mb-5 flex justify-center">
          <QrCodeBlock
            value={joinUrl}
            downloadLabel={t('downloadQr')}
            fileName="centerhq-group-join.png"
          />
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onGoToGroup}
            className="w-full rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-teal-700"
          >
            {t('goToGroup')}
          </button>
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            <MessageCircle size={16} aria-hidden />
            {t('shareWhatsapp')}
          </a>
        </div>
      </div>
    </div>
  );
}
