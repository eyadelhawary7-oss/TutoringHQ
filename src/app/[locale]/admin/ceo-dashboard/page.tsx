import { redirect } from 'next/navigation';

export default async function AdminCeoDashboardRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/ceo-dashboard`);
}
