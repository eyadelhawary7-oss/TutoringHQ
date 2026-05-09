/** Extract student UUIDs from card_orders.students JSON (strings or { id } objects). */
export function studentIdsFromOrderStudents(students: unknown): string[] {
  if (!Array.isArray(students)) return [];
  const ids: string[] = [];
  for (const el of students) {
    if (typeof el === 'string' && el.length > 0) ids.push(el);
    else if (el && typeof el === 'object' && 'id' in el) {
      const id = (el as { id?: unknown }).id;
      if (typeof id === 'string' && id.length > 0) ids.push(id);
    }
  }
  return ids;
}
