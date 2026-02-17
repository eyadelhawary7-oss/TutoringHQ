import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startTime = Date.now();

  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data, error } = await supabase
      .from('centers')
      .select('id')
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    const responseTime = Date.now() - startTime;

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        api: 'operational',
      },
      responseTime: `${responseTime}ms`,
      environment: process.env.NODE_ENV,
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;

    console.error('Health check failed:', error);

    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime: `${responseTime}ms`,
        environment: process.env.NODE_ENV,
      },
      { status: 503 },
    );
  }
}
