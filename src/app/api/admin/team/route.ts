import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import {
  adminTeamAddSchema,
  adminTeamUpdateSchema,
  adminTeamRemoveSchema,
} from '@/lib/validations';
import { validateCSRFRequest } from '@/lib/csrf';
import { verifyPasswordForSensitiveAction } from '@/lib/verify-password';

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: team, error } = await ctx.supabaseAdmin
      .from('admin_users')
      .select('id, name, email, role, phone, created_at')
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

    const body = await request.json();
    const parsed = adminTeamAddSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { name, email, phone, role } = parsed.data;

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

    // Find user in users table by phone (various formats used in the app)
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

    if (!userId) {
      return NextResponse.json({
        error: 'User not found. The person must sign up at CenterHQ first, then you can add them to the team.',
      }, { status: 400 });
    }

    // CRITICAL: Admins cannot add themselves to the team (privilege escalation protection)
    if (ctx.userId === userId) {
      return NextResponse.json({ error: 'Cannot add yourself to the team' }, { status: 403 });
    }

    const { data: existingAdmin } = await ctx.supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (existingAdmin) {
      return NextResponse.json({ error: 'This user is already in the team' }, { status: 400 });
    }

    const adminEmail = (email || '').trim() || `${formattedPhone}@centerhq.placeholder`;

    const { error: insertError } = await ctx.supabaseAdmin
      .from('admin_users')
      .insert({
        id: userId,
        name: name.trim(),
        email: adminEmail,
        phone: formattedPhone,
        role,
      });

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ success: true });
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

    const body = await request.json();
    const parsed = adminTeamUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { memberId, role, password } = parsed.data;

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

    const { error } = await ctx.supabaseAdmin
      .from('admin_users')
      .update({ role })
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

    const body = await request.json();
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
