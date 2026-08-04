import { redirect } from 'next/navigation';

/**
 * `/teacher/landing` was the public teacher marketing page; the design moves it
 * to `/teachers`, which every cross-link now points at. This stays as a
 * redirect because the old address is live and indexed.
 *
 * The `?ref=` passthrough is NOT optional: teacher referral links in
 * circulation carry it, and `/teachers` threads it on to `/teacher/signup`.
 */
export default async function TeacherLandingRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { locale } = await params;
  const { ref } = await searchParams;
  redirect(`/${locale}/teachers${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
}
