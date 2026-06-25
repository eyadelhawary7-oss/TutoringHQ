import { memoryCacheGet, memoryCacheSet } from '@/lib/clientMemoryCache';

export type RecentStudentView = { id: string; name: string };

// Tab-scoped in-memory only. "Recently viewed" carries student NAMES (PII), so
// it is no longer persisted to localStorage — it survives soft navigation within
// the session and is gone on reload/tab close, never written to disk.
function key(centerId: string): string {
  return `recentlyViewedStudents.${centerId}`;
}

export function pushRecentlyViewedStudent(centerId: string, student: RecentStudentView): void {
  if (typeof window === 'undefined' || !centerId?.trim()) return;
  const prev = memoryCacheGet<RecentStudentView[]>(key(centerId)) ?? [];
  const next = [
    { id: student.id, name: student.name },
    ...prev.filter((x) => x.id !== student.id),
  ].slice(0, 5);
  memoryCacheSet(key(centerId), next);
}

export function readRecentlyViewedStudents(centerId: string): RecentStudentView[] {
  if (typeof window === 'undefined' || !centerId?.trim()) return [];
  const arr = memoryCacheGet<RecentStudentView[]>(key(centerId));
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && typeof x === 'object' && 'id' in x && 'name' in x)
    .map((x) => ({ id: String(x.id), name: String(x.name) }))
    .slice(0, 5);
}
