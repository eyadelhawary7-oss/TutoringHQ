'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';

/**
 * The grouped settings list from `Merged-Center-Setup` §02 / §05 / §06 — a
 * label, then one card whose rows are separated by hairlines.
 *
 *   .glabel { 12px / 600; letter-spacing .02em; --color-muted }
 *   .group  { --color-panel; 1px --color-line; radius 16; overflow hidden }
 *   .srow   { row; gap 12; padding 16; border-top --color-hairline }
 *   .sicon  { 32x32; radius 8 }
 *   .slabel { flex 1; 15px / 500 }
 *   .sval   { 13px; --color-muted }
 *
 * NOT one of the four interactions `src/components/patterns/` owns (row action,
 * quick menu, group action bar, expand sheet), so it is not a fork of one.
 * `ListRow` is the closest primitive and is a different shape on purpose: it is
 * a standalone bordered row with an avatar, where this is a hairline-divided
 * row inside one shared card. A settings hub built out of `ListRow` would draw
 * a border around every single row and lose the group entirely.
 */

export function SettingsGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 px-1 text-sm font-semibold tracking-[0.02em] text-[var(--color-muted)]">
      {children}
    </p>
  );
}

export function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] card-shadow">
      {children}
    </div>
  );
}

interface SettingsRowProps {
  icon?: LucideIcon;
  /** Tailwind classes for the 32x32 icon tile — mint by default. */
  iconClassName?: string;
  label: string;
  /** The design's `.sval` — a short right-hand value (a count, a plan name). */
  value?: React.ReactNode;
  /** A pill instead of a plain value. Takes precedence over `value`. */
  badge?: React.ReactNode;
  /** Internal route. Renders the chevron. */
  href?: string;
  /** External destination (mailto:, wa.me). Renders the chevron. */
  externalHref?: string;
  /** Non-navigating row action. */
  onClick?: () => void;
  description?: string;
}

const ICON_TILE_DEFAULT = 'bg-[var(--color-mint)] text-[var(--color-accent-deep)]';

export function SettingsRow({
  icon: Icon,
  iconClassName = ICON_TILE_DEFAULT,
  label,
  value,
  badge,
  href,
  externalHref,
  onClick,
  description,
}: SettingsRowProps) {
  const locale = useLocale();
  const isRtl = locale === 'ar' || locale.startsWith('ar-');
  const Chevron = isRtl ? ChevronLeft : ChevronRight;
  const interactive = Boolean(href || externalHref || onClick);

  const inner = (
    <>
      {Icon && (
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-sm ${iconClassName}`}
          aria-hidden
        >
          <Icon className="h-[17px] w-[17px]" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-md font-medium text-[var(--color-ink)]">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs text-[var(--color-muted)]">{description}</span>
        )}
      </span>
      {badge ?? (value != null ? <span className="shrink-0 text-base text-[var(--color-muted)]">{value}</span> : null)}
      {interactive && <Chevron className="h-5 w-5 shrink-0 text-[var(--color-faint)]" aria-hidden />}
    </>
  );

  const rowClass =
    'flex w-full items-center gap-3 border-t border-[var(--color-hairline)] px-4 py-4 text-start first:border-t-0';

  if (href) {
    return (
      <Link href={href} className={`${rowClass} transition-colors hover:bg-[var(--color-tile)]`}>
        {inner}
      </Link>
    );
  }
  if (externalHref) {
    return (
      <a
        href={externalHref}
        target="_blank"
        rel="noopener noreferrer"
        className={`${rowClass} transition-colors hover:bg-[var(--color-tile)]`}
      >
        {inner}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${rowClass} transition-colors hover:bg-[var(--color-tile)]`}>
        {inner}
      </button>
    );
  }
  return <div className={rowClass}>{inner}</div>;
}

/**
 * A `.srow` whose right-hand affordance is a control rather than a value — the
 * design's toggle rows (§05, §06) and its segmented rows (§06 "Scan with").
 */
export function SettingsControlRow({
  icon: Icon,
  iconClassName = ICON_TILE_DEFAULT,
  label,
  description,
  labelId,
  children,
}: {
  icon?: LucideIcon;
  iconClassName?: string;
  label: string;
  description?: string;
  /** Points the control's `aria-labelledby` at this row's label. */
  labelId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-[var(--color-hairline)] px-4 py-4 first:border-t-0">
      {Icon && (
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-sm ${iconClassName}`}
          aria-hidden
        >
          <Icon className="h-[17px] w-[17px]" />
        </span>
      )}
      <div className="min-w-0 flex-1" id={labelId}>
        <p className="text-md font-medium text-[var(--color-ink)]">{label}</p>
        {description && <p className="mt-0.5 text-xs text-[var(--color-muted)]">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** The design's `.help` — the quiet explanatory line under a group. */
export function SettingsGroupHelp({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 px-1 text-xs leading-relaxed text-[var(--color-muted)]">{children}</p>;
}

/**
 * The design's `.signout` — a full-width quiet card, danger text, no fill.
 */
export function SettingsSignOutButton({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  icon: LucideIcon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4 text-md font-semibold text-[var(--color-danger)] transition-colors hover:bg-[var(--color-tile)]"
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      {label}
    </button>
  );
}
