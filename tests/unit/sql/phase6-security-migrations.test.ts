import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * SQL contract tests for the Phase 6 re-audit migrations (Fix A / B / F). vitest
 * has no Postgres, so the guarantees are pinned at the migration-source level (a
 * repo edit that drops one fails CI). The grants were ALSO applied to prod and
 * verified live during Phase 6 via catalog introspection and a
 * has_function_privilege access matrix:
 *
 *   Fix A/B RPCs        authenticated=DENY anon=DENY service_role=ALLOW
 *   Fix F trigger fns   all roles=DENY (trigger fires as owner; EXECUTE unchecked)
 *   Fix F helpers       authenticated=ALLOW anon=DENY  (PUBLIC-served helpers untouched)
 *
 * and the rebuilt-from-migrations grant block was diffed byte-for-byte against
 * db/schema.snapshot (and against fresh prod introspection — md5 match).
 */

function mig(name: string): string {
  return readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8');
}

const A = mig('20260626134248_phase6a_lockdown_definer_rpcs.sql');
const B = mig('20260626134256_phase6b_restrict_global_recompute.sql');
const F = mig('20260626134308_phase6f_tighten_anon_definer_funcs.sql');

describe('Fix A — broader unguarded definer RPC lockdown (SQL contract)', () => {
  const A_RPCS = [
    'append_commission_pause',
    'close_commission_pause',
    'approve_student_rpc',
    'complete_onboarding_step_rpc',
    'upsert_scan_metric',
    'get_center_benchmarks',
    'recalc_student_lifecycle',
    'compute_center_health_score',
  ];

  it('lists every per-center/student RPC in the revoke set', () => {
    for (const fn of A_RPCS) {
      expect(A, `${fn} in revoke list`).toContain(`'${fn}'`);
    }
  });

  it('revokes EXECUTE from PUBLIC, anon, authenticated and re-grants service_role only', () => {
    expect(A).toMatch(/REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
    expect(A).toContain('GRANT EXECUTE ON FUNCTION %s TO service_role');
    expect(A).not.toMatch(/GRANT EXECUTE ON FUNCTION %s TO (anon|authenticated)/);
  });
});

describe('Fix B — platform-wide recompute RPC restriction (SQL contract)', () => {
  const GLOBAL_RPCS = [
    'recalc_all_lifecycle_status',
    'recompute_all_health_scores',
    'compute_benchmark_snapshots',
  ];

  it('restricts every global-recompute RPC to service_role (DoS lever closed)', () => {
    for (const fn of GLOBAL_RPCS) {
      expect(B, `${fn} in revoke list`).toContain(`'${fn}'`);
    }
    expect(B).toMatch(/REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
    expect(B).toContain('GRANT EXECUTE ON FUNCTION %s TO service_role');
    expect(B).not.toMatch(/GRANT EXECUTE ON FUNCTION %s TO (anon|authenticated)/);
  });
});

describe('Fix F — least-privilege on anon-executable definer funcs (SQL contract)', () => {
  const TRIGGER_FNS = [
    'assign_center_code',
    'assign_student_number',
    'chq_block_pack_billing_write',
    'chq_prevent_blast_tampering',
    'chq_prevent_card_order_tampering',
    'chq_prevent_center_escalation',
    'chq_prevent_invoice_tampering',
    'chq_prevent_user_escalation',
    'resolve_inactivity_alerts_on_scan',
    'trigger_recalc_lifecycle_on_scan',
  ];

  const HELPERS = [
    'can_manage_students_fn',
    'can_record_payments_fn',
    'is_super_admin',
    'get_my_center_id',
  ];

  it('strips EXECUTE from all roles on the trigger functions (guarded to trigger fns only)', () => {
    for (const fn of TRIGGER_FNS) {
      expect(F, `${fn} in trigger revoke list`).toContain(`'${fn}'`);
    }
    expect(F).toMatch(/REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role/);
    // never blindly revokes a non-trigger by mistake
    expect(F).toContain("prorettype = 'pg_catalog.trigger'::regtype");
  });

  it('revokes anon AND PUBLIC on the non-anon RLS helpers but keeps authenticated', () => {
    for (const fn of HELPERS) {
      expect(F, `${fn} in helper revoke list`).toContain(`'${fn}'`);
    }
    expect(F).toMatch(/REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon/);
    expect(F).toContain('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role');
  });

  it('does NOT touch the PUBLIC-served RLS helpers (anon still needs them)', () => {
    for (const keep of [
      'get_auth_center_id',
      'get_auth_center_group_ids',
      'get_auth_teacher_group_ids',
      'has_center_role',
      'is_auth_teacher_suspended',
    ]) {
      expect(F, `${keep} must NOT be revoked`).not.toContain(`'${keep}'`);
    }
  });
});
