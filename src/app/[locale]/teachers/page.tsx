import type { Metadata } from 'next';
import TeachersClient from './TeachersClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isAr = locale === 'ar';

  return {
    title: isAr
      ? 'TutoringHQ للمدرسين | اجمع دخلك من السناتر والخصوصي'
      : 'TutoringHQ for teachers | All your income, centers and private, in one place',
    description: isAr
      ? 'سواء بتدرّس في سنتر أو عندك طلاب خصوصي، TutoringHQ بيجمع كل دخلك في شاشة واحدة ويبعت روابط الدفع لوحده. شغل السناتر مجاني للأبد.'
      : 'Whether you teach at a center or have private students, TutoringHQ brings all your income into one screen and sends payment links on its own. Center work is free, permanently.',
  };
}

/**
 * `/teachers` — the teacher audience page. Previously this path redirected to
 * the authenticated portal at `/teacher`; the design makes it the public
 * marketing page and cross-links to it from every other public screen.
 *
 * `?ref=` is carried through to `/teacher/signup`. The design draws no query
 * parameter, but dropping it would silently break every teacher referral link
 * already in circulation, so the passthrough stays.
 */
export default async function TeachersPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  return <TeachersClient referralCode={ref ?? null} />;
}
