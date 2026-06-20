import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { ScanLine, Send, ShieldCheck, Check } from 'lucide-react';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isAr = locale === 'ar';
  return {
    title: isAr
      ? 'إشعارات واتساب لأولياء الأمور | TutoringHQ'
      : 'WhatsApp Notifications for Parents | TutoringHQ',
    description: isAr
      ? 'أرسل إشعارات واتساب تلقائية لأولياء الأمور عند حضور أو غياب أبنائهم.'
      : 'Send automatic WhatsApp messages to parents when students attend or miss class.',
    alternates: { canonical: '/features/whatsapp-notifications' },
  };
}

type Step = { icon: typeof ScanLine; title: string; body: string };

const CONTENT = {
  ar: {
    heroTitle: 'واتساب تلقائي لكل ولي أمر',
    heroSub:
      'لحظة ما يمسح الطالب بطاقته عند الباب، يصل لولي الأمر إشعار واتساب فوري. متابعة بلا مكالمات، وثقة تكبر مع كل رسالة.',
    cta: 'ابدأ مجاناً الآن',
    stepsHeading: 'كيف يعمل',
    steps: [
      {
        icon: ScanLine,
        title: 'مسح الحضور يطلق الرسالة',
        body: 'بمجرد تسجيل حضور الطالب أو غيابه، يبدأ النظام في إرسال الإشعار تلقائياً.',
      },
      {
        icon: Send,
        title: 'ولي الأمر يستلم فوراً',
        body: 'رسالة واتساب تصل في ثوانٍ تخبر ولي الأمر بحالة ابنه في السنتر.',
      },
      {
        icon: ShieldCheck,
        title: 'السنتر يبني الثقة',
        body: 'متابعة شفافة ومستمرة تجعل أولياء الأمور أكثر اطمئناناً وولاءً للسنتر.',
      },
    ] as Step[],
    previewHeading: 'هكذا تصل الرسالة',
    bubbleName: 'سنتر النور التعليمي',
    bubbleText: 'حضر الطالب أحمد محمد الحصة اليوم الساعة 4:15 مساءً. شكراً لكم 🌟',
    bubbleTime: '4:15 م',
  },
  en: {
    heroTitle: 'Automatic WhatsApp for Every Parent',
    heroSub:
      'The moment a student scans their card at the door, the parent gets an instant WhatsApp notification. Follow-up without phone calls, and trust that grows with every message.',
    cta: 'Start free now',
    stepsHeading: 'How it works',
    steps: [
      {
        icon: ScanLine,
        title: 'Attendance scan triggers the message',
        body: 'As soon as a student is marked present or absent, the system sends the notification automatically.',
      },
      {
        icon: Send,
        title: 'Parent receives instantly',
        body: 'A WhatsApp message arrives in seconds, telling the parent their child status at the center.',
      },
      {
        icon: ShieldCheck,
        title: 'The center builds trust',
        body: 'Transparent, continuous follow-up makes parents more reassured and loyal to the center.',
      },
    ] as Step[],
    previewHeading: 'This is how the message arrives',
    bubbleName: 'Al-Noor Tutoring Center',
    bubbleText:
      'Student Ahmed Mohamed attended today class at 4:15 PM. Thank you 🌟',
    bubbleTime: '4:15 PM',
  },
} as const;

export default async function WhatsappNotificationsPage({
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
            {c.steps.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.title}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-start"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-teal-600/15 text-teal-400">
                    <Icon className="h-6 w-6" aria-hidden />
                  </span>
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
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-8 text-center text-2xl font-bold !text-white md:text-3xl">
            {c.previewHeading}
          </h2>
          <div className="mx-auto max-w-md rounded-3xl border border-[var(--color-border)] bg-[#0b141a] p-4">
            <div className="rounded-2xl rounded-se-sm bg-[#005c4b] p-3 text-start shadow-md">
              <p className="text-xs font-semibold text-emerald-200">
                {c.bubbleName}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white">
                {c.bubbleText}
              </p>
              <div className="mt-1 flex items-center justify-end gap-1">
                <span className="text-[11px] text-emerald-100/70">
                  {c.bubbleTime}
                </span>
                <Check className="h-3.5 w-3.5 text-sky-300" aria-hidden />
                <Check className="-ms-2.5 h-3.5 w-3.5 text-sky-300" aria-hidden />
              </div>
            </div>
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
