import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hashToken,
  issueForWebhook,
  mintForFallback,
  claimToken,
  findLiveTokenByPlaintext,
} from '@/lib/pinSetupTokens';

/**
 * Stateful fake: simulates the parts of the pin_setup_tokens table we touch.
 * - INSERT with the partial-unique-index constraint (one live webhook row per user).
 * - SELECT by user_id / token_hash with live + unused + unexpired filter.
 * - UPDATE atomic claim (used_at IS NULL AND expires_at > now()).
 */
type Row = {
  id: string;
  user_id: string;
  token_hash: string | null;
  source: 'webhook_paymob' | 'fallback_link';
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

function makeFakeAdmin(): {
  admin: SupabaseClient;
  rows: Row[];
} {
  const rows: Row[] = [];
  let idSeq = 1;

  const insert = (table: string) => (row: Partial<Row>) => {
    if (table !== 'pin_setup_tokens') throw new Error('unexpected insert table');
    // Simulate partial unique index on (user_id) WHERE source='webhook_paymob' AND used_at IS NULL.
    if (row.source === 'webhook_paymob') {
      const conflict = rows.find(
        (r) => r.user_id === row.user_id && r.source === 'webhook_paymob' && r.used_at == null,
      );
      if (conflict) {
        return {
          select() {
            return {
              maybeSingle: async () => ({ data: null, error: { code: '23505' } }),
              single: async () => ({ data: null, error: { code: '23505' } }),
            };
          },
        };
      }
    }
    const r: Row = {
      id: `row-${idSeq++}`,
      user_id: String(row.user_id),
      token_hash: row.token_hash ?? null,
      source: row.source as Row['source'],
      created_at: new Date().toISOString(),
      expires_at: String(row.expires_at),
      used_at: null,
    };
    rows.push(r);
    return {
      select() {
        return {
          maybeSingle: async () => ({ data: { id: r.id }, error: null }),
          single: async () => ({ data: { id: r.id }, error: null }),
        };
      },
    };
  };

  const buildSelect = () => {
    const filters: Array<(r: Row) => boolean> = [];
    let order: { col: keyof Row; asc: boolean } | null = null;
    let lim: number | null = null;
    const api = {
      eq(col: keyof Row, val: unknown) {
        filters.push((r) => (r as unknown as Record<string, unknown>)[col as string] === val);
        return api;
      },
      is(col: keyof Row, val: null) {
        filters.push((r) => (r as unknown as Record<string, unknown>)[col as string] === val);
        return api;
      },
      gt(col: keyof Row, val: string) {
        filters.push(
          (r) =>
            new Date((r as unknown as Record<string, string>)[col as string]).getTime() >
            new Date(val).getTime(),
        );
        return api;
      },
      order(col: keyof Row, opts: { ascending: boolean }) {
        order = { col, asc: opts.ascending };
        return api;
      },
      limit(n: number) {
        lim = n;
        return api;
      },
      async maybeSingle() {
        let res = rows.filter((r) => filters.every((f) => f(r)));
        if (order) {
          const o = order;
          res = res.slice().sort((a, b) => {
            const av = (a as unknown as Record<string, string>)[o.col as string];
            const bv = (b as unknown as Record<string, string>)[o.col as string];
            return (av > bv ? 1 : av < bv ? -1 : 0) * (o.asc ? 1 : -1);
          });
        }
        if (lim !== null) res = res.slice(0, lim);
        return { data: res[0] ?? null, error: null };
      },
    };
    return api;
  };

  const update = () => {
    const setPayload: Partial<Row> = {};
    const filters: Array<(r: Row) => boolean> = [];
    const api = {
      eq(col: keyof Row, val: unknown) {
        filters.push((r) => (r as unknown as Record<string, unknown>)[col as string] === val);
        return api;
      },
      is(col: keyof Row, val: null) {
        filters.push((r) => (r as unknown as Record<string, unknown>)[col as string] === val);
        return api;
      },
      gt(col: keyof Row, val: string) {
        filters.push(
          (r) =>
            new Date((r as unknown as Record<string, string>)[col as string]).getTime() >
            new Date(val).getTime(),
        );
        return api;
      },
      select() {
        return {
          async maybeSingle() {
            const target = rows.find((r) => filters.every((f) => f(r)));
            if (!target) return { data: null, error: null };
            Object.assign(target, setPayload);
            return { data: { user_id: target.user_id }, error: null };
          },
        };
      },
    };
    return {
      from_update: (payload: Partial<Row>) => {
        Object.assign(setPayload, payload);
        return api;
      },
    };
  };

  const admin = {
    from: vi.fn((table: string) => {
      if (table !== 'pin_setup_tokens') {
        return {
          select: buildSelect,
          insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
        };
      }
      const updateApi = update();
      return {
        insert: insert(table),
        select: buildSelect,
        update: (payload: Partial<Row>) => updateApi.from_update(payload),
      };
    }),
  } as unknown as SupabaseClient;

  return { admin, rows };
}

describe('pinSetupTokens helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00Z'));
  });

  it('issueForWebhook: creates a row with token_hash=null, source=webhook_paymob', async () => {
    const { admin, rows } = makeFakeAdmin();
    const res = await issueForWebhook(admin, { userId: 'user-1' });
    expect(res.created).toBe(true);
    expect(res.rowId).toBeTruthy();
    expect(rows[0].source).toBe('webhook_paymob');
    expect(rows[0].token_hash).toBeNull();
  });

  it('issueForWebhook: IDEMPOTENT — a second call for the same user is a no-op (webhook replay)', async () => {
    const { admin, rows } = makeFakeAdmin();
    const first = await issueForWebhook(admin, { userId: 'user-1' });
    const second = await issueForWebhook(admin, { userId: 'user-1' });
    expect(rows).toHaveLength(1);
    expect(second.created).toBe(false);
    expect(second.rowId).toBe(first.rowId);
  });

  it('mintForFallback: stores hash, returns plaintext', async () => {
    const { admin, rows } = makeFakeAdmin();
    const minted = await mintForFallback(admin, { userId: 'user-1' });
    expect(typeof minted.plaintext).toBe('string');
    expect(minted.plaintext.length).toBeGreaterThan(20);
    expect(rows[0].token_hash).toBe(hashToken(minted.plaintext));
    expect(rows[0].source).toBe('fallback_link');
  });

  it('findLiveTokenByPlaintext: returns the row when hashes match', async () => {
    const { admin } = makeFakeAdmin();
    const minted = await mintForFallback(admin, { userId: 'user-1' });
    const found = await findLiveTokenByPlaintext(admin, minted.plaintext);
    expect(found?.id).toBe(minted.rowId);
    expect(found?.source).toBe('fallback_link');
  });

  it('findLiveTokenByPlaintext: returns null on unknown token', async () => {
    const { admin } = makeFakeAdmin();
    const found = await findLiveTokenByPlaintext(admin, 'not-a-real-token');
    expect(found).toBeNull();
  });

  it('claimToken: first claim succeeds, second claim returns null (atomicity)', async () => {
    const { admin } = makeFakeAdmin();
    const issued = await issueForWebhook(admin, { userId: 'user-1' });
    const first = await claimToken(admin, { rowId: issued.rowId, ip: '1.2.3.4' });
    expect(first?.userId).toBe('user-1');
    const second = await claimToken(admin, { rowId: issued.rowId, ip: '1.2.3.4' });
    expect(second).toBeNull();
  });
});
