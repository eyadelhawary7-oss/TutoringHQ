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

  // Private-engine gate, computed once here (the "layout gate") and handed to
  // the shell so the sidebar can render locked vs unlocked nav items without a
  // second round-trip. Same source of truth as /api/teacher/context: the
  // teacher_private_access RPC (trialing|active subscription). On any error we
  // fail closed to the locked (free-zone) experience - never invent access.
  let privateAccess = false;
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

    const { data: gateData } = await supabaseAdmin.rpc('teacher_private_access', {
      p_user_id: authUser.id,
    });
    privateAccess = gateData === true;
  }

  return <TeacherShell privateAccess={privateAccess}>{children}</TeacherShell>;
}
