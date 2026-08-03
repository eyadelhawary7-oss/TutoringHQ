'use client';

/**
 * The four loading states, to `Merged-Design-Patterns` §02.
 *
 * All four already existed in the app — `chq-skeleton` in 9 files, 11 route
 * `loading.tsx` files, and `LoadingButton` for in-flight actions. What did not
 * exist was a NAMED SET, so each screen invented its own shape and the four
 * states were not distinguishable from one another. §02's whole point is that
 * they are four different messages:
 *
 *   list, rows still arriving   → structure is known, content is not
 *   a record opening            → one thing, not a list
 *   slow, not an error          → it is still working; do not offer a retry
 *   action in flight            → you pressed something and it is happening
 *
 * The third is the one that matters and the one nobody builds. A list that has
 * been skeletal for eight seconds looks broken; saying "still working" is the
 * difference between a user waiting and a user reloading.
 *
 * The sweep, its radius and its reduced-motion guard live on `.chq-skeleton` in
 * globals.css, deliberately unlayered — see the comment there. Radius variants
 * are `.chq-skeleton-tile` / `.chq-skeleton-pill`, NOT Tailwind `rounded-*`,
 * which loses the cascade to that rule and is silently inert on a skeleton.
 */

/**
 * §02 row bar widths, per frame: [title %, meta %].
 *
 * The design draws four visibly different rows rather than four identical ones,
 * because equal bars read as a repeating widget instead of as content whose
 * length is not yet known.
 */
const BARS = [
  [58, 34],
  [44, 40],
  [64, 28],
  [50, 36],
] as const;

/** One `.srow`. Shared so the list and record states cannot drift apart. */
function SkelRow({ index, badge }: { index: number; badge?: boolean }) {
  const [title, meta] = BARS[index % BARS.length];
  return (
    <div
      className="flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3"
      aria-hidden
    >
      <div className="chq-skeleton chq-skeleton-tile h-10 w-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="chq-skeleton h-[13px]" style={{ width: `${title}%` }} />
        <div className="chq-skeleton mt-[7px] h-[10px]" style={{ width: `${meta}%` }} />
      </div>
      {badge && <div className="chq-skeleton chq-skeleton-pill h-[22px] w-[62px] shrink-0" />}
    </div>
  );
}

/**
 * §02 · list, rows still arriving.
 *
 * The last row deliberately carries no trailing badge placeholder. The design
 * draws it that way and it is the detail that stops four identical rows reading
 * as a repeating widget rather than as unknown content.
 */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <SkelRow key={i} index={i} badge={i < rows - 1} />
      ))}
    </div>
  );
}

/**
 * §02 · a record opening — one thing, not a list.
 *
 *   .scard  { #FFFDF8; 1px #E2DDD1; radius 16; padding 16; gap 8 }
 *   .stiles { row; gap 8 }
 *   .stile  { flex 1; radius 12; padding 16 }
 *
 * No avatar and no header placeholder: on a record route the topbar is already
 * real, and §02's rule is that anything already known stays real. A grey block
 * where the title already is, is a placeholder for something that is not
 * missing.
 */
export function RecordSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      <div
        className="flex flex-col gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4"
        aria-hidden
      >
        <div className="chq-skeleton h-[12px] w-[40%]" />
        <div className="chq-skeleton chq-skeleton-pill h-[7px] w-full" />
        <div className="chq-skeleton h-[12px] w-[56%]" />
      </div>
      <div className="flex gap-2" aria-hidden>
        <div className="flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
          <div className="chq-skeleton h-[22px] w-[52%]" />
          <div className="chq-skeleton mt-2 h-[10px] w-[70%]" />
        </div>
        <div className="flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
          <div className="chq-skeleton h-[22px] w-[38%]" />
          <div className="chq-skeleton mt-2 h-[10px] w-[64%]" />
        </div>
      </div>
      <SkelRow index={2} />
      <SkelRow index={3} />
    </div>
  );
}

/**
 * §02 · slow, not an error.
 *
 *   .slow { row; gap 8; #F4EBD7; 1px #E2DDD1; radius 12; padding 12 16;
 *           12px; #9A6B1F }
 *
 * A band ABOVE the still-sweeping skeleton, not a replacement for it. The
 * skeleton keeps running underneath; this only adds the sentence the skeleton
 * cannot say. Start-aligned and full width — it is a notice, not a loader.
 *
 * Deliberately offers no retry and deliberately no spinner. The design's
 * caption is "slow, not an error": a retry here restarts something that is
 * already working, and a spinner beside the word "slower" says the same thing
 * twice. The glyph is a static clock.
 */
export function StillWorking({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-sand)] px-4 py-3 text-sm leading-normal text-[var(--color-brass)]"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[17px] w-[17px] shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span>{message}</span>
    </div>
  );
}

/**
 * §02 · action in flight.
 *
 *   .inflight { row centred; gap 8; w-100%; radius 12; padding 16;
 *               15px/700; #0E6B61 on #FFFDF8; opacity .72 }
 *
 * The button KEEPS ITS OWN LABEL. §02's rule is explicit: it dims rather than
 * disappearing and it does not turn into the word "Loading", so the person
 * still knows what they pressed. `label` is therefore the caller's real button
 * text, not a loading string.
 */
export function ActionSpinner({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] p-4 text-md font-bold text-[var(--color-panel)] opacity-[0.72]"
    >
      <span className="chq-spin-ring shrink-0" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
