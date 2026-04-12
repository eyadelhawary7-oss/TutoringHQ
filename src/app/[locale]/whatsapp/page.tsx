import { redirect } from 'next/navigation';

export default async function WhatsAppRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/whatsapp-pack`);
}
