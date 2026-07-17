import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const algorithm = 'aes-256-cbc';

function getKey(): Buffer {
  const secret = process.env.CSRF_SECRET;
  if (!secret || secret.length !== 64 || !/^[0-9a-fA-F]+$/.test(secret)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CSRF_SECRET must be set to a 64-character hex string (32 bytes)');
    }
    console.warn('[csrf] CSRF_SECRET not set - using dev fallback. Set in production!');
    return randomBytes(32);
  }
  return Buffer.from(secret, 'hex');
}

let key: Buffer;
try {
  key = getKey();
} catch {
  key = randomBytes(32);
}

export function generateCSRFToken(sessionId: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(sessionId, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function validateCSRFToken(token: string, sessionId: string): boolean {
  try {
    const [ivHex, encryptedHex] = token.split(':');
    if (!ivHex || !encryptedHex) return false;
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = createDecipheriv(algorithm, key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8') === sessionId;
  } catch {
    return false;
  }
}

/**
 * True only when a well-formed 64-char hex `CSRF_SECRET` is configured. When it
 * returns false, CSRF cannot be enforced and `validateCSRFRequest` fails CLOSED,
 * rejecting the request with 403 in every environment rather than letting it
 * through. (The stale prior comment claimed validation "passes" when the secret
 * is unset; that is the opposite of the actual behaviour, as proven in PR #161.)
 */
export function isCSRFEnabled(): boolean {
  const secret = process.env.CSRF_SECRET;
  return !!secret && secret.length === 64 && /^[0-9a-fA-F]+$/.test(secret);
}

/**
 * Validate CSRF from request headers. Returns true only if a valid token is
 * presented.
 *
 * Fail CLOSED: when CSRF cannot be enforced because `CSRF_SECRET` is missing or
 * malformed, we REJECT (return false) in every environment rather than wave the
 * request through. A state-changing request we cannot verify is never accepted
 * — the same fail-closed rule the Paymob/WhatsApp/Bosta webhooks already apply.
 * `CSRF_SECRET` must therefore be set in every environment (it is required in
 * production per docs/CSRF_SETUP.md; set it locally too — see .env.example).
 */
export function validateCSRFRequest(request: Request, userId: string): boolean {
  if (!isCSRFEnabled()) return false;
  const csrfToken = request.headers.get('X-CSRF-Token');
  const sessionId = request.headers.get('X-Session-ID');
  if (!csrfToken || !sessionId) return false;
  if (sessionId !== userId) return false;
  return validateCSRFToken(csrfToken, sessionId);
}
