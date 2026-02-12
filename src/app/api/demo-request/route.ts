import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * Public API for marketing website to submit demo requests.
 * No auth required.
 */
export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = await request.json();
    const { name, phone, email, centerName } = body;

    if (!name || !phone) {
      return NextResponse.json({ error: 'Missing name or phone' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await supabaseAdmin
      .from('demo_requests')
      .insert({
        name: String(name).trim(),
        phone: String(phone).trim().replace(/\s/g, ''),
        email: email ? String(email).trim() : null,
        center_name: centerName ? String(centerName).trim() : null,
        status: 'pending',
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
