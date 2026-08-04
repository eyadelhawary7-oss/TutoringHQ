import { permanentRedirect } from '@/i18n/routing';

/**
 * s03-4 / s08-6 — this was a second, contradictory Privacy Policy. It rendered
 * "Last updated: 9 May 2026" from the `legal.privacy` message namespace while
 * `/legal/privacy` rendered "[Pending]", so the site stated two different
 * things about the same document.
 *
 * A permanent redirect rather than a delete: URLs like this get pasted into
 * contracts and app-store listings, so a 404 would break someone else's record.
 * `/privacy` stays in `publicRoutes` (src/proxy.ts) so the redirect is reachable
 * unauthenticated.
 */
export default async function PrivacyRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect({ href: '/legal/privacy', locale });
}
