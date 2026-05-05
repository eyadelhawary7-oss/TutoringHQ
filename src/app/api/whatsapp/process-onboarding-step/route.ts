/**
 * Process a single onboarding step — invoked by process-onboarding Edge Function
 * POST body: { centerId, toPhone, step }
 * Auth: Bearer service role key or internal
 */

import { NextResponse } from 'next/server';
import { processOnboardingStep } from '@/lib/whatsapp/flows/onboarding';
import { parseBodyWithLimit } from '@/lib/validate';

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!authHeader?.startsWith('Bearer ') || !serviceKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  if (token !== serviceKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { centerId?: string; toPhone?: string; step?: number };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { centerId, toPhone, step } = body;
  if (!centerId || !toPhone || !step || step < 1 || step > 8) {
    return NextResponse.json({ error: 'Missing centerId, toPhone, or invalid step' }, { status: 400 });
  }

  try {
    const result = await processOnboardingStep(centerId, toPhone, step);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[process-onboarding-step]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
