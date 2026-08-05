import { permanentRedirect } from '@/i18n/routing';

/**
 * `/cookies` — the older public address for the Cookie Policy, kept alive as a
 * permanent redirect into `/legal/cookie`, which is where the document is now
 * defined.
 *
 * It used to hold the definition itself and `/legal/cookie` re-exported it.
 * That put the reader outside `legal/layout.tsx`, the only thing that supplies
 * the design's `flex min-h-screen flex-col bg-[var(--color-paper)]` column and
 * the `dir` — see the note in `legal/cookie/page.tsx` for what broke. Now the
 * two match the `/privacy` and `/terms` twins: old URL redirects, document
 * lives under `legal/`.
 *
 * A redirect rather than a delete, for the same reason as those two: public
 * legal URLs get pasted into app-store listings and contracts, so a 404 would
 * break someone else's record. `/cookies` stays in `publicRoutes`
 * (`src/proxy.ts`) and in `AppShell`'s `PUBLIC_PATHS` so the redirect is
 * reachable unauthenticated and never flashes the app shell on the way.
 */
export default async function CookiesRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect({ href: '/legal/cookie', locale });
}
