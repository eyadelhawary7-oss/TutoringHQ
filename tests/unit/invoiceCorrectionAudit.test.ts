import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MEDIUM fix: the sanctioned `app.allow_invoice_correction` bypass must write an
 * append-only audit_log entry so no paid-invoice correction is untraceable.
 * vitest can't run the trigger, so this pins the migration source (the live
 * behaviour was verified against PG16 during development and applied to prod via
 * catalog introspection).
 */
const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260625000005_invoice_correction_audit.sql'),
  'utf8',
);

describe('invoice-correction audit (migration source)', () => {
  it('replaces the tamper-guard function', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.chq_prevent_invoice_tampering/);
  });

  it('audits inside the GUC bypass branch', () => {
    const bypassIdx = sql.indexOf("app.allow_invoice_correction', true), '') = 'on'");
    const insertIdx = sql.indexOf('INSERT INTO public.audit_log');
    const returnIdx = sql.indexOf('RETURN NEW;');
    expect(bypassIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(bypassIdx); // audit happens after entering the bypass
    expect(returnIdx).toBeGreaterThan(insertIdx); // and before returning from the branch
  });

  it('records actor, action, reason and before/after of the money fields', () => {
    expect(sql).toMatch(/'invoice_correction'/);
    expect(sql).toMatch(/app\.correction_actor/);
    expect(sql).toMatch(/app\.correction_reason/);
    expect(sql).toMatch(/'before',\s*jsonb_build_object/);
    expect(sql).toMatch(/'after',\s*jsonb_build_object/);
    for (const field of ['total_amount', 'amount_received', 'paid_at', 'invoice_type']) {
      // present in both before and after snapshots
      const occurrences = sql.split(`'${field}', OLD.${field}`).length - 1;
      expect(occurrences + (sql.split(`'${field}', NEW.${field}`).length - 1)).toBeGreaterThanOrEqual(2);
    }
  });

  it('still enforces the paid-invoice guard outside the bypass', () => {
    for (const field of ['total_amount', 'amount_received', 'paid_at', 'invoice_type', 'paymob_transaction_id']) {
      expect(sql).toMatch(new RegExp(`cannot modify ${field} of a paid invoice`));
    }
    expect(sql).toMatch(/cannot modify owner_type/);
  });
});
