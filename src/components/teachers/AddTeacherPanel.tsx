'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Info } from 'lucide-react';
import TeacherJoinRequests from '@/components/settings/TeacherJoinRequests';

/**
 * "Teacher requests" panel: incoming teacher-initiated join requests (the
 * teacher asks to join the center; the owner accepts - Phase 2 territory, left
 * as-is). The old bare "add by code then separately propose to a group"
 * center path is retired: the owner now adds a teacher straight to a group in
 * one combined request from the "Add to a group" tab (GroupProposalsTab), so
 * there is no confusing two-step duplicate here anymore.
 *
 * `Merged-Center-Setup` §09, Add tab, adds the "Share your center code" card.
 * The code is `centers.center_code` — the same value the TEACHER side already
 * types into "bring a group to a centre" (`center_code` on that POST body), so
 * this is the real key to a real flow, not a decorative string.
 *
 * NOT drawn: the design's `thq.eg/t/ALNAHDA` short link. No such host, route or
 * redirector exists — printing one would be a fabricated destination. The code
 * itself is shown instead, with copy.
 *
 * Also NOT drawn: the design's "Or invite by phone" field on this tab. Inviting
 * a teacher by phone is `POST /api/invite-user`, which is broken in production
 * — `center_invites` has no `status` column and no unique constraint on
 * `(center_id, phone)`, so every invite 500s (F19.1). Adding a second entry
 * point to a route that always fails would multiply the failure, not fix it.
 */
export default function AddTeacherPanel() {
  const t = useTranslations('teachersSection');
  const [centerCode, setCenterCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCenterCode = useCallback((code: string | null) => setCenterCode(code), []);

  const copy = async () => {
    if (!centerCode) return;
    try {
      await navigator.clipboard.writeText(centerCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard unavailable (insecure context / permission denied) — the code
         is on screen and selectable either way, so there is nothing to report. */
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* §09 Add · "Share your center code". */}
      {centerCode && (
        <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-5 card-shadow">
          <h2 className="text-lg font-bold text-[var(--color-ink)]">{t('shareCenterCodeTitle')}</h2>
          <p className="mt-1 text-base text-[var(--color-mid)]">{t('shareCenterCodeHint')}</p>
          <div className="mt-4 flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-tile)] px-4 py-3">
            <code className="min-w-0 flex-1 truncate font-mono text-md font-semibold text-[var(--color-ink)]" dir="ltr">
              {centerCode}
            </code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-[var(--color-mint)] px-3 py-2 text-sm font-semibold text-[var(--color-accent-deep)] transition-colors hover:bg-[var(--color-mint-deep)]"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              {copied ? t('centerCodeCopied') : t('centerCodeCopy')}
            </button>
          </div>
        </section>
      )}

      {/* Incoming teacher-initiated join requests (reused settings block). */}
      <TeacherJoinRequests onCenterCode={handleCenterCode} />

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
