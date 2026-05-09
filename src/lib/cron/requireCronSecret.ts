import crypto from 'crypto';

/**
 * Vercel cron auth: compare Bearer token with timing-safe equality.
 * @returns Response with 401 empty body if unauthorized; null if OK.
 */
export function requireCronSecret(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(null, { status: 401 });
  }

  const raw =
    request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (raw.length !== expected.length) {
    return new Response(null, { status: 401 });
  }

  const a = Buffer.from(raw, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return new Response(null, { status: 401 });
  }

  return null;
}
