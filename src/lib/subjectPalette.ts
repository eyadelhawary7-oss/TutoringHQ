/**
 * One subject, one colour — on the Groups list and on the Schedule week grid.
 *
 * `Merged-Center-Groups` §01 tints each group's tile by subject (design lines
 * 397/410/423/436) and §05 tints the week-grid blocks and their legend from the
 * same four swatches (design lines 1197-1200, 1212-1243). If those two screens
 * derived their colour independently they would disagree the moment a centre
 * added a fifth subject, so both import this.
 *
 * The mapping is DERIVED, not stored: `subjects` has no colour column in the
 * live catalog and no migration is permitted here, so the index comes from a
 * stable hash of the subject's own name. That has two consequences worth
 * knowing:
 *
 *   - it is stable across reloads, sessions and both locales, because it reads
 *     only the trimmed, lower-cased name;
 *   - two different subjects CAN land on the same swatch. That is acceptable
 *     for a tint (the name is always rendered beside it) and is why the legend
 *     in §05 is built from the same function rather than a parallel list — a
 *     collision then shows up identically in both places instead of the legend
 *     claiming a colour the blocks do not use.
 */

export interface SubjectPalette {
  /** Tile / block background. */
  bg: string;
  /** Glyph and label drawn on that background. */
  fg: string;
  /** Position in SUBJECT_PALETTES — lets callers pick a matching glyph. */
  index: number;
}

/** The four swatches the design draws, in its own order. */
export const SUBJECT_PALETTES: readonly { bg: string; fg: string }[] = [
  { bg: '#DFEEEB', fg: '#0A514A' }, // mint   — design line 397
  { bg: '#F4EBD7', fg: '#9A6B1F' }, // brass  — design line 410
  { bg: '#E3ECF6', fg: '#2563EB' }, // blue   — design line 423
  { bg: '#E4F0E9', fg: '#1A6D4D' }, // green  — design line 436
] as const;

/**
 * djb2 over the normalised name. Small, dependency-free, and — unlike
 * `String.prototype.hashCode`-style sums — does not collide on anagrams, which
 * subject lists are full of ("Math 1" / "1 Math").
 */
function stableHash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * The palette for a subject name. `null`, empty and whitespace-only all resolve
 * to the first (mint) swatch rather than throwing — a group with no subject set
 * is normal, and it should look like a group, not like an error.
 */
export function subjectPalette(subject: string | null | undefined): SubjectPalette {
  const key = (subject ?? '').trim().toLowerCase();
  const index = key === '' ? 0 : stableHash(key) % SUBJECT_PALETTES.length;
  const entry = SUBJECT_PALETTES[index]!;
  return { bg: entry.bg, fg: entry.fg, index };
}
