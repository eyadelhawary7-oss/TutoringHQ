/** Lexical-aware ordering for STU-00002-style identifiers (numeric segments sort numerically). */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
