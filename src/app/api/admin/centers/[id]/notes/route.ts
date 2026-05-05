import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { data, error } = await ctx.supabaseAdmin
    .from('center_notes')
    .select(
      `
      id, body, is_pinned, created_at, updated_at,
      author:admin_users!center_notes_author_id_fkey(id, name)
    `,
    )
    .eq('center_id', id)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ errorKey: 'centerNotes.errors.csrf' }, { status: 403 });
  }

  const { id } = await params;
  let body: { body?: string; is_pinned?: boolean };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as { body?: string; is_pinned?: boolean };
  } catch {
    return NextResponse.json({ errorKey: 'centerNotes.errors.invalidJson' }, { status: 400 });
  }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) {
    return NextResponse.json({ errorKey: 'centerNotes.errors.bodyRequired' }, { status: 400 });
  }

  const { data: adminRow } = await ctx.supabaseAdmin.from('admin_users').select('id').eq('id', ctx.userId).maybeSingle();
  if (!adminRow) {
    return NextResponse.json({ errorKey: 'centerNotes.errors.authorNotRegistered' }, { status: 403 });
  }

  const { data, error } = await ctx.supabaseAdmin
    .from('center_notes')
    .insert({
      center_id: id,
      author_id: ctx.userId,
      body: text,
      is_pinned: body.is_pinned ?? false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ errorKey: 'centerNotes.errors.csrf' }, { status: 403 });
  }

  const { id } = await params;
  let payload: { note_id?: string; body?: string; is_pinned?: boolean };
  try {
    payload = (await parseBodyWithLimit(request, 65536)) as { note_id?: string; body?: string; is_pinned?: boolean };
  } catch {
    return NextResponse.json({ errorKey: 'centerNotes.errors.invalidJson' }, { status: 400 });
  }

  if (!payload.note_id) {
    return NextResponse.json({ errorKey: 'centerNotes.errors.noteIdRequired' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (payload.body !== undefined) {
    const trimmed = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!trimmed) {
      return NextResponse.json({ errorKey: 'centerNotes.errors.bodyRequired' }, { status: 400 });
    }
    updates.body = trimmed;
  }
  if (payload.is_pinned !== undefined) updates.is_pinned = payload.is_pinned;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ errorKey: 'centerNotes.errors.noChanges' }, { status: 400 });
  }

  const { data, error } = await ctx.supabaseAdmin
    .from('center_notes')
    .update(updates)
    .eq('id', payload.note_id)
    .eq('center_id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.internalRole !== 'super_admin') {
    return NextResponse.json({ errorKey: 'centerNotes.errors.superAdminOnly' }, { status: 403 });
  }
  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ errorKey: 'centerNotes.errors.csrf' }, { status: 403 });
  }

  const { id } = await params;
  let payload: { note_id?: string };
  try {
    payload = (await parseBodyWithLimit(request, 65536)) as { note_id?: string };
  } catch {
    return NextResponse.json({ errorKey: 'centerNotes.errors.invalidJson' }, { status: 400 });
  }

  if (!payload.note_id) {
    return NextResponse.json({ errorKey: 'centerNotes.errors.noteIdRequired' }, { status: 400 });
  }

  const { error } = await ctx.supabaseAdmin
    .from('center_notes')
    .delete()
    .eq('id', payload.note_id)
    .eq('center_id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
