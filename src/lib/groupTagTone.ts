/**
 * The two group-tag tints `Merged-Teacher-Students` draws.
 *
 * §01's roster gives every group tag its own tone: with two groups on screen
 * ("Physics", "Physics Sun 4PM") the design paints one `.tag` mint and the
 * other `.tag.b` brass, one tone per group, so a mixed roster is scannable at
 * a glance instead of a wall of identical mint chips. §02 reuses the same
 * tones on `.ptags`.
 *
 *   .tag    { #0A514A on #DFEEEB }   -> --color-teal-deep on --color-mint
 *   .tag.b  { #9A6B1F on #F4EBD7 }   -> --color-brass     on --color-sand
 *
 * The tone is derived from the group id by hash, NOT from the group's position
 * in a list. §01 knows the teacher's whole group set and §02 knows only the
 * groups one student is enrolled in, so an index-based tone would paint the
 * same group two different colours across the two screens. A hash of the id is
 * the only assignment that is stable everywhere the tag appears.
 *
 * This is a tint, never a status: it encodes group identity and nothing else.
 * Neither tone means paid, overdue, full or pending — the design states no such
 * rule and no column backs one.
 */

/** Colour pair per tone, in the design's order. Shape (radius, padding) stays
 *  with the caller: §01 draws a 4px-radius chip, §02 a pill. */
const GROUP_TAG_TONES = [
  'bg-[var(--color-mint)] text-[var(--color-teal-deep)]',
  'bg-[var(--color-sand)] text-[var(--color-brass)]',
] as const;

export const GROUP_TAG_TONE_COUNT = GROUP_TAG_TONES.length;

/**
 * Tailwind background + text classes for one group's tag.
 *
 * FNV-1a/32 over the id, so the same group always lands on the same tone in
 * every locale, on every screen, across reloads and re-renders.
 */
export function groupTagTone(groupId: string | null | undefined): string {
  const id = groupId ?? '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return GROUP_TAG_TONES[(hash >>> 0) % GROUP_TAG_TONES.length];
}
