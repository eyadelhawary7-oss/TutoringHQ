import type { SupabaseClient } from '@supabase/supabase-js';

const ERROR_MESSAGE_MAX = 1000;
const ERROR_STACK_MAX = 4000;

/** `/api/cron/foo-bar` → `foo-bar` (matches cron_log.cron_name). */
export function cronPathToLogName(apiCronPath: string): string {
  return apiCronPath.replace(/^\/api\/cron\//, '').replace(/\/$/, '');
}

export async function insertCronLogSuccess(
  admin: SupabaseClient,
  cronName: string,
  opts?: { duration_ms?: number; records_processed?: number; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    await admin.from('cron_log').insert({
      cron_name: cronName,
      status: 'success',
      duration_ms: opts?.duration_ms,
      records_processed: opts?.records_processed ?? 0,
      metadata: opts?.metadata ?? null,
    });
  } catch (e) {
    console.error('[cron_log] insert success failed', cronName, e);
  }
}

export async function insertCronLogFailure(
  admin: SupabaseClient,
  cronName: string,
  err: unknown,
  opts?: { duration_ms?: number; metadata?: Record<string, unknown> },
): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? '' : '';
  try {
    await admin.from('cron_log').insert({
      cron_name: cronName,
      status: 'failure',
      duration_ms: opts?.duration_ms,
      records_processed: 0,
      error_message: msg.slice(0, ERROR_MESSAGE_MAX),
      error_stack: stack.slice(0, ERROR_STACK_MAX),
      metadata: opts?.metadata ?? null,
    });
  } catch (e) {
    console.error('[cron_log] insert failure failed', cronName, e);
  }
}

/** Optional status for jobs that complete with warnings (e.g. backup with file errors). */
export async function insertCronLogPartial(
  admin: SupabaseClient,
  cronName: string,
  opts?: {
    duration_ms?: number;
    records_processed?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from('cron_log').insert({
      cron_name: cronName,
      status: 'partial',
      duration_ms: opts?.duration_ms,
      records_processed: opts?.records_processed ?? 0,
      metadata: opts?.metadata ?? null,
    });
  } catch (e) {
    console.error('[cron_log] insert partial failed', cronName, e);
  }
}
