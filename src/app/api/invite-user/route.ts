import { NextResponse } from 'next/server';
import { rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import { inviteUserSchema } from '@/lib/validations';
import { validateCSRFRequest } from '@/lib/csrf';
import { normalizePhone } from '@/lib/utils/phone';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';
import { sendTeamInvite } from '@/lib/centerNotify';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { parseBodyWithLimit, validatePhone, validateString, ValidationError } from '@/lib/validate';

export async function POST(request: Request) {
  try {
    const ctx = await requireOwnerAdminCenter(request);
    if (ctx instanceof NextResponse) return ctx;

    const inviteWindowSec = 3600;
    const { success } = await rateLimit(`invite:${ctx.centerId}`, 10, inviteWindowSec);
    if (!success) {
      return rateLimitExceededResponse(inviteWindowSec);
    }

    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = (await parseBodyWithLimit(request, 10240)) as Record<string, unknown>;
    validatePhone(body.phone, 'phone');
    const roleRaw = validateString(body.role, 'role', { required: true, maxLength: 20 });
    if (!['admin', 'assistant', 'teacher'].includes(roleRaw)) {
      throw new ValidationError('Invalid role value', 'role');
    }

    const parsed = inviteUserSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { name, phone, role, teacher_group_ids, permissions } = parsed.data;

    const phoneE164 = normalizePhone(String(phone).trim());

    const { data: currentUser, error: currentUserError } = await supabaseAdmin
      .from('users')
      .select('center_id, role, phone')
      .eq('id', ctx.userId)
      .single();

    if (currentUserError || !currentUser?.center_id) {
      return NextResponse.json({
        error: 'Your account could not be found. Please try logging in again, or contact support if the issue persists.',
      }, { status: 404 });
    }

    const digitsOf = (p: string) => p.replace(/\D/g, '').replace(/^0/, '').replace(/^20/, '');
    const currentPhoneNorm = digitsOf(currentUser.phone || '');
    const inviteePhoneNorm = digitsOf(phoneE164);
    if (currentPhoneNorm && inviteePhoneNorm && currentPhoneNorm === inviteePhoneNorm) {
      return NextResponse.json({ error: 'Cannot invite yourself to the team' }, { status: 403 });
    }

    if (currentUser.role !== 'owner' && currentUser.role !== 'admin') {
      return NextResponse.json({ error: 'Only center owners and admins can invite team members' }, { status: 403 });
    }

    const { data: centerPlanRow } = await supabaseAdmin
      .from('centers')
      .select('plan, max_teachers')
      .eq('id', currentUser.center_id)
      .single();
    const maxTeam = Number((centerPlanRow as { max_teachers?: number })?.max_teachers ?? 2);
    const { count: teamCount } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('center_id', currentUser.center_id);
    if ((teamCount ?? 0) >= maxTeam) {
      const planName = (centerPlanRow as { plan?: string })?.plan || 'Starter';
      return NextResponse.json({
        error: `You've reached your team member limit for the ${planName} plan. Upgrade to add more team members.`,
        code: 'TEAM_LIMIT_REACHED',
        plan: planName,
      }, { status: 403 });
    }

    const { data: existingByE164 } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('center_id', currentUser.center_id)
      .eq('phone', phoneE164)
      .maybeSingle();

    if (existingByE164) {
      return NextResponse.json({
        error: 'هذا الرقم مسجل بالفعل في السنتر / This phone number is already registered for your center',
      }, { status: 409 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tutoringhq.app';
    const acceptInviteUrl = `${appUrl}/en/accept-invite`;

    const invitePayload: Record<string, unknown> = {
      center_id: currentUser.center_id,
      phone: phoneE164,
      role: role || 'assistant',
      invited_name: name.trim() || null,
      status: 'pending',
    };
    if (role === 'teacher' && teacher_group_ids?.length) {
      invitePayload.teacher_group_ids = teacher_group_ids;
    }
    if (role === 'assistant' && permissions && Object.keys(permissions).length) {
      invitePayload.invited_permissions = permissions;
    }

    const { error: inviteErr } = await supabaseAdmin
      .from('center_invites')
      .upsert(invitePayload, { onConflict: 'center_id,phone' });

    if (inviteErr) {
      console.error('Invite insert error:', inviteErr);
      return NextResponse.json({
        error: 'فشل في إرسال الدعوة / Failed to create invitation',
        details: inviteErr.message,
      }, { status: 500 });
    }

    const { data: inviteRow } = await supabaseAdmin
      .from('center_invites')
      .select('id')
      .eq('center_id', currentUser.center_id)
      .eq('phone', phoneE164)
      .maybeSingle();

    const inviteToken = String((inviteRow as { id?: string } | null)?.id ?? '').trim();
    const { data: centerNameRow } = await supabaseAdmin
      .from('centers')
      .select('name')
      .eq('id', currentUser.center_id)
      .maybeSingle();
    const centerName = String((centerNameRow as { name?: string | null } | null)?.name ?? '').trim() || ',';
    const inviteeName = name.trim() || ',';
    const roleLabel =
      role === 'teacher'
        ? 'معلم'
        : role === 'assistant'
          ? 'مساعد'
          : role === 'admin'
            ? 'مسؤول'
            : role || 'assistant';

    if (inviteToken) {
      try {
        await sendTeamInvite(phoneE164, inviteeName, centerName, roleLabel, inviteToken);
      } catch (waErr) {
        console.error('[invite-user] sendTeamInvite:', waErr);
      }
    }

    try {
      await supabaseAdmin.from('audit_log').insert({
        center_id: currentUser.center_id,
        user_id: ctx.userId,
        action: 'team_member_invited_pending',
        entity_type: 'center_invites',
        details: { invited_phone: phoneE164, invited_name: name, invited_role: role },
      });
    } catch {
      // Don't fail if audit log fails
    }

    return NextResponse.json({
      success: true,
      pendingInvite: true,
      acceptInviteUrl,
      inviteToken: inviteToken || undefined,
      message: 'تم إرسال الدعوة / Invitation sent! The person should go to the accept-invite page, enter their phone number to receive a verification code, verify, and create their login credentials.',
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
    }
    console.error('Invite user error:', error);
    return NextResponse.json({
      error: 'حدث خطأ / Internal server error',
    }, { status: 500 });
  }
}
