import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  PAYOUT_APPROVAL_MIGRATION_FILE,
  PAYOUT_REJECTION_REASON_MAX,
  PAYOUT_REQUEST_STATUSES,
  PAYOUT_TRANSITION_RPC,
  httpStatusForPayoutRefusal,
  isPayoutApprovalMigrationMissing,
  isPayoutRequestStatus,
  isUuid,
  normalizeRejectionReason,
  parsePayoutApprovalAction,
  parsePayoutTransitionRpcResult,
  planPayoutTransition,
} from '@/lib/payoutApproval';

/**
 * PAYOUT-SYSTEM-SPEC.md §2.1. These lock down the rules that decide whether
 * real money is released, and the one runtime condition that must never be
 * mistaken for a transient failure (the migration not being applied).
 */

describe('payout request statuses', () => {
  it('matches the live CHECK constraint verified 4 Aug 2026', () => {
    expect([...PAYOUT_REQUEST_STATUSES]).toEqual(['pending', 'approved', 'paid', 'rejected']);
  });

  it('rejects anything else', () => {
    expect(isPayoutRequestStatus('settled')).toBe(false);
    expect(isPayoutRequestStatus(null)).toBe(false);
    expect(isPayoutRequestStatus('')).toBe(false);
  });
});

describe('parsePayoutApprovalAction', () => {
  it('accepts the three actions, trimmed', () => {
    expect(parsePayoutApprovalAction('approve')).toBe('approve');
    expect(parsePayoutApprovalAction(' reject ')).toBe('reject');
    expect(parsePayoutApprovalAction('mark_paid')).toBe('mark_paid');
  });

  it('rejects anything else, including near-misses and non-strings', () => {
    expect(parsePayoutApprovalAction('Approve')).toBeNull();
    expect(parsePayoutApprovalAction('paid')).toBeNull();
    expect(parsePayoutApprovalAction('delete')).toBeNull();
    expect(parsePayoutApprovalAction(undefined)).toBeNull();
    expect(parsePayoutApprovalAction({ action: 'approve' })).toBeNull();
  });
});

describe('planPayoutTransition — the legal transition table', () => {
  it('approves a pending request', () => {
    expect(planPayoutTransition('pending', 'approve')).toEqual({
      outcome: 'apply',
      nextStatus: 'approved',
    });
  });

  it('rejects from pending and from approved', () => {
    expect(planPayoutTransition('pending', 'reject')).toEqual({
      outcome: 'apply',
      nextStatus: 'rejected',
    });
    expect(planPayoutTransition('approved', 'reject')).toEqual({
      outcome: 'apply',
      nextStatus: 'rejected',
    });
  });

  it('marks paid only from approved', () => {
    expect(planPayoutTransition('approved', 'mark_paid')).toEqual({
      outcome: 'apply',
      nextStatus: 'paid',
    });
  });

  it('REFUSES mark_paid straight from pending — approval may not be skipped', () => {
    // This is the whole defect: money must not be recorded as sent without a
    // human authorising the release first.
    expect(planPayoutTransition('pending', 'mark_paid')).toEqual({
      outcome: 'conflict',
      status: 'pending',
    });
  });

  it('treats a repeat of the same action as idempotent, not an error', () => {
    // The double-click case from §2.2: the second call must be a no-op success,
    // never a second state change and never a second audit row.
    expect(planPayoutTransition('approved', 'approve')).toEqual({
      outcome: 'idempotent',
      status: 'approved',
    });
    expect(planPayoutTransition('rejected', 'reject')).toEqual({
      outcome: 'idempotent',
      status: 'rejected',
    });
    expect(planPayoutTransition('paid', 'mark_paid')).toEqual({
      outcome: 'idempotent',
      status: 'paid',
    });
  });

  it('never moves a paid request — paid is terminal in both directions', () => {
    expect(planPayoutTransition('paid', 'approve').outcome).toBe('conflict');
    expect(planPayoutTransition('paid', 'reject').outcome).toBe('conflict');
  });

  it('never revives a rejected request', () => {
    expect(planPayoutTransition('rejected', 'approve').outcome).toBe('conflict');
    expect(planPayoutTransition('rejected', 'mark_paid').outcome).toBe('conflict');
  });

  it('treats an unknown status as blocking, not as pass-through', () => {
    // A state added later must default to blocking (spec §7.2 item 4).
    expect(planPayoutTransition('settled_pending_bank', 'approve').outcome).toBe('conflict');
    expect(planPayoutTransition(null, 'approve').outcome).toBe('conflict');
    expect(planPayoutTransition(undefined, 'mark_paid').outcome).toBe('conflict');
  });

  it('covers every (status, action) pair explicitly', () => {
    const actions = ['approve', 'reject', 'mark_paid'] as const;
    const expected: Record<string, Record<string, string>> = {
      pending: { approve: 'apply', reject: 'apply', mark_paid: 'conflict' },
      approved: { approve: 'idempotent', reject: 'apply', mark_paid: 'apply' },
      paid: { approve: 'conflict', reject: 'conflict', mark_paid: 'idempotent' },
      rejected: { approve: 'conflict', reject: 'idempotent', mark_paid: 'conflict' },
    };
    for (const status of PAYOUT_REQUEST_STATUSES) {
      for (const action of actions) {
        expect(`${status}/${action}=${planPayoutTransition(status, action).outcome}`).toBe(
          `${status}/${action}=${expected[status][action]}`,
        );
      }
    }
  });
});

