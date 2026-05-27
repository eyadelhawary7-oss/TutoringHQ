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
      ? 'نظام حضور QR للسنترات التعليمية | CenterHQ'
      : 'QR Attendance System for Tutoring Centers | CenterHQ',
    description: isAr
      ? 'سجّل حضور الطلاب بمسح QR في ثوانٍ. إشعارات واتساب فورية لأولياء الأمور.'
      : 'Scan student QR codes in seconds. Instant WhatsApp notifications to parents.',
    alternates: { canonical: '/features/qr-attendance' },
  };
}

const CONTENT = {
  ar: {
    heroTitle: 'حضور بمسح QR في ثانية واحدة',
    heroSub:
      'لا مزيد من كشوف الحضور الورقية. كل طالب يحصل على كود QR، والموظف يمسحه عند الباب، فيصل إشعار واتساب لولي الأمر فوراً.',
    stepsHeading: 'كيف يعمل في 3 خطوات',
    steps: [
      { title: 'الطالب يحصل على بطاقة QR', desc: 'كل طالب له كود QR فريد على بطاقة أو موبايل.' },
      { title: 'الموظف يمسح عند الباب', desc: 'مسح سريع بكاميرا التابلت يسجّل الحضور لحظياً.' },
      { title: 'ولي الأمر يستلم واتساب فوراً', desc: 'رسالة تلقائية تؤكد حضور الطالب في نفس اللحظة.' },
    ],
    featuresHeading: 'مميزات الماسح',
    features: [
      'ماسح PWA يعمل بدون إنترنت',
      'يعمل على أي تابلت أندرويد',
      'بدون تطبيق لأولياء الأمور',
      'تأكيد فوري لوصول الإشعار',
    ],
    cta: 'ابدأ مجاناً الآن',
  },
  en: {
    heroTitle: 'QR Attendance in One Scan',
    heroSub:
      'No more paper attendance sheets. Every student gets a QR code, staff scan it at the door, and parents get a WhatsApp notification instantly.',
    stepsHeading: 'How it works in 3 steps',
    steps: [
      { title: 'Student gets a QR card', desc: 'Each student has a unique QR code on a card or phone.' },
      { title: 'Staff scans at the door', desc: 'A quick tablet-camera scan records attendance in real time.' },
      { title: 'Parent gets WhatsApp instantly', desc: 'An automatic message confirms the student arrived, immediately.' },
    ],
    featuresHeading: 'Scanner features',
    features: [
      'Offline-capable PWA scanner',
      'Works on any Android tablet',
      'No app install needed for parents',
      'Instant delivery confirmation',
    ],
    cta: 'Start free now',
  },
} as const;

export default async function QrAttendancePage({
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
            {c.stepsHeading}
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {c.steps.map((step, i) => (
              <div
                key={step.title}
                className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 text-center"
              >
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-teal-700 bg-teal-900/40 text-lg font-bold text-teal-400">
                  {i + 1}
                </div>
                <h3 className="mt-4 text-base font-semibold text-white">{step.title}</h3>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border-subtle)] bg-[#080f1a] px-4 py-12 md:px-6 md:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-center text-2xl font-bold !text-white md:text-3xl">
            {c.featuresHeading}
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {c.features.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3"
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white"
                  aria-hidden
                >
                  ✓
                </span>
                <span className="text-sm text-[var(--color-text-secondary)]">{feature}</span>
              </li>
            ))}
          </ul>

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
