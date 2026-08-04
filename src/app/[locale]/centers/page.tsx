import type { Metadata } from 'next';
import Script from 'next/script';
import { getTranslations } from 'next-intl/server';
import { SITE, SITE_URL } from '@/config/site';
import CentersClient from './CentersClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isAr = locale === 'ar';

  return {
    title: isAr
      ? 'TutoringHQ - نظام إدارة السنترات التعليمية'
      : 'TutoringHQ - Tutoring Center Management System for Egypt',
    description: isAr
      ? 'نظام إدارة السنترات التعليمية في مصر. حضور QR، متابعة الطلاب، فواتير تلقائية وإشعارات واتساب.'
      : "Egypt's tutoring center operating system. QR attendance, student tracking, automated billing & WhatsApp notifications.",
  };
}

const softwareApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE.brandName,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, Android PWA, iOS PWA',
  url: SITE_URL,
  // 999 is `pricing_plans.all_in_price` for `solo`, the cheapest active plan.
  offers: { '@type': 'Offer', price: '999', priceCurrency: 'EGP' },
  description: 'نظام إدارة السنترات التعليمية في مصر',
  inLanguage: ['ar-EG', 'en-US'],
  publisher: { '@type': 'Organization', name: SITE.companyName },
};

/**
 * `/centers` — the center audience page.
 *
 * The FAQ structured data is built from the SAME message keys the page renders,
 * in the page's own locale. It used to be a hand-written block of four Q&As
 * that no longer matched anything on screen (and mixed Arabic and English in
 * one graph), so the rich result and the page disagreed.
 */
export default async function CentersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing.faq' });

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: (['q1', 'q2', 'q3', 'q4'] as const).map((k) => ({
      '@type': 'Question',
      name: t(`${k}.question` as 'q1.question'),
      acceptedAnswer: { '@type': 'Answer', text: t(`${k}.answer` as 'q1.answer') },
    })),
  };

  return (
    <>
      <CentersClient />
      <Script
        id="ld-software-application"
        type="application/ld+json"
        strategy="lazyOnload"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
      />
      <Script
        id="ld-faq"
        type="application/ld+json"
        strategy="lazyOnload"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
    </>
  );
}
