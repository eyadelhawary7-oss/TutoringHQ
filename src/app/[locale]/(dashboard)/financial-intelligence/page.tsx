import { redirect } from 'next/navigation';

/** Legacy alias - Financial Intelligence was merged into Analytics. Redirect keeps old bookmarks working. */
export default async function FinancialIntelligenceRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/analytics`);
}
