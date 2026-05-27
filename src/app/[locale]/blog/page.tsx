import type { Metadata } from 'next';
import { BookOpen } from 'lucide-react';
import { Link } from '@/i18n/routing';

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
    sub: 'قريباً — نصائح عملية لإدارة السنتر',
    cta: 'ابدأ تجربتك مجاناً',
  },
  en: {
    heading: 'Blog',
    sub: 'Coming soon — practical tips for running your center',
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
    <main className="flex min-h-screen items-center justify-center bg-[#080f1a] px-4 py-20 text-white md:px-6">
      <div className="mx-auto max-w-xl text-center">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-teal-700/50 bg-teal-900/30"
          aria-hidden
        >
          <BookOpen className="h-8 w-8 text-teal-400" />
        </div>
        <h1 className="mt-8 text-3xl font-bold text-white md:text-4xl">{c.heading}</h1>
        <p className="mx-auto mt-4 max-w-md text-base text-[var(--color-text-secondary)] md:text-lg">
          {c.sub}
        </p>
        <Link
          href="/signup"
          className="mt-8 inline-flex rounded-xl bg-teal-600 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
        >
          {c.cta}
        </Link>
      </div>
    </main>
  );
}
