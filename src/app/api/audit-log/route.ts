import { NextRequest, NextResponse } from 'next/server';
import { validateCSRFRequest } from '@/lib/csrf';
import { requireCenterAuth } from '@/lib/centerAuth';

/**
 * Append one audit_log row using the service role. Callers must be authenticated
 * center users; center_id is always taken from the session (requireCenterAuth).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    if (!validateCSRFRequest(request, auth.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    let body: {
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

    const action = body.action;
    const entityType = body.entityType;
    if (typeof action !== 'string' || typeof entityType !== 'string') {
      return NextResponse.json(
        { error: 'action and entityType are required strings' },
        { status: 400 },
      );
    }

    const entityId = body.entityId;
    const details =
      body.details && typeof body.details === 'object' && !Array.isArray(body.details)
        ? (body.details as Record<string, unknown>)
        : {};

    const { error: insertError } = await auth.supabaseAdmin.from('audit_log').insert({
      center_id: auth.centerId,
      user_id: auth.userId,
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
