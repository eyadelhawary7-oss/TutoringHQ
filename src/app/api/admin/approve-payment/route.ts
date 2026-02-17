import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function POST(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (ctx.internalRole !== 'super_admin' && ctx.internalRole !== 'internal_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { centerId, action } = body;

    if (!centerId || !action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'centerId and action (approve|reject) required' }, { status: 400 });
    }

    const { supabaseAdmin, userId } = ctx;

    if (action === 'approve') {
      const { data: pendingInv } = await supabaseAdmin
        .from('invoices')
        .select('id, payment_amount, payment_reference')
        .eq('center_id', centerId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!pendingInv) {
        return NextResponse.json({ error: 'No pending payment proof found for this center' }, { status: 404 });
      }

      const { data: center } = await supabaseAdmin
        .from('centers')
        .select('billing_period')
        .eq('id', centerId)
        .single();

      const periodMonths: Record<string, number> = {
        monthly: 1,
        quarterly: 3,
        half_yearly: 6,
        yearly: 12,
        semi_annual: 6,
        annual: 12,
      };
      const months = periodMonths[(center as { billing_period?: string })?.billing_period || 'quarterly'] ?? 3;
      const nextDue = addMonths(new Date(), months);

      const { error: invErr } = await supabaseAdmin
        .from('invoices')
        .update({
          status: 'approved',
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', (pendingInv as { id: string }).id);

      if (invErr) throw invErr;

      await supabaseAdmin
        .from('centers')
        .update({
          status: 'active',
          subscription_status: 'active',
          billing_status: 'paid',
          last_payment_date: new Date().toISOString().split('T')[0],
          next_payment_due: nextDue.toISOString().split('T')[0],
          next_billing_date: nextDue.toISOString().split('T')[0],
          payment_due_date: nextDue.toISOString().split('T')[0],
        })
        .eq('id', centerId);

      const amount = Number((pendingInv as { payment_amount?: number }).payment_amount ?? 0);
      const ref = (pendingInv as { payment_reference?: string }).payment_reference ?? '';
      const bp = (center as { billing_period?: string })?.billing_period ?? 'quarterly';
      await supabaseAdmin.from('admin_payments').insert({
        center_id: centerId,
        amount,
        billing_period: bp === 'half_yearly' ? 'semi_annual' : bp === 'yearly' ? 'annual' : bp,
        paid_at: new Date().toISOString(),
        notes: `Payment proof approved - Ref: ${ref}`,
        recorded_by: userId,
      });

      try {
        await supabaseAdmin.from('audit_log').insert({
          center_id: centerId,
          user_id: userId,
          action: 'admin_invoice_approved',
          entity_type: 'invoices',
          details: { invoice_id: (pendingInv as { id: string }).id, action: 'approve' },
        });
      } catch {
        // ignore
      }

      return NextResponse.json({ success: true, message: 'Payment approved, account reactivated' });
    }

    if (action === 'reject') {
      const { data: pendingInv } = await supabaseAdmin
        .from('invoices')
        .select('id')
        .eq('center_id', centerId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingInv) {
        await supabaseAdmin
          .from('invoices')
          .update({ status: 'rejected', updated_at: new Date().toISOString() })
          .eq('id', (pendingInv as { id: string }).id);

        try {
          await supabaseAdmin.from('audit_log').insert({
            center_id: centerId,
            user_id: userId,
            action: 'admin_invoice_rejected',
            entity_type: 'invoices',
            details: { invoice_id: (pendingInv as { id: string }).id, action: 'reject' },
          });
        } catch {
          // ignore
        }
      }

      return NextResponse.json({ success: true, message: 'Payment rejected' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Payment approval error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
