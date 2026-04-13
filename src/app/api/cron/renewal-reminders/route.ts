import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabaseAdmin as supabaseAdminHealth } from '@/lib/supabase-admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { formatNumber } from '@/lib/formatNumber';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

function getSupabaseAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function addDays(date: Date, days: number): string {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result.toISOString().split('T')[0];
}

function normalizePhoneForMeta(phone: string): string {
  return phone
    .replace(/^\+/, '')
    .replace(/^0(\d{10})$/, '20$1');
}

function formatAmount(amount: number): string {
  return formatNumber(amount, 'ar');
}

function buildReminderMessage(
  ownerName: string,
  centerName: string,
  plan: string,
  amount: number,
  daysUntilDue: number
): string {
  const planMap: Record<string, string> = {
    starter: 'سنتر صغير',
    pro: 'سنتر متوسط',
    business: 'سنتر كبير',
    enterprise: 'سنتر ضخم',
    top_centers: 'ميجا سنتر',
  };
  const planArabic = planMap[plan] || plan;

  if (daysUntilDue === 7) {
    return `مرحباً ${ownerName} 👋

تذكير ودي: اشتراك ${centerName} على CenterHQ سيتجدد خلال *7 أيام*.

📋 الباقة: ${planArabic}
💰 المبلغ: ${formatAmount(amount)} ج.م

للاستفسار أو تغيير الباقة، تواصل معنا على هذا الرقم.

شكراً لثقتك في CenterHQ 🎓`;
  }

  return `تنبيه عاجل ⚠️

${ownerName}، اشتراك *${centerName}* سيتجدد *غداً*.

💰 المبلغ المستحق: ${formatAmount(amount)} ج.م
📋 الباقة: ${planArabic}

يرجى التأكد من جاهزية طريقة الدفع لضمان استمرارية الخدمة.

للمساعدة تواصل معنا فوراً 🙏`;
}

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'renewal-reminders';

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabase = getSupabaseAdmin();

  const { data: pausedRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  try {
    const today = new Date();
    const in7Days = addDays(today, 7);
    const tomorrow = addDays(today, 1);

    const { data: centers, error } = await supabase
      .from('centers')
      .select('id, name, phone, owner_name, plan, billing_amount, next_payment_due, subscription_status')
      .in('next_payment_due', [in7Days, tomorrow])
      .eq('subscription_status', 'active')
      .not('phone', 'is', null);

    if (error) {
      throw new Error(error.message || 'DB error');
    }

    if (!centers || centers.length === 0) {
      await supabase.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'success',
        duration_ms: Date.now() - cronStart,
        records_processed: 0,
      });
      try {
        if (supabaseAdminHealth) {
          await supabaseAdminHealth.from('cron_health_log').upsert(
            {
              cron_name: 'renewal-reminders',
              last_success_at: new Date().toISOString(),
              failure_count: 0,
            },
            { onConflict: 'cron_name' },
          );
        }
      } catch (healthLogErr) {
        console.error('[renewal-reminders] cron_health_log:', healthLogErr);
      }
      return NextResponse.json({ success: true, sent: 0, message: 'No centers due today' });
    }

    let sent = 0;
    let failed = 0;

    for (const center of centers) {
      const daysUntilDue = center.next_payment_due === in7Days ? 7 : 1;
      const phone = normalizePhoneForMeta(center.phone as string);
      const ownerName = (center.owner_name || center.name) as string;
      const amount = Number(center.billing_amount) || 0;

      const message = buildReminderMessage(
        ownerName,
        center.name as string,
        center.plan as string,
        amount,
        daysUntilDue
      );

      const success = await sendWhatsAppMessage(phone, message);
      if (success) sent++;
      else failed++;

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: sent + failed,
      metadata: { sent, failed, total: centers.length },
    });

    try {
      if (supabaseAdminHealth) {
        await supabaseAdminHealth.from('cron_health_log').upsert(
          {
            cron_name: 'renewal-reminders',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[renewal-reminders] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, sent, failed, total: centers.length });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
    try {
      await supabase.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'failure',
        duration_ms: Date.now() - cronStart,
        error_message: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown',
      });
    } catch (logErr) {
      console.error(`[${CRON_NAME}] cron_log:`, logErr);
    }
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
