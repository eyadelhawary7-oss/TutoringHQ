'use client';

import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import TeacherJoinRequests from '@/components/settings/TeacherJoinRequests';

/**
 * "Teacher requests" panel: incoming teacher-initiated join requests (the
 * teacher asks to join the center; the owner accepts - Phase 2 territory, left
 * as-is). The old bare "add by code then separately propose to a group"
 * center path is retired: the owner now adds a teacher straight to a group in
 * one combined request from the "Add to a group" tab (GroupProposalsTab), so
 * there is no confusing two-step duplicate here anymore.
 */
export default function AddTeacherPanel() {
  const t = useTranslations('teachersSection');

  return (
    <div className="flex flex-col gap-6">
      {/* Incoming teacher-initiated join requests (reused settings block). */}
      <TeacherJoinRequests />

      {/* Pointer: adding a teacher to a group now lives in the combined flow. */}
      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <Info className="h-5 w-5 text-[var(--color-teal-deep)]" aria-hidden />
          {t('addToGroupPointerTitle')}
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('addToGroupPointerHint')}</p>
      </section>
    </div>
  );
}