describe('normalizeRejectionReason', () => {
  it('trims and drops empties', () => {
    expect(normalizeRejectionReason('  duplicate request  ')).toEqual({
      ok: true,
      reason: 'duplicate request',
    });
    expect(normalizeRejectionReason('   ')).toEqual({ ok: true, reason: null });
    expect(normalizeRejectionReason(null)).toEqual({ ok: true, reason: null });
    expect(normalizeRejectionReason(42)).toEqual({ ok: true, reason: null });
  });

  it('accepts a reason of exactly the maximum length', () => {
    const exact = 'x'.repeat(PAYOUT_REJECTION_REASON_MAX);
    expect(normalizeRejectionReason(exact)).toEqual({ ok: true, reason: exact });
  });

  it('REFUSES an over-length reason instead of truncating it', () => {
    // Silently storing the first 500 characters would write a half sentence
    // into audit_log.details.reason while reporting success. The reason is the
    // only record of why a payout was denied; a wrong one is worse than none.
    const long = 'x'.repeat(PAYOUT_REJECTION_REASON_MAX + 50);
    expect(normalizeRejectionReason(long)).toEqual({
      ok: false,
      code: 'reason_too_long',
      length: PAYOUT_REJECTION_REASON_MAX + 50,
      max: PAYOUT_REJECTION_REASON_MAX,
    });
  });

  it('measures length after trimming, so surrounding whitespace cannot trip it', () => {
    const padded = `   ${'x'.repeat(PAYOUT_REJECTION_REASON_MAX)}   `;
    expect(normalizeRejectionReason(padded).ok).toBe(true);
  });
});

describe('isPayoutApprovalMigrationMissing', () => {
  it('recognises the PostgREST missing-function code', () => {
    expect(
      isPayoutApprovalMigrationMissing({
        code: 'PGRST202',
        message: `Could not find the function public.${PAYOUT_TRANSITION_RPC}(...) in the schema cache`,
      }),
    ).toBe(true);
  });

  it('recognises 42883 only when the error also names the RPC and says it is absent', () => {
    expect(
      isPayoutApprovalMigrationMissing({
        code: '42883',
        message: `function public.${PAYOUT_TRANSITION_RPC}(uuid, text, uuid, text) does not exist`,
      }),
    ).toBe(true);
  });

  it('recognises the message form when no code is set', () => {
    expect(
      isPayoutApprovalMigrationMissing({
        message: `function public.${PAYOUT_TRANSITION_RPC}(uuid, text, uuid, text) does not exist`,
      }),
    ).toBe(true);
  });

  /*
   * The narrowing that matters. Once the migration IS applied, the function
   * body reads five tables, and unrelated drift inside it raises the same bare
   * SQLSTATEs. Returning 503 there would tell the operator to apply a migration
   * that is already in the catalog, hiding a real fault in a money path behind
   * a confident, wrong explanation.
   */
  it('does NOT claim "migration missing" on a bare SQLSTATE with no RPC name', () => {
    expect(isPayoutApprovalMigrationMissing({ code: '42883', message: 'x' })).toBe(false);
    expect(isPayoutApprovalMigrationMissing({ code: '42703', message: 'x' })).toBe(false);
    expect(isPayoutApprovalMigrationMissing({ code: 'PGRST204', message: 'x' })).toBe(false);
  });

  it('does NOT claim "migration missing" for drift raised inside the applied function', () => {
    // 42703 from the coverage guard after someone renames a column it reads.
    expect(
      isPayoutApprovalMigrationMissing({
        code: '42703',
        message: 'column "reward_amount" does not exist',
        hint: null,
        details: null,
      }),
    ).toBe(false);
    // Same, but PostgREST forwarded the PL/pgSQL CONTEXT line, which names the
    // enclosing function for every error raised inside it. The name alone must
    // not be enough; the text must also say the RPC itself is absent.
    expect(
      isPayoutApprovalMigrationMissing({
        code: '42703',
        message: 'column "reward_amount" does not exist',
        details: `PL/pgSQL function ${PAYOUT_TRANSITION_RPC}(uuid,text,uuid,text) line 62 at SQL statement`,
      }),
    ).toBe(false);
  });

  it('does NOT swallow ordinary failures as "migration missing"', () => {
    expect(isPayoutApprovalMigrationMissing({ code: '23503', message: 'FK violation' })).toBe(false);
    expect(isPayoutApprovalMigrationMissing({ message: 'timeout' })).toBe(false);
    expect(isPayoutApprovalMigrationMissing(null)).toBe(false);
    expect(isPayoutApprovalMigrationMissing('boom')).toBe(false);
  });
});

