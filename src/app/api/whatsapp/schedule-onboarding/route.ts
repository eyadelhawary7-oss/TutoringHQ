/**
 * Schedule WhatsApp onboarding Flow 1 for a center
 * POST body: { centerId, centerPhone }
 * Auth: Bearer user token (must own the center)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { scheduleOnboardingFlow } from '@/lib/whatsapp/flows/onboarding';
import { normalizePhone } from '@/lib/whatsapp/client';

async function getUserContext(request: NextRequest) {
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

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, role')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { centerId: userRecord.center_id as string, supabaseAdmin };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: { centerId?: string; centerPhone?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const centerId = body.centerId ?? ctx.centerId;
    if (centerId !== ctx.centerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let phone = body.centerPhone;
    if (!phone) {
      const { data } = await ctx.supabaseAdmin
        .from('centers')
        .select('phone')
        .eq('id', centerId)
        .single();
      phone = (data as { phone?: string } | null)?.phone ?? '';
    }

    if (!phone?.trim()) {
      return NextResponse.json(
        { error: 'Center phone required for WhatsApp onboarding' },
        { status: 400 }
      );
    }

    const normalized = normalizePhone(phone.trim());
    await scheduleOnboardingFlow(centerId, normalized);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[schedule-onboarding]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
