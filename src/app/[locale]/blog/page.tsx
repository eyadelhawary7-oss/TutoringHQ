import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { BookOpen } from 'lucide-react';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isAr = locale === 'ar';
  return {
    title: isAr ? 'المدونة | CenterHQ' : 'Blog | CenterHQ',
    description: isAr
      ? 'نصائح وأدوات لإدارة السنترات التعليمية في مصر.'
      : 'Tips and tools for running tutoring centers in Egypt.',
    alternates: { canonical: '/blog' },
  };
}

const CONTENT = {
  ar: {
    heading: 'المدونة',
    sub: 'قريباً - نصائح عملية لإدارة السنتر',
    cta: 'ابدأ تجربتك مجاناً',
  },
  en: {
    heading: 'Blog',
    sub: 'Coming soon - practical tips for running your center',
    cta: 'Start your free trial',
  },
} as const;

export default async function BlogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const c = locale === 'en' ? CONTENT.en : CONTENT.ar;

  return (
    <main className="min-h-screen bg-[#080f1a] text-white">
      <section
        className="flex min-h-screen flex-col items-center justify-center px-4 py-20 md:px-6"
        style={{
          background:
            'radial-gradient(ellipse 80% 40% at 50% 0%, rgba(13, 148, 136, 0.08), transparent), #080f1a',
        }}
      >
        <div className="mx-auto max-w-2xl text-center">
          <span className="mx-auto inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-teal-600/15 text-teal-400">
            <BookOpen className="h-10 w-10" aria-hidden />
          </span>
          <h1 className="mt-8 text-3xl font-bold leading-tight text-white md:text-5xl">
            {c.heading}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[var(--color-text-secondary)] md:text-lg">
            {c.sub}
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-flex rounded-xl bg-teal-600 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
          >
            {c.cta}
          </Link>
        </div>
      </section>
    </main>
  );
}
