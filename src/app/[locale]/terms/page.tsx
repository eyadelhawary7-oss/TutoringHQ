import { permanentRedirect } from '@/i18n/routing';

/**
 * s03-4 / s08-6 — the second, contradictory Terms document. Its one piece of
 * unique content, the config-driven processing-fee disclosure, is NOT dropped:
 * it moved into `legal/terms/page.tsx`, which resolves the same
 * `getProcessingFeeConfig()` / `resolveProcessingFeeAmount()` pair and passes it
 * into the Terms reader under the same `> 0` gate (F1).
 *
 * Permanent redirect, not a delete — see the note on the privacy twin.
 */
export default async function TermsRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect({ href: '/legal/terms', locale });
}
