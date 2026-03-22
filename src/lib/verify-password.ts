import { createClient } from '@supabase/supabase-js';

const PASSWORD_CONFIRM_THRESHOLD_EGP = 50_000;

/**
 * Verifies the current user's password for sensitive actions.
 * Requires the user to have email set (phone-only accounts cannot use this).
 */
export async function verifyPasswordForSensitiveAction(
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!password || typeof password !== 'string' || password.trim().length === 0) {
    return { ok: false, error: 'PIN required' };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error: userError } = await authClient.auth.getUser();
  if (userError || !user) {
    return { ok: false, error: 'Not authenticated' };
  }

  const email = (user.email || '').trim();
  if (!email) {
    return {
      ok: false,
      error:
        'Your account uses phone sign-in. Add an email and PIN in account settings to perform sensitive actions.',
    };
  }

  const verifyClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  const { error } = await verifyClient.auth.signInWithPassword({
    email,
    password: password.trim(),
  });

  if (error) {
    return { ok: false, error: 'Invalid PIN' };
  }

  return { ok: true };
}

/** EGP amount above which payment approval requires password confirmation */
export const SENSITIVE_PAYMENT_THRESHOLD = PASSWORD_CONFIRM_THRESHOLD_EGP;