describe('httpStatusForPayoutRefusal', () => {
  it('maps each refusal code', () => {
    expect(httpStatusForPayoutRefusal('not_found')).toBe(404);
    expect(httpStatusForPayoutRefusal('invalid_action')).toBe(400);
    expect(httpStatusForPayoutRefusal('forbidden_actor')).toBe(403);
    expect(httpStatusForPayoutRefusal('invalid_transition')).toBe(409);
    expect(httpStatusForPayoutRefusal('conflict')).toBe(409);
    expect(httpStatusForPayoutRefusal('insufficient_reward_coverage')).toBe(409);
  });

  it('never turns an unrecognised refusal into a success', () => {
    expect(httpStatusForPayoutRefusal('something_new')).toBe(500);
    expect(httpStatusForPayoutRefusal(undefined)).toBe(500);
  });
});

describe('parsePayoutTransitionRpcResult', () => {
  it('parses a success payload', () => {
    expect(
      parsePayoutTransitionRpcResult({
        ok: true,
        idempotent: false,
        id: 'a',
        status: 'approved',
        previous_status: 'pending',
      }),
    ).toMatchObject({ ok: true, status: 'approved', previous_status: 'pending' });
  });

  it('parses a refusal payload', () => {
    expect(parsePayoutTransitionRpcResult({ ok: false, code: 'invalid_transition' })).toMatchObject(
      { ok: false, code: 'invalid_transition' },
    );
  });

  it('returns null for anything that is not a result object', () => {
    expect(parsePayoutTransitionRpcResult(null)).toBeNull();
    expect(parsePayoutTransitionRpcResult([{ ok: true }])).toBeNull();
    expect(parsePayoutTransitionRpcResult({ status: 'approved' })).toBeNull();
    expect(parsePayoutTransitionRpcResult('ok')).toBeNull();
  });
});

