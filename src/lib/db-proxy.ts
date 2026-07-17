import { supabase } from './supabase';

export interface Filter {
  column: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'not_is' | 'in';
  value: unknown;
}

interface QueryOptions {
  table: string;
  select?: string;
  filters?: Filter[];
  order?: { column: string; ascending?: boolean };
  limit?: number;
  single?: boolean;
}

interface MutationOptions {
  table: string;
  data: Record<string, unknown> | Record<string, unknown>[];
  filters?: Filter[];
  select?: string | false;
  single?: boolean;
}

async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

const DEBUG_DB_PROXY = typeof window !== 'undefined' && (process.env.NODE_ENV === 'development' || (window as { __DEBUG_DB?: boolean }).__DEBUG_DB);

async function dbRequest(body: Record<string, unknown>) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');

  const url = '/api/db';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  const isStateChange = ['insert', 'update', 'delete'].includes(body.operation as string);
  if (isStateChange) {
    const { getCsrfHeaders } = await import('./csrf-client');
    Object.assign(headers, await getCsrfHeaders(token));
  }
  const requestBody = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: requestBody });
  } catch (fetchErr) {
    if (DEBUG_DB_PROXY) {
      console.error('[db-proxy] Fetch failed:', fetchErr);
      console.error('[db-proxy] Full stack:', (fetchErr as Error)?.stack);
    }
    throw fetchErr;
  }

  let result: {
    data?: unknown;
    error?: string | { message?: string };
    count?: number;
    code?: string;
    permanent?: boolean;
    locked?: boolean;
  };
  try {
    result = await res.json();
  } catch (parseErr) {
    const text = await res.text().catch(() => '');
    if (DEBUG_DB_PROXY) {
      console.error('[db-proxy] JSON parse failed:', parseErr);
      console.error('[db-proxy] Response body:', text);
    }
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }

  if (result.error) {
    const err = new Error(
      typeof result.error === 'string' ? result.error : (result.error?.message ?? 'Unknown error'),
    ) as Error & { code?: string; permanent?: boolean; locked?: boolean };
    // Surface the server's classification so callers (the offline scanner sync)
    // can DROP a permanently-rejected item instead of retrying it forever, and can
    // react to a lock. A permanent rejection is one the server will never accept
    // (e.g. a scan taken while the centre was locked), distinct from a transient
    // network/5xx failure that should keep retrying.
    if (typeof result.code === 'string') err.code = result.code;
    err.permanent = result.permanent === true;
    err.locked = result.locked === true;
    return { data: null, error: err, count: result.count };
  }
  return { data: result.data, error: null, count: result.count };
}

/** True when a dbInsert/dbRequest error is a server-final rejection (never retryable). */
export function isPermanentDbError(err: unknown): boolean {
  return err instanceof Error && (err as { permanent?: boolean }).permanent === true;
}

/** True when a dbInsert/dbRequest error indicates the centre is locked / suspended. */
export function isCenterLockedDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string; locked?: boolean }).code;
  return (
    (err as { locked?: boolean }).locked === true ||
    code === 'CENTER_LOCKED' ||
    code === 'CENTER_LOCKED_SCAN_REJECTED' ||
    code === 'CENTER_SUSPENDED' ||
    code === 'CENTER_BLACKLISTED'
  );
}

/** SELECT query that bypasses RLS */
export async function dbSelect(options: QueryOptions) {
  return dbRequest({
    operation: 'select',
    table: options.table,
    select: options.select,
    filters: options.filters,
    order: options.order,
    limit: options.limit,
    single: options.single,
  });
}

/** INSERT that bypasses RLS */
export async function dbInsert(options: MutationOptions) {
  return dbRequest({
    operation: 'insert',
    table: options.table,
    data: options.data,
    select: options.select,
    single: options.single,
  });
}

/** UPDATE that bypasses RLS */
export async function dbUpdate(options: MutationOptions) {
  return dbRequest({
    operation: 'update',
    table: options.table,
    data: options.data,
    filters: options.filters,
  });
}

/** DELETE that bypasses RLS */
export async function dbDelete(options: { table: string; filters: Filter[] }) {
  return dbRequest({
    operation: 'delete',
    table: options.table,
    filters: options.filters,
  });
}

/** COUNT query that bypasses RLS */
export async function dbCount(options: QueryOptions) {
  return dbRequest({
    operation: 'count',
    table: options.table,
    select: options.select,
    filters: options.filters,
  });
}

/** Log an audit entry (server: service role via /api/audit-log) */
export async function auditLog(params: {
  centerId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
}) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');

  const url = '/api/audit-log';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const { getCsrfHeaders } = await import('./csrf-client');
  Object.assign(headers, await getCsrfHeaders(token));

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        details: params.details ?? {},
      }),
    });
  } catch (fetchErr) {
    throw fetchErr;
  }

  let result: { ok?: boolean; error?: string };
  try {
    result = await res.json();
  } catch (parseErr) {
    const text = await res.text().catch(() => '');
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }

  if (!res.ok || result.error) {
    const err = new Error(typeof result.error === 'string' ? result.error : `HTTP ${res.status}`);
    return { data: null, error: err, count: undefined };
  }
  return { data: result, error: null, count: undefined };
}
