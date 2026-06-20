import type { Metadata } from 'next';
import TeacherLandingClient from './TeacherLandingClient';

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
      ? 'سواء بتدرّس في سنتر أو عندك طلاب خصوصي، TutoringHQ بيجمع كل دخلك في شاشة واحدة ويبعت روابط الدفع لوحده. تجربة مجانية للـ Engine الخصوصي.'
      : 'Whether you teach at a center or have private students, TutoringHQ brings all your income into one screen and sends payment links automatically. Free trial for the private engine.',
  };
}

export default function TeacherLandingPage() {
  return <TeacherLandingClient />;
}
