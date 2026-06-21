'use client';

import { useTranslations } from 'next-intl';
import { Share2, MessageCircle } from 'lucide-react';
import CopyButton from './CopyButton';
import QrCodeBlock from './QrCodeBlock';

// Arabic-first: the product default locale is ar, so the shared link points at
// the Arabic public join page.
const JOIN_BASE = 'https://centerhq.app/ar/join/g';

/**
 * "Share with students" card at the top of a teacher's group detail page. The
 * join link routes to the public self-enrollment flow; students tap it, verify
 * their number, and enroll themselves.
 */
export default function GroupJoinLinkCard({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string | null;
}) {
  const t = useTranslations('teacherPortal.groups.share');

  const joinUrl = `${JOIN_BASE}/${groupId}`;
  const waText = t('waMessage', { group: groupName ?? '', url: joinUrl });
  const waHref = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-brass)]/40 bg-[var(--color-surface-1)] p-6 shadow-card">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
        <Share2 size={18} className="text-[var(--color-brass)]" aria-hidden />
        {t('heading')}
      </h2>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <code
            dir="ltr"
            className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
          >
            {joinUrl}
          </code>
          <CopyButton value={joinUrl} label={t('copy')} copiedLabel={t('copied')} />
        </div>

        <div className="self-center">
          <QrCodeBlock
            value={joinUrl}
            downloadLabel={t('downloadQr')}
            fileName="tutoringhq-group-join.png"
          />
        </div>

        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brass)] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <MessageCircle size={16} aria-hidden />
          {t('shareWhatsapp')}
        </a>

        <p className="rounded-lg bg-[var(--color-surface-2)] p-3 text-xs text-[var(--color-text-muted)]">
          {t('note')}
        </p>
      </div>
    </section>
  );
}
