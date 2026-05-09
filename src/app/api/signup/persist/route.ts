import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { normalizePhone } from '@/lib/utils/phone';
import { parseBodyWithLimit, ValidationError } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'misconfigured' }, { status: 503 });
    }

    const body = (await parseBodyWithLimit(request, 16384)) as Record<string, unknown>;
    const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phoneRaw) {
      return NextResponse.json({ error: 'phone required' }, { status: 400 });
    }
    const phone = normalizePhone(phoneRaw);

    const centerName = typeof body.center_name === 'string' ? body.center_name.trim() : '';
    const ownerName = typeof body.owner_name === 'string' ? body.owner_name.trim() : '';
    if (!centerName || !ownerName) {
      return NextResponse.json({ error: 'center_name and owner_name required' }, { status: 400 });
    }

    const row: Record<string, unknown> = {
      phone,
      email: typeof body.email === 'string' ? body.email.trim() || null : null,
      center_name: centerName,
      owner_name: ownerName,
      city: typeof body.city === 'string' ? body.city.trim() || null : null,
      plan_key: typeof body.plan_key === 'string' ? body.plan_key.trim() || null : null,
      billing_period: typeof body.billing_period === 'string' ? body.billing_period.trim() || null : null,
      referral_code: typeof body.referral_code === 'string' ? body.referral_code.trim() || null : null,
      terms_accepted_at: typeof body.terms_accepted_at === 'string' ? body.terms_accepted_at : null,
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    if (typeof body.last_step_completed === 'number' && Number.isFinite(body.last_step_completed)) {
      row.last_step_completed = body.last_step_completed;
    }
    if (typeof body.payment_attempt_count === 'number' && Number.isFinite(body.payment_attempt_count)) {
      row.payment_attempt_count = body.payment_attempt_count;
    }

    const { data, error } = await supabaseAdmin
      .from('pending_signups')
      .upsert(row, { onConflict: 'phone' })
      .select('id')
      .single();

    if (error) {
      Sentry.captureException(error, { tags: { api: 'signup-persist' } });
      return NextResponse.json({ error: 'save_failed' }, { status: 500 });
    }

    return NextResponse.json({ id: (data as { id?: string } | null)?.id });
  } catch (e) {
    if (e instanceof ValidationError && e.message === 'Request payload too large') {
      Sentry.captureMessage('signup persist payload limit', {
        level: 'warning',
        tags: { api: 'signup-persist' },
      });
      return new Response(null, { status: 413 });
    }
    Sentry.captureException(e, { tags: { api: 'signup-persist' } });
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
}
