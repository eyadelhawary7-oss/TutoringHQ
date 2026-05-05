import { requireSuperAdminApi } from '@/lib/admin-auth';
import { createLead, getLeads } from '@/lib/ceo';
import type { CreateLeadInput } from '@/types/ceo';
import { NextRequest, NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage') ?? undefined;
    const leads = await getLeads(auth.supabaseAdmin, stage);
    return NextResponse.json({ leads });
  } catch (e) {
    console.error('[GET /api/ceo/leads]', e);
    return NextResponse.json({ error: 'Failed to load leads' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await parseBodyWithLimit(request, 65536)) as CreateLeadInput;
    if (!body.name || !body.phone) {
      return NextResponse.json({ error: 'name and phone required' }, { status: 400 });
    }
    const lead = await createLead(auth.supabaseAdmin, body);
    return NextResponse.json({ lead }, { status: 201 });
  } catch (e) {
    console.error('[POST /api/ceo/leads]', e);
    return NextResponse.json({ error: 'Failed to create lead' }, { status: 500 });
  }
}
