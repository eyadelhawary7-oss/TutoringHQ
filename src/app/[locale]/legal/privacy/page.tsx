import LegalDoc from '../LegalDoc';

export const metadata = { title: 'Privacy Policy - CenterHQ' };

export default function LegalPrivacyPage() {
  return (
    <LegalDoc
      title={{ en: 'Privacy Policy', ar: 'سياسة الخصوصية' }}
      sections={[
        { en: 'Introduction and Data Controller', ar: 'مقدمة والمتحكم في البيانات' },
        { en: 'Data We Collect', ar: 'البيانات التي نجمعها' },
        { en: 'How We Use Your Data', ar: 'كيف نستخدم بياناتك' },
        { en: 'Legal Basis for Processing', ar: 'الأساس القانوني للمعالجة' },
        { en: 'Data Sharing and Sub-processors', ar: 'مشاركة البيانات والمعالجون الفرعيون' },
        { en: 'Data Retention', ar: 'الاحتفاظ بالبيانات' },
        { en: 'Your Rights Under Egyptian PDPL', ar: 'حقوقك بموجب قانون حماية البيانات المصري' },
        { en: 'Cross-border Data Transfers', ar: 'نقل البيانات عبر الحدود' },
        { en: 'Cookies and Tracking', ar: 'الكوكيز والتتبع' },
        { en: "Children's Privacy", ar: 'خصوصية الأطفال' },
        { en: 'Changes to This Policy', ar: 'التغييرات على هذه السياسة' },
        { en: 'Contact and Data Rights Requests', ar: 'التواصل وطلبات حقوق البيانات' },
      ]}
    />
  );
}
