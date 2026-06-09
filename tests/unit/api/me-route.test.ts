import { describe, it, expect, vi, beforeEach } from 'vitest';

// Env consumed by the route before it constructs any supabase client.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockGetUser = vi.fn();
const usersCoreMaybeSingle = vi.fn();
const usersPermsMaybeSingle = vi.fn();
const adminUsersMaybeSingle = vi.fn();
const centersSingle = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((_url: string, key: string) => {
    // Anon client (auth-only) is created with the public anon key + Bearer header.
    if (key === 'test-anon-key') {
      return { auth: { getUser: mockGetUser } };
    }
    // Service-role client — exposes the table query builders the route uses.
    return {
      from: (table: string) => {
        if (table === 'users') {
          return {
            select: (cols: string) => {
              const isPermsSelect = cols.includes('can_');
              return {
                eq: () => ({
                  maybeSingle: isPermsSelect
                    ? usersPermsMaybeSingle
                    : usersCoreMaybeSingle,
                }),
              };
            },
          };
        }
        if (table === 'admin_users') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: adminUsersMaybeSingle }),
            }),
          };
        }
        if (table === 'centers') {
          return {
            select: () => ({
              eq: () => ({ single: centersSingle }),
            }),
          };
        }
        throw new Error(`unexpected table in /api/me test mock: ${table}`);
      },
    };
  }),
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: { setTag: () => void }) => void) =>
    cb({ setTag: vi.fn() } as never),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { GET } from '@/app/api/me/route';

function makeRequest(token = 'tok'): Request {
  return new Request('http://localhost/api/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

const USER_ID = 'user-abc';
const CENTER_ID = 'center-xyz';

beforeEach(() => {
  mockGetUser.mockReset();
  usersCoreMaybeSingle.mockReset();
  usersPermsMaybeSingle.mockReset();
  adminUsersMaybeSingle.mockReset();
  centersSingle.mockReset();

  // Sensible defaults — individual tests override what they care about.
  centersSingle.mockResolvedValue({
    data: { id: CENTER_ID, name: 'Test Center' },
    error: null,
  });
  adminUsersMaybeSingle.mockResolvedValue({ data: null, error: null });
});

describe('GET /api/me — column-drift safety (regression for the nine-day-outage pattern)', () => {
  it('returns the correct center_id even when the permission-column SELECT errors', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: '201112223344@centerhq.local' } },
      error: null,
    });
    usersCoreMaybeSingle.mockResolvedValue({
      data: {
        id: USER_ID,
        center_id: CENTER_ID,
        role: 'owner',
        name: 'Owner',
        phone: '+201112223344',
        preferred_locale: 'ar',
      },
      error: null,
    });
    // Schema drift: a can_* column is missing → PostgREST 42703 → supabase-js
    // returns { data: null, error }. Before the fix this masqueraded as "no
    // users row" and zeroed out center_id.
    usersPermsMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'column "can_xyz" does not exist', code: '42703' },
    });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.center_id).toBe(CENTER_ID);
    expect(json.user.center_id).toBe(CENTER_ID);
    expect(json.role).toBe('owner');
    // Defaults applied, but the user row itself is intact.
    expect(json.user.can_view_payments).toBe(false);
    expect(json.user.can_scan).toBe(false);
    expect(json.user.is_active).toBe(true);
    // CRUCIAL: admin_users fallback must NOT have been consulted (it would
    // overwrite center_id with null and bounce a center owner to /admin).
    expect(adminUsersMaybeSingle).not.toHaveBeenCalled();
  });

  it('returns 500 when the CORE users SELECT errors (does not masquerade as no-row)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: '201112223344@centerhq.local' } },
      error: null,
    });
    usersCoreMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'connection refused', code: '08006' },
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    // Hard failure — never silently fall through to admin_users.
    expect(adminUsersMaybeSingle).not.toHaveBeenCalled();
    expect(usersPermsMaybeSingle).not.toHaveBeenCalled();
  });

  it('falls back to admin_users only on a genuine empty users row', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: '201111111111@centerhq.local' } },
      error: null,
    });
    usersCoreMaybeSingle.mockResolvedValue({ data: null, error: null });
    adminUsersMaybeSingle.mockResolvedValue({
      data: { id: USER_ID, name: 'Super', phone: '+201111111111' },
      error: null,
    });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.role).toBe('super_admin');
    expect(json.center_id).toBeNull();
    // Admin-only users don't carry per-tenant permission flags.
    expect(usersPermsMaybeSingle).not.toHaveBeenCalled();
  });

  it('happy path: returns center_id AND permission flags from DB when both selects succeed', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: '201112223344@centerhq.local' } },
      error: null,
    });
    usersCoreMaybeSingle.mockResolvedValue({
      data: {
        id: USER_ID,
        center_id: CENTER_ID,
        role: 'assistant',
        name: 'Assistant',
        phone: '+201112223344',
        preferred_locale: 'en',
      },
      error: null,
    });
    usersPermsMaybeSingle.mockResolvedValue({
      data: {
        can_scan: true,
        can_view_payments: true,
        can_record_payments: false,
        can_view_dashboard: false,
        can_view_revenue: false,
        can_manage_students: true,
        can_manage_groups: false,
        can_allow_late_entry: false,
        can_manage_rooms: false,
        can_view_schedule: true,
        can_view_settings: false,
        is_active: true,
      },
      error: null,
    });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.center_id).toBe(CENTER_ID);
    expect(json.user.can_scan).toBe(true);
    expect(json.user.can_view_payments).toBe(true);
    expect(json.user.can_record_payments).toBe(false);
    expect(json.user.is_active).toBe(true);
  });
});
