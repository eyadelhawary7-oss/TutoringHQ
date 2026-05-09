import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import type { PatchStudentBody } from '@/types/whatsapp-pack'
import { parseBodyWithLimit } from '@/lib/validate';

async function getCenterOwnerAdminContext(request: NextRequest) {
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

  const role = String(userRecord.role ?? '').toLowerCase()
  if (role !== 'owner' && role !== 'admin') {
    return { forbidden: true as const }
  }

  return {
    centerId: userRecord.center_id as string,
    supabaseAdmin,
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  try {
    const ctx = await getCenterOwnerAdminContext(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('forbidden' in ctx) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { centerId, supabaseAdmin } = ctx
    const { studentId } = await params

    const { data: studentRow, error: studentLookupError } = await supabaseAdmin
      .from('students')
      .select('center_id')
      .eq('id', studentId)
      .single()

    if (studentLookupError || !studentRow || studentRow.center_id !== centerId) {
      return new Response(null, { status: 404 })
    }

    const body = (await parseBodyWithLimit(request, 65536)) as PatchStudentBody
    const updateFields: Partial<PatchStudentBody> = {}
    if (body.parent_pack_opted_in !== undefined) {
      updateFields.parent_pack_opted_in = body.parent_pack_opted_in
    }
    if (body.notify_on_scan !== undefined) {
      updateFields.notify_on_scan = body.notify_on_scan
    }
    if (body.notify_on_absence !== undefined) {
      updateFields.notify_on_absence = body.notify_on_absence
    }
    if (body.notify_on_balance !== undefined) {
      updateFields.notify_on_balance = body.notify_on_balance
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
    }

    const { error: updateError } = await supabaseAdmin
      .from('students')
      .update(updateFields)
      .eq('id', studentId)
      .eq('center_id', centerId)

    if (updateError) {
      console.error('[PATCH /api/whatsapp-pack/student/[studentId]]', updateError)
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    const { count, error: countError } = await supabaseAdmin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('center_id', centerId)
      .eq('parent_pack_opted_in', true)
      .eq('is_active', true)
      .not('parent_phone', 'is', null)

    if (countError) {
      console.error('[PATCH /api/whatsapp-pack/student/[studentId]] count', countError)
      return NextResponse.json({ error: 'Count failed' }, { status: 500 })
    }

    const activeCount = count ?? 0

    const { error: centerUpdateError } = await supabaseAdmin
      .from('centers')
      .update({ parent_pack_active_parents: activeCount })
      .eq('id', centerId)

    if (centerUpdateError) {
      console.error('[PATCH /api/whatsapp-pack/student/[studentId]] center', centerUpdateError)
      return NextResponse.json({ error: 'Center update failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, activeCount })
  } catch (e) {
    console.error('[PATCH /api/whatsapp-pack/student/[studentId]]', e)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
