/**
 * The verification state machine.
 *
 * Two properties matter more than the rest and are tested hardest:
 *   1. `unconfigured` outranks a stored `verified`. There is no input that
 *      returns isVerified true while the guard is unhappy.
 *   2. Only the provider webhook can reach `verified`. Not the user, not the
 *      redirect return, not an admin.
 */

import { describe, it, expect } from 'vitest';
import {
  PERSISTED_VERIFICATION_STATES,
  TRANSITIONS,
  VERIFICATION_OUTCOMES,
  canTransition,
  capabilitiesFor,
  isPersistedVerificationState,
  resolveEffectiveState,
  stateForOutcome,
  type PersistedVerificationState,
  type VerificationActor,
  type VerificationRecord,
} from '@/lib/verificationState';

const ACTORS: VerificationActor[] = ['user', 'provider', 'admin', 'system'];

const VERIFIED_RECORD: VerificationRecord = {
  state: 'verified',
  verified_at: '2026-07-12T09:00:00.000Z',
  legal_name: 'Dina Fouad',
  national_id: '29805150102345',
  last_outcome: 'passed',
};

describe('unconfigured is a first-class state and it outranks everything', () => {
  it('a stored VERIFIED record resolves to unconfigured when Valify is not configured', () => {
    // The single most important assertion in this feature. A row can say
    // verified; if the provider integration does not exist, the badge does not
    // render and nothing is unlocked.
    const effective = resolveEffectiveState(VERIFIED_RECORD, 'valify_not_configured');

    expect(effective.state).toBe('unconfigured');
    expect(effective.isVerified).toBe(false);
    expect(effective.cause).toBe('valify_not_configured');
    expect(effective.verified_at).toBeNull();
    expect(effective.canStartVerification).toBe(false);
  });

  it('the same holds when the schema has not been applied', () => {
    const effective = resolveEffectiveState(VERIFIED_RECORD, 'verification_schema_not_applied');
    expect(effective.state).toBe('unconfigured');
    expect(effective.isVerified).toBe(false);
  });

  it('NO record + NO guard cause yields isVerified true — exhaustively', () => {
    // Sweep every persisted state against both guard causes. None may verify.
    for (const state of PERSISTED_VERIFICATION_STATES) {
      for (const cause of ['valify_not_configured', 'verification_schema_not_applied'] as const) {
        const record: VerificationRecord = { ...VERIFIED_RECORD, state };
        expect(resolveEffectiveState(record, cause).isVerified).toBe(false);
      }
    }
    expect(resolveEffectiveState(null, 'valify_not_configured').isVerified).toBe(false);
  });

  it('unconfigured unlocks strictly nothing', () => {
    const caps = capabilitiesFor('unconfigured');
    expect(caps).toEqual({
      onlineCollection: false,
      withdrawals: false,
      automatedFeeCollection: false,
    });
  });

  it('is DISTINCT from unverified: unverified invites a retry, unconfigured does not', () => {
    const unconfigured = resolveEffectiveState(null, 'valify_not_configured');
    const unverified = resolveEffectiveState(null, null);

    expect(unconfigured.state).toBe('unconfigured');
    expect(unconfigured.canStartVerification).toBe(false);

    expect(unverified.state).toBe('unverified');
    expect(unverified.canStartVerification).toBe(true);
  });
});

describe('resolveEffectiveState with the guard happy', () => {
  it('a missing row reads as unverified, not as an error', () => {
    const effective = resolveEffectiveState(null, null);
    expect(effective.state).toBe('unverified');
    expect(effective.isVerified).toBe(false);
    expect(effective.cause).toBeNull();
  });

  it('verified resolves to verified and carries the date', () => {
    const effective = resolveEffectiveState(VERIFIED_RECORD, null);
    expect(effective.state).toBe('verified');
    expect(effective.isVerified).toBe(true);
    expect(effective.verified_at).toBe('2026-07-12T09:00:00.000Z');
    expect(effective.canStartVerification).toBe(false);
  });

  it('pending is not verified and cannot start again', () => {
    const effective = resolveEffectiveState(
      { state: 'pending', verified_at: null, legal_name: null, national_id: null, last_outcome: null },
      null,
    );
    expect(effective.isVerified).toBe(false);
    expect(effective.canStartVerification).toBe(false);
  });

  it('rejected can retry', () => {
    const effective = resolveEffectiveState(
      {
        state: 'rejected',
        verified_at: null,
        legal_name: null,
        national_id: null,
        last_outcome: 'failed',
      },
      null,
    );
    expect(effective.isVerified).toBe(false);
    expect(effective.canStartVerification).toBe(true);
    expect(effective.last_outcome).toBe('failed');
  });

  it('never leaks a stale verified_at on a non-verified state', () => {
    const effective = resolveEffectiveState({ ...VERIFIED_RECORD, state: 'rejected' }, null);
    expect(effective.verified_at).toBeNull();
  });
});

