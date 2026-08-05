import LegalDoc from '../LegalDoc';

export const metadata = { title: 'Cookie Policy - TutoringHQ' };

/**
 * The Cookie Policy's one definition, and the third of the four readers the
 * design's index opens.
 *
 * IT LIVES HERE, NOT AT `/cookies`, AND THAT IS THE WHOLE POINT OF THIS FILE.
 * Until now the document was defined in `[locale]/cookies/page.tsx` and this
 * route re-exported it. One definition, so no drift — but the definition sat
 * outside `legal/layout.tsx`, which is the element that supplies
 * `flex min-h-screen flex-col bg-[var(--color-paper)]` and the `dir`. `/cookies`
 * is in `AppShell`'s `PUBLIC_PATHS`, so `AppShell` renders `<>{children}</>`
 * with no wrapper of its own and `<body>` is not a flex column either. The
 * reader's `flex-1` scroll body and `flex-shrink-0` footer therefore had no
 * flex parent at that address: the "Back to all documents" bar stopped sitting
 * at the foot of the screen, and the paper column was never established.
 *
 * Three of the four documents were fine because they are under `legal/`. The
 * cookie policy was the exception, and it is the one address the public
 * marketing footer links to by name.
 *
 * So the direction is inverted rather than patched with a second layout file:
 * the definition moves under `legal/`, where the other three already are, and
 * `/cookies` becomes a `permanentRedirect` exactly like `/privacy` and
 * `/terms`. Same single definition, one route family, one layout.
 */
export default function LegalCookiePage() {
  return <LegalDoc slug="cookie" />;
}
