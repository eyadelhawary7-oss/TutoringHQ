import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/utils/phone';

/**
 * Called after login. Checks if user's phone is in center_invites.
 * If yes: creates users record, marks invite accepted, returns centerId.
 * Also checks existing users record.
 */
export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const phoneRaw = user.phone?.replace(/\s/g, '') || user.user_metadata?.phone || '';
    const normalizedPhone = normalizePhone(phoneRaw);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Check if already in users
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, center_id')
      .eq('id', user.id)
      .single();

    if (existingUser?.center_id) {
      return NextResponse.json({
        centerId: existingUser.center_id,
        needsOnboarding: false,
      });
    }

    // Check center_invites for this phone (DB stores +20 format)
    if (normalizedPhone) {
      const digits = phoneRaw.replace(/\D/g, '');
      const phoneVariants = [
        normalizedPhone,
        digits.startsWith('0') ? digits : '0' + digits,
      ];
      let invite: { id: string; center_id: string; role: string } | null = null;
      for (const p of phoneVariants) {
        const { data } = await supabaseAdmin
          .from('center_invites')
          .select('id, center_id, role')
          .eq('phone', p)
          .eq('status', 'pending')
          .limit(1)
          .maybeSingle();
        if (data) { invite = data; break; }
      }

      if (invite) {
        await supabaseAdmin.from('users').upsert(
          {
            id: user.id,
            center_id: invite.center_id,
            role: invite.role || 'owner',
            phone: normalizedPhone,
            name: user.user_metadata?.name || null,
          },
          { onConflict: 'id' }
        );

        await supabaseAdmin
          .from('center_invites')
          .update({ status: 'accepted' })
          .eq('id', invite.id);

        return NextResponse.json({
          centerId: invite.center_id,
          needsOnboarding: true,
        });
      }
    }

    return NextResponse.json({
      centerId: null,
      needsOnboarding: false,
      contactSales: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
