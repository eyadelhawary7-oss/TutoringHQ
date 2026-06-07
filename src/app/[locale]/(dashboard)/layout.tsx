import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';

/** Route-group layout for center dashboard subtree (no extra chrome - AppShell wraps at locale root). */
export default async function DashboardRouteGroupLayout({
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
      .select('role, center_id')
      .eq('id', authUser.id)
      .maybeSingle();

    let user: { role: string; center_id: string | null } | null = null;
    if (usersRow) {
      user = usersRow as { role: string; center_id: string | null };
    } else {
      const { data: adminRow } = await supabaseAdmin
        .from('admin_users')
        .select('id')
        .eq('id', authUser.id)
        .maybeSingle();
      if (adminRow) {
        user = { role: 'super_admin', center_id: null };
      }
    }

    if (!user) {
      const locale = await getLocale();
      redirect(`/${locale}/login`);
    }

    // --- V3 ONBOARDING GATE ---
    // Centre-less users (Model B teachers, or any null center_id) skip the
    // funnel entirely; onboarding is a centre concept. Guard removes the old
    // user.center_id! assertion, which queried centers with id null.
    if (user.role !== 'super_admin' && user.center_id) {
      const centerId = user.center_id;
      try {
        const { data: centerData } = await supabaseAdmin
          .from('centers')
          .select('onboarding_step, onboarding_completed_at, status')
          .eq('id', centerId)
          .single();

        if (centerData) {
          const funnelComplete =
            centerData.onboarding_completed_at !== null ||
            (centerData.onboarding_step ?? 0) >= 4;

          if (!funnelComplete && centerData.status === 'active') {
            const locale = await getLocale();
            redirect(`/${locale}/onboarding`);
          }
        }
      } catch {
        // Fail open — never block dashboard access on DB error
      }
    }
    // --- END V3 ONBOARDING GATE ---
  }

  return children;
}
