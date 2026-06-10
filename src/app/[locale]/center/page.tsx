import type { Metadata } from 'next';
import Script from 'next/script';
import HomePageClient from '../HomePageClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isAr = locale === 'ar';

  return {
    title: isAr
      ? 'CenterHQ – نظام إدارة السنترات التعليمية'
      : 'CenterHQ – Tutoring Center Management System for Egypt',
    description: isAr
      ? 'نظام إدارة السنترات التعليمية في مصر. حضور QR، متابعة الطلاب، فواتير تلقائية وإشعارات واتساب.'
      : "Egypt's tutoring center operating system. QR attendance, student tracking, automated billing & WhatsApp notifications.",
  };
}

const softwareApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'CenterHQ',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, Android PWA, iOS PWA',
  url: 'https://centerhq.app',
  offers: { '@type': 'Offer', price: '999', priceCurrency: 'EGP' },
  description: 'نظام إدارة السنترات التعليمية في مصر',
  inLanguage: ['ar-EG', 'en-US'],
  publisher: { '@type': 'Organization', name: 'EHG Intelligence Egypt' },
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'ما هو CenterHQ؟',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'نظام إدارة متكامل للسنترات التعليمية في مصر يشمل حضور QR وإشعارات واتساب وفواتير تلقائية.',
      },
    },
    {
      '@type': 'Question',
      name: 'كم تكلفة الاشتراك؟',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'تبدأ الأسعار من 999 جنيه شهرياً لخطة Solo.',
      },
    },
    {
      '@type': 'Question',
      name: 'هل يعمل على الموبايل؟',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'نعم، CenterHQ تطبيق PWA يعمل على Android وiOS بدون تنزيل.',
      },
    },
    {
      '@type': 'Question',
      name: 'How does QR attendance work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Each student gets a unique QR code. Staff scan it at the door; parents get instant WhatsApp notifications.',
      },
    },
  ],
};

export default function CenterLandingPage() {
  return (
    <>
      <HomePageClient />
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
