import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const VALID_KEYS = ['can_scan','can_view_payments','can_record_payments','can_view_dashboard','can_view_revenue','can_manage_students','can_manage_groups','can_allow_late_entry'];

async function getCallerContext(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return null;
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const authClient = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user }, error } = await authClient.auth.getUser();
  if (error || !user) return null;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller } = await admin.from('users').select('id, role, center_id').eq('id', user.id).single();
  if (!caller?.center_id) return null;
  return { caller, admin };
}

export async function POST(request: Request) { return PUT(request); }

export async function PUT(request: Request) {
  try {
    const ctx = await getCallerContext(request);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (ctx.caller.role !== 'owner' && ctx.caller.role !== 'admin') {
      return NextResponse.json({ error: 'Only owner/admin can change permissions' }, { status: 403 });
    }
    const body = await request.json();
    const targetId = body.targetUserId || body.userId;
    if (!targetId) return NextResponse.json({ error: 'Missing targetUserId' }, { status: 400 });

    const { data: target } = await ctx.admin.from('users').select('id, role, center_id').eq('id', targetId).eq('center_id', ctx.caller.center_id).single();
    if (!target) return NextResponse.json({ error: 'User not found in this center' }, { status: 404 });
    if (target.role !== 'assistant' && target.role !== 'teacher') {
      return NextResponse.json({ error: 'Can only set permissions for assistants/teachers' }, { status: 400 });
    }

    let updateObj: Record<string, boolean> = {};
    if (body.permissions && typeof body.permissions === 'object') {
      for (const [k, v] of Object.entries(body.permissions)) {
        if (VALID_KEYS.includes(k) && typeof v === 'boolean') updateObj[k] = v;
      }
    } else if (body.permissionKey && typeof body.enabled === 'boolean') {
      if (VALID_KEYS.includes(body.permissionKey)) updateObj[body.permissionKey] = body.enabled;
    } else if (body.permission && typeof body.value === 'boolean') {
      if (VALID_KEYS.includes(body.permission)) updateObj[body.permission] = body.value;
    }
    if (Object.keys(updateObj).length === 0) return NextResponse.json({ error: 'No valid permissions' }, { status: 400 });

    const { data, error } = await ctx.admin.from('users').update(updateObj).eq('id', targetId).eq('center_id', ctx.caller.center_id).select();
    if (error) {
      console.error('Permission update error:', error.message, error.details);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
