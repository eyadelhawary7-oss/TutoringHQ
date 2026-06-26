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
 *
 * SCOPE / honest caveat: this no-PII-on-disk guarantee covers localStorage and
 * sessionStorage only. The offline attendance scanner is a deliberate, separate
 * exception — it caches roster data (student name/phone/balance) in IndexedDB
 * (`src/lib/db.ts`) so scanning keeps working with no network. That cache is
 * required for the offline feature; it is wiped on EXPLICIT logout via
 * `clearOfflineData()` (not on token expiry — see db.ts). So: "no PII in
 * localStorage/sessionStorage" is accurate; "no PII anywhere in browser storage"
 * is NOT — the IndexedDB scanner cache holds roster PII by design.
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
