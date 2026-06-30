import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { resolveProcessingFeeAmount } from '@/lib/processingFee';
import { formatCurrency } from '@/lib/formatNumber';

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

  // Processing-fee disclosure is gated by the `processing_fee_enabled` toggle:
  // when the fee is turned off (amount resolves to 0) the whole block disappears,
  // matching the invoice/checkout behaviour. Final wording pending Adsero review.
  const feeAmount = resolveProcessingFeeAmount(await getProcessingFeeConfig());

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:py-14">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{t('title')}</h1>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t('lastUpdated')}</p>
      <div className="mt-8 whitespace-pre-wrap text-[var(--color-text-primary)] leading-relaxed">
        {t('placeholderBody')}
      </div>
      {feeAmount > 0 ? (
        <section className="mt-8 border-t border-[var(--color-border)] pt-6">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t('processingFeeHeading')}
          </h2>
          <p className="mt-2 text-[var(--color-text-primary)] leading-relaxed">
            {t('processingFeeBody', { amount: formatCurrency(feeAmount, locale) })}
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            {t('processingFeePlaceholderNote')}
          </p>
        </section>
      ) : null}
    </main>
  );
}
