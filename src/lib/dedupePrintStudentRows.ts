/** Deduplicate student rows for print: unique `id`, then at most one row per trimmed `student_number`. */
export function dedupePrintStudentRows<T extends { id: string; student_number?: string | null }>(
  rows: T[],
): T[] {
  const byId = [...new Map(rows.map((s) => [s.id, s] as const)).values()];
  const seenNumbers = new Set<string>();
  const out: T[] = [];
  for (const s of byId) {
    const num = s.student_number?.trim();
    if (num) {
      if (seenNumbers.has(num)) continue;
      seenNumbers.add(num);
    }
    out.push(s);
  }
  return out;
}
