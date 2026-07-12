import { redirect } from 'next/navigation';

/**
 * RETIRED — the CEO home is now the single canonical `/ceo` dashboard, which
 * carries the full exec view plus the platform controls (ops kill-switches,
 * announcement banner, and the emergency panel). This second, overlapping
 * dashboard has been folded into it; any direct link lands on `/ceo`.
 */
export default async function RetiredCeoDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/ceo`);
}
