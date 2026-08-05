'use client';

import { MoreVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { RoleBadge } from '@/components/shared';
import { initialsOf } from '@/lib/initials';

/**
 * `Merged-Center-Setup` §07 `.mcard` — one team member.
 *
 *   .mcard { --color-panel; 1px --color-line; radius 16; padding 12 16 }
 *   .mcard.off { opacity .62 }
 *   .mav   { 40x40; circle; --color-mint on --color-accent-deep; 13px/600 }
 *   .mn    { 15px / 600 }
 *   .mperm { 11px; --color-muted }
 *   .mfoot { border-top --color-hairline; padding-top 12; margin-top 8 }
 *   .linkbtn { --color-accent-deep; 12px / 600 }
 *
 * The three-dot opens the shared `ActionSheet` (`src/components/patterns/`),
 * which is why this component only signals `onActions` rather than owning a
 * menu of its own.
 *
 * The permission summary line is derived from the member's real granted flags —
 * it is never a fixed string per role. The design's own example
 * ("Money · students · attendance · messages") is a summary of what that person
 * actually has, and a role-shaped guess would be a different claim.
 */

export interface TeamMemberCardMember {
  id: string;
  name: string | null;
  phone: string;
  role: string;
  is_active?: boolean;
}

export default function TeamMemberCard({
  member,
  permissionSummary,
  isSelf,
  isOwnerRow,
  onActions,
  onEditPermissions,
  onToggleActive,
  children,
}: {
  member: TeamMemberCardMember;
  /** Already-localised, already-joined summary of granted permissions. */
  permissionSummary: string;
  isSelf: boolean;
  isOwnerRow: boolean;
  onActions?: () => void;
  onEditPermissions?: () => void;
  onToggleActive?: () => void;
  /** The expanded permission editor, when this card is the one being edited. */
  children?: React.ReactNode;
}) {
  const t = useTranslations('settings');
  const paused = member.is_active === false;

  return (
    <div
      className={`rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 card-shadow ${
        paused ? 'opacity-[0.62]' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-mint)] text-base font-semibold text-[var(--color-accent-deep)]"
          aria-hidden
        >
          {initialsOf(member.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-md font-semibold leading-tight text-[var(--color-ink)]">
            {member.name || member.phone}
            {isSelf && <span className="ms-1 text-xs font-normal text-[var(--color-muted)]">{t('you')}</span>}
          </p>
          <p className="mt-1 truncate text-xs text-[var(--color-muted)]">{permissionSummary}</p>
        </div>
        {paused ? (
          <span className="shrink-0 rounded-full bg-[var(--color-hairline)] px-3 py-1 text-xs font-semibold text-[var(--color-danger)]">
            {t('deactivatedStatus')}
          </span>
        ) : (
          <RoleBadge role={member.role} />
        )}
        {onActions && (
          <button
            type="button"
            onClick={onActions}
            aria-label={t('permissions')}
            className="ms-1 shrink-0 rounded-sm p-1 text-[var(--color-faint)] transition-colors hover:bg-[var(--color-tile)] hover:text-[var(--color-mid)]"
          >
            <MoreVertical className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-[var(--color-hairline)] pt-3">
        <p className="font-mono text-xs text-[var(--color-muted)]" dir="ltr">
          {member.phone}
        </p>
        <span className="flex-1" />
        {isOwnerRow ? (
          <span className="text-xs text-[var(--color-muted)]">{t('ownerKeepsEveryPermission')}</span>
        ) : (
          <>
            {paused && onToggleActive && (
              <button
                type="button"
                onClick={onToggleActive}
                className="text-sm font-semibold text-[var(--color-accent-deep)] hover:underline"
              >
                {t('reactivate')}
              </button>
            )}
            {onEditPermissions && (
              <button
                type="button"
                onClick={onEditPermissions}
                className="text-sm font-semibold text-[var(--color-accent-deep)] hover:underline"
              >
                {t('editPermissions')}
              </button>
            )}
          </>
        )}
      </div>

      {children}
    </div>
  );
}
