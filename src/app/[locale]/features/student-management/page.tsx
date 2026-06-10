import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import {
  CalendarCheck,
  Wallet,
  Users,
  Phone,
  Hash,
  StickyNote,
} from 'lucide-react';

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

type Card = { icon: typeof CalendarCheck; title: string; body: string };

const CONTENT = {
  ar: {
    heroTitle: 'ملف كامل لكل طالب',
    heroSub:
      'كل ما تحتاج معرفته عن الطالب في مكان واحد: حضوره، مدفوعاته، مجموعاته، وتواصلك مع ولي أمره - بدون أوراق متفرقة أو ملفات ضائعة.',
    cta: 'ابدأ مجاناً الآن',
    cardsHeading: 'كل بيانات الطالب في لمحة',
    cards: [
      {
        icon: CalendarCheck,
        title: 'سجل الحضور',
        body: 'تاريخ كامل لحضور وغياب الطالب في كل حصة ومجموعة.',
      },
      {
        icon: Wallet,
        title: 'تتبع المدفوعات',
        body: 'ما دفعه الطالب وما عليه من متأخرات، محدّث لحظياً.',
      },
      {
        icon: Users,
        title: 'تعيين المجموعات',
        body: 'أضف الطالب لمجموعاته بسهولة وانقله بين المجموعات.',
      },
      {
        icon: Phone,
        title: 'تواصل ولي الأمر',
        body: 'بيانات اتصال ولي الأمر جاهزة للإشعارات والمتابعة.',
      },
      {
        icon: Hash,
        title: 'رقم الطالب',
        body: 'رقم تعريفي فريد لكل طالب بصيغة #1024 لتمييزه بسرعة.',
      },
      {
        icon: StickyNote,
        title: 'الملاحظات والتنبيهات',
        body: 'سجّل ملاحظات خاصة وتنبيهات مهمة على ملف كل طالب.',
      },
    ] as Card[],
  },
  en: {
    heroTitle: 'Complete Profile for Every Student',
    heroSub:
      'Everything you need to know about a student in one place: attendance, payments, groups, and parent communication - no scattered papers or lost files.',
    cta: 'Start free now',
    cardsHeading: 'All student data at a glance',
    cards: [
      {
        icon: CalendarCheck,
        title: 'Attendance history',
        body: 'A full record of the student attendance and absence per class and group.',
      },
      {
        icon: Wallet,
        title: 'Payment tracking',
        body: 'What the student has paid and what is overdue, updated in real time.',
      },
      {
        icon: Users,
        title: 'Group assignment',
        body: 'Add a student to their groups easily and move them between groups.',
      },
      {
        icon: Phone,
        title: 'Parent contact',
        body: 'Parent contact details ready for notifications and follow-up.',
      },
      {
        icon: Hash,
        title: 'Student number',
        body: 'A unique identifier for every student in #1024 format for quick lookup.',
      },
      {
        icon: StickyNote,
        title: 'Notes & flags',
        body: 'Record private notes and important flags on each student profile.',
      },
    ] as Card[],
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

      <section className="border-t border-slate-800/40 bg-[#080f1a] px-4 py-12 md:px-6 md:py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-8 text-center text-2xl font-bold !text-white md:text-3xl">
            {c.cardsHeading}
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {c.cards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-start"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-teal-600/15 text-teal-400">
                    <Icon className="h-6 w-6" aria-hidden />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                    {card.body}
                  </p>
                </div>
              );
            })}
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
