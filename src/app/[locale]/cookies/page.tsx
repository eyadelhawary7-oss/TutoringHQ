import LegalDoc from '../legal/LegalDoc';

export const metadata = { title: 'Cookie Policy - TutoringHQ' };

/**
 * `/cookies` — the address the public marketing footer links to, alongside
 * `/privacy` and `/terms`. The cookie policy previously lived only at
 * `/legal/cookie`, which now re-exports this page so there is exactly one
 * definition of the document and no chance of the two drifting.
 *
 * The section list is no longer passed in here. It lives with the other three
 * documents in `legal/legalContent.ts`, keyed by slug, so the reader chrome,
 * the index row and the version line all read the same source.
 */
export default function CookiesPage() {
  return <LegalDoc slug="cookie" />;
}
