import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getStudentUiConfig } from '@/lib/pricingConfig';

/**
 * The Students screens' three platform_config numbers, read server-side.
 *
 *   qrCardPrice        — Merged-Center-Students §02's ID-card banner price.
 *                        Key `qr_card_price`; ABSENT from platform_config live,
 *                        so the code default (62) is what renders. Never the
 *                        design's sample 25.
 *   overdueAfterDays   — `student_overdue_after_days`, the At risk → Overdue line.
 *   newStudentDays     — `student_new_for_days`, how long the New badge lasts.
 *
 * These pages are `'use client'`, and the config reader needs the service-role
 * key, so it cannot be imported into them directly — hence this narrow GET.
 *
 * FAILS VISIBLY, NEVER FALSELY: on any error the client is told nothing and the
 * §02 banner drops its price clause entirely rather than guessing a number.
 * Read-only and authenticated; no CSRF (GET is not a mutation).
 */
export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  const accessToken = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')?.trim();
  if (!accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await getStudentUiConfig());
  } catch {
    return NextResponse.json({ error: 'Config unavailable' }, { status: 503 });
  }
}
