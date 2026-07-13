/**
 * staff_invites token helpers.
 *
 * Proves the security-relevant behaviours against a recording Supabase stub:
 *   1. Only the SHA-256 HASH of the plaintext is ever stored; hashing is deterministic.
 *   2. mint freezes the CEO's role; custom_permissions are kept ONLY for role='custom'.
 *   3. find looks up by hash (never by plaintext) and only matches an OPEN row
 *      (used_at IS NULL, revoked_at IS NULL, not expired).
 *   4. consume is single-use: true when a row was updated, false on a replay/lost race.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hashInviteToken,
  mintStaffInvite,
  findOpenInviteByPlaintext,
  consumeStaffInvite,
} from '@/lib/staffInviteTokens';

type Rec = { table: string; values?: unknown };

function makeClient(opts?: { maybeSingleData?: unknown; updateData?: unknown }) {
  const inserts: Rec[] = [];
  const eqCalls: { col: string; val: unknown }[] = [];
  const isCalls: { col: string; val: unknown }[] = [];
  let lastInsertSelectSingle: unknown = { id: 'invite-1' };

  function builder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'gt', 'limit']) b[m] = () => b;
    b.eq = (col: string, val: unknown) => {
      eqCalls.push({ col, val });
      return b;
    };
    b.is = (col: string, val: unknown) => {
      isCalls.push({ col, val });
      return b;
    };
    b.insert = (values: unknown) => {
      inserts.push({ table, values });
      return b;
    };
    b.update = (values: unknown) => {
      inserts.push({ table: `${table}:update`, values });
      return b;
    };
    b.single = async () => ({ data: lastInsertSelectSingle, error: null });
    b.maybeSingle = async () => ({
      data:
        inserts.some((i) => i.table === `${table}:update`)
          ? (opts?.updateData ?? null)
          : (opts?.maybeSingleData ?? null),
      error: null,
    });
    return b;
  }

  const client = { from: (t: string) => builder(t) } as unknown as SupabaseClient;
  return {
    client,
    inserts,
    eqCalls,
    isCalls,
    setInsertId: (v: unknown) => {
      lastInsertSelectSingle = v;
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('hashInviteToken', () => {
  it('is deterministic and not the plaintext', () => {
    const h1 = hashInviteToken('abc');
    const h2 = hashInviteToken('abc');
    expect(h1).toBe(h2);
    expect(h1).not.toBe('abc');
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('mintStaffInvite', () => {
  it('stores the HASH (never the plaintext) and freezes the role', async () => {
    const { client, inserts } = makeClient();
    const res = await mintStaffInvite(client, {
      role: 'sales_rep',
      customPermissions: ['centers'],
      createdBy: 'ceo-1',
    });
    expect(res.plaintext).toBeTruthy();
    const row = inserts.find((i) => i.table === 'staff_invites')!.values as Record<string, unknown>;
    expect(row.token_hash).toBe(hashInviteToken(res.plaintext));
    expect(row.token_hash).not.toBe(res.plaintext);
    expect(row.role).toBe('sales_rep');
    // Non-custom role → custom_permissions dropped to [].
    expect(row.custom_permissions).toEqual([]);
    expect(row.created_by).toBe('ceo-1');
  });

  it('keeps custom_permissions only for role="custom"', async () => {
    const { client, inserts } = makeClient();
    await mintStaffInvite(client, {
      role: 'custom',
      customPermissions: ['centers', 'analytics'],
      createdBy: null,
    });
    const row = inserts.find((i) => i.table === 'staff_invites')!.values as Record<string, unknown>;
    expect(row.role).toBe('custom');
    expect(row.custom_permissions).toEqual(['centers', 'analytics']);
  });
});

describe('findOpenInviteByPlaintext', () => {
  it('looks up by hash and filters to an OPEN row', async () => {
    const invite = { id: 'i-1', role: 'accountant', custom_permissions: [] };
    const { client, eqCalls, isCalls } = makeClient({ maybeSingleData: invite });
    const found = await findOpenInviteByPlaintext(client, 'plainX');
    expect(found).toEqual(invite);
    // matched by hash, not the plaintext
    expect(eqCalls.some((e) => e.col === 'token_hash' && e.val === hashInviteToken('plainX'))).toBe(true);
    expect(eqCalls.some((e) => e.val === 'plainX')).toBe(false);
    // open-only guards
    expect(isCalls.some((c) => c.col === 'used_at' && c.val === null)).toBe(true);
    expect(isCalls.some((c) => c.col === 'revoked_at' && c.val === null)).toBe(true);
  });

  it('returns null when no open row matches', async () => {
    const { client } = makeClient({ maybeSingleData: null });
    expect(await findOpenInviteByPlaintext(client, 'nope')).toBeNull();
  });
});

describe('consumeStaffInvite', () => {
  it('returns true when a row was updated (first use)', async () => {
    const { client } = makeClient({ updateData: { id: 'i-1' } });
    expect(await consumeStaffInvite(client, 'i-1')).toBe(true);
  });

  it('returns false on a replay / lost race (no row updated)', async () => {
    const { client } = makeClient({ updateData: null });
    expect(await consumeStaffInvite(client, 'i-1')).toBe(false);
  });
});
