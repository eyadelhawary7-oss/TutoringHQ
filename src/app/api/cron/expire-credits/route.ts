import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendChqCreditExpiryTemplate } from '@/lib/centerNotify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Set true when Meta template `chq_credit_expiry` is Active. */
const creditExpiryWaEnabled = false;

async function recalcCreditBalanceFromLedger(
  supabase: SupabaseClient,
  centerId: string,
): Promise<void> {
  const { data: rows, error } = await supabase
    .from('credit_ledger')
    .select('amount')
    .eq('center_id', centerId);
  if (error) {
    console.error('[cron/expire-credits] ledger sum', centerId, error);
    return;
  }
  const sum = (rows ?? []).reduce(
    (acc, r) => acc + Number((r as { amount?: unknown }).amount ?? 0),
    0,
  );
  await supabase.from('centers').update({ credit_balance: Math.max(0, sum) }).eq('id', centerId);
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pausedRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: true, reason: 'cron_paused' }, { status: 200 });
  }

  const now = new Date().toISOString();

  const { data: expiredRows, error: expErr } = await supabase
    .from('credit_ledger')
    .select('id, center_id, amount')
    .eq('type', 'earned')
    .gt('amount', 0)
    .not('expires_at', 'is', null)
    .lt('expires_at', now);

  if (expErr) {
    console.error('[cron/expire-credits] fetch expired', expErr);
    return NextResponse.json({ error: expErr.message }, { status: 500 });
  }

  const affectedCenters = new Set<string>();
  let expiredBatchCount = 0;

  for (const row of expiredRows ?? []) {
    const r = row as { id: string; center_id: string; amount: number | string };
    const prev = Number(r.amount);
    if (!Number.isFinite(prev) || prev <= 0) continue;

    const { error: upErr } = await supabase.from('credit_ledger').update({ amount: 0 }).eq('id', r.id);
    if (upErr) {
      console.error('[cron/expire-credits] zero earned', r.id, upErr);
      continue;
    }

    const { error: insErr } = await supabase.from('credit_ledger').insert({
      center_id: r.center_id,
      amount: -prev,
      type: 'expired',
      reference_id: r.id,
      reference_type: 'expiry',
    });
    if (insErr) {
      console.error('[cron/expire-credits] insert expired', r.id, insErr);
      continue;
    }

    affectedCenters.add(r.center_id);
    expiredBatchCount += 1;
  }

  for (const centerId of affectedCenters) {
    await recalcCreditBalanceFromLedger(supabase, centerId);
  }

  const in30 = new Date();
  in30.setUTCDate(in30.getUTCDate() + 30);
  const horizonIso = in30.toISOString();

  const { data: soonRows, error: soonErr } = await supabase
    .from('credit_ledger')
    .select('id, center_id, amount, expires_at')
    .eq('type', 'earned')
    .gt('amount', 0)
    .not('expires_at', 'is', null)
    .gte('expires_at', now)
    .lte('expires_at', horizonIso);

  let upcomingExpiryRows = 0;
  if (soonErr) {
    console.error('[cron/expire-credits] soon query', soonErr);
  } else {
    upcomingExpiryRows = soonRows?.length ?? 0;
    const centerIds = [...new Set((soonRows ?? []).map((x) => (x as { center_id: string }).center_id))];
    const centerMap = new Map<string, { name: string; phone: string | null }>();

    if (centerIds.length > 0) {
      const { data: centers, error: cErr } = await supabase
        .from('centers')
        .select('id, name, phone')
        .in('id', centerIds);
      if (cErr) {
        console.error('[cron/expire-credits] centers batch', cErr);
      } else {
        for (const c of centers ?? []) {
          const row = c as { id: string; name?: string; phone?: string | null };
          centerMap.set(row.id, { name: row.name ?? '—', phone: row.phone ?? null });
        }
      }
    }

    for (const raw of soonRows ?? []) {
      const row = raw as {
        center_id: string;
        amount: number | string;
        expires_at: string;
      };
      const meta = centerMap.get(row.center_id);
      const exp = new Date(row.expires_at);
      const expiresOnStr = exp.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

      const sent = await sendChqCreditExpiryTemplate(supabase, creditExpiryWaEnabled, {
        name: meta?.name ?? '—',
        phone: meta?.phone ?? null,
        amountStr: String(row.amount ?? 0),
        expiresOnStr,
      });

      if (!creditExpiryWaEnabled) {
        console.log('[cron/expire-credits] WA template queue chq_credit_expiry', {
          centerId: row.center_id,
          amount: row.amount,
          expiresOnStr,
        });
      } else if (!sent) {
        console.warn('[cron/expire-credits] chq_credit_expiry send failed', row.center_id);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    expiredBatches: expiredBatchCount,
    centersRecalculated: affectedCenters.size,
    upcomingExpiryRows,
  });
}
