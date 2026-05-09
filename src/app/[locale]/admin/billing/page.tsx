import { redirect } from 'next/navigation';

/** Canonical admin billing UI lives at `/[locale]/admin?tab=billing`. */
export default async function AdminBillingAliasPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/admin?tab=billing`);
}
