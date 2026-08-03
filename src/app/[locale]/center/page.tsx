import { redirect } from 'next/navigation';

/**
 * `/center` is a live, indexed public URL, and every cross-link in
 * design/Merged-Public-Marketing.html points at `/centers` instead. A redirect
 * keeps the old address working rather than turning it into a 404; a redirect
 * is not a drawn element, so it costs the design nothing.
 */
export default async function CenterLandingRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/centers`);
}
