import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.terms' });
  return { title: t('title') };
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.terms' });
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:py-14">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{t('title')}</h1>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t('lastUpdated')}</p>
      <div className="mt-8 whitespace-pre-wrap text-[var(--color-text-primary)] leading-relaxed">
        {t('placeholderBody')}
      </div>
    </main>
  );
}
