// src/lib/deadLetterQueue.ts
//
// Visibility + safe recovery for dead-lettered outbox jobs.
//
// When a webhook_outbox job exhausts its retries, process-outbox parks it in
// dead_letter_queue and marks the outbox row 'dead'. Historically that was the
// end of the line: no surface, no alert, no recovery — a dropped WhatsApp /
// notification simply vanished, and only a hand-written SQL UPDATE could ever
// resurrect it. This module makes those entries listable and re-runnable from
// the admin surface, reusing the EXISTING outbox + DLQ tables (no parallel
// queue) and the resolved/resolved_at columns that were already on the table.

import type { SupabaseClient } from '@supabase/supabase-js';

export type DeadLetterEntry = {
  id: string;
  job_type: string;
  error_message: string | null;
  attempt_count: number | null;
  created_at: string;
};

/**
 * Unresolved (not-yet-recovered) dead-letter entries, newest first. This is the
 * self-serve "what silently failed" view for an admin.
 */
export async function listUnresolvedDeadLetters(
  supabaseAdmin: SupabaseClient,
  limit = 100,
): Promise<{ entries: DeadLetterEntry[]; error: string | null }> {
  const { data, error } = await supabaseAdmin
    .from('dead_letter_queue')
    .select('id, job_type, error_message, attempt_count, created_at')
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { entries: [], error: error.message };
  return { entries: (data ?? []) as DeadLetterEntry[], error: null };
}

/** Count of unresolved dead-letter entries — drives the in-app indicator/badge. */
export async function countUnresolvedDeadLetters(
  supabaseAdmin: SupabaseClient,
): Promise<number> {
  const { count } = await supabaseAdmin
    .from('dead_letter_queue')
    .select('id', { count: 'exact', head: true })
    .eq('resolved', false);
  return count ?? 0;
}

export type RetryResult =
  | { ok: true; status: 'requeued' | 'already_resolved'; outboxId?: string }
  | { ok: false; error: string };

/**
 * Safely re-run a dead-lettered job: re-enqueue it onto webhook_outbox (fresh
 * pending row, attempt counter reset) and mark the DLQ entry resolved.
 *
 * Idempotent: the entry is CLAIMED first (resolved flips false->true in a single
 * conditional update), so a double-click or a concurrent retry finds it already
 * resolved and enqueues nothing — one DLQ entry can never fan out into two
 * outbox jobs. If the re-enqueue insert then fails, the claim is rolled back so
 * the entry stays visible and retry-able (never silently lost). The outbox job
 * handlers are themselves idempotent (WhatsApp sends dedupe), so even a
 * worst-case double delivery is harmless.
 */
export async function retryDeadLetterEntry(
  supabaseAdmin: SupabaseClient,
  dlqId: string,
): Promise<RetryResult> {
  // (1) Atomically claim: only an unresolved row transitions.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('dead_letter_queue')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', dlqId)
    .eq('resolved', false)
    .select('id, job_type, payload')
    .maybeSingle();
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed) {
    // Missing or already resolved/retried — nothing to do (idempotent no-op).
    return { ok: true, status: 'already_resolved' };
  }
  const row = claimed as { id: string; job_type: string; payload: unknown };

  // (2) Re-enqueue a fresh outbox job.
  const { data: ins, error: insErr } = await supabaseAdmin
    .from('webhook_outbox')
    .insert({
      job_type: row.job_type,
      payload: row.payload,
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insErr || !ins) {
    // (3) Roll the claim back so the entry stays recoverable.
    await supabaseAdmin
      .from('dead_letter_queue')
      .update({ resolved: false, resolved_at: null })
      .eq('id', dlqId);
    return { ok: false, error: insErr?.message ?? 'enqueue failed' };
  }

  return { ok: true, status: 'requeued', outboxId: (ins as { id: string }).id };
}
