/**
 * Regression for §10c follow-up: `fetchAdminAccessFlags` and
 * `requireSuperAdminRow` must derive the super-admin phone check from
 * `auth.users.phone` (verified session, not writable via /api/db), not
 * `public.users.phone` (centre-tenant data, prior storage path for
 * self-elevation against SUPER_ADMIN_PHONES).
 *
 * Even though `dbProxyProtectedColumns` now blocks writes to
 * `public.users.phone` via the proxy as defence-in-depth, the helpers
 * must structurally prefer the auth source so the escalation class is
 * killed, not just the current instance.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchAdminAccessFlags, requireSuperAdminRow } from '@/lib/admin-access';

const PREV_PHONES = process.env.SUPER_ADMIN_PHONES;

interface MockState {
  /** auth.users.email (CenterHQ identity source: `<digits>@centerhq.local`). */
  authEmail?: string | null;
  /** auth.users.phone (typically null in CenterHQ; future-proofing only). */
  authPhone: string | null;
  /** public.users.phone (centre-tenant data; defence-in-depth fallback). */
  publicUsersPhone: string | null;
  adminUser: { role: string; custom_permissions: unknown } | null;
}

function makeMockSupabase(state: MockState) {
  return {
    auth: {
      admin: {
        getUserById: async (_userId: string) => {
          const hasAny =
            state.authEmail !== undefined || state.authPhone !== null;
          return {
            data: {
              user: hasAny
                ? {
                    email: state.authEmail ?? null,
                    phone: state.authPhone ?? null,
                  }
                : null,
            },
            error: null,
          };
        },
      },
    },
    from(table: string) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        maybeSingle: async () => {
          if (table === 'admin_users') {
            return { data: state.adminUser, error: null };
          }
          if (table === 'users') {
            return { data: state.publicUsersPhone ? { phone: state.publicUsersPhone } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };
}

beforeEach(() => {
  process.env.SUPER_ADMIN_PHONES = '+201234567890';
});

afterEach(() => {
  process.env.SUPER_ADMIN_PHONES = PREV_PHONES;
});

describe('fetchAdminAccessFlags (§10c re-source regression)', () => {
  it('uses auth.users.phone , tampered public.users.phone does NOT confer super-admin', async () => {
    const supa = makeMockSupabase({
      authPhone: '+201000000000', // normal owner phone in verified session
      publicUsersPhone: '+201234567890', // tampered to match SUPER_ADMIN_PHONES
      adminUser: null,
    });
    const flags = await fetchAdminAccessFlags(supa as unknown as never, 'user-1');
    expect(flags.isSuperAdmin).toBe(false);
    expect(flags.adminRole).toBeNull();
  });

  it('uses auth.users.phone , session phone matching SUPER_ADMIN_PHONES DOES confer super-admin', async () => {
    const supa = makeMockSupabase({
      authPhone: '+201234567890',
      publicUsersPhone: null,
      adminUser: null,
    });
    const flags = await fetchAdminAccessFlags(supa as unknown as never, 'user-1');
    expect(flags.isSuperAdmin).toBe(true);
  });

  it('falls back to public.users.phone only when the auth admin lookup returns no phone', async () => {
    const supa = makeMockSupabase({
      authPhone: null, // auth lookup returns no phone
      publicUsersPhone: '+201234567890', // (under USERS_PROTECTED_COLUMNS this can no longer be set by a centre)
      adminUser: null,
    });
    const flags = await fetchAdminAccessFlags(supa as unknown as never, 'user-1');
    // Defence-in-depth fall-back: still resolves the SUPER_ADMIN_PHONES match,
    // since the write path is closed by the proxy protected-column gate.
    expect(flags.isSuperAdmin).toBe(true);
  });

  it('admin_users.role=super_admin also confers super-admin even with no phone', async () => {
    const supa = makeMockSupabase({
      authPhone: null,
      publicUsersPhone: null,
      adminUser: { role: 'super_admin', custom_permissions: [] },
    });
    const flags = await fetchAdminAccessFlags(supa as unknown as never, 'user-1');
    expect(flags.isSuperAdmin).toBe(true);
    expect(flags.adminRole).toBe('super_admin');
  });

  // CenterHQ-shape regression: auth.users.phone is null because accounts are
  // created with `auth.admin.createUser({ email, password })` only. The phone
  // identity lives in the email local-part `<digits>@centerhq.local`. The
  // email is set server-side and is NOT writable via /api/db.
  it('derives super-admin from auth EMAIL local-part when auth.users.phone is null (CenterHQ shape)', async () => {
    const supa = makeMockSupabase({
      authEmail: '201234567890@centerhq.local',
      authPhone: null,
      publicUsersPhone: null,
      adminUser: null,
    });
    const flags = await fetchAdminAccessFlags(supa as unknown as never, 'user-1');
    expect(flags.isSuperAdmin).toBe(true);
  });

  // Stronger property: even if public.users.phone is somehow tampered to
  // match SUPER_ADMIN_PHONES (i.e. defence-in-depth via
  // USERS_PROTECTED_COLUMNS were ABSENT), the email-derived phone takes
  // priority and a normal centre owner does NOT become super-admin.
  it('tampered public.users.phone is IGNORED when email-derived phone is non-super (CenterHQ shape, structural)', async () => {
    const supa = makeMockSupabase({
      authEmail: '201000000000@centerhq.local', // normal owner
      authPhone: null,
      publicUsersPhone: '+201234567890', // tampered to SUPER_ADMIN_PHONES
      adminUser: null,
    });
    const flags = await fetchAdminAccessFlags(supa as unknown as never, 'user-1');
    expect(flags.isSuperAdmin).toBe(false);
  });
});

describe('requireSuperAdminRow (§10c re-source regression)', () => {
  it('rejects 403 when session phone is non-super and public.users.phone is tampered', async () => {
    const supa = makeMockSupabase({
      authPhone: '+201000000000',
      publicUsersPhone: '+201234567890', // tampered
      adminUser: null,
    });
    const res = await requireSuperAdminRow(supa as unknown as never, 'user-1');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('allows (null) when session phone matches SUPER_ADMIN_PHONES', async () => {
    const supa = makeMockSupabase({
      authPhone: '+201234567890',
      publicUsersPhone: null,
      adminUser: null,
    });
    const res = await requireSuperAdminRow(supa as unknown as never, 'user-1');
    expect(res).toBeNull();
  });

  it('allows (null) when admin_users.role=super_admin', async () => {
    const supa = makeMockSupabase({
      authPhone: null,
      publicUsersPhone: null,
      adminUser: { role: 'super_admin', custom_permissions: [] },
    });
    const res = await requireSuperAdminRow(supa as unknown as never, 'user-1');
    expect(res).toBeNull();
  });

  it('allows (null) via auth EMAIL local-part (CenterHQ shape, phone=null)', async () => {
    const supa = makeMockSupabase({
      authEmail: '201234567890@centerhq.local',
      authPhone: null,
      publicUsersPhone: null,
      adminUser: null,
    });
    const res = await requireSuperAdminRow(supa as unknown as never, 'user-1');
    expect(res).toBeNull();
  });

  it('rejects 403 when email-derived phone is non-super, even with tampered public.users.phone', async () => {
    const supa = makeMockSupabase({
      authEmail: '201000000000@centerhq.local', // normal owner email
      authPhone: null,
      publicUsersPhone: '+201234567890', // tampered
      adminUser: null,
    });
    const res = await requireSuperAdminRow(supa as unknown as never, 'user-1');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});
