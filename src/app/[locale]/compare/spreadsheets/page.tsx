import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isAr = locale === 'ar';
  return {
    title: isAr
      ? 'بديل الإكسيل لإدارة السنتر | TutoringHQ'
      : 'Spreadsheet Alternative for Tutoring Centers | TutoringHQ',
    description: isAr
      ? 'لماذا السنترات الناجحة تتخلى عن الإكسيل وتستخدم TutoringHQ.'
      : 'Why successful tutoring centers ditch spreadsheets for TutoringHQ.',
    alternates: { canonical: '/compare/spreadsheets' },
  };
}

type Row = { feature: string; sheets: string; chq: string };

const CONTENT = {
  ar: {
    pageTitle: 'TutoringHQ مقابل الإكسيل والورق',
    heroSub:
      'الإكسيل والورق يكفيان في البداية، لكن مع نمو السنتر تتحول إلى فوضى: بيانات متفرقة، أخطاء يدوية، وأهالي بلا متابعة. TutoringHQ بُني خصيصاً للسنترات التعليمية في مصر.',
    colSheets: 'الإكسيل / الورق',
    colChq: 'TutoringHQ',
    cta: 'ابدأ مجاناً الآن',
    tableHeading: 'المقارنة بالتفصيل',
    rows: [
      {
        feature: 'تسجيل الحضور',
        sheets: 'إدخال يدوي بطيء وعرضة للخطأ',
        chq: 'مسح QR فوري عند الباب',
      },
      {
        feature: 'إشعارات الأهالي',
        sheets: 'مكالمات ورسائل فردية متعبة',
        chq: 'واتساب تلقائي عند الحضور والغياب',
      },
      {
        feature: 'تحصيل المدفوعات',
        sheets: 'تتبع يدوي ومبالغ ضائعة',
        chq: 'فواتير تلقائية وتذكير بالمتأخرات',
      },
      {
        feature: 'سجل الطالب',
        sheets: 'مبعثر بين ملفات وأوراق',
        chq: 'ملف كامل لكل طالب في مكان واحد',
      },
      {
        feature: 'التقارير',
        sheets: 'تجميع يدوي يستغرق ساعات',
        chq: 'تقارير لحظية للحضور والدخل',
      },
      {
        feature: 'القابلية للتوسع',
        sheets: 'تنهار مع زيادة الطلاب والفروع',
        chq: 'يدعم فروع وآلاف الطلاب بسلاسة',
      },
    ] as Row[],
  },
  en: {
    pageTitle: 'TutoringHQ vs. Spreadsheets & Paper',
    heroSub:
      'Spreadsheets and paper work at first, but as your center grows they turn into chaos: scattered data, manual mistakes, and parents left in the dark. TutoringHQ is built specifically for tutoring centers in Egypt.',
    colSheets: 'Spreadsheet / Paper',
    colChq: 'TutoringHQ',
    cta: 'Start free now',
    tableHeading: 'Detailed comparison',
    rows: [
      {
        feature: 'Attendance tracking',
        sheets: 'Slow, error-prone manual entry',
        chq: 'Instant QR scan at the door',
      },
      {
        feature: 'Parent notifications',
        sheets: 'Exhausting one-by-one calls & texts',
        chq: 'Automatic WhatsApp on check-in & absence',
      },
      {
        feature: 'Payment collection',
        sheets: 'Manual tracking and lost money',
        chq: 'Automated invoices and overdue reminders',
      },
      {
        feature: 'Student history',
        sheets: 'Scattered across files and papers',
        chq: 'Complete profile per student in one place',
      },
      {
        feature: 'Reporting',
        sheets: 'Hours of manual aggregation',
        chq: 'Real-time attendance & revenue reports',
      },
      {
        feature: 'Scalability',
        sheets: 'Breaks down as students & branches grow',
        chq: 'Handles branches and thousands of students',
      },
    ] as Row[],
  },
} as const;

export default async function CompareSpreadsheetsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const c = locale === 'en' ? CONTENT.en : CONTENT.ar;

  return (
    <main className="min-h-screen bg-[var(--color-navy-950)] text-white">
      <section
        className="px-4 pb-12 pt-20 md:px-6 md:pb-16 md:pt-28"
        style={{
          background:
            'radial-gradient(ellipse 80% 40% at 50% 0%, rgba(13, 148, 136, 0.08), transparent), var(--color-navy-950)',
        }}
      >
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-3xl font-bold leading-tight text-white md:text-5xl">
            {c.pageTitle}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[var(--color-text-secondary)] md:text-lg">
            {c.heroSub}
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-flex rounded-xl bg-teal-600 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-teal-700 btn-press chq-focus"
          >
            {c.cta}
          </Link>
        </div>
      </section>

      <section className="border-t border-slate-800/40 bg-[var(--color-navy-950)] px-4 py-12 md:px-6 md:py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-8 text-center text-2xl font-bold !text-white md:text-3xl">
            {c.tableHeading}
          </h2>
          <div className="overflow-hidden rounded-2xl border border-[var(--color-border)]">
            <table className="w-full border-collapse text-start">
              <thead>
                <tr className="bg-[var(--color-surface-1)]">
                  <th className="px-4 py-4 text-start text-sm font-semibold text-white md:px-6" />
                  <th className="px-4 py-4 text-start text-sm font-semibold text-slate-300 md:px-6">
                    {c.colSheets}
                  </th>
                  <th className="px-4 py-4 text-start text-sm font-semibold text-teal-400 md:px-6">
                    {c.colChq}
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={
                      i % 2 === 0
                        ? 'bg-[var(--color-surface-0)]'
                        : 'bg-[var(--color-surface-1)]'
                    }
                  >
                    <th
                      scope="row"
                      className="px-4 py-4 text-start text-sm font-semibold text-white md:px-6"
                    >
                      {row.feature}
                    </th>
                    <td className="px-4 py-4 text-start text-sm text-[var(--color-text-secondary)] md:px-6">
                      {row.sheets}
                    </td>
                    <td className="px-4 py-4 text-start text-sm text-white md:px-6">
                      {row.chq}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/signup"
              className="inline-flex rounded-xl bg-teal-600 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-teal-700 btn-press chq-focus"
            >
              {c.cta}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
