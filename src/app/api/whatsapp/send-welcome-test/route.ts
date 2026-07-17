/**
 * Send chq_welcome template immediately to the center owner's phone (onboarding step 3 test).
 */
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { centerAccessGateResponse } from '@/lib/centerAccessGate';
import { processOnboardingStep } from '@/lib/whatsapp/flows/onboarding';
import { normalizePhone } from '@/lib/whatsapp/client';

async function getUserCenterContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('center_id')
    .eq('id', user.id)
    .single();

  const centerId = userRecord?.center_id as string | undefined;
  if (!centerId) return null;

  return { centerId, supabaseAdmin };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserCenterContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Part 6 (CLOSE as leak): inherit the suspension / lock gate the hand-rolled
    // auth skipped. A locked centre must not send outbound WhatsApp.
    const welcomeGate = await centerAccessGateResponse(ctx.supabaseAdmin, ctx.centerId);
    if (welcomeGate) return welcomeGate;

    const { data: row } = await ctx.supabaseAdmin.from('centers').select('phone').eq('id', ctx.centerId).single();

    const phone = (row as { phone?: string | null } | null)?.phone?.trim();
    if (!phone) {
      return NextResponse.json({ error: 'Center phone is required to send WhatsApp' }, { status: 400 });
    }

    const normalized = normalizePhone(phone);
    const result = await processOnboardingStep(ctx.centerId, normalized, 1);

    if (!result.success) {
      return NextResponse.json({ error: 'Failed to send WhatsApp template' }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[send-welcome-test]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
