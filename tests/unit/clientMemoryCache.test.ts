import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('clientMemoryCache', () => {
  it('round-trips values in memory and removes them', async () => {
    const { memoryCacheGet, memoryCacheSet, memoryCacheRemove } = await import(
      '@/lib/clientMemoryCache'
    );
    expect(memoryCacheGet('missing')).toBeNull();
    memoryCacheSet('k', { name: 'Sara', phone: '+201000000000' });
    expect(memoryCacheGet<{ name: string }>('k')?.name).toBe('Sara');
    memoryCacheRemove('k');
    expect(memoryCacheGet('k')).toBeNull();
  });
});

describe('PII stores never touch sessionStorage / localStorage', () => {
  const setItem = vi.fn();
  const getItem = vi.fn(() => null);

  beforeEach(() => {
    setItem.mockClear();
    getItem.mockClear();
    // Simulate a browser whose storage we forbid the PII modules from using.
    (globalThis as unknown as { window: unknown }).window = {};
    (globalThis as unknown as { localStorage: unknown }).localStorage = { setItem, getItem };
    (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = { setItem, getItem };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    delete (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage;
  });

  it('recentlyViewedStudents keeps names in memory, not on disk', async () => {
    const { pushRecentlyViewedStudent, readRecentlyViewedStudents } = await import(
      '@/lib/recentlyViewedStudents'
    );
    pushRecentlyViewedStudent('center-1', { id: 's1', name: 'Ahmed Ali' });
    const recent = readRecentlyViewedStudents('center-1');
    expect(recent).toEqual([{ id: 's1', name: 'Ahmed Ali' }]);
    // The PII name round-tripped, but disk storage was never written.
    expect(setItem).not.toHaveBeenCalled();
  });
});
