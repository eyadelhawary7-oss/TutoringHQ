import crypto from 'crypto';

/** Hex strings (e.g. HMAC digest). Lowercases inputs for stable comparison when hex is case-insensitive. */
export function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(String(aHex).trim().toLowerCase(), 'hex');
    const b = Buffer.from(String(bHex).trim().toLowerCase(), 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function timingSafeEqualUtf8(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function hmacSha512Hex(secret: string, payload: string): string {
  return crypto.createHmac('sha512', secret).update(payload, 'utf8').digest('hex');
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}
