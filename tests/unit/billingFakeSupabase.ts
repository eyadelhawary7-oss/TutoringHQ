/**
 * Shared in-memory Supabase fake for the billing-reliability unit tests.
 *
 * Chainable select/insert/update with eq/neq/in/gte/lte/not/is filters. Builders
 * are thenable so `await from().select().eq()` resolves to `{ data, error }`.
 * Mirrors the minimal surface the reconciliation / adapter / finalizer code uses.
 */

export type Row = Record<string, unknown>;

let __id = 0;

export function makeFakeSupabase(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let mode: 'select' | 'update' | 'insert' = 'select';
    let payload: Row | null = null;

    const rowsOf = () => tables[table] ?? (tables[table] = []);

    const apply = () => {
      const rows = rowsOf();
      if (mode === 'insert') {
        const toInsert = Array.isArray(payload) ? payload : [payload];
        // Simulate the gen_random_uuid() default so dedup-by-id works like prod.
        for (const p of toInsert) {
          const row = { ...(p as Row) };
          if (row.id === undefined) row.id = `fake-${++__id}`;
          rows.push(row);
        }
        return { data: payload, error: null };
      }
      if (mode === 'update') {
        for (const r of rows) {
          if (filters.every((f) => f(r))) Object.assign(r, payload);
        }
        return { data: null, error: null };
      }
      return { data: rows.filter((r) => filters.every((f) => f(r))), error: null };
    };

    const api: Record<string, unknown> = {
      select() {
        mode = 'select';
        return api;
      },
      update(p: Row) {
        mode = 'update';
        payload = p;
        return api;
      },
      insert(p: Row) {
        mode = 'insert';
        payload = p;
        return Promise.resolve(apply());
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return api;
      },
      neq(col: string, val: unknown) {
        filters.push((r) => r[col] !== val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return api;
      },
      gte(col: string, val: unknown) {
        filters.push((r) => (r[col] as string) >= (val as string));
        return api;
      },
      lte(col: string, val: unknown) {
        filters.push((r) => (r[col] as string) <= (val as string));
        return api;
      },
      not(col: string, op: string, val: unknown) {
        if (op === 'is' && val === null) filters.push((r) => r[col] != null);
        else filters.push((r) => r[col] !== val);
        return api;
      },
      is(col: string, val: unknown) {
        if (val === null) filters.push((r) => r[col] == null);
        else filters.push((r) => r[col] === val);
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      maybeSingle() {
        const rows = rowsOf().filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: rows[0] ? { ...rows[0] } : null, error: null });
      },
      single() {
        const rows = rowsOf().filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: rows[0] ? { ...rows[0] } : null, error: rows[0] ? null : { message: 'no row' } });
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(apply()).then(resolve);
      },
    };
    return api;
  }

  return { from: (table: string) => builder(table) } as never;
}
