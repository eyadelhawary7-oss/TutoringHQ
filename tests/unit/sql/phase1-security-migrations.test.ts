import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * SQL contract tests for the Phase 1 critical-security migrations. vitest has no
 * Postgres, so the behaviors are pinned at the migration-source level (a repo
 * edit that drops a guarantee fails CI). The live functions were applied to prod
 * and verified via catalog introspection + transactional runtime probes during
 * Phase 1 (grant denial, underpayment rejection, atomic credit rollback).
 */

function mig(name: string): string {
  return readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8');
}

const A = mig('20260625000001_phase1a_lockdown_money_rpcs.sql');
const B = mig('20260625000002_phase1b_remove_ai_execute_query.sql');
const C = mig('20260625000003_phase1c_atomic_combined_finalize.sql');

function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  expect(start, `function ${name} present`).toBeGreaterThan(-1);
  const rest = sql.slice(start);
  const next = rest.indexOf('CREATE OR REPLACE FUNCTION', 10);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('Fix A — money/credit/billing RPC lockdown (SQL contract)', () => {
  const MONEY_RPCS = [
    'earn_credits_atomic',
    'spend_credits_atomic',
    'reserve_credits_atomic',
    'cancel_reservation_atomic',
    'process_payment_rpc',
    'deduct_blast_balance_rpc',
    'redeem_promo_code',
    'increment_promo_uses',
    'try_finalize_payment_session',
  ];

  it('revokes EXECUTE from PUBLIC, anon, authenticated on every money/billing RPC', () => {
    for (const fn of MONEY_RPCS) {
      expect(A, `${fn} in revoke list`).toContain(`'${fn}'`);
    }
    expect(A).toContain('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon');
    expect(A).toMatch(/FROM PUBLIC, anon, authenticated/);
    // never re-grants authenticated
    expect(A).not.toMatch(/GRANT EXECUTE ON FUNCTION %s TO authenticated/);
    expect(A).toContain('GRANT EXECUTE ON FUNCTION %s TO service_role');
  });

  it('defines a caller-center guard that allows service-role (auth.uid() NULL) only', () => {
    const guard = fnBody(A, 'assert_caller_center_access');
    expect(guard).toContain('v_uid := auth.uid()');
    expect(guard).toMatch(/IF v_uid IS NULL THEN\s*\n\s*RETURN;/);
    expect(guard).toContain('IS DISTINCT FROM p_center_id');
    expect(guard).toContain('RAISE EXCEPTION');
  });

  it('each credit/money function calls the guard before mutating', () => {
    for (const fn of [
      'earn_credits_atomic',
      'spend_credits_atomic',
      'reserve_credits_atomic',
      'cancel_reservation_atomic',
      'process_payment_rpc',
      'deduct_blast_balance_rpc',
    ]) {
      expect(fnBody(A, fn), `${fn} guards caller`).toContain(
        'PERFORM public.assert_caller_center_access(p_center_id)',
      );
    }
  });

  it('process_payment_rpc refuses an amount below the invoice total (no clear on underpayment)', () => {
    const body = fnBody(A, 'process_payment_rpc');
    expect(body).toContain('p_amount < v_invoice.total_amount');
    expect(body).toMatch(/RAISE EXCEPTION 'underpayment/);
    // the underpayment guard must precede marking the invoice paid
    const guardIdx = body.indexOf('underpayment');
    const paidIdx = body.indexOf("UPDATE invoices");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(paidIdx);
  });
});

describe('Fix B — AI query primitive removed (SQL contract)', () => {
  it('drops ai_execute_query', () => {
    expect(B).toContain('DROP FUNCTION IF EXISTS public.ai_execute_query(text, uuid)');
  });
});

describe('Fix C — atomic combined finalize (SQL contract)', () => {
  it('try_finalize_payment_session no longer writes finalized_at (claim-only)', () => {
    const body = fnBody(C, 'try_finalize_payment_session');
    expect(body).not.toMatch(/finalized_at\s*=\s*NOW\(\)/);
    expect(body).toContain('RETURN TRUE');
  });

  it('finalize_combined_session_paid spends credit AND finalizes in one function', () => {
    const body = fnBody(C, 'finalize_combined_session_paid');
    expect(body).toContain('spend_credits_atomic');
    expect(body).toMatch(/finalized_at\s*=\s*NOW\(\)/);
    expect(body).toContain("status = 'paid'");
    // credit spend must come before the paid/finalized write (same txn → atomic)
    const spendIdx = body.indexOf('spend_credits_atomic');
    const paidWriteIdx = body.indexOf('UPDATE combined_payment_sessions');
    expect(spendIdx).toBeGreaterThan(-1);
    expect(paidWriteIdx).toBeGreaterThan(-1);
    expect(spendIdx).toBeLessThan(paidWriteIdx);
    // idempotent replay guard
    expect(body).toContain("RETURN 'already_done'");
  });

  it('advisory-lock key strips uuid hyphens before the hex cast', () => {
    for (const fn of ['try_finalize_payment_session', 'finalize_combined_session_paid']) {
      expect(fnBody(C, fn), `${fn} lock key`).toContain(
        "replace(p_session_id::TEXT, '-', '')",
      );
    }
  });

  it('finalize RPC is granted to service_role only', () => {
    expect(C).toContain(
      'REVOKE EXECUTE ON FUNCTION public.finalize_combined_session_paid(uuid, numeric, text) FROM PUBLIC, anon, authenticated',
    );
    expect(C).toContain('TO service_role');
  });
});
