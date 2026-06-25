import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  retryDeadLetterEntry,
  listUnresolvedDeadLetters,
} from '@/lib/deadLetterQueue';

// A dead-lettered job must NOT be silently lost: it has to be listable and
// re-runnable, idempotently, reusing the existing outbox + DLQ tables.

type Stub = {
  admin: SupabaseClient;
  claimMaybeSingle: ReturnType<typeof vi.fn>;
  outboxInsertSingle: ReturnType<typeof vi.fn>;
  rollbackEq: ReturnType<typeof vi.fn>;
};

function makeAdmin(opts: {
  claim: { data: unknown; error: unknown };
  outbox: { data: unknown; error: unknown };
}): Stub {
  const claimMaybeSingle = vi.fn().mockResolvedValue(opts.claim);
  const outboxInsertSingle = vi.fn().mockResolvedValue(opts.outbox);
  const rollbackEq = vi.fn().mockResolvedValue({ error: null });

  const admin = {
    from: (table: string) => {
      if (table === 'dead_letter_queue') {
        return {
          update: (vals: Record<string, unknown>) => {
            // claim flips resolved=true (chainable -> select -> maybeSingle);
            // rollback flips resolved=false (terminal awaited .eq).
            if (vals.resolved === true) {
              return {
                eq: () => ({
                  eq: () => ({ select: () => ({ maybeSingle: claimMaybeSingle }) }),
                }),
              };
            }
            return { eq: rollbackEq };
          },
        };
      }
      if (table === 'webhook_outbox') {
        return { insert: () => ({ select: () => ({ single: outboxInsertSingle }) }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { admin, claimMaybeSingle, outboxInsertSingle, rollbackEq };
}

describe('retryDeadLetterEntry — safe, idempotent recovery', () => {
  it('re-enqueues the job onto webhook_outbox and resolves the entry', async () => {
    const { admin, outboxInsertSingle, rollbackEq } = makeAdmin({
      claim: { data: { id: 'd1', job_type: 'send_card_order_status_wa', payload: { x: 1 } }, error: null },
      outbox: { data: { id: 'o1' }, error: null },
    });

    const res = await retryDeadLetterEntry(admin, 'd1');

    expect(res).toEqual({ ok: true, status: 'requeued', outboxId: 'o1' });
    expect(outboxInsertSingle).toHaveBeenCalledTimes(1);
    expect(rollbackEq).not.toHaveBeenCalled();
  });

  it('is idempotent: an already-resolved (or missing) entry does NOT enqueue again', async () => {
    const { admin, outboxInsertSingle } = makeAdmin({
      claim: { data: null, error: null }, // conditional update matched nothing
      outbox: { data: { id: 'o1' }, error: null },
    });

    const res = await retryDeadLetterEntry(admin, 'd1');

    expect(res).toEqual({ ok: true, status: 'already_resolved' });
    expect(outboxInsertSingle).not.toHaveBeenCalled();
  });

  it('rolls the claim back if re-enqueue fails — the entry stays recoverable, never lost', async () => {
    const { admin, rollbackEq } = makeAdmin({
      claim: { data: { id: 'd1', job_type: 'send_billing_nudge_wa', payload: {} }, error: null },
      outbox: { data: null, error: { message: 'insert failed' } },
    });

    const res = await retryDeadLetterEntry(admin, 'd1');

    expect(res.ok).toBe(false);
    // claim was rolled back (resolved set back to false) so it remains visible.
    expect(rollbackEq).toHaveBeenCalledTimes(1);
  });
});

describe('listUnresolvedDeadLetters — visibility', () => {
  it('returns the unresolved entries (the self-serve "what silently failed" view)', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: 'd1', job_type: 'send_card_order_status_wa', error_message: 'boom', attempt_count: 8, created_at: '2026-06-25T00:00:00Z' }],
      error: null,
    });
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ limit }) }) }),
      }),
    } as unknown as SupabaseClient;

    const { entries, error } = await listUnresolvedDeadLetters(admin);
    expect(error).toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries[0].job_type).toBe('send_card_order_status_wa');
  });
});
