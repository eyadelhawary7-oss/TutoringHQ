import { describe, it, expect } from 'vitest';
import { isPlaceholderValue } from '@/lib/valifyConfig';
import type { ValifyUnconfiguredCause } from '@/lib/valifyGuardLogic';
import {
  resolveEffectiveState,
  VERIFICATION_STATES,
  VERIFICATION_OUTCOMES,
  type EffectiveVerification,
  type PersistedVerificationState,
  type VerificationOutcome,
} from '@/lib/verificationState';
import {
  verificationBadgeView,
  verificationOutcomeNoteKey,
  verifyCtaView,
  digitalCollectionView,
  adminVerificationView,
} from '@/lib/verification/uiState';
import enMessages from '../../messages/en.json';
import arMessages from '../../messages/ar.json';

/**
 * THE FAILURE PATH IS THE POINT OF THIS FILE.
 *
 * Valify does not exist as an integration. Online collection is not live. The
 * identity schema is not in the live database.
 *
 * Re-verified live against project lczmjpnbuhnsislcvzar on 4 August 2026, by the
 * consolidation agent, running each query rather than repeating a header:
 *
 *   • columns in `public` matching %verif%/%national%/%kyc%/%valify%  → 6
 *     (`backup_log.last_verified_at`, `enrollment_otps.verified_at`,
 *      `phone_verifications.verified_at`, `students.parent_phone_verified`,
 *      `students.phone_verified`, `teacher_signup_otps.verified_at`)
 *     — every one of them OTP or backup integrity. ZERO identity columns.
 *   • `public.centers`            → 128 columns
 *   • `public.teacher_profiles`   →  24 columns
 *   • base tables in `public`     → 142, including neither `verification_records`
 *     nor `verification_attempts`
 *
 * So the state every surface renders today is `unconfigured`, and what these
 * tests assert is that NOTHING claims success in it. A green checkmark backed by
 * no integration is the worst outcome this feature can produce; every test below
 * exists to make that outcome impossible to ship.
 *
 * SCOPE. The config point itself (`valifyConfig` + `valifyGuardLogic`) is tested
 * exhaustively in `tests/unit/valifyGuard.test.ts` and the state machine in
 * `tests/unit/verificationState.test.ts`. This file tests the VIEW layer — the
 * mapping every screen renders through — plus the one config fact the view layer
 * depends on: that the strict placeholder vocabulary is the one in effect.
 */

/** Every state a surface can be handed, unconfigured first because it is today's. */
const UNCONFIGURED_CAUSES = [
  'valify_not_configured',
  'verification_schema_not_applied',
] as const satisfies readonly ValifyUnconfiguredCause[];

function live(
  state: PersistedVerificationState,
  last_outcome: VerificationOutcome | null = null,
): EffectiveVerification {
  return resolveEffectiveState(
    { state, verified_at: state === 'verified' ? '2026-07-12T00:00:00Z' : null, legal_name: null, national_id: null, last_outcome },
    null,
  );
}

/** The exact state every live surface renders today. */
const unconfigured = resolveEffectiveState(null, 'valify_not_configured');

describe('the placeholder vocabulary the whole feature keys on', () => {
  it('is the strict one — there is only one isPlaceholderValue and it catches "test" and angle brackets', () => {
    // There were briefly two, with different vocabularies: one treated `test`
    // and any value containing `<` as a placeholder and the other did not, so
    // the same .env could be live to one module and dead to the other. The
    // permissive one is deleted. These two tokens are what distinguished them.
    expect(isPlaceholderValue('test')).toBe(true);
    expect(isPlaceholderValue('<your-url>')).toBe(true);
  });

  it('recognises the dialects that actually ship in .env.example', () => {
    for (const v of [
      'placeholder',
      'your-key-here',
      'PLACEHOLDER',
      ' TODO ',
      'https://example.com',
      '',
    ]) {
      expect(isPlaceholderValue(v), `${JSON.stringify(v)} should be a placeholder`).toBe(true);
    }
    expect(isPlaceholderValue('vk_live_abc123')).toBe(false);
    expect(isPlaceholderValue('https://verify.valifysolutions.com')).toBe(false);
  });
});