describe('only the provider webhook can reach verified', () => {
  it('refuses every non-provider actor with the security-specific code', () => {
    for (const actor of ACTORS.filter((a) => a !== 'provider')) {
      for (const from of PERSISTED_VERIFICATION_STATES.filter((s) => s !== 'verified')) {
        const decision = canTransition(from as PersistedVerificationState, 'verified', actor);
        expect(decision.allowed).toBe(false);
        expect(decision.code).toBe('verified_requires_provider_webhook');
      }
    }
  });

  it('the redirect return (a user) cannot verify — this is VERIFICATION-SPEC §2', () => {
    // "if verified state is settable from whatever comes back on the redirect,
    // hitting the success URL makes you verified."
    expect(canTransition('pending', 'verified', 'user').allowed).toBe(false);
  });

  it('an admin cannot verify either — no manual approval route exists', () => {
    expect(canTransition('pending', 'verified', 'admin').allowed).toBe(false);
    expect(canTransition('rejected', 'verified', 'admin').allowed).toBe(false);
  });

  it('the provider CAN, but only from pending', () => {
    expect(canTransition('pending', 'verified', 'provider').allowed).toBe(true);
    expect(canTransition('unverified', 'verified', 'provider').allowed).toBe(false);
  });

  it('the transition table itself contains exactly one edge into verified', () => {
    const into = TRANSITIONS.filter((t) => t.to === 'verified');
    expect(into).toHaveLength(1);
    expect(into[0].by).toBe('provider');
    expect(into[0].from).toBe('pending');
  });
});

describe('the rest of the transition table', () => {
  it('a user starts a check from unverified or rejected', () => {
    expect(canTransition('unverified', 'pending', 'user').allowed).toBe(true);
    expect(canTransition('rejected', 'pending', 'user').allowed).toBe(true);
  });

  it('an admin may revoke a verification, re-locking payouts', () => {
    expect(canTransition('verified', 'unverified', 'admin').allowed).toBe(true);
  });

  it('names the permitted actor when the edge exists but the actor is wrong', () => {
    const decision = canTransition('verified', 'unverified', 'user');
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('actor_not_permitted');
    expect(decision.message).toContain('admin');
  });

  it('refuses a no-op with its own code rather than pretending it happened', () => {
    const decision = canTransition('verified', 'verified', 'provider');
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('already_in_state');
  });

  it('refuses an edge that exists for nobody', () => {
    expect(canTransition('unverified', 'rejected', 'provider').code).toBe('no_such_transition');
  });

  it('every refusal carries a code that is not "ok"', () => {
    for (const from of PERSISTED_VERIFICATION_STATES) {
      for (const to of PERSISTED_VERIFICATION_STATES) {
        for (const actor of ACTORS) {
          const d = canTransition(from, to, actor);
          if (d.allowed) expect(d.code).toBe('ok');
          else expect(d.code).not.toBe('ok');
          expect(d.message.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('outcome → state mapping (VERIFICATION-SPEC §9.1, six outcomes onto five states)', () => {
  it('maps each of the six return states as documented', () => {
    expect(stateForOutcome('passed')).toBe('verified');
    expect(stateForOutcome('failed')).toBe('rejected');
    // The three "nothing happened" outcomes land back at the start, and are
    // told apart by last_outcome rather than by three near-identical states.
    expect(stateForOutcome('abandoned')).toBe('unverified');
    expect(stateForOutcome('expired')).toBe('unverified');
    expect(stateForOutcome('provider_error')).toBe('unverified');
  });

  it('is total over the outcome union and never yields unconfigured', () => {
    for (const outcome of VERIFICATION_OUTCOMES) {
      const state = stateForOutcome(outcome);
      expect(isPersistedVerificationState(state)).toBe(true);
      expect(state).not.toBe('unconfigured');
    }
  });

  it('only "passed" produces verified', () => {
    const verifying = VERIFICATION_OUTCOMES.filter((o) => stateForOutcome(o) === 'verified');
    expect(verifying).toEqual(['passed']);
  });
});

describe('capabilities', () => {
  it('only verified unlocks anything', () => {
    for (const state of ['unconfigured', 'unverified', 'pending', 'rejected'] as const) {
      const caps = capabilitiesFor(state);
      expect(Object.values(caps).every((v) => v === false)).toBe(true);
    }
    expect(capabilitiesFor('verified')).toEqual({
      onlineCollection: true,
      withdrawals: true,
      automatedFeeCollection: true,
    });
  });
});

describe('isPersistedVerificationState', () => {
  it('rejects unconfigured — it is computed, never stored', () => {
    expect(isPersistedVerificationState('unconfigured')).toBe(false);
  });

  it('rejects junk rather than coercing it', () => {
    for (const v of [null, undefined, '', 'VERIFIED', 'yes', 1, {}]) {
      expect(isPersistedVerificationState(v)).toBe(false);
    }
  });
});
