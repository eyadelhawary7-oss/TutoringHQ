import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { sendWelcomeTemplate } from '@/lib/centerNotify';
import { generateReferralCode } from '@/lib/referral';
import { normalizePhone, authEmailFromPhone } from '@/lib/utils/phone';
import { issueForWebhook as issuePinSetupTokenForWebhook } from '@/lib/pinSetupTokens';

export interface ProvisionCenterOwnerArgs {
  centerId: string;
  centerName: string;
  ownerName?: string | null;
  /** Owner phone; will be normalised to the canonical stored form. */
  phone: string;
}

/**
 * Create the owner LOGIN for a center and put it on the set-PIN rails — WITHOUT any
 * payment. This is the trial-first signup's provisioning step: it mirrors the
 * (now-retired) Paymob auto-approve owner block, minus the billing activation.
 *
 * Creates: a Supabase auth user (placeholder password, overwritten when the owner
 * chooses their PIN at /set-pin), the `public.users` owner row (all can_* perms,
 * `pin_set_at` NULL), a live `pin_setup_tokens` row (so /set-pin's cookie path
 * renders the form), a referral code, and a best-effort welcome WhatsApp.
 *
 * The two HARD steps (auth create, users insert) throw on failure so the caller can
 * roll back the center; the token / referral / welcome are best-effort (the owner can
 * still recover a PIN link via /api/auth/request-pin-setup-link).
 *
 * @returns the created auth user id.
 */
export async function provisionCenterOwner(
  supabase: SupabaseClient,
  args: ProvisionCenterOwnerArgs,
): Promise<string> {
  const { centerId, centerName, ownerName } = args;
  const normalizedPhone = normalizePhone((args.phone ?? '').trim());
  // Refuse to provision — and thus refuse to WRITE — a phone that does not
  // canonicalize to a valid Egyptian mobile E.164. authEmailFromPhone returns
  // null in exactly that case, so it is also the write guard.
  const authEmail = authEmailFromPhone(normalizedPhone);
  if (!authEmail) {
    throw new Error('provisionCenterOwner: missing/invalid phone');
  }

  // Placeholder password — 256 bits of entropy, never disclosed. Overwritten by
  // /api/auth/set-initial-pin once the owner chooses a PIN; until then pin_set_at
  // stays NULL (the "no PIN yet" gate).
  const placeholderPassword = randomBytes(32).toString('base64url');

  const { data: authData, error: createAuthError } = await supabase.auth.admin.createUser({
    email: authEmail,
    password: placeholderPassword,
    email_confirm: true,
  });
  if (createAuthError || !authData?.user?.id) {
    throw new Error(
      `provisionCenterOwner: auth create failed: ${createAuthError?.message ?? 'unknown'}`,
    );
  }
  const userId = authData.user.id;

  const { error: userInsErr } = await supabase.from('users').insert({
    id: userId,
    center_id: centerId,
    role: 'owner',
    phone: normalizedPhone,
    name: (ownerName ?? '').trim() || centerName || null,
    preferred_locale: 'ar',
    can_scan: true,
    can_view_payments: true,
    can_record_payments: true,
    can_view_dashboard: true,
    can_view_revenue: true,
    can_manage_students: true,
    can_manage_groups: true,
    can_manage_rooms: true,
    can_view_schedule: true,
    can_view_settings: true,
    can_allow_late_entry: true,
    is_active: true,
  });
  if (userInsErr) {
    // Roll back the orphan auth user before surfacing to the caller.
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(`provisionCenterOwner: users insert failed: ${userInsErr.message}`);
  }

  // Set-PIN rails — best-effort. Failure must NOT abort provisioning; the owner can
  // recover via /api/auth/request-pin-setup-link, but it must surface to Sentry.
  try {
    await issuePinSetupTokenForWebhook(supabase, { userId });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { source: 'provisionCenterOwner', step: 'issuePinSetupToken' },
      extra: { centerId, userId },
    });
  }

  // Referral code — best-effort, retry a few times on code collision.
  try {
    let code = generateReferralCode(centerName);
    for (let attempts = 0; attempts < 5; attempts++) {
      const { error: rcErr } = await supabase
        .from('referral_codes')
        .insert({ center_id: centerId, code });
      if (!rcErr) {
        await supabase.from('centers').update({ referral_code: code }).eq('id', centerId);
        break;
      }
      code = generateReferralCode(centerName);
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { source: 'provisionCenterOwner', step: 'referralCode' },
      extra: { centerId },
    });
  }

  // Welcome WhatsApp — best-effort, respects the wa_sending_enabled kill switch.
  try {
    const { data: waCfg } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'wa_sending_enabled')
      .maybeSingle();
    if (waCfg?.value !== false) {
      await sendWelcomeTemplate(supabase, { id: centerId, name: centerName, phone: normalizedPhone });
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { source: 'provisionCenterOwner', step: 'welcome' },
      extra: { centerId },
    });
  }

  return userId;
}
