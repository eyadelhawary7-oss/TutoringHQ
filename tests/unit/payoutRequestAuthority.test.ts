/**
 * PAYOUT-SYSTEM-SPEC.md §2.7 — payout-initiation authorization symmetry.
 *
 * The two routes that move money out of a centre enforced two different rules:
 *   POST /api/billing/withdrawal  → owner-only (`auth.role !== 'owner'` → 403)
 *   POST /api/referrals/payout    → a delegable staff permission, evaluated by
 *                                   `requirePermission`, which also passed on
 *                                   `auth.isSuperAdmin` alone.
 *
 * Decision 1 (unify the pipelines) is Eyad's and is still open, so nothing is
 * unified here. These tests pin the two things that need no decision:
 *   (a) the weaker route is no weaker than the stronger one, and
 *   (b) `can_request_referral_payouts` is REQUEST-ONLY and can never authorise
 *       the approval/release side.
 *
 * Live catalog, verified 2026-08-04 (Supabase lczmjpnbuhnsislcvzar):
 *   - `public.users.can_request_referral_payouts` boolean NOT NULL DEFAULT false
 *   - true on exactly 1 of 4 `public.users` rows; that row's role is **owner**
 *     (center "Test Center 333", is_test = true), so it passes on the owner arm
 *     with or without this change.
 *   - 0 rows with role 'admin' or 'assistant' exist at all.
 *   - `users_center_check`: owner/admin/assistant ⇒ center_id NOT NULL;
 *     super_admin/teacher ⇒ center_id NULL.
 *   - No function in `pg_proc` references the permission — application code is
 *     the entire enforcement surface.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  assertNotReleaseAuthority,
  hasMoneyRequestAuthority,
  hasPermission,
  isRequestOnlyMoneyPermission,
  requireMoneyRequestPermission,
  requirePermission,
  REQUEST_ONLY_MONEY_PERMISSIONS,
} from '@/lib/centerPermissions';
import type { CenterAuthContext, CenterPermissions } from '@/lib/centerAuth';
import type { SupabaseClient } from '@supabase/supabase-js';

const ROOT = process.cwd();

const allFalsePermissions: CenterPermissions = {
  can_record_payments: false,
  can_view_payments: false,
  can_manage_billing: false,
  can_edit_center_profile: false,
  can_delete_students: false,
  can_manage_academic_calendar: false,
  can_place_card_orders: false,
  can_request_referral_payouts: false,
};

function makeAuth(
  role: string,
  overrides: Partial<CenterPermissions> = {},
  isSuperAdmin = false,
): CenterAuthContext {
  return {
    ok: true,
    userId: 'user-1',
    centerId: 'center-1',
    role,
    isSuperAdmin,
    permissions: { ...allFalsePermissions, ...overrides },
    supabaseAdmin: {} as SupabaseClient,
  };
}

/** The rule `POST /api/billing/withdrawal` enforces today, as a predicate. */
function withdrawalRouteWouldAllow(auth: CenterAuthContext): boolean {
  return auth.role === 'owner';
}

