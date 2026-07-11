import { redirect } from 'next/navigation';

/**
 * RETIRED — center signup is now trial-first (14-day free trial, no charge at
 * signup, immediate owner provisioning). There is no manual pending-approval
 * queue anymore, so this screen is gone; any direct link lands on /admin.
 */
export default async function RetiredPendingSignupsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/admin`);
}
