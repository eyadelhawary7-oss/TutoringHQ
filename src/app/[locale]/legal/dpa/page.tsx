import LegalDoc from '../LegalDoc';

export const metadata = { title: 'Data Processing Agreement - CenterHQ' };

export default function LegalDpaPage() {
  return (
    <LegalDoc
      title={{ en: 'Data Processing Agreement', ar: 'اتفاقية معالجة البيانات' }}
      sections={[
        { en: 'Parties and Purpose', ar: 'الأطراف والغرض' },
        { en: 'Definitions', ar: 'التعريفات' },
        { en: 'Subject Matter and Duration', ar: 'الموضوع والمدة' },
        { en: 'Nature and Purpose of Processing', ar: 'طبيعة المعالجة والغرض منها' },
        { en: 'Types of Personal Data', ar: 'أنواع البيانات الشخصية' },
        { en: 'Obligations of the Data Processor', ar: 'التزامات معالج البيانات' },
        { en: 'Sub-processors', ar: 'المعالجون الفرعيون' },
        { en: 'Data Subject Rights', ar: 'حقوق أصحاب البيانات' },
        { en: 'Security Measures', ar: 'الإجراءات الأمنية' },
        { en: 'Data Breach Notification', ar: 'الإخطار بخرق البيانات' },
        { en: 'Return and Deletion of Data', ar: 'إعادة البيانات وحذفها' },
        { en: 'Audit Rights', ar: 'حقوق التدقيق' },
        { en: 'Governing Law', ar: 'القانون الحاكم' },
        { en: 'Signatures', ar: 'التوقيعات' },
      ]}
    />
  );
}
