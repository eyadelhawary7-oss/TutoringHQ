'use client';

import { Check, Circle, Square, Triangle } from 'lucide-react';
import type { Standing } from '@/lib/studentStanding';

/**
 * The standing pill, Merged-Center-Students §01/§02 `.badge`:
 *
 *   .badge { display:inline-flex; align-items:center; gap:4px; font-size:11px;
 *            font-weight:600; padding:4px 12px; border-radius:999px;
 *            white-space:nowrap; flex-shrink:0 }
 *
 * with a 12px Lucide glyph and a per-standing colour pair taken straight off the
 * frames:
 *
 *   Paid     #E4F0E9 / #1A6D4D   check
 *   Overdue  #F4E5E2 / #9C3322   filled square
 *   At risk  #F4EBD7 / #8A5E16   triangle
 *   New      #E3ECF6 / #2563EB   filled circle
 *
 * Replaces `LifecycleBadge`, which coloured by `students.lifecycle_status` — a
 * column the roster no longer reads (it is 'unpaid'-equivalent dead weight for
 * standing; see studentStanding.ts). The glyph is what makes the four states
 * readable without relying on hue alone.
 *
 * React 19: `ref` is a normal prop. No forwardRef.
 */

type BadgeStyle = { chip: string; avatar: string };

const STANDING_STYLE: Record<Standing, BadgeStyle> = {
  paid: {
    chip: 'bg-[#E4F0E9] text-[#1A6D4D]',
    avatar: 'bg-[#E4F0E9] text-[#1A6D4D]',
  },
  overdue: {
    chip: 'bg-[#F4E5E2] text-[#9C3322]',
    avatar: 'bg-[#F4E5E2] text-[#9C3322]',
  },
  at_risk: {
    chip: 'bg-[#F4EBD7] text-[#8A5E16]',
    avatar: 'bg-[#F4EBD7] text-[#8A5E16]',
  },
  new: {
    chip: 'bg-[#E3ECF6] text-[#2563EB]',
    avatar: 'bg-[#E3ECF6] text-[#2563EB]',
  },
};

/** The tint §01 `.av` (38×38) and §02 `.idav` (54×54) take from the standing. */
export function standingAvatarClass(standing: Standing): string {
  return STANDING_STYLE[standing].avatar;
}

function StandingGlyph({ standing }: { standing: Standing }) {
  if (standing === 'paid') return <Check size={12} strokeWidth={2.5} aria-hidden />;
  if (standing === 'overdue') return <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden />;
  if (standing === 'at_risk') return <Triangle size={12} strokeWidth={2.2} aria-hidden />;
  return <Circle size={12} fill="currentColor" strokeWidth={0} aria-hidden />;
}

export function StandingBadge({ standing, label }: { standing: Standing; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold ${STANDING_STYLE[standing].chip}`}
    >
      <StandingGlyph standing={standing} />
      {label}
    </span>
  );
}
