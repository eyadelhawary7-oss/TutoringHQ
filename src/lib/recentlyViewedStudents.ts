export type RecentStudentView = { id: string; name: string };

function key(centerId: string): string {
  return `recentlyViewedStudents.${centerId}`;
}

export function pushRecentlyViewedStudent(centerId: string, student: RecentStudentView): void {
  if (typeof window === 'undefined' || !centerId?.trim()) return;
  try {
    const raw = localStorage.getItem(key(centerId));
    const prev: RecentStudentView[] = raw ? (JSON.parse(raw) as RecentStudentView[]) : [];
    const next = [{ id: student.id, name: student.name }, ...prev.filter((x) => x.id !== student.id)].slice(
      0,
      5,
    );
    localStorage.setItem(key(centerId), JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readRecentlyViewedStudents(centerId: string): RecentStudentView[] {
  if (typeof window === 'undefined' || !centerId?.trim()) return [];
  try {
    const raw = localStorage.getItem(key(centerId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === 'object' && 'id' in x && 'name' in x)
      .map((x) => ({ id: String((x as RecentStudentView).id), name: String((x as RecentStudentView).name) }))
      .slice(0, 5);
  } catch {
    return [];
  }
}
