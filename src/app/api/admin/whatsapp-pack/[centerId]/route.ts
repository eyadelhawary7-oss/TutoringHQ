import { requireSuperAdminApi } from '@/lib/admin-auth'
import { NextResponse } from 'next/server'
import { parseBodyWithLimit } from '@/lib/validate';

interface PatchBody {
  parent_pack_enabled?: unknown
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ centerId: string }> },
) {
  const auth = await requireSuperAdminApi(request)
  if (!auth.ok) {
    return auth.response
  }

  const { centerId } = await params
  let body: PatchBody
  try {
    body = (await parseBodyWithLimit(request, 65536)) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (typeof body.parent_pack_enabled !== 'boolean') {
    return NextResponse.json({ error: 'parent_pack_enabled required' }, { status: 400 })
  }

  const { error } = await auth.supabaseAdmin
    .from('centers')
    .update({ parent_pack_enabled: body.parent_pack_enabled })
    .eq('id', centerId)

  if (error) {
    console.error('[PATCH /api/admin/whatsapp-pack/[centerId]]', error)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
