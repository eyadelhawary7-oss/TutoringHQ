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
      ? 'إدارة بيانات الطلاب | CenterHQ'
      : 'Student Management for Tutoring Centers | CenterHQ',
    description: isAr
      ? 'ملف كامل لكل طالب: الحضور، المدفوعات، المجموعات، والتواصل مع ولي الأمر.'
      : 'Complete student profiles: attendance history, payments, groups, and parent communication.',
    alternates: { canonical: '/features/student-management' },
  };
}

type Card = { title: string; desc: string };

const CONTENT = {
  ar: {
    heroTitle: 'ملف كامل لكل طالب',
    heroSub:
      'كل ما تحتاج معرفته عن أي طالب في مكان واحد — من تاريخ الحضور إلى المدفوعات والمجموعات والتواصل مع ولي الأمر.',
    cardsHeading: 'كل بيانات الطالب في صفحة واحدة',
    cards: [
      { title: 'سجل الحضور', desc: 'تاريخ حضور وغياب كامل لكل حصة.' },
      { title: 'متابعة المدفوعات', desc: 'الفواتير المدفوعة والمتأخرة لكل طالب.' },
      { title: 'توزيع المجموعات', desc: 'تعيين الطالب لمجموعاته وفصوله بسهولة.' },
      { title: 'بيانات ولي الأمر', desc: 'رقم واتساب ولي الأمر وكل وسائل التواصل.' },
      { title: 'رقم الطالب (#1024)', desc: 'رقم تعريفي فريد لكل طالب لتسهيل البحث.' },
      { title: 'الملاحظات والتنبيهات', desc: 'ملاحظات داخلية وتنبيهات خاصة بكل طالب.' },
    ] as Card[],
    cta: 'ابدأ مجاناً الآن',
  },
  en: {
    heroTitle: 'Complete Profile for Every Student',
    heroSub:
      'Everything you need to know about any student in one place — from attendance history to payments, groups, and parent communication.',
    cardsHeading: 'All student data on one page',
    cards: [
      { title: 'Attendance history', desc: 'A full record of presence and absence per session.' },
      { title: 'Payment tracking', desc: 'Paid and overdue invoices for each student.' },
      { title: 'Group assignment', desc: 'Assign students to their groups and classes easily.' },
      { title: 'Parent contact', desc: "The parent's WhatsApp number and all contact details." },
      { title: 'Student number (#1024)', desc: 'A unique ID for every student to make lookup fast.' },
      { title: 'Notes & flags', desc: 'Internal notes and special flags per student.' },
    ] as Card[],
    cta: 'Start free now',
  },
} as const;

export default async function StudentManagementPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const c = locale === 'en' ? CONTENT.en : CONTENT.ar;

  return (
    <main className="min-h-screen bg-[#080f1a] text-white">
      <section
        className="px-4 pb-12 pt-20 md:px-6 md:pb-16 md:pt-28"
        style={{
          background:
            'radial-gradient(ellipse 80% 40% at 50% 0%, rgba(13, 148, 136, 0.08), transparent), #080f1a',
        }}
      >
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-3xl font-bold leading-tight text-white md:text-5xl">
            {c.heroTitle}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[var(--color-text-secondary)] md:text-lg">
            {c.heroSub}
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-flex rounded-xl bg-teal-600 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
          >
            {c.cta}
          </Link>
        </div>
      </section>

      <section className="border-t border-[var(--color-border-subtle)] bg-[#080f1a] px-4 py-12 md:px-6 md:py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-center text-2xl font-bold !text-white md:text-3xl">
            {c.cardsHeading}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {c.cards.map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5 text-start"
              >
                <div
                  className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-teal-700/50 bg-teal-900/40"
                  aria-hidden
                >
                  <div className="h-3 w-3 rounded-sm bg-teal-500" />
                </div>
                <h3 className="mb-1 text-sm font-semibold text-white">{card.title}</h3>
                <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">{card.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/signup"
              className="inline-flex rounded-xl bg-teal-600 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
            >
              {c.cta}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
