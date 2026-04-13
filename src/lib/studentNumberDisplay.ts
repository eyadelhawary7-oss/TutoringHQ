/**
 * Prefix # for display when the stored value omits it (parity across table, detail, exports).
 */
export function formatStudentNumberForDisplay(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === '') return '';
  const s = String(raw).trim();
  return s.startsWith('#') ? s : `#${s}`;
}
