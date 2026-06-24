/**
 * Saved-Card Engine — consent capture endpoint (Phase 1, requirement 1c).
 *
 * Records a center owner's EXPLICIT consent to (a) store their card and (b)
 * auto-charge it on future billing dates, BEFORE any card is stored for
 * recurring use. The stored text is the server-canonical text for the locale +
 * version (never client-supplied), snapshotted into saved_card_consents.
 *
 * Owner-only, CSRF-protected mutation. Teacher consent capture (owner_type
 * 'teacher') reuses the same engine via a sibling route in a later slice.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCenterAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { recordConsent, CONSENT_VERSION, getConsentText } from '@/lib/savedCard/consent';
import { createSupabaseSavedCardStore } from '@/lib/savedCard/store';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  locale: z.enum(['ar', 'en']),
  agreedToStore: z.boolean(),
  agreedToAutoCharge: z.boolean(),
});

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // A card may only be stored for recurring use when BOTH are agreed.
  if (!parsed.data.agreedToStore || !parsed.data.agreedToAutoCharge) {
    return NextResponse.json(
      { error: 'Both store and auto-charge consent are required' },
      { status: 400 },
    );
  }

  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null;
  const userAgent = request.headers.get('user-agent');

  const store = createSupabaseSavedCardStore(auth.supabaseAdmin);
  const consent = await recordConsent(store, {
    owner: { ownerType: 'center', ownerId: auth.centerId },
    locale: parsed.data.locale,
    agreedToStore: parsed.data.agreedToStore,
    agreedToAutoCharge: parsed.data.agreedToAutoCharge,
    userId: auth.userId,
    ipAddress,
    userAgent,
  });

  return NextResponse.json({
    ok: true,
    consentId: consent.id,
    consentVersion: CONSENT_VERSION,
    consentText: getConsentText(parsed.data.locale),
  });
}
