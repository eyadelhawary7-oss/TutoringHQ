import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import {
  adminTeamAddSchema,
  adminTeamUpdateSchema,
  adminTeamRemoveSchema,
} from '@/lib/validations';
import { validateCSRFRequest } from '@/lib/csrf';
import { verifyPasswordForSensitiveAction } from '@/lib/verify-password';
import { parseBodyWithLimit } from '@/lib/validate';

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: team, error } = await ctx.supabaseAdmin
      .from('admin_users')
      .select('id, name, email, role, phone, custom_permissions, created_at')
      .order('created_at', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ team: team || [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (ctx.internalRole !== 'super_admin') {
      return NextResponse.json({ error: 'Only super_admin can invite team members' }, { status: 403 });
    }
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const parsed = adminTeamAddSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { name, email, phone, role, custom_permissions } = parsed.data;

    // Defense-in-depth: never allow super_admin to be assigned via the API,
    // independent of the Zod enum. super_admin is conferred only by seed SQL
    // and SUPER_ADMIN_PHONES, never by a team-management write.
    if ((role as string) === 'super_admin') {
      return NextResponse.json({ error: 'Cannot assign super_admin role', code: 'ROLE_ESCALATION_FORBIDDEN' }, { status: 403 });
    }

    // Format phone: remove non-digits, ensure starts with 20 (Egypt)
    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) formattedPhone = formattedPhone.slice(1);
    if (!formattedPhone.startsWith('20')) formattedPhone = '20' + formattedPhone;
    const phoneWithPlus = '+' + formattedPhone;

    // Check if already in admin_users (by phone)
    const { data: existingByPhone } = await ctx.supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('phone', formattedPhone)
      .maybeSingle();

    if (existingByPhone) {
      return NextResponse.json({ error: 'This phone number is already in the team' }, { status: 400 });
    }

    // Team members are EMPLOYEES, not customers — they never go through center/teacher
    // signup. If the phone already has a login (e.g. the person is also a center owner),
    // reuse it; otherwise provision the login DIRECTLY (auth identity + self-service
    // set-PIN link), the same way a center owner is provisioned without signing up.
    const phoneVariants = [formattedPhone, phoneWithPlus, '0' + formattedPhone.slice(2), formattedPhone.slice(2)];
    let userId: string | null = null;
    for (const p of phoneVariants) {
      const { data: userRow } = await ctx.supabaseAdmin
        .from('users')
        .select('id')
        .eq('phone', p)
        .maybeSingle();
      if (userRow) {
        userId = userRow.id;
        break;
      }
    }

    // A newly provisioned employee gets a set-PIN link to return to the caller.
    let setupUrl: string | null = null;
    let provisioned = false;
    if (!userId) {
      try {
        const { provisionStaffLogin } = await import('@/lib/staffLoginProvision');
        const result = await provisionStaffLogin(ctx.supabaseAdmin, {
          phone: phoneWithPlus,
          name: name.trim(),
        });
        userId = result.userId;
        setupUrl = result.setupUrl;
        provisioned = true;
      } catch (e) {
        return NextResponse.json(
          {
            error:
              'Could not create the team member login. If they were added before, remove the stale account first, then retry.',
            detail: e instanceof Error ? e.message : 'unknown',
          },
          { status: 500 },
        );
      }
    }

    // CRITICAL: Admins cannot add themselves to the team (privilege escalation protection)
    if (ctx.userId === userId) {
      if (provisioned && userId) await ctx.supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      return NextResponse.json({ error: 'Cannot add yourself to the team' }, { status: 403 });
    }

    const { data: existingAdmin } = await ctx.supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (existingAdmin) {
      // Only possible when reusing an existing account (a freshly provisioned id is new).
      return NextResponse.json({ error: 'This user is already in the team' }, { status: 400 });
    }

    const adminEmail = (email || '').trim() || `${formattedPhone}@centerhq.placeholder`;

    const customPerms = custom_permissions ?? [];
    const { error: insertError } = await ctx.supabaseAdmin
      .from('admin_users')
      .insert({
        id: userId,
        name: name.trim(),
        email: adminEmail,
        phone: formattedPhone,
        role,
        custom_permissions: customPerms,
      });

    if (insertError) {
      // Roll back a freshly provisioned auth user so a failed add never leaves an orphan.
      if (provisioned && userId) await ctx.supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Link the HR staff row (sm/sr) to this login so scoped queries (getInternalScope)
    // resolve. Match by phone; only link an unlinked row (never steal another login's).
    let staffLinked = false;
    let staffRow: { id: string; user_id: string | null } | null = null;
    for (const p of phoneVariants) {
      const { data } = await ctx.supabaseAdmin
        .from('staff')
        .select('id, user_id')
        .eq('phone', p)
        .maybeSingle();
      if (data) {
        staffRow = data as { id: string; user_id: string | null };
        break;
      }
    }
    if (staffRow && !staffRow.user_id) {
      const { error: linkErr } = await ctx.supabaseAdmin
        .from('staff')
        .update({ user_id: userId })
        .eq('id', staffRow.id)
        .is('user_id', null);
      if (!linkErr) staffLinked = true;
    }

    return NextResponse.json({ success: true, provisioned, setupUrl, staffLinked });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (ctx.internalRole !== 'super_admin') {
      return NextResponse.json({ error: 'Only super_admin can change roles' }, { status: 403 });
    }
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const parsed = adminTeamUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { memberId, role, custom_permissions, password } = parsed.data;

    // Defense-in-depth: never allow promotion to super_admin via the API,
    // independent of the Zod enum. super_admin is conferred only by seed SQL
    // and SUPER_ADMIN_PHONES, never by a team-management write.
    if ((role as string) === 'super_admin') {
      return NextResponse.json({ error: 'Cannot assign super_admin role', code: 'ROLE_ESCALATION_FORBIDDEN' }, { status: 403 });
    }

    // Password confirmation required for changing another admin's role
    const accessToken = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!accessToken || !supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const verify = await verifyPasswordForSensitiveAction(
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      password || ''
    );
    if (!verify.ok) {
      return NextResponse.json({ error: verify.error }, { status: 401 });
    }

    // CRITICAL: Admins cannot change their own role (privilege escalation protection)
    if (ctx.userId === memberId) {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 403 });
    }

    const { data: member } = await ctx.supabaseAdmin
      .from('admin_users')
      .select('role')
      .eq('id', memberId)
      .single();

    if (member?.role === 'super_admin' || member?.role === 'admin') {
      return NextResponse.json({ error: 'Cannot change super admin role' }, { status: 400 });
    }

    const updatePayload: { role: string; custom_permissions?: string[] } = { role };
    if (role === 'custom' && custom_permissions) {
      updatePayload.custom_permissions = custom_permissions;
    }
    const { error } = await ctx.supabaseAdmin
      .from('admin_users')
      .update(updatePayload)
      .eq('id', memberId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (ctx.internalRole !== 'super_admin') {
      return NextResponse.json({ error: 'Only super_admin can remove team members' }, { status: 403 });
    }
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const parsed = adminTeamRemoveSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { memberId } = parsed.data;

    // CRITICAL: Admins cannot remove themselves (privilege escalation protection)
    if (ctx.userId === memberId) {
      return NextResponse.json({ error: 'Cannot remove yourself from the team' }, { status: 403 });
    }

    const { data: member } = await ctx.supabaseAdmin
      .from('admin_users')
      .select('role')
      .eq('id', memberId)
      .single();

    if (member?.role === 'super_admin' || member?.role === 'admin') {
      return NextResponse.json({ error: 'Cannot remove super admin' }, { status: 400 });
    }

    const { error } = await ctx.supabaseAdmin
      .from('admin_users')
      .delete()
      .eq('id', memberId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
