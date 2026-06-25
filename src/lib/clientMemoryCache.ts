/**
 * Tab-scoped, in-memory client cache for data that must NOT be persisted to disk.
 *
 * Replaces sessionStorage/localStorage for anything containing PII — student and
 * owner names, phone numbers, emails, addresses. The store lives only for the
 * lifetime of the page's JS runtime: it survives soft (client-side) navigation
 * within the SPA, but is gone on a full reload or tab close and is NEVER written
 * to disk. The server stays the source of truth for durability (e.g. signup
 * progress is also POSTed to /api/signup/persist), so a reload simply re-fetches
 * instead of reading personal data back off the device.
 */
const store = new Map<string, unknown>();

export function memoryCacheGet<T>(key: string): T | null {
  return store.has(key) ? (store.get(key) as T) : null;
}

export function memoryCacheSet(key: string, value: unknown): void {
  store.set(key, value);
}

export function memoryCacheRemove(key: string): void {
  store.delete(key);
}
