import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The invoice tamper guard is enforced at the DB level (BEFORE UPDATE trigger),
 * verified live for both owner types during the migration. Unit tests can't run a
 * Postgres trigger, so this guards the MIGRATION SOURCE so the verified contract
 * can't silently regress: a paid invoice's money fields are immutable for centers
 * AND teachers, finalization still works, and only chargeback / the audited
 * correction bypass may touch a paid invoice.
 *
 * The migration source now lives under supabase/migrations_archive/ — Phase 0
 * collapsed the applied migrations into 00000000000000_baseline.sql and archived
 * the originals. This contract pins the original migration text, so it reads
 * from the archive.
 */
const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations_archive/20260626000000_billing_reliability_hardening.sql'),
  'utf8',
);

describe('invoice tamper guard (migration source)', () => {
  it('is owner-agnostic: locks owner identity for center AND teacher invoices', () => {
    expect(sql).toMatch(/cannot modify owner_type/);
    expect(sql).toMatch(/cannot modify center_id/);
    expect(sql).toMatch(/cannot modify teacher_id/);
    // No center-only gating that would exclude teacher rows from the paid-lock.
    expect(sql).not.toMatch(/IF\s+OLD\.owner_type\s*=\s*'center'/i);
  });

  it("locks a paid invoice's money-critical fields", () => {
    expect(sql).toMatch(/OLD\.status\s*=\s*'paid'/);
    for (const field of ['total_amount', 'amount_received', 'paid_at', 'invoice_type', 'paymob_transaction_id']) {
      expect(sql).toMatch(new RegExp(`cannot modify ${field} of a paid invoice`));
    }
  });

  it('still allows the legitimate finalization and the one forced reversal (chargeback)', () => {
    // The paid-status lock carves out chargeback; pending->paid is unguarded.
    expect(sql).toMatch(/NEW\.status\s*<>\s*'chargeback'/);
  });

  it('provides an audited correction bypass (not an in-place free-for-all)', () => {
    expect(sql).toMatch(/app\.allow_invoice_correction/);
  });

  it('asserts the trigger on the invoices table', () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_chq_prevent_invoice_tampering/);
    expect(sql).toMatch(/BEFORE UPDATE ON public\.invoices/);
  });
});
