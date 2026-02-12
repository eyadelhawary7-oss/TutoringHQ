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

async function dbRequest(body: Record<string, unknown>) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch('/api/db', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  if (result.error) {
    return { data: null, error: { message: result.error }, count: result.count };
  }
  return { data: result.data, error: null, count: result.count };
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

/** Log an audit entry */
export async function auditLog(params: {
  centerId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
}) {
  return dbInsert({
    table: 'audit_log',
    data: {
      center_id: params.centerId,
      user_id: params.userId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      details: params.details ?? {},
    },
    select: false,
  });
}
