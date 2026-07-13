import { getTranslations } from 'next-intl/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { findOpenInviteByPlaintext } from '@/lib/staffInviteTokens';
import StaffInviteClient from './StaffInviteClient';

/**
 * /staff-invite — PUBLIC self-service intake page for an internal-team invite link.
 *
 * The server component resolves the `?t=<token>` invite server-side (service-role) purely to
 * decide whether to render the intake FORM (and which role to display, read-only) or the
 * INVALID view. It grants nothing: the real boundary is /api/staff-invite/submit, which
 * re-validates the token and freezes the role from the invite. There is deliberately no
 * role picker — the invited person can only enter their name / phone / email.
 */
export default async function StaffInvitePage({
  searchParams,
  params,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'staffInvite' });

  const rawT = sp.t;
  const token =
    typeof rawT === 'string'
      ? rawT.trim()
      : Array.isArray(rawT) && typeof rawT[0] === 'string'
        ? rawT[0].trim()
        : '';

  let role: string | null = null;
  if (token) {
    try {
      const invite = await findOpenInviteByPlaintext(getSupabaseAdmin(), token);
      role = invite ? invite.role : null;
    } catch {
      role = null; // degrade to the invalid view; never expose system errors
    }
  }

  const roleLabels: Record<string, string> = {
    internal_viewer: t('roleInternalViewer'),
    internal_admin: t('roleInternalAdmin'),
    sales_manager: t('roleSalesManager'),
    sales_rep: t('roleSalesRep'),
    support_agent: t('roleSupportAgent'),
    accountant: t('roleAccountant'),
    custom: t('roleCustom'),
  };

  return (
    <StaffInviteClient
      locale={locale === 'ar' ? 'ar' : 'en'}
      mode={token && role ? 'form' : 'invalid'}
      token={token}
      roleLabel={role ? (roleLabels[role] ?? role) : ''}
      labels={{
        header: t('header'),
        helper: t('helper'),
        invitedAs: t('invitedAs'),
        nameLabel: t('nameLabel'),
        phoneLabel: t('phoneLabel'),
        emailLabel: t('emailLabel'),
        emailOptional: t('emailOptional'),
        submit: t('submit'),
        submitting: t('submitting'),
        successHeader: t('successHeader'),
        successHelper: t('successHelper'),
        invalidHeader: t('invalidHeader'),
        invalidHelper: t('invalidHelper'),
        errorGeneric: t('errorGeneric'),
        errorPhone: t('errorPhone'),
        errorName: t('errorName'),
      }}
    />
  );
}
