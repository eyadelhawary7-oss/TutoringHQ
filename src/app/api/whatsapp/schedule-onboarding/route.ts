/**
 * Schedule WhatsApp onboarding Flow 1 for a center
 * POST body: { centerPhone? } — center is always the authenticated user's center.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { scheduleOnboardingFlow } from '@/lib/whatsapp/flows/onboarding';
import { normalizePhone } from '@/lib/whatsapp/client';
import { parseBodyWithLimit } from '@/lib/validate';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    let body: { centerPhone?: string };
    try {
      body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const centerId = auth.centerId;

    let phone = body.centerPhone;
    if (!phone) {
      const { data } = await auth.supabaseAdmin
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
