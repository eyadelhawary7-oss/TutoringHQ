import { redirect } from 'next/navigation';

/** Canonical list lives at /admin/orders; keep /admin/card-orders as entry for detail back-links. */
export default async function AdminCardOrdersAliasPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/admin/orders`);
}
