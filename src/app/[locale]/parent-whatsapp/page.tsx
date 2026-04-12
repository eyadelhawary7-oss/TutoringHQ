import { redirect } from 'next/navigation';

export default async function ParentWhatsAppRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/whatsapp-pack`);
}
