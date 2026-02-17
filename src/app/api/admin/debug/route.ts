import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  console.log('==========================================');
  console.log('[admin/debug] 🔍 Route called');
  console.log('==========================================');

  try {
    // Check environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('[admin/debug] 📋 Environment check:', {
      hasUrl: !!supabaseUrl,
      hasServiceKey: !!serviceKey,
      urlPrefix: supabaseUrl?.substring(0, 20) + '...',
      keyPrefix: serviceKey?.substring(0, 20) + '...',
    });

    if (!supabaseUrl || !serviceKey) {
      const error = 'Missing Supabase credentials';
      console.error('[admin/debug] ❌', error);
      return NextResponse.json(
        {
          error,
          hasUrl: !!supabaseUrl,
          hasServiceKey: !!serviceKey,
        },
        { status: 500 }
      );
    }

    // Create Supabase client
    console.log('[admin/debug] 🔧 Creating Supabase client...');
    const supabase = createClient(supabaseUrl, serviceKey);
    console.log('[admin/debug] ✅ Supabase client created');

    // Query centers
    console.log('[admin/debug] 📡 Querying centers...');
    const { data: centers, error: centersError } = await supabase
      .from('centers')
      .select('id, name, phone, plan, status, billing_type, is_early_adopter, early_adopter_price, created_at')
      .order('created_at', { ascending: false });

    console.log('[admin/debug] 📊 Centers query result:', {
      count: centers?.length || 0,
      error: centersError,
      firstCenter: centers?.[0],
    });

    if (centersError) {
      console.error('[admin/debug] ❌ Centers query error:', centersError);
      return NextResponse.json(
        {
          error: centersError.message,
          code: centersError.code,
          details: centersError.details,
          hint: centersError.hint,
        },
        { status: 500 }
      );
    }

    // Calculate counts
    const counts = {
      total: centers?.length || 0,
      active: centers?.filter((c) => c.status === 'active').length || 0,
      pending: centers?.filter((c) => c.status === 'pending').length || 0,
    };

    console.log('[admin/debug] 📈 Counts:', counts);

    // Calculate MRR
    const planPricing: Record<string, number> = {
      starter: 2000,
      pro: 4500,
      business: 6500,
      enterprise: 9000,
      STARTER: 2000,
      PRO: 4500,
      BUSINESS: 6500,
      ENTERPRISE: 9000,
    };

    const activeCenters =
      centers?.filter((c) => c.status === 'active' && (c.billing_type || 'fixed') === 'fixed') || [];

    const totalMRR = activeCenters.reduce((sum, center) => {
      const price = center.is_early_adopter
        ? (center.early_adopter_price || 0)
        : planPricing[center.plan || 'starter'] ?? 2000;
      return sum + price;
    }, 0);

    console.log('[admin/debug] 💰 MRR:', totalMRR);

    const response = {
      centers,
      counts,
      revenue: { total_mrr: totalMRR },
      note: 'Debug endpoint - for diagnostics only',
    };

    console.log('[admin/debug] ✅ Success - returning data');
    console.log('==========================================');

    return NextResponse.json(response);
  } catch (error) {
    console.error('==========================================');
    console.error('[admin/debug] 💥 CAUGHT ERROR:', error);
    console.error('[admin/debug] Error type:', error?.constructor?.name);
    console.error('[admin/debug] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[admin/debug] Error stack:', error instanceof Error ? error.stack : 'No stack');
    console.error('==========================================');

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        type: error?.constructor?.name,
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
