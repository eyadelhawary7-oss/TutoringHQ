import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic'

export const maxDuration = 60;

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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
  return amount.toLocaleString('en-US');
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

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error('[Renewal Reminders] CRON_SECRET env var is not set — refusing to run');
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const today = new Date();
  const in7Days = addDays(today, 7);
  const tomorrow = addDays(today, 1);

  const { data: centers, error } = await supabase
    .from('centers')
    .select('id, name, phone, owner_name, plan, billing_amount, next_billing_date, subscription_status')
    .in('next_billing_date', [in7Days, tomorrow])
    .eq('subscription_status', 'active')
    .not('phone', 'is', null);

  if (error) {
    console.error('[Renewal Reminders] DB error:', error);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!centers || centers.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No centers due today' });
  }

  let sent = 0;
  let failed = 0;

  for (const center of centers) {
    const daysUntilDue = center.next_billing_date === in7Days ? 7 : 1;
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

  return NextResponse.json({ sent, failed, total: centers.length });
}