describe('§2.7 — the referral payout gate is owner OR an explicit delegation', () => {
  it('allows the owner (the arm the withdrawal route also allows)', () => {
    const auth = makeAuth('owner');
    expect(hasMoneyRequestAuthority(auth, 'can_request_referral_payouts')).toBe(true);
    expect(requireMoneyRequestPermission(auth, 'can_request_referral_payouts')).toBeNull();
  });

  it('preserves the one live holder: an owner row with the flag set still passes', () => {
    // The single production row with can_request_referral_payouts = true is an
    // owner. Its behaviour must not change.
    const auth = makeAuth('owner', { can_request_referral_payouts: true });
    expect(requireMoneyRequestPermission(auth, 'can_request_referral_payouts')).toBeNull();
  });

  it('allows an assistant the owner has explicitly delegated to', () => {
    const auth = makeAuth('assistant', { can_request_referral_payouts: true });
    expect(hasMoneyRequestAuthority(auth, 'can_request_referral_payouts')).toBe(true);
  });

  it('allows a centre admin the owner has explicitly delegated to', () => {
    const auth = makeAuth('admin', { can_request_referral_payouts: true });
    expect(hasMoneyRequestAuthority(auth, 'can_request_referral_payouts')).toBe(true);
  });

  it('denies an assistant without the flag', () => {
    const auth = makeAuth('assistant');
    const denied = requireMoneyRequestPermission(auth, 'can_request_referral_payouts');
    expect(denied).toBeInstanceOf(Response);
    expect((denied as Response).status).toBe(403);
  });

  it('REGRESSION: isSuperAdmin alone no longer initiates a payout request', () => {
    // `requirePermission` short-circuited on this flag. A SUPER_ADMIN_PHONES
    // entry mints a super-admin with no database row at all (§7.5), so this was
    // a forensically anonymous path to initiating a centre's payout — and the
    // sibling withdrawal route rejects the same identity.
    const superAdmin = makeAuth('super_admin', {}, true);
    expect(hasPermission(superAdmin, 'can_manage_billing')).toBe(true); // unchanged elsewhere
    expect(hasMoneyRequestAuthority(superAdmin, 'can_request_referral_payouts')).toBe(false);
    expect(withdrawalRouteWouldAllow(superAdmin)).toBe(false);
  });

  it('REGRESSION: a centre-less role holding the flag is not a delegation', () => {
    // users_center_check makes teacher/super_admin rows center_id IS NULL, so
    // they are never centre staff however they reached a centre context.
    for (const role of ['teacher', 'super_admin']) {
      const auth = makeAuth(role, { can_request_referral_payouts: true });
      expect(
        hasMoneyRequestAuthority(auth, 'can_request_referral_payouts'),
        `role ${role} must not pass on the flag alone`,
      ).toBe(false);
    }
  });

  it('REGRESSION: a tampered role string with no flag never passes', () => {
    for (const role of ['owner ', 'Owner', 'super_admin', 'assistant', '']) {
      if (role === 'owner') continue;
      const auth = makeAuth(role);
      expect(
        hasMoneyRequestAuthority(auth, 'can_request_referral_payouts'),
        `role ${JSON.stringify(role)} must not pass`,
      ).toBe(false);
    }
  });

  it('the referral gate is never weaker than owner-only for a non-delegated caller', () => {
    // Exhaustive over the identity shapes centerAuth can produce. Wherever the
    // referral gate allows and the owner-only rule does not, the ONLY reason may
    // be an explicit, live, centre-staff delegation.
    const roles = ['owner', 'admin', 'assistant', 'teacher', 'super_admin', 'bogus'];
    for (const role of roles) {
      for (const flag of [true, false]) {
        for (const isSuperAdmin of [true, false]) {
          const auth = makeAuth(role, { can_request_referral_payouts: flag }, isSuperAdmin);
          const referralAllows = hasMoneyRequestAuthority(
            auth,
            'can_request_referral_payouts',
          );
          if (referralAllows && !withdrawalRouteWouldAllow(auth)) {
            expect(
              flag && (role === 'admin' || role === 'assistant'),
              `widened access for role=${role} flag=${flag} isSuperAdmin=${isSuperAdmin}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});

describe('§2.7 — can_request_referral_payouts is REQUEST-ONLY, never release', () => {
  it('is registered as request-only', () => {
    expect(REQUEST_ONLY_MONEY_PERMISSIONS).toContain('can_request_referral_payouts');
    expect(isRequestOnlyMoneyPermission('can_request_referral_payouts')).toBe(true);
    expect(isRequestOnlyMoneyPermission('can_manage_billing')).toBe(false);
  });

  it('assertNotReleaseAuthority throws for it and passes everything else', () => {
    expect(() => assertNotReleaseAuthority('can_request_referral_payouts')).toThrow(
      /REQUEST-ONLY/,
    );
    expect(() => assertNotReleaseAuthority('can_manage_billing')).not.toThrow();
  });

  it('the generic permission helpers refuse it, so a release path cannot reuse them', () => {
    // This is the tripwire for the mistake the spec names: a future approval or
    // release path reaching for the familiar requirePermission(...) call.
    const owner = makeAuth('owner');
    expect(() => hasPermission(owner, 'can_request_referral_payouts')).toThrow(
      /REQUEST-ONLY/,
    );
    expect(() => requirePermission(owner, 'can_request_referral_payouts')).toThrow(
      /REQUEST-ONLY/,
    );
  });

  it('type-check: a release-authority signature cannot accept the request-only permission', () => {
    const releaseGate = (
      auth: CenterAuthContext,
      permission: import('@/lib/centerPermissions').ReleaseAuthorityPermission,
    ): Response | null => (auth && permission ? null : null);
    const owner = makeAuth('owner');
    // @ts-expect-error can_request_referral_payouts is excluded from ReleaseAuthorityPermission
    releaseGate(owner, 'can_request_referral_payouts');
    expect(releaseGate(owner, 'can_manage_billing')).toBeNull();
  });
});

/**
 * Source tripwire. If someone later wires the permission into a new file — most
 * dangerously an approval/release path — this fails and forces a human to read
 * §2.7 before the change lands. CI has no live database, so a source scan is the
 * only gate that can catch this class of change.
 */
describe('§2.7 — nothing new may reference can_request_referral_payouts', () => {
  const PERMISSION = 'can_request_referral_payouts';

  const ALLOWED_REFERENCES = [
    // auth plumbing: loads the flag onto the session
    'src/lib/centerAuth.ts',
    // the gate itself
    'src/lib/centerPermissions.ts',
    // deny-list keeping the flag out of the /api/db proxy
    'src/lib/dbProxyProtectedColumns.ts',
    // the one REQUEST route
    'src/app/api/referrals/payout/route.ts',
    // the owner-only delegation surface
    'src/app/api/settings/staff/[userId]/permissions/route.ts',
    'src/app/[locale]/settings/team/page.tsx',
    'src/components/settings/StaffMemberCard.tsx',
  ].map((p) => p.split('/').join(sep));

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
    }
    return out;
  }

  const referencing = walk(join(ROOT, 'src'))
    .filter((f) => readFileSync(f, 'utf8').includes(PERMISSION))
    .map((f) => relative(ROOT, f))
    .sort();

  it('the set of files referencing the permission is exactly the reviewed allowlist', () => {
    const unexpected = referencing.filter((f) => !ALLOWED_REFERENCES.includes(f));
    expect(
      unexpected,
      `New reference(s) to ${PERMISSION}:\n${unexpected.join('\n')}\n\n` +
        'It is REQUEST-ONLY (PAYOUT-SYSTEM-SPEC.md §2.7, Decision 1). It may never ' +
        'authorise payout approval or release — that authority is platform-side ' +
        '(admin_users), never public.users. If this reference is legitimate, add it ' +
        'to ALLOWED_REFERENCES in this test with a reason.',
    ).toEqual([]);
    // Guard against the allowlist silently rotting into a no-op.
    expect(referencing.length).toBeGreaterThan(0);
  });

  it('no approval/release-shaped API path references it', () => {
    const RELEASE_SHAPED = /(approv|releas|disburs|payout-run|settle|withdrawals)/i;
    const offenders = referencing.filter(
      (f) => f.startsWith(join('src', 'app', 'api')) && RELEASE_SHAPED.test(f),
    );
    expect(
      offenders,
      `Release-shaped route(s) referencing ${PERMISSION}:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the request route uses the money-request gate, not the generic one', () => {
    const src = readFileSync(
      join(ROOT, 'src/app/api/referrals/payout/route.ts'),
      'utf8',
    );
    expect(src).toContain('requireMoneyRequestPermission');
    expect(src).not.toMatch(/requirePermission\s*\(/);
    // and it still validates CSRF (§2.6) — money-movement route
    expect(src).toContain('validateCSRFRequest');
  });

  it('the sibling withdrawal route is still owner-only (unification is undecided)', () => {
    const src = readFileSync(
      join(ROOT, 'src/app/api/billing/withdrawal/route.ts'),
      'utf8',
    );
    expect(src).toContain("auth.role !== 'owner'");
    expect(src).not.toContain(PERMISSION);
  });
});
