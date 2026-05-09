'use client';

/**
 * Clears Supabase auth cookies via POST /api/auth/signout, then hard-navigates to login.
 */
export async function signOutToLogin(locale: string): Promise<void> {
  try {
    await fetch('/api/auth/signout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale }),
    });
  } catch {
    /* still navigate away */
  }
  if (typeof window !== 'undefined') {
    window.location.href = `/${locale}/login`;
  }
}