describe('no surface claims success while the config holds placeholders', () => {
  it('the badge says unavailable and is NOT hidden', () => {
    const view = verificationBadgeView(unconfigured);
    expect(view.tone).toBe('unavailable');
    expect(view.labelKey).toBe('badge.unavailable');
    // Hiding it would leave the old silent behaviour, which reads as "fine".
    expect(view.show).toBe(true);
  });

  it('the badge never reads verified in any unconfigured cause', () => {
    for (const cause of UNCONFIGURED_CAUSES) {
      const view = verificationBadgeView(resolveEffectiveState(null, cause));
      expect(view.labelKey).not.toBe('badge.verified');
      expect(view.tone).not.toBe('verified');
    }
  });

  it('THE CENTRAL ASSERTION: a stored "verified" row is refused while the guard is unhappy', () => {
    // With no live integration no webhook could have written that row, so it is
    // test data, a manual edit, or a migration default. Rendering it is the
    // green-checkmark-backed-by-nothing failure this whole phase exists to stop.
    const v = resolveEffectiveState(
      {
        state: 'verified',
        verified_at: '2026-07-12T00:00:00Z',
        legal_name: 'Someone',
        national_id: '12345678901234',
        last_outcome: 'passed',
      },
      'valify_not_configured',
    );
    expect(v.isVerified).toBe(false);
    expect(verificationBadgeView(v).labelKey).toBe('badge.unavailable');
    expect(digitalCollectionView(v).on).toBe(false);
    expect(verifyCtaView(v).alreadyVerified).toBe(false);
  });

  it('the Verify CTA is DISABLED with a readable reason, not hidden', () => {
    const view = verifyCtaView(unconfigured);
    expect(view.enabled).toBe(false);
    expect(view.reasonKey).toBe('cta.reason.unavailable');
    expect(view.alreadyVerified).toBe(false);
  });

  it('the CTA is enabled only from a retryable entry point on a live feature', () => {
    expect(verifyCtaView(live('unverified')).enabled).toBe(true);
    expect(verifyCtaView(live('rejected')).enabled).toBe(true);
    // The three "nothing happened" outcomes all land in unverified and are all
    // retryable — that is exactly why they do not need statuses of their own.
    expect(verifyCtaView(live('unverified', 'expired')).enabled).toBe(true);
    expect(verifyCtaView(live('unverified', 'provider_error')).enabled).toBe(true);
    expect(verifyCtaView(live('unverified', 'abandoned')).enabled).toBe(true);
    // A second redirect mid-flight costs another Valify charge.
    expect(verifyCtaView(live('pending')).enabled).toBe(false);
    expect(verifyCtaView(live('verified')).alreadyVerified).toBe(true);
  });

  it('every disabled CTA carries a reason key — a greyed control is never unexplained', () => {
    for (const state of ['unverified', 'pending', 'verified', 'rejected'] as const) {
      const view = verifyCtaView(live(state));
      if (!view.enabled && !view.alreadyVerified) expect(view.reasonKey, state).not.toBeNull();
    }
    expect(verifyCtaView(unconfigured).reasonKey).not.toBeNull();
  });

  it('digital collection is OFF with a reason, and is on for nothing but a real pass', () => {
    expect(digitalCollectionView(unconfigured)).toEqual({
      on: false,
      reasonKey: 'collection.reason.unavailable',
    });
    for (const state of ['unverified', 'pending', 'verified', 'rejected'] as const) {
      const view = digitalCollectionView(live(state));
      expect(view.on, state).toBe(state === 'verified');
      if (!view.on) expect(view.reasonKey, state).not.toBeNull();
    }
  });

  it('admin sees "not configured" with the NAMED cause and its filters gated', () => {
    const view = adminVerificationView(unconfigured);
    expect(view.labelKey).toBe('admin.status.notConfigured');
    expect(view.causeKey).toBe('admin.cause.valifyNotConfigured');
    expect(view.gated).toBe(true);
  });

  it('admin gets a different named cause per failure, so it is actionable', () => {
    expect(
      adminVerificationView(resolveEffectiveState(null, 'verification_schema_not_applied')).causeKey,
    ).toBe('admin.cause.verificationSchemaNotApplied');
    expect(adminVerificationView(resolveEffectiveState(null, 'valify_not_configured')).causeKey).toBe(
      'admin.cause.valifyNotConfigured',
    );
  });

  it('providers are NOT told which env var is missing — that is a deployment detail', () => {
    const providerCopy = [
      verifyCtaView(unconfigured).reasonKey,
      verificationBadgeView(unconfigured).labelKey,
      digitalCollectionView(unconfigured).reasonKey,
    ];
    for (const key of providerCopy) {
      expect(key).not.toBeNull();
      expect(key).not.toContain('admin.');
    }
  });
});

