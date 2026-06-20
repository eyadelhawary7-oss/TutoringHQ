import LegalDoc from '../LegalDoc';

export const metadata = { title: 'Terms and Conditions - TutoringHQ' };

export default function LegalTermsPage() {
  return (
    <LegalDoc
      title={{ en: 'Terms and Conditions', ar: 'الشروط والأحكام' }}
      sections={[
        { en: 'Introduction and Acceptance', ar: 'المقدمة والقبول' },
        { en: 'Definitions', ar: 'التعريفات' },
        { en: 'Platform Access and Accounts', ar: 'الوصول إلى المنصة والحسابات' },
        { en: 'Subscription Plans and Fees', ar: 'خطط الاشتراك والرسوم' },
        { en: 'Payment Processing', ar: 'معالجة المدفوعات' },
        { en: 'Acceptable Use', ar: 'الاستخدام المقبول' },
        { en: 'Intellectual Property', ar: 'الملكية الفكرية' },
        { en: 'Data and Privacy', ar: 'البيانات والخصوصية' },
        { en: 'Service Availability and Limitations', ar: 'توافر الخدمة والقيود' },
        { en: 'Liability and Indemnification', ar: 'المسؤولية والتعويض' },
        { en: 'Termination', ar: 'إنهاء الخدمة' },
        { en: 'Governing Law (Egyptian Law)', ar: 'القانون الحاكم (القانون المصري)' },
        { en: 'Dispute Resolution', ar: 'تسوية النزاعات' },
        { en: 'Changes to Terms', ar: 'التغييرات على الشروط' },
        { en: 'Contact', ar: 'التواصل' },
      ]}
    />
  );
}
