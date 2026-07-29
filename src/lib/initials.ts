/**
 * The two-letter mark the design's `.av` avatar tile carries — "AN" for
 * Al-Nahda, "DF" for Dina Fouad, "OF" for Omar Farid.
 *
 * `Merged-Admin-Accounts` draws it on all four sections, so it lives here
 * rather than being re-derived per screen. Feeds `ListRow`'s `avatar` prop.
 *
 * Arabic names get one glyph, not two: Arabic script is cursive and a
 * two-letter mark taken from separate words renders as two disconnected
 * letterforms that read as neither name. The design's own Arabic frames show
 * a single glyph ("ن" for النهضة) for exactly this reason.
 */
export function initialsOf(value: string | null | undefined): string {
  const s = (value ?? '').trim();
  if (!s) return '?';

  const isArabic = /[؀-ۿ]/.test(s);
  const words = s.split(/\s+/).filter(Boolean);

  if (isArabic) {
    // Skip a leading article so "النهضة" marks as "ن", not "ا".
    const head = words[0] ?? s;
    const stripped = head.startsWith('ال') && head.length > 2 ? head.slice(2) : head;
    return stripped.charAt(0);
  }

  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}
