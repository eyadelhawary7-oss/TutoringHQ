import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { requirePermission } from '@/lib/centerPermissions';
import { parseBodyWithLimit } from '@/lib/validate';

const ALLOWED_PATCH = new Set([
  'name',
  'city',
  'governorate',
  'phone',
  'onboarding_step',
  'onboarding_completed',
  'onboarding_started_at',
]);

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) {
      return auth.response;
    }
    // Permission gate added May 12 per docs/AUDIT_center_role_gating.md
    const permErr = requirePermission(auth, 'can_edit_center_profile');
    if (permErr) return permErr;

    let body: Record<string, unknown>;
    try {
      body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (!ALLOWED_PATCH.has(key)) continue;
      const v = body[key];
      if (key === 'onboarding_completed' && typeof v === 'boolean') {
        patch[key] = v;
      } else if (key === 'onboarding_step' && typeof v === 'number' && Number.isFinite(v)) {
        patch[key] = v;
      } else if (key === 'onboarding_started_at' && (typeof v === 'string' || v === null)) {
        patch[key] = v;
      } else if (key === 'name' && typeof v === 'string') {
        patch[key] = v.trim();
      } else if ((key === 'city' || key === 'governorate' || key === 'phone') && (typeof v === 'string' || v === null)) {
        patch[key] = typeof v === 'string' ? v.trim() || null : null;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error: upErr } = await auth.supabaseAdmin.from('centers').update(patch).eq('id', auth.centerId);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[centers/me PATCH]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
