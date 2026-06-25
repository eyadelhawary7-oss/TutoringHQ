import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * CSRF must FAIL CLOSED: when CSRF_SECRET is missing/malformed the validator
 * rejects (returns false) instead of waving the request through.
 */
const VALID_SECRET = 'a'.repeat(64); // 64-hex = 32 bytes

function makeRequest(headers: Record<string, string>): Request {
  return new Request('https://centerhq.app/api/x', { method: 'POST', headers });
}

afterEach(() => {
  vi.resetModules();
  delete process.env.CSRF_SECRET;
});

describe('validateCSRFRequest fail-closed', () => {
  it('REJECTS when CSRF_SECRET is unset (was previously allowed)', async () => {
    delete process.env.CSRF_SECRET;
    vi.resetModules();
    const { validateCSRFRequest, isCSRFEnabled } = await import('@/lib/csrf');
    expect(isCSRFEnabled()).toBe(false);
    expect(validateCSRFRequest(makeRequest({}), 'user-1')).toBe(false);
  });

  it('REJECTS when CSRF_SECRET is malformed (not 64-hex)', async () => {
    process.env.CSRF_SECRET = 'too-short';
    vi.resetModules();
    const { validateCSRFRequest, isCSRFEnabled } = await import('@/lib/csrf');
    expect(isCSRFEnabled()).toBe(false);
    expect(validateCSRFRequest(makeRequest({}), 'user-1')).toBe(false);
  });

  it('accepts a valid token when the secret IS configured', async () => {
    process.env.CSRF_SECRET = VALID_SECRET;
    vi.resetModules();
    const { validateCSRFRequest, generateCSRFToken } = await import('@/lib/csrf');
    const token = generateCSRFToken('user-1');
    const ok = validateCSRFRequest(
      makeRequest({ 'X-CSRF-Token': token, 'X-Session-ID': 'user-1' }),
      'user-1',
    );
    expect(ok).toBe(true);
  });

  it('still rejects a missing token even when the secret is configured', async () => {
    process.env.CSRF_SECRET = VALID_SECRET;
    vi.resetModules();
    const { validateCSRFRequest } = await import('@/lib/csrf');
    expect(validateCSRFRequest(makeRequest({}), 'user-1')).toBe(false);
  });
});
