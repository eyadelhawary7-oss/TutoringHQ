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
      ? 'CenterHQ للمدرسين | اجمع دخلك من السناتر والخصوصي'
      : 'CenterHQ for teachers | All your income, centers and private, in one place',
    description: isAr
      ? 'سواء بتدرّس في سنتر أو عندك طلاب خصوصي، CenterHQ بيجمع كل دخلك في شاشة واحدة ويبعت روابط الدفع لوحده. تجربة مجانية للـ Engine الخصوصي.'
      : 'Whether you teach at a center or have private students, CenterHQ brings all your income into one screen and sends payment links automatically. Free trial for the private engine.',
  };
}

export default function TeacherLandingPage() {
  return <TeacherLandingClient />;
}
