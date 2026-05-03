import { NextResponse } from 'next/server';
import { getClientIp, rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ center_code: string; group_id: string }> },
) {
  const joinWindowSec = 3600;
  const ip = getClientIp(request);
  const { success } = await rateLimit(`join:${ip}`, 10, joinWindowSec);
  if (!success) {
    return rateLimitExceededResponse(joinWindowSec);
  }

  const { center_code, group_id } = await context.params;

  if (!center_code || !group_id) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 404 });
  }
  if (!UUID_RE.test(group_id)) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 404 });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const codeIsUuid = UUID_RE.test(center_code);
  const orFilter = codeIsUuid
    ? `center_code.eq.${center_code},id.eq.${center_code}`
    : `center_code.eq.${center_code}`;

  const { data: center, error: centerError } = await supabase
    .from('centers')
    .select('id, name')
    .or(orFilter)
    .limit(1)
    .maybeSingle();

  if (centerError || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const centerRow = center as { id: string; name: string | null };

  const { data: group, error: groupError } = await supabase
    .from('student_groups')
    .select('id, name, subject')
    .eq('id', group_id)
    .eq('center_id', centerRow.id)
    .maybeSingle();

  if (groupError || !group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const groupRow = group as { id: string; name: string | null; subject: string | null };

  return NextResponse.json({
    center_id: centerRow.id,
    center_name: centerRow.name ?? '',
    group_id: groupRow.id,
    group_name: groupRow.name ?? '',
    group_subject: groupRow.subject ?? null,
  });
}
