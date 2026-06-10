import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';
import TeacherShell from '../TeacherShell';

/**
 * Teacher portal subtree layout. /teacher is deliberately NOT in
 * AUTHENTICATED_ROUTE_PREFIXES (src/proxy.ts) - adding it there would trip the
 * "center half" wall that bounces teachers off authenticated prefixes. The
 * proxy enforces the other direction (center roles never reach /teacher);
 * this layout covers the unauthenticated case server-side, mirroring the
 * (dashboard) route-group layout.
 */
export default async function TeacherLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    const locale = await getLocale();
    redirect(`/${locale}/login`);
  }

  if (supabaseAdmin) {
    const { data: usersRow } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', authUser.id)
      .maybeSingle();

    if (!usersRow) {
      const locale = await getLocale();
      redirect(`/${locale}/login`);
    }

    // Same wall as the proxy: center users may not reach /teacher/*.
    if (String((usersRow as { role?: string }).role ?? '') !== 'teacher') {
      const locale = await getLocale();
      redirect(`/${locale}/dashboard`);
    }
  }

  return <TeacherShell>{children}</TeacherShell>;
}
