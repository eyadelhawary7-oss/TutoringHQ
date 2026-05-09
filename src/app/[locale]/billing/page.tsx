import { redirect } from 'next/navigation';

/** Legacy paths — soft redirect to settings billing (H1). */
export default async function BillingRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/settings/billing`);
}
