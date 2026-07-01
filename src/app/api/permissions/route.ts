import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireCenterAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { verifyPasswordForSensitiveAction } from '@/lib/verify-password';
import { parseBodyWithLimit } from '@/lib/validate';

const VALID_KEYS = ['can_scan','can_view_payments','can_record_payments','can_view_dashboard','can_view_revenue','can_manage_students','can_manage_groups','can_allow_late_entry','can_manage_rooms','can_view_schedule','can_view_settings','is_active'];

const permissionsBodySchema = z
  .object({
    targetUserId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    permissions: z.record(z.string(), z.boolean()).optional(),
    permissionKey: z.string().optional(),
    enabled: z.boolean().optional(),
    permission: z.string().optional(),
    value: z.boolean().optional(),
    password: z.string().optional(), // Required for sensitive action
  })
  .refine((d) => d.targetUserId || d.userId, { message: 'targetUserId or userId required' });

export async function POST(request: NextRequest) { return PUT(request); }

export async function PUT(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    // The raw bearer token is still needed to re-verify the caller's password
    // for the sensitive action below (the shared gate doesn't expose it).
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')?.trim();

    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    const ctx = { caller: { id: auth.userId, role: auth.role, center_id: auth.centerId }, admin: auth.supabaseAdmin };

    if (ctx.caller.role !== 'owner' && ctx.caller.role !== 'admin') {
      return NextResponse.json({ error: 'Only owner/admin can change permissions' }, { status: 403 });
    }
    if (!validateCSRFRequest(request, ctx.caller.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }
    if (!url || !anon || !token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const parsed = permissionsBodySchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const targetId = parsed.data.targetUserId || parsed.data.userId;

    // CRITICAL: Users cannot modify their own permissions (privilege escalation protection)
    if (ctx.caller.id === targetId) {
      return NextResponse.json({ error: 'Cannot modify your own permissions' }, { status: 403 });
    }

    // Password confirmation required for changing another admin's permissions
    const verify = await verifyPasswordForSensitiveAction(
      url,
      anon,
      token,
      parsed.data.password || ''
    );
    if (!verify.ok) {
      return NextResponse.json({ error: verify.error }, { status: 401 });
    }

    const { data: target } = await ctx.admin.from('users').select('id, role, center_id').eq('id', targetId).eq('center_id', ctx.caller.center_id).single();
    if (!target) return NextResponse.json({ error: 'User not found in this center' }, { status: 404 });
    if (target.role !== 'assistant' && target.role !== 'teacher') {
      return NextResponse.json({ error: 'Can only set permissions for assistants/teachers' }, { status: 400 });
    }

    const data = parsed.data;
    const updateObj: Record<string, boolean> = {};
    if (data.permissions && typeof data.permissions === 'object') {
      for (const [k, v] of Object.entries(data.permissions)) {
        if (VALID_KEYS.includes(k) && typeof v === 'boolean') updateObj[k] = v;
      }
    } else if (data.permissionKey != null && typeof data.enabled === 'boolean') {
      if (VALID_KEYS.includes(data.permissionKey)) updateObj[data.permissionKey] = data.enabled;
    } else if (data.permission != null && typeof data.value === 'boolean') {
      if (VALID_KEYS.includes(data.permission)) updateObj[data.permission] = data.value;
    }
    if (Object.keys(updateObj).length === 0) return NextResponse.json({ error: 'No valid permissions' }, { status: 400 });

    const { data: updated, error } = await ctx.admin.from('users').update(updateObj).eq('id', targetId).eq('center_id', ctx.caller.center_id).select();
    if (error) {
      console.error('Permission update error:', error.message, error.details);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