describe('six outcomes still readable through five states', () => {
  /**
   * The distinction B carried as three extra statuses (`failed`, `expired`,
   * `provider_error`) has to survive the collapse into A's five states, or the
   * consolidation lost information rather than deduplicating it. It survives in
   * `last_outcome`, and this is where a user can see it.
   */
  it('an expired link is a neutral badge with its own sentence, not a rejection', () => {
    const v = live('unverified', 'expired');
    expect(verificationBadgeView(v).tone).toBe('neutral');
    expect(verificationBadgeView(v).labelKey).toBe('badge.unverified');
    expect(verificationOutcomeNoteKey(v)).toBe('outcome.expired');
  });

  it('a provider error is distinguishable from a plain unverified and from a fail', () => {
    expect(verificationOutcomeNoteKey(live('unverified', 'provider_error'))).toBe(
      'outcome.providerError',
    );
    expect(verificationOutcomeNoteKey(live('unverified', null))).toBeNull();
    expect(verificationBadgeView(live('rejected', 'failed')).tone).toBe('attention');
  });

  it('every outcome that lands in unverified or rejected has a sentence, except a pass', () => {
    for (const outcome of VERIFICATION_OUTCOMES) {
      const note = verificationOutcomeNoteKey(live('unverified', outcome));
      if (outcome === 'passed') expect(note).toBeNull();
      else expect(note, outcome).not.toBeNull();
    }
  });

  it('a verified or pending provider is given no history to misread', () => {
    expect(verificationOutcomeNoteKey(live('verified', 'passed'))).toBeNull();
    expect(verificationOutcomeNoteKey(live('pending', 'abandoned'))).toBeNull();
  });
});

describe('every key these views emit exists in BOTH message files', () => {
  function lookup(messages: Record<string, unknown>, dotted: string): unknown {
    return dotted
      .split('.')
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], messages);
  }

  // Collect every key any view can produce, across every reachable state and
  // every reachable outcome. Nothing is hand-listed that a view can emit.
  const states: EffectiveVerification[] = [
    ...UNCONFIGURED_CAUSES.map((cause) => resolveEffectiveState(null, cause)),
    ...VERIFICATION_STATES.filter((s) => s !== 'unconfigured').flatMap((s) => [
      live(s as PersistedVerificationState),
      ...VERIFICATION_OUTCOMES.map((o) => live(s as PersistedVerificationState, o)),
    ]),
  ];

  const keys = new Set<string>([
    'cta.whatYoullNeed',
    'cta.verifyToSwitchOn',
    'collectForYou.title',
    'collectForYou.body',
    'collectForYou.subline',
    'settingsRow.title',
    'settingsRow.subtitleUnverified',
    'settingsRow.subtitleUnavailable',
    'settingsRow.subtitleOn',
    'admin.filterUnverifiedDisabled',
  ]);
  for (const state of states) {
    keys.add(verificationBadgeView(state).labelKey);
    const note = verificationOutcomeNoteKey(state);
    if (note) keys.add(note);
    const cta = verifyCtaView(state);
    keys.add(cta.labelKey);
    if (cta.reasonKey) keys.add(cta.reasonKey);
    const collection = digitalCollectionView(state);
    if (collection.reasonKey) keys.add(collection.reasonKey);
    const admin = adminVerificationView(state);
    keys.add(admin.labelKey);
    if (admin.causeKey) keys.add(admin.causeKey);
  }

  it.each([...keys])('verification.%s resolves in en and ar', (key) => {
    const en = lookup(enMessages as unknown as Record<string, unknown>, `verification.${key}`);
    const ar = lookup(arMessages as unknown as Record<string, unknown>, `verification.${key}`);
    expect(typeof en, `en missing verification.${key}`).toBe('string');
    expect(typeof ar, `ar missing verification.${key}`).toBe('string');
    expect((en as string).length).toBeGreaterThan(0);
    expect((ar as string).length).toBeGreaterThan(0);
  });

  it('the verification namespace is key-identical across en and ar', () => {
    const flatten = (obj: unknown, prefix = ''): string[] =>
      typeof obj === 'object' && obj !== null
        ? Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
        : [prefix];
    const en = flatten((enMessages as Record<string, unknown>).verification).sort();
    const ar = flatten((arMessages as Record<string, unknown>).verification).sort();
    expect(en).toEqual(ar);
    expect(en.length).toBeGreaterThan(0);
  });

  it('no message key is orphaned — every verification.* key some view emits is emitted', () => {
    // The reverse direction of the check above: catches a key left behind by a
    // deleted status (`badge.failed`, `badge.expired`, `badge.providerError`
    // and `cta.reason.providerError` all went when B's six statuses did).
    const flatten = (obj: unknown, prefix = ''): string[] =>
      typeof obj === 'object' && obj !== null
        ? Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
        : [prefix];
    const declared = flatten((enMessages as Record<string, unknown>).verification);
    const orphans = declared.filter((k) => !keys.has(k));
    expect(orphans, `unused verification keys: ${orphans.join(', ')}`).toEqual([]);
  });
});
