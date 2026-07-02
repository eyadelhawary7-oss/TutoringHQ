import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import { requireCenterAuth } from '@/lib/centerAuth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { parseBodyWithLimit, validatePhone, validateString, ValidationError } from '@/lib/validate';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const onboardWindowSec = 3600;
    const { success } = await rateLimit(`onboard:${auth.centerId}`, 20, onboardWindowSec);
    if (!success) {
      return rateLimitExceededResponse(onboardWindowSec);
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const body = (await parseBodyWithLimit(request, 10240)) as Record<string, unknown>;
    const name = validateString(body.name, 'name', { required: true, maxLength: 100 });
    const phoneStr = validatePhone(body.phone, 'phone');
    const phone = phoneStr ? phoneStr.trim() : null;

    // Server-side guardian-consent gate: a center adding a student must confirm
    // it holds the guardian's consent. The checkbox is not enough — reject here
    // if absent, and stamp who/when as proof on the inserted row below.
    if (body.guardianConsentConfirmed !== true) {
      return NextResponse.json(
        { error: 'guardian_consent_required', code: 'GUARDIAN_CONSENT_REQUIRED' },
        { status: 403 },
      );
    }

    const { data: center, error: centerErr } = await supabaseAdmin
      .from('centers')
      .select('student_sequence')
      .eq('id', auth.centerId)
      .single();

    if (centerErr) {
      return NextResponse.json({ error: centerErr.message }, { status: 500 });
    }

    const seq =
      (center as { student_sequence?: number | null } | null)?.student_sequence ?? 1;
    const studentNumber = '#' + String(seq).padStart(4, '0');

    const { error: insertErr } = await supabaseAdmin.from('students').insert({
      center_id: auth.centerId,
      student_number: studentNumber,
      name: name,
      phone,
      is_active: true,
      guardian_consent_confirmed_at: new Date().toISOString(),
      guardian_consent_confirmed_by: auth.userId ?? null,
    });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const { error: updateErr } = await supabaseAdmin
      .from('centers')
      .update({ student_sequence: seq + 1 })
      .eq('id', auth.centerId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    const { count, error: countErr } = await supabaseAdmin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('center_id', auth.centerId)
      .eq('is_active', true);

    if (countErr) {
      return NextResponse.json({ error: countErr.message }, { status: 500 });
    }

    const { error: rpcErr } = await supabaseAdmin.rpc('complete_onboarding_step_rpc', {
      p_center_id: auth.centerId,
      p_step: 1,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      studentCount: count ?? 1,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    throw err;
  }
}
