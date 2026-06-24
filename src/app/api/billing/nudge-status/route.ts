/**
 * Live in-app banner data for the current owner (center OR teacher). Computed
 * straight from billing state — it never reads the nudge ledger and never calls
 * WhatsApp, so the banner works fully even when WhatsApp is off or templates are
 * unapproved. Returns the single highest-priority active nudge, or null.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireCenterAuth, requireTeacherAuth } from '@/lib/centerAuth';
import { cairoDateKey } from '@/lib/cairo/day';
import { getOwnerNudgeState } from '@/lib/nudges/store';
import { selectBannerNudge } from '@/lib/nudges/evaluate';
import type { OwnerRef } from '@/lib/nudges/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Resolve the owner from the session. Teachers first (role-gated), then centers.
  let owner: OwnerRef;
  let supabase: SupabaseClient;

  const tAuth = await requireTeacherAuth(request);
  if (tAuth.ok) {
    owner = { ownerType: 'teacher', ownerId: tAuth.userId };
    supabase = tAuth.supabaseAdmin;
  } else {
    const cAuth = await requireCenterAuth(request);
    if (!cAuth.ok) return cAuth.response;
    // Super-admins / centre-less sessions have no billing owner → no banner.
    if (!cAuth.centerId || cAuth.role === 'super_admin') {
      return NextResponse.json({ nudge: null });
    }
    owner = { ownerType: 'center', ownerId: cAuth.centerId };
    supabase = cAuth.supabaseAdmin;
  }

  const localeParam = request.nextUrl.searchParams.get('locale');
  const locale = localeParam === 'en' ? 'en' : 'ar';
  const todayCairo = cairoDateKey(new Date());

  try {
    const state = await getOwnerNudgeState(supabase, owner, todayCairo);
    if (!state) return NextResponse.json({ nudge: null });
    const nudge = selectBannerNudge(state, todayCairo, locale);
    return NextResponse.json({ nudge });
  } catch (err) {
    console.error('[nudge-status]', err);
    // Never break the dashboard over a banner — fail closed (no banner).
    return NextResponse.json({ nudge: null });
  }
}