describe('isUuid', () => {
  it('accepts a uuid and rejects injection-ish ids', () => {
    expect(isUuid('3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid("' or 1=1--")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe('the migration proposal keeps its safety properties', () => {
  const raw = fs.readFileSync(path.join(process.cwd(), PAYOUT_APPROVAL_MIGRATION_FILE), 'utf8');
  /** Executable statements only — the header prose also names this DDL. */
  const sql = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('is marked NOT APPLIED', () => {
    expect(raw).toContain('NOT APPLIED');
    expect(raw).toContain('Eyad applies this by hand');
  });

  it('guards every ADD COLUMN and CREATE INDEX', () => {
    const addColumns = sql.match(/ADD COLUMN/g) ?? [];
    const guarded = sql.match(/ADD COLUMN IF NOT EXISTS/g) ?? [];
    expect(addColumns.length).toBeGreaterThan(0);
    expect(guarded.length).toBe(addColumns.length);

    const createIndexes = sql.match(/CREATE INDEX/g) ?? [];
    const guardedIdx = sql.match(/CREATE INDEX IF NOT EXISTS/g) ?? [];
    expect(guardedIdx.length).toBe(createIndexes.length);
  });

  it('wraps every ADD CONSTRAINT in an existence check', () => {
    const addConstraints = (sql.match(/ADD CONSTRAINT/g) ?? []).length;
    const guards = (sql.match(/IF NOT EXISTS \(\s*\n?\s*SELECT 1 FROM pg_constraint/g) ?? []).length;
    expect(addConstraints).toBeGreaterThan(0);
    expect(guards).toBe(addConstraints);
  });

  it('defines the RPC the route calls, and only grants it to service_role', () => {
    expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${PAYOUT_TRANSITION_RPC}(`);
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public, pg_temp');
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  });

  it('takes a locking read and an advisory lock before deciding (§2.2)', () => {
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('FOR UPDATE');
  });

  it('writes the audit row in the same transaction as the state change', () => {
    expect(sql).toContain('INSERT INTO public.audit_log');
    const auditIdx = sql.indexOf('INSERT INTO public.audit_log');
    const commitIdx = sql.indexOf('\nCOMMIT;');
    expect(auditIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(auditIdx);
  });

  it('does not add a pending-uniqueness index — request creation is §2.7, not this change', () => {
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX[\s\S]*payout_requests[\s\S]*status\s*=\s*'pending'/);
  });

  /*
   * The blocker this rework closes. The first version guarded approval with
   * `count(*) ... WHERE status = 'approved'`, which lapses the moment the
   * first request is marked paid — approve, mark_paid, approve again, and the
   * same reward balance leaves twice in sequence. These lock the replacement
   * in place: a coverage sum that counts 'paid' as still committed.
   */
  describe('the approval coverage guard', () => {
    /** The RPC body only — the header prose quotes the old shape to explain it. */
    const body = sql.slice(sql.indexOf(`CREATE OR REPLACE FUNCTION public.${PAYOUT_TRANSITION_RPC}(`));

    it('no longer refuses purely on the count of other approved requests', () => {
      expect(body).not.toContain('center_has_open_approval');
      expect(body).not.toMatch(/count\(\*\)[\s\S]{0,200}status\s*=\s*'approved'\s*;/);
    });

    it("counts 'paid' as still committed — the whole point of the fix", () => {
      expect(body).toMatch(/status IN \('approved', 'paid'\)/);
    });

    it('sums the committed amount, excluding the request being decided', () => {
      expect(body).toMatch(/coalesce\(sum\(amount_requested\), 0\)/);
      expect(body).toContain('id <> p_payout_id');
    });

    it("measures coverage against referral_reward_records in status 'available'", () => {
      expect(body).toMatch(/coalesce\(sum\(reward_amount\), 0\)/);
      expect(body).toContain('FROM public.referral_reward_records');
      expect(body).toContain('WHERE referrer_center_id = v_center_id');
    });

    it('refuses when committed plus this request exceeds what is available', () => {
      expect(body).toMatch(/IF v_committed \+ v_row\.amount_requested > v_available THEN/);
      expect(body).toContain('insufficient_reward_coverage');
    });

    it('runs after the advisory lock and the locking read, not before', () => {
      const lockIdx = body.indexOf('pg_advisory_xact_lock');
      const forUpdateIdx = body.indexOf('FOR UPDATE');
      const guardIdx = body.indexOf('insufficient_reward_coverage');
      const updateIdx = body.indexOf('UPDATE public.payout_requests SET');
      expect(lockIdx).toBeGreaterThan(-1);
      expect(forUpdateIdx).toBeGreaterThan(lockIdx);
      expect(guardIdx).toBeGreaterThan(forUpdateIdx);
      // and it must gate the write, not follow it
      expect(updateIdx).toBeGreaterThan(guardIdx);
    });

    it('only gates approval, so mark_paid cannot be blocked after the fact', () => {
      // committed already includes an approved row; re-checking on mark_paid
      // would refuse to record money that has demonstrably been sent.
      const guardIdx = body.indexOf('insufficient_reward_coverage');
      const openIdx = body.lastIndexOf("IF v_next = 'approved' THEN", guardIdx);
      expect(openIdx).toBeGreaterThan(-1);
      expect(openIdx).toBeLessThan(guardIdx);
    });
  });
});
