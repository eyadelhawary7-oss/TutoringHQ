import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { normalizePhone, authEmailFromPhone } from '@/lib/utils/phone';
import { mintForFallback } from '@/lib/pinSetupTokens';
import { sendPinSetupLink } from '@/lib/centerNotify';

export interface ProvisionStaffLoginResult {
  /** The created auth user id (== admin_users.id == staff.user_id). */
  userId: string;
  /** Single-use /set-pin link to hand the employee so they choose their own PIN. */
  setupUrl: string;
}

/**
 * Create a LOGIN for an internal team member (manager / rep / accountant / …)
 * DIRECTLY — the same primitives that provision a center owner, minus everything
 * customer-specific. Employees are staff, not customers: they never sign up, have no
 * `public.users` row (the documented internal-team invariant; `getAdminContext` and
 * `/api/login` already resolve such accounts from `admin_users` alone), and have no
 * center or billing.
 *
 * Creates only the auth identity + a self-service set-PIN grant. The caller owns the
 * `admin_users` row and the `staff.user_id` link so it can roll back atomically. If any
 * step AFTER the auth-user create fails (e.g. minting the token), this function deletes
 * the just-created auth user before rethrowing, so a failed add never leaves an orphan
 * `<digits>@centerhq.local` identity that would block re-adding the same phone.
 *
 * Mirrors `provisionCenterOwner`: `<digits>@centerhq.local` auth email (so phone+PIN
 * login resolves), a 256-bit placeholder password overwritten at /set-pin, and a
 * `pin_setup_tokens` fallback grant delivered by the same WhatsApp template. The PIN
 * rail works for a center-less user because `pin_setup_tokens.user_id` now FKs
 * `auth.users` and `/api/auth/set-initial-pin` has an internal-admin branch.
 */
export async function provisionStaffLogin(
  admin: SupabaseClient,
  args: { phone: string; name?: string | null },
): Promise<ProvisionStaffLoginResult> {
  const normalized = normalizePhone((args.phone ?? '').trim());
  // Refuse to WRITE a phone that does not canonicalize to a valid Egyptian
  // mobile E.164 (authEmailFromPhone returns null in exactly that case).
  const authEmail = authEmailFromPhone(normalized);
  if (!authEmail) throw new Error('provisionStaffLogin: missing/invalid phone');

  // 256 bits of entropy, never disclosed; overwritten when the employee sets their PIN.
  const placeholderPassword = randomBytes(32).toString('base64url');

  const { data: authData, error: createErr } = await admin.auth.admin.createUser({
    email: authEmail,
    password: placeholderPassword,
    email_confirm: true,
  });
  if (createErr || !authData?.user?.id) {
    throw new Error(`provisionStaffLogin: auth create failed: ${createErr?.message ?? 'unknown'}`);
  }
  const userId = authData.user.id;

  try {
    // Self-service set-PIN grant (single-use, TTL'd). Same helper the owner path uses.
    const { plaintext } = await mintForFallback(admin, { userId });
    const appUrl =
      (process.env.NEXT_PUBLIC_APP_URL || 'https://tutoringhq.app').replace(/\/+$/, '') ||
      'https://tutoringhq.app';
    const setupUrl = `${appUrl}/ar/set-pin?t=${encodeURIComponent(plaintext)}`;

    // Best-effort WhatsApp delivery — the caller also returns setupUrl so the CEO can
    // copy/share it. A send failure must never fail provisioning.
    try {
      await sendPinSetupLink(normalized, setupUrl);
    } catch (e) {
      Sentry.captureException(e, {
        tags: { source: 'provisionStaffLogin', step: 'sendPinSetupLink' },
        extra: { userId },
      });
    }

    return { userId, setupUrl };
  } catch (e) {
    // Token mint failed AFTER the auth user was created — delete the orphan before
    // rethrowing so the same phone can be re-added (createUser would otherwise 422 on
    // the duplicate email forever).
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw e instanceof Error
      ? e
      : new Error('provisionStaffLogin: set-PIN grant failed after auth create');
  }
}
