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
      ? 'إشعارات واتساب لأولياء الأمور | CenterHQ'
      : 'WhatsApp Notifications for Parents | CenterHQ',
    description: isAr
      ? 'أرسل إشعارات واتساب تلقائية لأولياء الأمور عند حضور أو غياب أبنائهم.'
      : 'Send automatic WhatsApp messages to parents when students attend or miss class.',
    alternates: { canonical: '/features/whatsapp-notifications' },
  };
}

const CONTENT = {
  ar: {
    heroTitle: 'واتساب تلقائي لكل ولي أمر',
    heroSub:
      'في اللحظة التي يحضر فيها الطالب، يستلم ولي الأمر رسالة واتساب تلقائية. ثقة أكبر، وتواصل بلا مجهود.',
    stepsHeading: 'كيف يعمل',
    steps: [
      { title: 'مسح الحضور يُطلق الرسالة', desc: 'بمجرد مسح كود الطالب يبدأ النظام في إرسال الإشعار.' },
      { title: 'ولي الأمر يستلم فوراً', desc: 'رسالة واتساب تصل خلال ثوانٍ على هاتف ولي الأمر.' },
      { title: 'السنتر يبني الثقة', desc: 'تواصل منتظم وشفّاف يزيد ثقة أولياء الأمور بالسنتر.' },
    ],
    previewHeading: 'هكذا تصل الرسالة',
    senderName: 'سنتر النخبة',
    messageBody: 'تم تسجيل حضور الطالب أحمد محمد اليوم الساعة 4:30 مساءً. شكراً لثقتكم. 🎓',
    messageTime: '4:30 م',
    cta: 'ابدأ مجاناً الآن',
  },
  en: {
    heroTitle: 'Automatic WhatsApp for Every Parent',
    heroSub:
      'The moment a student checks in, the parent gets an automatic WhatsApp message. More trust, effortless communication.',
    stepsHeading: 'How it works',
    steps: [
      { title: 'Attendance scan triggers the message', desc: 'Scanning the student code starts the notification instantly.' },
      { title: 'Parent receives it instantly', desc: 'A WhatsApp message arrives on the parent phone within seconds.' },
      { title: 'The center builds trust', desc: 'Regular, transparent updates grow parent confidence in your center.' },
    ],
    previewHeading: 'This is how the message arrives',
    senderName: 'Elite Center',
    messageBody: "Student Ahmed Mohamed's attendance was recorded today at 4:30 PM. Thank you for your trust. 🎓",
    messageTime: '4:30 PM',
    cta: 'Start free now',
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
        <div className="mx-auto max-w-md">
          <h2 className="mb-8 text-center text-2xl font-bold !text-white md:text-3xl">
            {c.previewHeading}
          </h2>
          <div className="rounded-3xl border border-[var(--color-border-subtle)] bg-[#0b141a] p-4 shadow-xl">
            <div className="mb-4 flex items-center gap-3 border-b border-white/10 pb-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white"
                aria-hidden
              >
                CH
              </span>
              <div className="text-start">
                <p className="text-sm font-semibold text-white">{c.senderName}</p>
                <p className="text-xs text-emerald-400">online</p>
              </div>
            </div>
            <div className="flex justify-start">
              <div className="relative max-w-[85%] rounded-2xl rounded-ss-sm bg-[#005c4b] px-4 py-2.5 text-start">
                <p className="text-sm leading-relaxed text-white">{c.messageBody}</p>
                <p className="mt-1 text-end text-[10px] text-white/60">{c.messageTime} ✓✓</p>
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
