import { describe, it, expect } from 'vitest';
import * as config from '@/lib/verification/config';
import * as state from '@/lib/verification/state';

/**
 * THE TERRITORY A ↔ TERRITORY B CONTRACT.
 *
 * Territory A (`claude/phase4-valify-config-and-client`) owns
 * `src/lib/verification/config.ts` and `src/lib/verification/state.ts`. At the
 * time Territory B was built that branch sat at origin/master with ZERO
 * commits, so Territory B authored both modules at the paths Territory A will
 * land at, and every UI surface imports them rather than re-deriving
 * verification locally.
 *
 * WHEN TERRITORY A LANDS ITS OWN VERSIONS: take Territory A's and delete
 * Territory B's, so that exactly ONE config point survives. This file is the
 * safety net for that swap. It pins the surface Territory B's UI depends on, so
 * a divergent Territory A implementation fails HERE, at type-check and at CI,
 * rather than at runtime on a user's screen.
 *
 * If a test in this file fails after a merge, the fix is to reconcile the two
 * modules — not to loosen the test.
 */
describe('verification module contract (Territory A owns these paths)', () => {
  it('exposes the four config env keys as the single config surface', () => {
    expect(config.VERIFICATION_CONFIG_ENV_KEYS).toEqual([
      'VALIFY_BASE_URL',
      'VALIFY_API_KEY',
      'VALIFY_FLOW_ID',
      'VALIFY_WEBHOOK_SECRET',
    ]);
  });

  it('exposes readVerificationConfig, requireVerificationConfig and the error type', () => {
    expect(typeof config.readVerificationConfig).toBe('function');
    expect(typeof config.requireVerificationConfig).toBe('function');
    expect(typeof config.isPlaceholderValue).toBe('function');
    expect(typeof config.VerificationNotConfiguredError).toBe('function');
  });

  it('readVerificationConfig returns a discriminated result keyed on `configured`', () => {
    const bad = config.readVerificationConfig({});
    expect(bad).toHaveProperty('configured', false);
    expect(bad).toHaveProperty('cause');
    expect(bad).toHaveProperty('missing');
    expect(bad).toHaveProperty('placeholder');
  });

  it('exposes exactly the six statuses the UI switches on', () => {
    // The UI has a branch for each. A seventh added without updating
    // `uiState.ts` would silently fall through to the `unverified` default,
    // which is the one wrong answer we can afford least.
    expect([...state.VERIFICATION_STATUSES].sort()).toEqual(
      ['expired', 'failed', 'pending', 'provider_error', 'unverified', 'verified'].sort(),
    );
  });

  it('exposes the three column names the reader selects', () => {
    // These must match the migration proposal
    // supabase/migrations/20260804140000_verification_state_columns.sql exactly.
    expect([...state.VERIFICATION_STATE_COLUMNS]).toEqual([
      'verification_status',
      'verified_at',
      'valify_transaction_id',
    ]);
  });

  it('exposes resolveVerificationState and isVerified', () => {
    expect(typeof state.resolveVerificationState).toBe('function');
    expect(typeof state.isVerified).toBe('function');
  });

  it('resolveVerificationState returns a result discriminated on `available`', () => {
    const result = state.resolveVerificationState({
      config: config.readVerificationConfig({}),
      stateSourceAvailable: false,
      row: null,
    });
    expect(result).toHaveProperty('available', false);
    expect(result).toHaveProperty('cause');
    expect(result).toHaveProperty('detail');
  });

  it('the three unavailable causes the UI maps to admin copy all round-trip', () => {
    // `uiState.adminVerificationView` indexes a Record keyed on these exact
    // strings; a renamed cause would produce `undefined` message keys.
    const causes = [
      'provider_not_configured',
      'provider_placeholder_credentials',
      'state_source_missing',
    ] as const;
    for (const cause of causes) {
      const s: state.VerificationState = { available: false, cause, detail: '' };
      expect(s.available).toBe(false);
    }
  });
});
