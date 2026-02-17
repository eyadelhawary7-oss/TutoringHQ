'use client';

/** Cached CSRF token and session ID for authenticated requests */
let csrfCache: { token: string; sessionId: string } | null = null;

/**
 * Fetches CSRF token for the current session and returns headers to include in state-changing requests.
 * Call this before POST/PUT/DELETE to protected endpoints.
 */
export async function getCsrfHeaders(accessToken: string): Promise<Record<string, string>> {
  if (!accessToken) return {};

  try {
    if (!csrfCache) {
      const res = await fetch('/api/csrf-token', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return {};
      const { token, sessionId } = await res.json();
      if (token && sessionId) {
        csrfCache = { token, sessionId };
      }
    }
    if (csrfCache) {
      return {
        'X-CSRF-Token': csrfCache.token,
        'X-Session-ID': csrfCache.sessionId,
      };
    }
  } catch {
    // Ignore - CSRF may be disabled
  }
  return {};
}

/** Clear cached CSRF token (e.g. on logout) */
export function clearCsrfCache() {
  csrfCache = null;
}
