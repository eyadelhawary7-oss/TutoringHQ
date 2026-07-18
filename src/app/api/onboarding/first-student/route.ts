import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { parseBodyWithLimit } from '@/lib/validate';
import { centerAccessGateResponse } from '@/lib/centerAccessGate';
import { validateCSRFRequest } from '@/lib/csrf';

type CtxOk = {
  ok: true;
  userId: string;
  centerId: string;
  canManage: boolean;
  supabaseAdmin: SupabaseClient;
};
type CtxFail = { ok: false; status: 401 | 500 };
type Ctx = CtxOk | CtxFail;

// Two-select identity resolution mirroring centerAuth.ts (see its docblock):
// the prior single wide SELECT bundled `can_manage_students` with `center_id`
// and discarded the error, so a missing/renamed permission column made
// PostgREST error, supabase-js return data:null, and an onboarding owner got
// 401-locked OUT of onboarding. CORE pulls only identity columns and a query
// error here is infrastructure failure (500, never null/401). PERMISSIONS is
// best-effort and defaults canManage=true on error to preserve the prior
// "missing/unknown is allowed" semantics for this route.
async function getUserCenterContext(request: NextRequest): Promise<Ctx> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return { ok: false, status: 500 };
  }

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return { ok: false, status: 401 };

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) return { ok: false, status: 401 };

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: coreUser, error: coreErr } = await supabaseAdmin
    .from('users')
    .select('id, center_id')
    .eq('id', user.id)
    .maybeSingle();

  if (coreErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/onboarding/first-student');
      scope.setTag('step', 'core_user_lookup');
      Sentry.captureException(coreErr);
    });
    return { ok: false, status: 500 };
  }

  const centerId = (coreUser as { center_id?: string | null } | null)?.center_id ?? null;
  if (!centerId) return { ok: false, status: 401 };

  let canManage = true;
  const { data: permsRow, error: permsErr } = await supabaseAdmin
    .from('users')
    .select('can_manage_students')
    .eq('id', user.id)
    .maybeSingle();

  if (permsErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/onboarding/first-student');
      scope.setTag('step', 'permission_flags');
      Sentry.captureMessage(
        `onboarding/first-student permission-column lookup failed: ${permsErr.message}`,
        'warning',
      );
    });
  } else if (permsRow) {
    canManage =
      (permsRow as { can_manage_students?: boolean | null }).can_manage_students !== false;
  }

  return {
    ok: true,
    userId: user.id,
    centerId,
    canManage,
    supabaseAdmin,
  };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserCenterContext(request);
    if (!ctx.ok) {
      if (ctx.status === 500) {
        return NextResponse.json({ error: 'server_error' }, { status: 500 });
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!ctx.canManage) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fail-closed CSRF on this state-changing POST (creates a student). Same pattern as the
    // pay route: validateCSRFRequest returns false when CSRF_SECRET is unset/malformed.
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    // Part 6 (CLOSE as leak): inherit the suspension / lock gate the hand-rolled
    // auth skipped. A locked centre must not create students.
    const gate = await centerAccessGateResponse(ctx.supabaseAdmin, ctx.centerId);
    if (gate) return gate;

    let body: { name?: string; phone?: string | null };
    try {
      body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2) {
      return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 });
    }

    // Server-side guardian-consent gate: a center adding a student must confirm
    // it holds the guardian's consent. Reject if absent; stamp who/when as proof.
    if ((body as { guardianConsentConfirmed?: unknown }).guardianConsentConfirmed !== true) {
      return NextResponse.json(
        { error: 'guardian_consent_required', code: 'GUARDIAN_CONSENT_REQUIRED' },
        { status: 403 },
      );
    }

    const phone =
      typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;

    const { data: inserted, error } = await ctx.supabaseAdmin
      .from('students')
      .insert({
        center_id: ctx.centerId,
        name,
        phone,
        fee: 0,
        payment_status: 'unpaid',
        guardian_consent_confirmed_at: new Date().toISOString(),
        guardian_consent_confirmed_by: ctx.userId,
      })
      .select('id, name, phone, student_number')
      .single();

    if (error || !inserted) {
      return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
    }

    return NextResponse.json({
      student: {
        id: inserted.id as string,
        name: inserted.name as string,
        phone: (inserted.phone as string | null) ?? '',
        student_number: (inserted.student_number as string | null) ?? null,
      },
    });
  } catch (e) {
    console.error('[onboarding/first-student]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
