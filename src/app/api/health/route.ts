import { NextResponse } from 'next/server';

export async function GET() {
  // #region agent log
  console.log('[DEBUG] /api/health called', { timestamp: Date.now() });
  // #endregion
  return NextResponse.json({
    status: 'ok',
    timestamp: Date.now(),
    env: {
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasSupabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      nodeEnv: process.env.NODE_ENV,
    },
  });
}
