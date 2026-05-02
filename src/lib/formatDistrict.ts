/** Human-readable district from stored slug (e.g. `6th_october` → `6th October`). */
export function formatDistrictDisplay(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === '') return '';
  return String(raw)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Normalize editable district text back to slug for API/DB. */
export function districtSlugFromDisplay(display: string): string {
  return display.trim().replace(/\s+/g, '_').toLowerCase();
}
