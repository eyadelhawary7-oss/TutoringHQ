import { redirect } from 'next/navigation';

export default async function AdminPendingSignupsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/admin?tab=pending`);
}
