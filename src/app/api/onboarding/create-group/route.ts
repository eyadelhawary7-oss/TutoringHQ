import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { parseBodyWithLimit, validateString, ValidationError } from '@/lib/validate';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const body = (await parseBodyWithLimit(request, 10240)) as Record<string, unknown>;
    const name = validateString(body.name, 'name', { required: true, maxLength: 100 });
    const subjectRaw = validateString(body.subject, 'subject', { maxLength: 100 });
    const subject = subjectRaw.length > 0 ? subjectRaw : null;

    const { error: insertErr } = await supabaseAdmin.from('student_groups').insert({
      center_id: auth.centerId,
      name: name,
      subject,
    });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const { error: rpcErr } = await supabaseAdmin.rpc('complete_onboarding_step_rpc', {
      p_center_id: auth.centerId,
      p_step: 2,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    throw err;
  }
}
