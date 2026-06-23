import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendChqPackInvoiceTemplate } from '@/lib/centerNotify'
import { syncPackParentCount } from '@/lib/parent-pack'
import { dateInNDays } from '@/lib/parentPack'
import {
  billingPeriodArabicMonthYear,
  cairoYmdParts,
  computeRollingParentCount,
  daysInCairoMonth,
  getPackPlanMinimumEgp,
} from '@/lib/packBilling'
import { parseBodyWithLimit } from '@/lib/validate';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { applyProcessingFee } from '@/lib/processingFee';

// TODO: set to true when chq_pack_invoice is approved by Meta
const packInvoiceEnabled = true

function centerCodeForPack(c: { center_code?: string | null; referral_code?: string | null; id: string }): string {
  const raw = (c.center_code || c.referral_code || '').trim()
  if (raw) return raw.replace(/\s+/g, '')
  return 'UNK'
}

async function getCenterUserContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null

  const authHeader = request.headers.get('Authorization')
  const accessToken = authHeader?.replace('Bearer ', '')
  if (!accessToken) return null

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })

  const { data: { user }, error } = await supabaseAuth.auth.getUser()
  if (error || !user) return null

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, role')
    .eq('id', user.id)
    .single()

  if (!userRecord?.center_id) return null

  return { userRecord, supabaseAdmin, centerId: userRecord.center_id as string }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getCenterUserContext(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const role = ctx.userRecord.role as string
    if (role !== 'owner' && role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await parseBodyWithLimit(request, 65536)) as { enabled: boolean; confirmed?: boolean }

    const { data: centerRow, error: centerErr } = await ctx.supabaseAdmin
      .from('centers')
      .select(
        `id, status, plan, name, phone, center_code, referral_code,
        parent_pack_enabled, parent_pack_active_parents,
        pack_disabled_at, pack_price_per_parent, pack_custom_invoice_minimum, pack_pending_balance`,
      )
      .eq('id', ctx.centerId)
      .single()

    if (centerErr || !centerRow) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 })
    }

    const plan = String(centerRow.plan ?? '')
    const pricePer = Number((centerRow as { pack_price_per_parent?: number }).pack_price_per_parent ?? 12)
    const customMin = (centerRow as { pack_custom_invoice_minimum?: number | null }).pack_custom_invoice_minimum
    const packDisabledAt = (centerRow as { pack_disabled_at?: string | null }).pack_disabled_at

    if (body.enabled && centerRow.status !== 'active') {
      return NextResponse.json({ error: 'center_not_active' }, { status: 400 })
    }

    if (body.enabled && packDisabledAt) {
      const { data: unpaid } = await ctx.supabaseAdmin
        .from('invoices')
        .select('id')
        .eq('center_id', ctx.centerId)
        .eq('invoice_type', 'pack_billing')
        .in('status', ['pending', 'overdue'])
        .limit(1)
        .maybeSingle()

      if (unpaid) {
        return NextResponse.json({ error: 'pack_invoice_unpaid' }, { status: 400 })
      }
    }

    if (!body.enabled) {
      const { y, m, d, ym } = cairoYmdParts()
      const daysInMonth = daysInCairoMonth(y, m)
      const rolling = await computeRollingParentCount(ctx.supabaseAdmin, ctx.centerId, ym)
      const planMin = getPackPlanMinimumEgp(plan, customMin)
      const proratedBase = Math.max((d / daysInMonth) * rolling * pricePer, planMin)
      const pending = Number((centerRow as { pack_pending_balance?: number }).pack_pending_balance ?? 0)
      const proratedTotal = Math.ceil(proratedBase) + (pending > 0 ? pending : 0)

      // Flat processing fee (Section 5) added to the prorated pack invoice.
      const feeCfg = await getProcessingFeeConfig()
      const { fee: processingFee, total: chargedTotal } = applyProcessingFee(proratedTotal, feeCfg)

      if (body.confirmed !== true) {
        return NextResponse.json({
          requires_confirmation: true,
          prorated_amount: chargedTotal,
        })
      }

      const code = centerCodeForPack(centerRow as { center_code?: string; referral_code?: string; id: string })
      const invoiceNumber = `PACK-${code}-${y}-${String(m).padStart(2, '0')}-PARTIAL`
      const periodStart = `${ym}-01`
      const periodEnd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

      const { error: invErr } = await ctx.supabaseAdmin.from('invoices').insert({
        center_id: ctx.centerId,
        invoice_number: invoiceNumber,
        invoice_type: 'pack_billing',
        base_amount: proratedTotal,
        total_amount: chargedTotal,
        billing_period_start: periodStart,
        billing_period_end: periodEnd,
        due_date: dateInNDays(7),
        status: 'pending',
        payment_reference: `Parent Pack, partial ${ym} (through ${periodEnd})`,
        metadata: { processing_fee: processingFee },
      })

      if (invErr) {
        console.error('[PATCH /api/parent-pack/toggle] partial invoice', invErr)
        return NextResponse.json({ error: invErr.message }, { status: 500 })
      }

      const { error: updateErr } = await ctx.supabaseAdmin
        .from('centers')
        .update({
          parent_pack_enabled: false,
          parent_pack_active_parents: 0,
          pack_disabled_at: new Date().toISOString(),
          pack_pending_balance: 0,
        })
        .eq('id', ctx.centerId)

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 })
      }

      try {
        await sendChqPackInvoiceTemplate(ctx.supabaseAdmin, packInvoiceEnabled, {
          name: (centerRow as { name?: string }).name ?? ',',
          phone: (centerRow as { phone?: string | null }).phone ?? null,
          monthArabic: billingPeriodArabicMonthYear(ym),
          parentCountStr: String(rolling),
          amountStr: String(chargedTotal),
        })
      } catch (waErr) {
        console.error('[parent-pack/toggle] WA send error:', waErr)
      }

      return NextResponse.json({
        pack_enabled: false,
        active_parents: 0,
        prorated_amount: proratedTotal,
      })
    }

    const updateData = { parent_pack_enabled: true }

    const { error: updateErr } = await ctx.supabaseAdmin
      .from('centers')
      .update(updateData)
      .eq('id', ctx.centerId)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    const activeCount = await syncPackParentCount(ctx.supabaseAdmin, ctx.centerId)

    return NextResponse.json({
      pack_enabled: true,
      active_parents: activeCount,
    })
  } catch (e) {
    console.error('[PATCH /api/parent-pack/toggle]', e)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
