import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncPackParentCount } from '@/lib/parent-pack'

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCenterUserContext(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const role = ctx.userRecord.role as string
    if (role !== 'owner' && role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: studentId } = await params
    const centerId = ctx.centerId

    const { opted_in } = (await request.json()) as { opted_in: boolean }

    const { data: student, error: studentError } = await ctx.supabaseAdmin
      .from('students')
      .select('id, center_id, is_active, parent_phone, parent_pack_opted_in')
      .eq('id', studentId)
      .single()

    if (studentError || !student) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    if (student.center_id !== centerId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    if (opted_in) {
      if (!student.is_active) {
        return NextResponse.json({ error: 'student_inactive' }, { status: 400 })
      }
      if (!student.parent_phone) {
        return NextResponse.json({ error: 'no_parent_phone' }, { status: 400 })
      }
    }

    const { error: updateError } = await ctx.supabaseAdmin
      .from('students')
      .update({ parent_pack_opted_in: opted_in })
      .eq('id', studentId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    const activeParents = await syncPackParentCount(ctx.supabaseAdmin, centerId)

    return NextResponse.json({
      student_id: studentId,
      opted_in: opted_in,
      active_parents: activeParents,
    })
  } catch (e) {
    console.error('[PATCH /api/parent-pack/student/[id]]', e)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
