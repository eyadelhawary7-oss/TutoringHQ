import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    // Check environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    const supabase = createClient(supabaseUrl, serviceKey);

    // Query centers
    const { data: centers, error: centersError } = await supabase
      .from('centers')
      .select('id, name, phone, plan, status, billing_type, is_early_adopter, early_adopter_price, created_at')
      .order('created_at', { ascending: false });

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

    const response = {
      centers,
      counts,
      revenue: { total_mrr: totalMRR },
      note: 'Debug endpoint - for diagnostics only',
    };

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
