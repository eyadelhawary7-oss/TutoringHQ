import LegalDoc from '../LegalDoc';

export const metadata = { title: 'Cookie Policy - TutoringHQ' };

export default function LegalCookiePage() {
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
