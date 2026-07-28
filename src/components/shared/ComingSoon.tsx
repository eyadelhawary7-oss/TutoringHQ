import type { ReactNode } from 'react';

/**
 * The one screen for a feature that is not on yet — `Merged-Lifecycle` §06.
 *
 * The design's rule, and the reason this is shared rather than written inline
 * each time: a calm full screen that **names the working alternative**. "Not
 * available" on its own leaves someone stuck; "take attendance with the
 * checklist instead" does not. So `action` is where the alternative goes, and
 * it reads as the point of the screen rather than a footnote.
 *
 * Presentational only. It renders what it is handed and gates nothing — the
 * caller owns the entitlement check, because the check belongs in the route
 * where a service-role read cannot bypass it.
 *
 * Not built alongside it: the design's **locked list row**. Its only candidate
 * today is the Orders sidebar item, which is currently *hidden* when
 * `card_orders_enabled` is false, and hidden-versus-locked is a decision about
 * whether to advertise a feature we do not have yet. The row lands with that
 * decision rather than ahead of it — see `NEW-FEATURES.md` A3.
 */
export default function ComingSoon({
  featureName,
  title,
  description,
  badge,
  action,
}: {
  /** The feature as the user knows it, shown above the card. Optional. */
  featureName?: string;
  /** What is coming — the design's "Cards & scanning". */
  title: string;
  /** Why it is not on yet, in plain words. */
  description: string;
  /** The "Coming soon" pill. Omitted rather than defaulted, so copy stays in messages/. */
  badge?: string;
  /** The working alternative. A link, ideally — this is the part that unsticks someone. */
  action?: ReactNode;
}) {
  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-8 text-center">
        {(featureName || badge) && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {featureName && (
              <span className="text-sm font-medium text-[var(--color-text-secondary)]">
                {featureName}
              </span>
            )}
            {badge && (
              <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-muted)]">
                {badge}
              </span>
            )}
          </div>
        )}
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">{title}</h1>
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{description}</p>
        {action && <div className="pt-1">{action}</div>}
      </div>
    </div>
  );
}
