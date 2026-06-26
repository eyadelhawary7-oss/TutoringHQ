'use client';

import { clearOfflineData } from '@/lib/db';

/**
 * Clears Supabase auth cookies via POST /api/auth/signout, then hard-navigates to login.
 *
 * This is the EXPLICIT logout path (the "Log out" buttons). It also wipes the
 * offline scanner roster PII from IndexedDB so a shared device does not retain
 * student names/phones/balances after a user deliberately signs out. Token/
 * session expiry does NOT route through here (middleware handles that), so an
 * offline scanner mid-session is never wiped out from under the user.
 */
export async function signOutToLogin(locale: string): Promise<void> {
  try {
    await clearOfflineData();
  } catch {
    /* best-effort — never block logout on an IndexedDB error */
  }
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
