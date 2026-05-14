import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `platform_config.value` is JSONB NOT NULL. PostgREST upsert/batch paths can map
 * JSON null to SQL NULL. Store explicit jsonb null via JSON.parse where needed,
 * and prefer update-then-insert for single-key writes (see pricing-admin routes).
 */
export function serializePlatformConfigJsonbValue(v: unknown): unknown {
  if (v === null) {
    return JSON.parse('null') as null;
  }
  return v;
}

export type PlatformConfigUpsertPayload = {
  key: string;
  value: unknown;
  updated_at: string;
  updated_by?: string | null;
};

/** Log structured details for diagnosing NOT NULL / PostgREST issues on admin/pricing saves. */
export function logPlatformConfigWriteFailure(
  logContext: string,
  phase: 'update' | 'insert',
  row: Pick<PlatformConfigUpsertPayload, 'key'>,
  err: { message?: string; code?: string; details?: string; hint?: string },
) {
  console.error('[platform_config write failed]', {
    trigger: logContext,
    phase,
    key: row.key,
    message: err.message,
    code: err.code,
    details: err.details,
    hint: err.hint,
    fullErrorSerialized: (() => {
      try {
        return JSON.stringify(err);
      } catch {
        return String(err);
      }
    })(),
  });
  console.error('[platform_config write failed] raw object:', err);
}

/** Single-row update by key; insert if missing. Avoids `.upsert()` for PostgREST null pitfalls. */
export async function upsertPlatformConfigRowUpdateInsert(
  supabase: SupabaseClient,
  row: PlatformConfigUpsertPayload,
  logContext: string,
): Promise<{ ok: boolean; message?: string }> {
  const value = serializePlatformConfigJsonbValue(row.value);
  const patch: Record<string, unknown> = {
    value,
    updated_at: row.updated_at,
  };
  if (row.updated_by != null && row.updated_by !== '') {
    patch.updated_by = row.updated_by;
  }

  const { data: updatedKeys, error: updateErr } = await supabase
    .from('platform_config')
    .update(patch)
    .eq('key', row.key)
    .select('key');

  if (updateErr) {
    logPlatformConfigWriteFailure(logContext, 'update', { key: row.key }, updateErr);
    return { ok: false, message: updateErr.message };
  }

  if (updatedKeys?.length) {
    return { ok: true };
  }

  const insertBody: Record<string, unknown> = { key: row.key, ...patch };
  const { error: insertErr } = await supabase.from('platform_config').insert(insertBody);

  if (insertErr && !String(insertErr.message ?? '').toLowerCase().includes('duplicate')) {
    logPlatformConfigWriteFailure(logContext, 'insert', { key: row.key }, insertErr);
    return { ok: false, message: insertErr.message };
  }

  return { ok: true };
}
