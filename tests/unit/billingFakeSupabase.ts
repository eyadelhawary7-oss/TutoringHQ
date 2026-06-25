/**
 * Shared in-memory Supabase fake for the billing-reliability unit tests.
 *
 * Chainable select/insert/update with eq/neq/in/gte/lte/not/is filters. Builders
 * are thenable so `await from().select().eq()` resolves to `{ data, error }`.
 * Mirrors the minimal surface the reconciliation / adapter / finalizer code uses.
 */

export type Row = Record<string, unknown>;

let __id = 0;

/**
 * In-memory implementation of the Phase 3 atomic finalize RPCs
 * (finalize_subscription_invoice_paid / finalize_teacher_invoice_paid) — they
 * mark the invoice paid AND apply the dependent side-effects together, exactly
 * as the Postgres functions do in one transaction. Shared so every billing fake
 * models the same atomic step.
 */
export function applyFinalizeInvoiceRpc(
  tables: Record<string, Row[]>,
  name: string,
  params: Record<string, unknown>,
): { data: string; error: null } {
  const invoices = tables.invoices ?? (tables.invoices = []);
  const markPaid = (inv: Row) =>
    Object.assign(inv, {
      status: 'paid',
      amount_received: params.p_amount_received,
      payment_method: 'paymob',
      payment_reference: params.p_txn_id,
      paymob_transaction_id: params.p_txn_id,
      paid_at: new Date().toISOString(),
      metadata: params.p_metadata,
    });

  if (name === 'finalize_teacher_invoice_paid') {
    const inv = invoices.find(
      (r) =>
        r.id === params.p_invoice_id &&
        r.owner_type === 'teacher' &&
        r.teacher_id === params.p_teacher_id &&
        r.status !== 'paid',
    );
    if (!inv) return { data: 'already_paid', error: null };
    markPaid(inv);
    const sub = (tables.teacher_subscriptions ?? [])
      .filter((s) => s.teacher_id === params.p_teacher_id)
      .sort((a, b) => (String(b.created_at ?? '') > String(a.created_at ?? '') ? 1 : -1))[0];
    if (sub) {
      Object.assign(sub, {
        status: 'active',
        current_period_start: params.p_period_start,
        current_period_end: params.p_period_end,
        next_billing_at: params.p_period_end,
        last_payment_at: params.p_period_start,
        grace_until: null,
        dunning_attempts: 0,
      });
    }
    return { data: 'completed', error: null };
  }

  if (name === 'finalize_subscription_invoice_paid') {
    const inv = invoices.find(
      (r) => r.id === params.p_invoice_id && r.center_id === params.p_center_id && r.status !== 'paid',
    );
    if (!inv) return { data: 'already_paid', error: null };
    markPaid(inv);
    (tables.renewal_history ?? (tables.renewal_history = [])).push({
      id: `fake-rh-${++__id}`,
      center_id: params.p_center_id,
      renewal_date: params.p_renewal_date,
      amount_paid: params.p_total_amount,
      payment_method: 'paymob',
      recorded_by: null,
    });
    const center = (tables.centers ?? []).find((c) => c.id === params.p_center_id);
    if (center) {
      Object.assign(center, {
        billing_status: 'paid',
        next_payment_due: params.p_next_payment_due,
        auto_suspend_at: params.p_auto_suspend_at,
        last_payment_date: params.p_last_payment_date,
        upgrade_count_this_period: 0,
      });
      if (params.p_was_suspended) {
        center.status = 'active';
        center.subscription_status = 'active';
      }
    }
    return { data: 'completed', error: null };
  }

  throw new Error(`unexpected rpc in fake: ${name}`);
}

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
      or(expr: string) {
        // PostgREST or-string: `col.op.val,col.op.val` — OR of the clauses,
        // AND-ed with the rest of the chain. Supports gte/lte/eq (enough for
        // the reconciliation window filter).
        const clauses = String(expr)
          .split(',')
          .map((c) => {
            const firstDot = c.indexOf('.');
            const secondDot = c.indexOf('.', firstDot + 1);
            return {
              col: c.slice(0, firstDot),
              op: c.slice(firstDot + 1, secondDot),
              val: c.slice(secondDot + 1),
            };
          });
        filters.push((r) =>
          clauses.some(({ col, op, val }) => {
            const cell = r[col];
            if (cell == null) return false;
            if (op === 'gte') return String(cell) >= val;
            if (op === 'lte') return String(cell) <= val;
            if (op === 'eq') return String(cell) === val;
            return false;
          }),
        );
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

  return {
    from: (table: string) => builder(table),
    rpc: async (name: string, params: Record<string, unknown>) =>
      applyFinalizeInvoiceRpc(tables, name, params),
  } as never;
}
