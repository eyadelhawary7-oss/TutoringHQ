import { redirect } from 'next/navigation';

/** Plural alias - the teacher portal lives under /teacher. */
export default async function TeachersRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/teacher`);
}
