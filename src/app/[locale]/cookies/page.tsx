import LegalDoc from '../legal/LegalDoc';

export const metadata = { title: 'Cookie Policy - TutoringHQ' };

/**
 * `/cookies` — the address the public marketing footer links to, alongside
 * `/privacy` and `/terms`, both of which already existed at the top level and
 * were unlinked. The cookie policy previously lived only at `/legal/cookie`,
 * which now re-exports this page so there is exactly one definition of the
 * document and no chance of the two drifting.
 */
export default function CookiesPage() {
  return (
    <LegalDoc
      title={{ en: 'Cookie Policy', ar: 'سياسة الكوكيز' }}
      sections={[
        { en: 'What Are Cookies', ar: 'ما هي الكوكيز' },
        { en: 'Cookies We Use', ar: 'الكوكيز التي نستخدمها' },
        { en: 'Third-Party Cookies', ar: 'كوكيز الأطراف الثالثة' },
        { en: 'Managing Cookies', ar: 'إدارة الكوكيز' },
        { en: 'Contact', ar: 'التواصل' },
      ]}
    />
  );
}
