import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Missing config' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const fromStr = ninetyDaysAgo.toISOString();

  const [checksRes, incidentsRes] = await Promise.all([
    supabase
      .from('status_checks')
      .select('service, status, response_time_ms, checked_at')
      .gte('checked_at', fromStr)
      .order('checked_at', { ascending: false })
      .limit(5000),
    supabase
      .from('status_incidents')
      .select('id, title, severity, started_at, resolved_at, services_affected')
      .order('started_at', { ascending: false })
      .limit(5),
  ]);

  const checks = (checksRes.data ?? []) as { service: string; status: string; response_time_ms: number | null; checked_at: string }[];
  const incidents = (incidentsRes.data ?? []) as { id: string; title: string; severity: string; started_at: string; resolved_at: string | null; services_affected: string[] }[];

  const services = ['api', 'scanner', 'payments'];
  const latestByService: Record<string, { status: string; response_time_ms: number | null; checked_at: string }> = {};
  for (const s of services) {
    const latest = checks.find((c) => c.service === s);
    latestByService[s] = latest
      ? { status: latest.status, response_time_ms: latest.response_time_ms, checked_at: latest.checked_at }
      : { status: 'unknown', response_time_ms: null, checked_at: '' };
  }

  const overallStatus =
    Object.values(latestByService).every((v) => v.status === 'operational')
      ? 'operational'
      : Object.values(latestByService).some((v) => v.status === 'outage')
        ? 'outage'
        : 'degraded';

  const uptimeByDay: Record<string, Record<string, 'operational' | 'degraded' | 'outage' | 'unknown'>> = {};
  for (let d = 0; d < 90; d++) {
    const day = new Date();
    day.setDate(day.getDate() - (89 - d));
    const dayStr = day.toISOString().slice(0, 10);
    uptimeByDay[dayStr] = {};
    for (const s of services) {
      const dayChecks = checks.filter(
        (c) => c.service === s && c.checked_at.startsWith(dayStr)
      );
      const worst = dayChecks.some((c) => c.status === 'outage')
        ? 'outage'
        : dayChecks.some((c) => c.status === 'degraded')
          ? 'degraded'
          : dayChecks.length > 0
            ? 'operational'
            : 'unknown';
      uptimeByDay[dayStr][s] = worst;
    }
  }

  return NextResponse.json({
    overall: overallStatus,
    services: latestByService,
    uptime_90d: uptimeByDay,
    incidents,
  });
}
