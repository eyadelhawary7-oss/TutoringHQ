/**
 * chq_signup_session — signed, httpOnly, SameSite=Lax cookie set during
 * POST /api/signup (BEFORE redirecting to the Paymob iframe). Proves that the
 * browser hitting /set-pin is the same browser that initiated this specific
 * signup. The cookie alone is NEVER sufficient authority to set a PIN —
 * /api/auth/set-initial-pin AND-s it against webhook-confirmed paid state.
 *
 * Signed with HMAC-SHA256 using the existing CSRF_SECRET (re-used to avoid
 * env-var sprawl; the signature scope is distinct from CSRF token usage and
 * the secret rotation cadence is shared by design).
 *
 * Lazy-init per ADR 018 — module load does NOT touch process.env.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const SIGNUP_SESSION_COOKIE = 'chq_signup_session';
export const SIGNUP_SESSION_TTL_SECONDS = 30 * 60; // 30 minutes

type Payload = {
  centerId: string;
  expiresAt: number; // unix ms
};

function getSecret(): Buffer | null {
  const secret = process.env.CSRF_SECRET;
  if (!secret || secret.length !== 64 || !/^[0-9a-fA-F]+$/.test(secret)) {
    return null;
  }
  return Buffer.from(secret, 'hex');
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/**
 * Sign a payload. Returns null if CSRF_SECRET is missing or malformed — caller
 * should fail loudly (Sentry) rather than fall back to an unsigned cookie.
 */
export function signSignupSession(centerId: string): string | null {
  const key = getSecret();
  if (!key) return null;
  const payload: Payload = {
    centerId,
    expiresAt: Date.now() + SIGNUP_SESSION_TTL_SECONDS * 1000,
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = b64urlEncode(createHmac('sha256', key).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Verify a cookie value. Returns the payload on success, null on any failure
 * (bad signature, expired, malformed, secret unset). Constant-time signature
 * comparison via timingSafeEqual.
 */
export function verifySignupSession(value: string | undefined | null): Payload | null {
  if (!value || typeof value !== 'string') return null;
  const key = getSecret();
  if (!key) return null;

  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return null;

  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);

  const expectedSig = b64urlEncode(createHmac('sha256', key).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8')) as Payload;
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload.centerId !== 'string' ||
    !payload.centerId ||
    typeof payload.expiresAt !== 'number' ||
    payload.expiresAt <= Date.now()
  ) {
    return null;
  }
  return payload;
}

/** Cookie attributes for Set-Cookie. SameSite=Lax so Paymob iframe redirect carries it back. */
export const SIGNUP_SESSION_COOKIE_OPTIONS = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: true as const,
  path: '/',
  maxAge: SIGNUP_SESSION_TTL_SECONDS,
};
