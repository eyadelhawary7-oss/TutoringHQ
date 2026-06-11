import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * SQL contract tests for 20260611000002_center_cut_and_group_proposals.sql.
 *
 * vitest has no Postgres, so the four finish_center_class_and_bill behaviors
 * (cut>0 dual transactions, cut=0 lesson-only, idempotency, center-only kind
 * gate) cannot execute here - they are pinned at the SQL-text level instead,
 * so a repo edit that drops one of the guarantees fails CI. The live function
 * was applied to prod and verified via catalog introspection (Rule 146).
 */

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260611000002_center_cut_and_group_proposals.sql',
  ),
  'utf8',
);

function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const rest = sql.slice(start);
  const next = rest.indexOf('CREATE OR REPLACE FUNCTION', 10);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('finish_center_class_and_bill (SQL contract)', () => {
  const body = fnBody('finish_center_class_and_bill');

  it('cut > 0 writes a center_fee transaction alongside the lesson transaction', () => {
    expect(body).toContain("IF v_cut > 0 THEN");
    expect(body).toContain("'center_fee', p_session_id");
    expect(body).toMatch(/v_cut\s+:= COALESCE\(v_group\.center_cut_egp, 0\)/);
    // The center_fee charge bills the cut, not the fee.
    expect(body).toContain('v_teacher_id, v_center_id, v_cut, v_cut');
  });

  it('cut = 0 skips the center_fee insert (it lives only inside the v_cut > 0 branch)', () => {
    const centerFeeInserts = body.match(/'center_fee', p_session_id/g) ?? [];
    expect(centerFeeInserts).toHaveLength(1);
    const guardPos = body.indexOf('IF v_cut > 0 THEN');
    expect(body.indexOf("'center_fee', p_session_id")).toBeGreaterThan(guardPos);
  });

  it('is idempotent: billed sessions no-op and every charge carries an idempotency key', () => {
    expect(body).toContain('IF v_session.billed THEN');
    expect(body).toContain('RETURN QUERY SELECT v_session.id, false, 0');
    expect(body).toContain("'lesson:' || p_session_id::text || ':' || v_attendee.student_id::text");
    expect(body).toContain("'center_fee:' || p_session_id::text || ':' || v_attendee.student_id::text");
    const notExists = body.match(/WHERE NOT EXISTS \(\s*SELECT 1 FROM public\.transactions t WHERE t\.idempotency_key/g) ?? [];
    expect(notExists.length).toBe(2);
  });

  it("rejects kind <> 'center' with errcode 23514", () => {
    expect(body).toContain("IF v_session.kind <> 'center' THEN");
    expect(body).toMatch(/finish_center_class_and_bill is center-only[\s\S]*?errcode = '23514'/);
  });

  it('is locked to service_role (no anon/authenticated execute)', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.finish_center_class_and_bill\(uuid, uuid\)\s*\n\s*FROM public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.finish_center_class_and_bill\(uuid, uuid\)\s*\n\s*TO service_role/,
    );
  });
});

describe('group proposal negotiation engine (SQL contract)', () => {
  it('every offer insert resets the negotiation clock (expires_at = now() + 7 days)', () => {
    const guard = fnBody('guard_group_proposal_offer');
    expect(guard).toContain("set expires_at = now() + interval '7 days'");
  });

  it('accept creates the center student_groups row with the accepted cut', () => {
    const respond = fnBody('respond_group_proposal');
    expect(respond).toContain(
      '(center_id, teacher_id, kind, name, subject, fee_per_class, center_cut_egp, status)',
    );
    expect(respond).toContain("'center', v_name, v_prop.subject");
    expect(respond).toContain('v_prop.fee_per_class, v_latest.cut_egp');
    expect(respond).toContain('accepted_offer_id = v_latest.id');
  });

  it('turn order is enforced: the latest-offer maker cannot accept/counter', () => {
    const respond = fnBody('respond_group_proposal');
    expect(respond).toContain('if v_latest.made_by = p_side then');
    expect(respond).toMatch(/not your turn[\s\S]*?errcode = '23514'/);
  });

  it('respond_group_proposal is locked to service_role (SECURITY DEFINER + trusted params)', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.respond_group_proposal\(uuid, uuid, text, text, numeric, text\)\s*\n\s*FROM public, anon, authenticated/,
    );
  });

  it('center_cut_egp is bounded by fee_per_class at the table level', () => {
    expect(sql).toContain(
      'CHECK (center_cut_egp >= 0 AND (fee_per_class IS NULL OR center_cut_egp <= fee_per_class))',
    );
  });
});
