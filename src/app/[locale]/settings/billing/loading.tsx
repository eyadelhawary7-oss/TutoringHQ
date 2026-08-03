import { RecordSkeleton } from '@/components/patterns';

/**
 * Merged-Design-Patterns §02, "a record opening".
 *
 * The billing screen is one record — the center's subscription — with a
 * summary card, two figures and a list of invoices, which is exactly the
 * shape §02 draws. It used to hand-roll `animate-pulse` on
 * `--color-surface-2`, off the sweep, off the palette and off the radius.
 *
 * §02 drops the header placeholder because a record's topbar is already real.
 * The one bar kept here is the PAGE TITLE, and `/settings` has no route layout
 * — `loading.tsx` replaces the whole page including its heading, so at this
 * moment the title genuinely is not on screen yet. It is a real unknown, not
 * a placeholder over something already drawn.
 */
export default function Loading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="chq-skeleton h-8 w-36" aria-hidden />
        <RecordSkeleton />
      </div>
    </div>
  );
}
