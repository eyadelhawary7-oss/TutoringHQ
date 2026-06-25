import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';
import {
  listUnresolvedDeadLetters,
  countUnresolvedDeadLetters,
  retryDeadLetterEntry,
} from '@/lib/deadLetterQueue';

export const dynamic = 'force-dynamic';

/** List unresolved dead-letter entries (self-serve visibility). */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;
  const row403 = await requireSuperAdminRow(auth.supabaseAdmin, auth.userId);
  if (row403) return row403;

  const { entries, error } = await listUnresolvedDeadLetters(auth.supabaseAdmin);
  if (error) {
    console.error('[admin/dead-letter] list', error);
    return NextResponse.json({ error }, { status: 500 });
  }
  return NextResponse.json({ entries, count: entries.length });
}

/** Safely retry (re-enqueue) a dead-letter entry. Idempotent. */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;
  const row403 = await requireSuperAdminRow(auth.supabaseAdmin, auth.userId);
  if (row403) return row403;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const body = (await parseBodyWithLimit(request, 8192)) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const result = await retryDeadLetterEntry(auth.supabaseAdmin, id);
  if (!result.ok) {
    console.error('[admin/dead-letter] retry', result.error);
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const remaining = await countUnresolvedDeadLetters(auth.supabaseAdmin);
  return NextResponse.json({ success: true, status: result.status, remaining });
}
