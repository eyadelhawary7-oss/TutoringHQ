import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { ScanLine, Tablet, MessageCircle, CheckCircle2 } from 'lucide-react';

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

type Step = { icon: typeof ScanLine; title: string; body: string };
type Feature = { title: string };

const CONTENT = {
  ar: {
    heroTitle: 'حضور بمسح QR في ثانية واحدة',
    heroSub:
      'حوّل تسجيل الحضور من إدخال يدوي بطيء إلى مسح فوري عند الباب. كل طالب يحصل على بطاقة QR، والإشعار يصل لولي الأمر في نفس اللحظة.',
    cta: 'ابدأ مجاناً الآن',
    stepsHeading: 'كيف يعمل في 3 خطوات',
    steps: [
      {
        icon: ScanLine,
        title: 'الطالب يحصل على بطاقة QR',
        body: 'بطاقة شخصية لكل طالب تحمل رمز QR فريد، تُطبع وتُسلّم مرة واحدة.',
      },
      {
        icon: Tablet,
        title: 'الموظف يمسح عند الباب',
        body: 'مسح سريع من أي تابلت أندرويد لحظة دخول الطالب، بدون طوابير.',
      },
      {
        icon: MessageCircle,
        title: 'ولي الأمر يستلم واتساب فوراً',
        body: 'إشعار تلقائي يؤكد حضور الابن في نفس اللحظة، بلا أي مجهود.',
      },
    ] as Step[],
    featuresHeading: 'مميزات الماسح',
    features: [
      { title: 'ماسح PWA يعمل بدون إنترنت' },
      { title: 'يعمل على أي تابلت أندرويد' },
      { title: 'بدون تثبيت تطبيق لأولياء الأمور' },
      { title: 'تأكيد فوري لوصول الإشعار' },
    ] as Feature[],
  },
  en: {
    heroTitle: 'QR Attendance in One Scan',
    heroSub:
      'Turn attendance from slow manual entry into an instant scan at the door. Every student gets a QR card, and the parent is notified the moment they arrive.',
    cta: 'Start free now',
    stepsHeading: 'How it works in 3 steps',
    steps: [
      {
        icon: ScanLine,
        title: 'Student gets a QR card',
        body: 'A personal card for each student carrying a unique QR code, printed and handed out once.',
      },
      {
        icon: Tablet,
        title: 'Staff scans at the door',
        body: 'A quick scan from any Android tablet the moment the student walks in - no queues.',
      },
      {
        icon: MessageCircle,
        title: 'Parent gets WhatsApp instantly',
        body: 'An automatic message confirms the student arrived in the same moment, with zero effort.',
      },
    ] as Step[],
    featuresHeading: 'Scanner features',
    features: [
      { title: 'Offline-capable PWA scanner' },
      { title: 'Works on any Android tablet' },
      { title: 'No app install needed for parents' },
      { title: 'Instant delivery confirmation' },
    ] as Feature[],
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

      <section className="border-t border-slate-800/40 bg-[#080f1a] px-4 py-12 md:px-6 md:py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-8 text-center text-2xl font-bold !text-white md:text-3xl">
            {c.stepsHeading}
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {c.steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.title}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-start"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-teal-600/15 text-teal-400">
                      <Icon className="h-6 w-6" aria-hidden />
                    </span>
                    <span className="text-sm font-semibold text-teal-400">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-white">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                    {step.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-800/40 bg-[#080f1a] px-4 py-12 md:px-6 md:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-center text-2xl font-bold !text-white md:text-3xl">
            {c.featuresHeading}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {c.features.map((feature) => (
              <li
                key={feature.title}
                className="flex items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 text-start"
              >
                <CheckCircle2
                  className="mt-0.5 h-5 w-5 flex-shrink-0 text-teal-400"
                  aria-hidden
                />
                <span className="text-sm text-white">{feature.title}</span>
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
