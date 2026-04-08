import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateCSRFRequest } from '@/lib/csrf';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Append one audit_log row using the service role. Callers must be authenticated
 * center users; centerId must match their users.center_id.
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace(/^Bearer\s+/i, '')?.trim();
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (!validateCSRFRequest(request, user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    let body: {
      centerId?: unknown;
      action?: unknown;
      entityType?: unknown;
      entityId?: unknown;
      details?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const centerId = body.centerId;
    const action = body.action;
    const entityType = body.entityType;
    if (typeof centerId !== 'string' || typeof action !== 'string' || typeof entityType !== 'string') {
      return NextResponse.json(
        { error: 'centerId, action, and entityType are required strings' },
        { status: 400 },
      );
    }

    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('center_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!userRecord?.center_id || userRecord.center_id !== centerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const entityId = body.entityId;
    const details =
      body.details && typeof body.details === 'object' && !Array.isArray(body.details)
        ? (body.details as Record<string, unknown>)
        : {};

    const { error: insertError } = await supabaseAdmin.from('audit_log').insert({
      center_id: centerId,
      user_id: user.id,
      action,
      entity_type: entityType,
      entity_id: typeof entityId === 'string' ? entityId : null,
      details,
    });

    if (insertError) {
      console.error('[api/audit-log] insert:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/audit-log]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
