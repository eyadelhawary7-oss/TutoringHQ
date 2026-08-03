import type { Metadata } from 'next';
import Script from 'next/script';
import { SITE_URL } from '@/config/site';
import SplashClient from './SplashClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isAr = locale === 'ar';

  return {
    title: isAr ? 'TutoringHQ | منصة التدريس في مصر' : 'TutoringHQ | The teaching platform for Egypt',
    description: isAr
      ? 'منصة واحدة لكل مين بيعلّم في مصر - سواء بتدير سنتر أو بتدرّس خصوصي. حضور، فوترة، ودخلك كله في مكان واحد.'
      : 'One platform for everyone who teaches in Egypt - whether you run a center or teach privately. Attendance, billing, and your income in one place.',
  };
}

// Neutral, persona-spanning schema for the splash root. The center-specific
// SoftwareApplication + FAQ schema lives on /centers where it belongs.
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'TutoringHQ',
  url: SITE_URL,
  description: 'منصة التدريس في مصر - للسناتر والمدرسين',
  publisher: { '@type': 'Organization', name: 'EHG Intelligence Egypt' },
};

export default function LocaleHomePage() {
  return (
    <>
      <SplashClient />
      <Script
        id="ld-organization"
        type="application/ld+json"
        strategy="lazyOnload"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
    </>
  );
}
