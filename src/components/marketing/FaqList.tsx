'use client';

import { useState } from 'react';

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * The `.faq` / `.qa` accordion (design L238-243). Native `<details>` so it works
 * without JS and is keyboard-accessible for free; the `+` / `−` glyph is the
 * design's `.pm`.
 *
 * Replaces `landing/LandingFAQ.tsx`, which always rendered every item closed.
 * The design deliberately opens specific items on each screen (the landing page
 * opens the first and the fifth, both audience pages open the first two), so
 * `defaultOpen` is an explicit list of indices rather than a boolean.
 *
 * Open state is held here rather than left to the DOM. Every screen using this
 * list also fetches live config (plan prices, the summer dates), so the parent
 * re-renders a moment after mount — and React re-applies the `open` attribute
 * on re-render, which would snap shut an item the reader had just opened.
 */
export default function FaqList({
  items,
  defaultOpen = [],
}: {
  items: FaqItem[];
  defaultOpen?: number[];
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(defaultOpen));

  const toggle = (i: number, isOpen: boolean) =>
    setOpen((prev) => {
      if (prev.has(i) === isOpen) return prev;
      const next = new Set(prev);
      if (isOpen) next.add(i);
      else next.delete(i);
      return next;
    });

  return (
    <div className="mt-4 flex flex-col gap-2">
      {items.map((item, i) => (
        <details
          key={item.q}
          open={open.has(i)}
          onToggle={(e) => toggle(i, (e.currentTarget as HTMLDetailsElement).open)}
          className="group rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4 [&_summary::-webkit-details-marker]:hidden"
        >
          <summary className="flex cursor-pointer list-none items-start justify-between gap-3 text-start text-[13px] font-bold leading-snug text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
            <span>{item.q}</span>
            <span
              className="shrink-0 text-[17px] font-normal leading-none text-[var(--color-muted)]"
              aria-hidden
            >
              <span className="group-open:hidden">+</span>
              <span className="hidden group-open:inline">−</span>
            </span>
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-mid)]">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
