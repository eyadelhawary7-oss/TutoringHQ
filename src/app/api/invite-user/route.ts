import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { inviteUserSchema } from '@/lib/validations';
import { validateCSRFRequest } from '@/lib/csrf';
import { normalizePhone } from '@/lib/utils/phone';

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!validateCSRFRequest(request, user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = inviteUserSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { name, phone, role } = parsed.data;

    const phoneE164 = normalizePhone(String(phone).trim());

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: currentUser, error: currentUserError } = await supabaseAdmin
      .from('users')
      .select('center_id, role, phone')
      .eq('id', user.id)
      .single();

    if (currentUserError || !currentUser?.center_id) {
      return NextResponse.json({
        error: 'Your account could not be found. Please try logging in again, or contact support if the issue persists.',
      }, { status: 404 });
    }

    // CRITICAL: Users cannot invite themselves (privilege escalation protection)
    const digitsOf = (p: string) => p.replace(/\D/g, '').replace(/^0/, '').replace(/^20/, '');
    const currentPhoneNorm = digitsOf(currentUser.phone || user.phone || '');
    const inviteePhoneNorm = digitsOf(phoneE164);
    if (currentPhoneNorm && inviteePhoneNorm && currentPhoneNorm === inviteePhoneNorm) {
      return NextResponse.json({ error: 'Cannot invite yourself to the team' }, { status: 403 });
    }

    if (currentUser.role !== 'owner' && currentUser.role !== 'admin') {
      return NextResponse.json({ error: 'Only center owners and admins can invite team members' }, { status: 403 });
    }

    // Check team member limit
    const { data: centerRow } = await supabaseAdmin
      .from('centers')
      .select('plan, max_teachers')
      .eq('id', currentUser.center_id)
      .single();
    const maxTeam = Number((centerRow as { max_teachers?: number })?.max_teachers ?? 2);
    const { count: teamCount } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('center_id', currentUser.center_id);
    if ((teamCount ?? 0) >= maxTeam) {
      const planName = (centerRow as { plan?: string })?.plan || 'Starter';
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://center-hq.vercel.app';
    const acceptInviteUrl = `${appUrl}/en/accept-invite`;

    const { error: inviteErr } = await supabaseAdmin
      .from('center_invites')
      .upsert(
        {
          center_id: currentUser.center_id,
          phone: phoneE164,
          role: role || 'assistant',
          invited_name: name.trim() || null,
          status: 'pending',
        },
        { onConflict: 'center_id,phone' }
      );

    if (inviteErr) {
      console.error('Invite insert error:', inviteErr);
      return NextResponse.json({
        error: 'فشل في إرسال الدعوة / Failed to create invitation',
        details: inviteErr.message,
      }, { status: 500 });
    }

    try {
      await supabaseAdmin.from('audit_log').insert({
        center_id: currentUser.center_id,
        user_id: user.id,
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
      message: 'تم إرسال الدعوة / Invitation sent! The person should go to the accept-invite page, enter their phone number to receive a verification code, verify, and create their login credentials.',
    });
  } catch (error) {
    console.error('Invite user error:', error);
    return NextResponse.json({
      error: 'حدث خطأ / Internal server error',
    }, { status: 500 });
  }
}
