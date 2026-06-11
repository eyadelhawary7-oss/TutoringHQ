import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getClientIp, rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';

/**
 * PUBLIC PDPL (Law 151/2020) data-rights request intake. No auth - the data
 * subject may not have an account. There is no dedicated table for these yet,
 * so each request is surfaced to ops via Sentry (a tagged info-level message)
 * which routes to the on-call alert channel; this guarantees delivery without
 * a schema change. Rate-limited per IP to prevent abuse of the public form.
 */
const VALID_TYPES = new Set([
  'access',
  'correction',
  'deletion',
  'portability',
  'objection',
]);

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const { success } = await rateLimit(`privacy-request:${ip}`, 5, 3600);
  if (!success) {
    return rateLimitExceededResponse(3600);
  }

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 16384)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request', code: 'INVALID_BODY' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
  const requestType = typeof body.requestType === 'string' ? body.requestType : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (name.length < 2 || !contact || !VALID_TYPES.has(requestType)) {
    return NextResponse.json({ error: 'Invalid request', code: 'INVALID_FIELDS' }, { status: 400 });
  }

  Sentry.captureMessage('PDPL data-rights request submitted', {
    level: 'info',
    tags: { route: 'api/privacy-request', request_type: requestType },
    extra: {
      name,
      contact,
      requestType,
      message: message.slice(0, 2000),
    },
  });

  return NextResponse.json({ success: true });
}
