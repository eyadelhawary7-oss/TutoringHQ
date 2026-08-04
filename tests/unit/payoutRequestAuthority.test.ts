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
  assertRequestIntent,
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
    expect(hasMoneyRequestAuthority(auth, 'can_request_referral_payouts', 'request')).toBe(true);
    expect(requireMoneyRequestPermission(auth, 'can_request_referral_payouts', 'request')).toBeNull();
  });

  it('preserves the one live holder: an owner row with the flag set still passes', () => {
    // The single production row with can_request_referral_payouts = true is an
    // owner. Its behaviour must not change.
    const auth = makeAuth('owner', { can_request_referral_payouts: true });
    expect(requireMoneyRequestPermission(auth, 'can_request_referral_payouts', 'request')).toBeNull();
  });

  it('allows an assistant the owner has explicitly delegated to', () => {
    const auth = makeAuth('assistant', { can_request_referral_payouts: true });
    expect(hasMoneyRequestAuthority(auth, 'can_request_referral_payouts', 'request')).toBe(true);
  });

  it('allows a centre admin the owner has explicitly delegated to', () => {
    const auth = makeAuth('admin', { can_request_referral_payouts: true });
    expect(hasMoneyRequestAuthority(auth, 'can_request_referral_payouts', 'request')).toBe(true);
  });

  it('denies an assistant without the flag', () => {
    const auth = makeAuth('assistant');
    const denied = requireMoneyRequestPermission(auth, 'can_request_referral_payouts', 'request');
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
    expect(hasMoneyRequestAuthority(superAdmin, 'can_request_referral_payouts', 'request')).toBe(false);
    expect(withdrawalRouteWouldAllow(superAdmin)).toBe(false);
  });

  it('REGRESSION: a centre-less role holding the flag is not a delegation', () => {
    // users_center_check makes teacher/super_admin rows center_id IS NULL, so
    // they are never centre staff however they reached a centre context.
    for (const role of ['teacher', 'super_admin']) {
      const auth = makeAuth(role, { can_request_referral_payouts: true });
      expect(
        hasMoneyRequestAuthority(auth, 'can_request_referral_payouts', 'request'),
        `role ${role} must not pass on the flag alone`,
      ).toBe(false);
    }
  });

  it('REGRESSION: a tampered role string with no flag never passes', () => {
    for (const role of ['owner ', 'Owner', 'super_admin', 'assistant', '']) {
      if (role === 'owner') continue;
      const auth = makeAuth(role);
      expect(
        hasMoneyRequestAuthority(auth, 'can_request_referral_payouts', 'request'),
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
            'request',
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

  it('closes the indirection hole: the money-request gate refuses a release intent', () => {
    // The hole this closes, found by the adversarial audit on PR #319 and
    // recorded there before it was fixed:
    //
    //     requireMoneyRequestPermission(auth, REQUEST_ONLY_MONEY_PERMISSIONS[0])
    //
    // type-checked, passed all 17 tests, and GRANTED on the owner arm — with no
    // string literal to grep for. For a release path that is §7.1's
    // payee-self-approval shape: the centre owner approving their own payout.
    //
    // `intent` is required and has no default, so a release path must now write
    // 'request' next to code that approves money — a lie visible in the diff —
    // or pass 'release' and throw on the first call, in every environment.
    const owner = makeAuth('owner');
    const viaIndirection = REQUEST_ONLY_MONEY_PERMISSIONS[0];

    expect(() => hasMoneyRequestAuthority(owner, viaIndirection, 'release')).toThrow(
      /REQUEST-ONLY/,
    );
    expect(() => requireMoneyRequestPermission(owner, viaIndirection, 'release')).toThrow(
      /REQUEST-ONLY/,
    );
    // The throw names the intent that was attempted, so the stack trace says
    // what the caller was doing rather than only what it may not do.
    expect(() => assertRequestIntent('release', 'can_request_referral_payouts')).toThrow(
      /'release' intent/,
    );

    // And the legitimate direction is unaffected — indirection included.
    expect(hasMoneyRequestAuthority(owner, viaIndirection, 'request')).toBe(true);
    expect(() =>
      assertRequestIntent('request', 'can_request_referral_payouts'),
    ).not.toThrow();
  });

  it('the release intent is refused for every role, not just the owner arm', () => {
    // A release path must not be able to find ANY identity that slips through.
    for (const role of ['owner', 'admin', 'assistant', 'teacher', 'super_admin', 'bogus']) {
      for (const flag of [true, false]) {
        for (const isSuperAdmin of [true, false]) {
          const auth = makeAuth(role, { can_request_referral_payouts: flag }, isSuperAdmin);
          expect(
            () => hasMoneyRequestAuthority(auth, 'can_request_referral_payouts', 'release'),
            `release intent must throw for role=${role} flag=${flag} isSuperAdmin=${isSuperAdmin}`,
          ).toThrow(/REQUEST-ONLY/);
        }
      }
    }
  });

  it('the intent argument is required, and omitting it fails closed at runtime too', () => {
    // Two independent guarantees, and the runtime one matters more: a JS caller,
    // an `as any` escape, or a transpiled call that drops the argument reaches
    // `intent === undefined`, which is not 'request' and therefore THROWS. The
    // gate cannot be reached by forgetting about it.
    const owner = makeAuth('owner');

    expect(() =>
      // @ts-expect-error intent is required — omitting it must not compile
      hasMoneyRequestAuthority(owner, 'can_request_referral_payouts'),
    ).toThrow(/REQUEST-ONLY/);
    expect(() =>
      // @ts-expect-error intent is required — omitting it must not compile
      requireMoneyRequestPermission(owner, 'can_request_referral_payouts'),
    ).toThrow(/REQUEST-ONLY/);
    expect(() =>
      // @ts-expect-error 'approve' is not a MoneyMovementIntent
      hasMoneyRequestAuthority(owner, 'can_request_referral_payouts', 'approve'),
    ).toThrow(/REQUEST-ONLY/);

    expect(hasMoneyRequestAuthority(owner, 'can_request_referral_payouts', 'request')).toBe(
      true,
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
    // ── Decision 1's unified path. Both mention the permission ONLY to record
    // that it is deliberately NOT consulted, and both gate STRICTER than it.
    //
    // Reviewed 2026-08-04, reading the code and not the comment:
    //   `POST /api/payouts/request` gates on `auth.role !== 'owner'` → 403, with
    //   `isSuperAdmin` explicitly NOT an alternative arm. That is tighter than
    //   `hasMoneyRequestAuthority`, which also passes a delegated admin/assistant
    //   holding the flag. The literal string appears once, in the `detail.note`
    //   of that refusal, explaining the omission to whoever reads the response.
    //   `requestPayout.ts` mentions it only in the header comment quoting
    //   §2.7/Decision 1. Neither file imports `centerPermissions`, reads
    //   `auth.permissions`, or branches on the flag.
    //
    // These are the tripwire's intended false positives: it matches the literal
    // string anywhere in a file, so documenting "we do not use this" trips it.
    // That is the correct trade — a scan that skipped comments could be walked
    // around with a template string — so they are allowlisted, not exempted by
    // narrowing the scan.
    'src/app/api/payouts/request/route.ts',
    'src/lib/collectionPayout/requestPayout.ts',
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

  it('the Decision 1 files mention the permission without consulting it', () => {
    // The allowlist entry above asserts these two files gate STRICTER than the
    // permission and only name it to say so. Without this test that claim is a
    // comment: both files are allowlisted, so a later edit adding a real
    // `auth.permissions[PERMISSION]` read would pass the scan above, and the
    // INDIRECT_HANDLES test below only catches reaching the gate by import.
    // A direct flag read needs neither. This closes that seam.
    const DECISION_1_FILES = [
      'src/app/api/payouts/request/route.ts',
      'src/lib/collectionPayout/requestPayout.ts',
    ].map((p) => p.split('/').join(sep));

    for (const rel of DECISION_1_FILES) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(
        src.includes('auth.permissions'),
        `${rel} reads auth.permissions. It is on the unified owner-only path ` +
          '(PAYOUT-SYSTEM-SPEC.md Decision 1) and must not consult a delegable ' +
          'flag — that would widen payout initiation to staff accounts at every ' +
          'centre, which is the exact widening Decision 1 refused.',
      ).toBe(false);
    }

    // And the stricter gate the allowlist entry credits it with is still there.
    const routeSrc = readFileSync(
      join(ROOT, 'src/app/api/payouts/request/route.ts'.split('/').join(sep)),
      'utf8',
    );
    expect(
      /auth\.role\s*!==\s*'owner'/.test(routeSrc),
      "POST /api/payouts/request no longer refuses on `auth.role !== 'owner'`. " +
        'The allowlist entry for this file is justified by that gate being ' +
        'STRICTER than the permission; if the gate changed, re-review the entry.',
    ).toBe(true);
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

  it('the scan cannot be walked around by indirection', () => {
    // The scan above matches the LITERAL permission string, so a release path
    // written as `hasMoneyRequestAuthority(auth, REQUEST_ONLY_MONEY_PERMISSIONS[0], …)`
    // would never appear in `referencing` at all. The `intent` argument now
    // catches that at runtime; this catches it at review time, which is earlier
    // and cheaper. Reaching the constant or the gate outside the reviewed set is
    // itself the signal, whatever string the call uses.
    const INDIRECT_HANDLES = [
      'REQUEST_ONLY_MONEY_PERMISSIONS',
      'hasMoneyRequestAuthority',
      'requireMoneyRequestPermission',
      'assertRequestIntent',
      'RequestOnlyMoneyPermission',
    ];
    const ALLOWED_INDIRECT = [
      // the gate itself
      'src/lib/centerPermissions.ts',
      // the one REQUEST route
      'src/app/api/referrals/payout/route.ts',
    ].map((p) => p.split('/').join(sep));

    const offenders = walk(join(ROOT, 'src'))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => ({ rel: relative(ROOT, f), src: readFileSync(f, 'utf8') }))
      .filter(({ src }) => INDIRECT_HANDLES.some((h) => src.includes(h)))
      .map(({ rel }) => rel)
      .filter((rel) => !ALLOWED_INDIRECT.includes(rel))
      .sort();

    expect(
      offenders,
      `File(s) reaching the request-only money gate indirectly:\n${offenders.join('\n')}\n\n` +
        'Reaching it through the constant or the helper rather than the literal ' +
        `'${PERMISSION}' bypasses the string scan above. If this is a REQUEST path, ` +
        'add it to ALLOWED_INDIRECT with a reason. If it approves, releases or ' +
        'disburses money, it must not use this authority at all — release ' +
        'authority is platform-side (admin_users), never public.users ' +
        '(PAYOUT-SYSTEM-SPEC.md §2.7, §7.1).',
    ).toEqual([]);
    // The allowlist must not rot into a no-op.
    expect(ALLOWED_INDIRECT.length).toBeGreaterThan(0);
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
