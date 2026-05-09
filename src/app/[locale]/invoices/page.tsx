import { redirect } from 'next/navigation';

/** Legacy paths — invoices live under settings billing (H1). */
export default async function InvoicesRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/settings/billing`);
}
