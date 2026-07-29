import { describe, it, expect } from 'vitest';
import {
  fetchAdminPermissionKeys,
  setAdminPermissionKeys,
  fetchPermissionKeysForAdmins,
} from '@/lib/adminPermissionsStore';

/**
 * A minimal stand-in for the PostgREST builder chain these helpers use. It
 * records the writes so the tests can assert that a revoked grant is DISABLED
 * rather than deleted — the audit trail is the entire reason `permissions` was
 * chosen over the jsonb blob, and a delete would throw it away.
 */
type Row = { user_id: string; permission: string; enabled: boolean | null };

function makeClient(rows: Row[], opts: { failRead?: boolean } = {}) {
  const upserts: { user_id: string; permission: string; enabled: boolean }[][] = [];
  const disables: { userId: string; permissions: string[] }[] = [];
  const deletes: string[] = [];

  const client = {
    from(table: string) {
      if (table !== 'permissions') throw new Error(`unexpected table ${table}`);
      const state: { userId?: string; userIds?: string[]; onlyEnabled?: boolean } = {};

      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          if (col === 'user_id') state.userId = String(val);
          if (col === 'enabled') state.onlyEnabled = val === true;
          return builder;
        },
        in(col: string, vals: string[]) {
          if (col === 'user_id') state.userIds = vals;
          if (col === 'permission') {
            disables.push({ userId: state.userId as string, permissions: vals });
            return Promise.resolve({ error: null });
          }
          return builder;
        },
        upsert(payload: { user_id: string; permission: string; enabled: boolean }[]) {
          upserts.push(payload);
          return Promise.resolve({ error: null });
        },
        update() {
          return builder;
        },
        delete() {
          deletes.push(state.userId ?? '');
          return builder;
        },
        then(resolve: (v: { data: Row[] | null; error: unknown }) => void) {
          if (opts.failRead) return resolve({ data: null, error: { message: 'boom' } });
          let out = rows;
          if (state.userId) out = out.filter((r) => r.user_id === state.userId);
          if (state.userIds) out = out.filter((r) => state.userIds!.includes(r.user_id));
          if (state.onlyEnabled) out = out.filter((r) => r.enabled !== false);
          return resolve({ data: out, error: null });
        },
      };
      return builder;
    },
  };

  return { client: client as never, upserts, disables, deletes };
}

describe('fetchAdminPermissionKeys', () => {
  it('returns only enabled grants for that admin', async () => {
    const { client } = makeClient([
      { user_id: 'a', permission: 'centers', enabled: true },
      { user_id: 'a', permission: 'billing', enabled: false },
      { user_id: 'b', permission: 'analytics', enabled: true },
    ]);
    expect(await fetchAdminPermissionKeys(client, 'a')).toEqual(['centers']);
  });

  it('fails CLOSED — an unreadable table grants nothing', async () => {
    // The gates fall back to the role's own set. Returning a partial or
    // optimistic list here would hand out access on a database error.
    const { client } = makeClient([{ user_id: 'a', permission: 'centers', enabled: true }], {
      failRead: true,
    });
    expect(await fetchAdminPermissionKeys(client, 'a')).toEqual([]);
  });
});

describe('setAdminPermissionKeys', () => {
  it('enables only what is missing', async () => {
    const { client, upserts } = makeClient([{ user_id: 'a', permission: 'centers', enabled: true }]);
    const res = await setAdminPermissionKeys(client, 'a', ['centers', 'billing']);
    expect(res.ok).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toEqual([{ user_id: 'a', permission: 'billing', enabled: true }]);
  });

  it('DISABLES a revoked grant rather than deleting it', async () => {
    const { client, disables, deletes } = makeClient([
      { user_id: 'a', permission: 'centers', enabled: true },
      { user_id: 'a', permission: 'billing', enabled: true },
    ]);
    await setAdminPermissionKeys(client, 'a', ['centers']);
    expect(disables).toEqual([{ userId: 'a', permissions: ['billing'] }]);
    // created_at has to survive, so nothing is ever hard-deleted here.
    expect(deletes).toEqual([]);
  });

  it('re-enables a previously revoked grant in place', async () => {
    const { client, upserts } = makeClient([{ user_id: 'a', permission: 'billing', enabled: false }]);
    await setAdminPermissionKeys(client, 'a', ['billing']);
    expect(upserts[0]).toEqual([{ user_id: 'a', permission: 'billing', enabled: true }]);
  });

  it('revokes everything when the desired set is empty', async () => {
    // This is the demotion path: moving off the custom role must clear the
    // bespoke set, or a demoted admin keeps grants their new role never gave.
    const { client, disables } = makeClient([
      { user_id: 'a', permission: 'centers', enabled: true },
      { user_id: 'a', permission: 'billing', enabled: true },
    ]);
    await setAdminPermissionKeys(client, 'a', []);
    expect(disables[0].permissions.sort()).toEqual(['billing', 'centers']);
  });

  it('writes nothing when the set already matches', async () => {
    const { client, upserts, disables } = makeClient([
      { user_id: 'a', permission: 'centers', enabled: true },
    ]);
    await setAdminPermissionKeys(client, 'a', ['centers']);
    expect(upserts).toEqual([]);
    expect(disables).toEqual([]);
  });

  it('de-duplicates and drops empty keys', async () => {
    const { client, upserts } = makeClient([]);
    await setAdminPermissionKeys(client, 'a', ['centers', 'centers', '']);
    expect(upserts[0]).toEqual([{ user_id: 'a', permission: 'centers', enabled: true }]);
  });

  it('surfaces a read failure instead of silently wiping grants', async () => {
    const { client, disables } = makeClient([{ user_id: 'a', permission: 'centers', enabled: true }], {
      failRead: true,
    });
    const res = await setAdminPermissionKeys(client, 'a', ['billing']);
    expect(res.ok).toBe(false);
    expect(disables).toEqual([]);
  });
});

describe('fetchPermissionKeysForAdmins', () => {
  it('groups enabled grants by admin', async () => {
    const { client } = makeClient([
      { user_id: 'a', permission: 'centers', enabled: true },
      { user_id: 'a', permission: 'billing', enabled: true },
      { user_id: 'b', permission: 'analytics', enabled: true },
    ]);
    const map = await fetchPermissionKeysForAdmins(client, ['a', 'b']);
    expect(map.get('a')?.sort()).toEqual(['billing', 'centers']);
    expect(map.get('b')).toEqual(['analytics']);
  });

  it('returns an empty map for no ids, without querying', async () => {
    const { client } = makeClient([]);
    expect((await fetchPermissionKeysForAdmins(client, [])).size).toBe(0);
  });
});
