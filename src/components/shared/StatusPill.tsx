'use client';

export type StatusPillTone = 'danger' | 'success' | 'warning' | 'accent' | 'neutral';

export interface StatusPillProps {
  tone: StatusPillTone;
  children: React.ReactNode;
}

/**
 * The `.badge` primitive, to `Merged-Design-Patterns` §03–§06.
 *
 *   .badge { inline-flex; gap 4; 11px/600; padding 4 12; radius pill;
 *            white-space nowrap; flex-shrink 0 }
 *
 * The chrome itself lives on `.badge` in globals.css (inside @layer components)
 * because six purpose-built badges in this folder already consume those classes
 * and must not drift from it. This component is the generic one: the row
 * primitives take a badge as an element of THIS type so a caller cannot post
 * arbitrary chrome into a row's badge slot.
 *
 * Tone mapping against the design's four drawn tones — three are exact:
 *   danger  #F4E5E2 / #9C3322  ✓ .badge-danger
 *   success #E4F0E9 / #1A6D4D  ✓ .badge-success
 *   accent  #DFEEEB / #0A514A  ✓ .badge-brand
 *   warning #F4EBD7 / #9A6B1F  — the design draws its warning text at #8A5E16,
 *           which is not a token and appears nowhere in tokens.css. Kept on
 *           --color-brass and logged as design drift rather than adding a hex
 *           to a palette that was just collapsed to 30.
 *
 * The six domain badges (Plan, Role, Method, PaymentStatus, Balance, Billing)
 * are NOT merged into this — they carry domain logic. Each renders StatusPill
 * in its own file's sweep.
 */
const TONE_CLASS: Record<StatusPillTone, string> = {
  danger: 'badge-danger',
  success: 'badge-success',
  warning: 'badge-gold',
  accent: 'badge-brand',
  neutral: 'badge-neutral',
};

export default function StatusPill({ tone, children }: StatusPillProps) {
  return <span className={`badge ${TONE_CLASS[tone]}`}>{children}</span>;
}
