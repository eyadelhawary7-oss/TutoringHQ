import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/billingAudit', () => ({ logBillingEvent: vi.fn().mockResolvedValue(undefined) }));

import { teacherOverageAmount } from '@/lib/teacherPlans';
import { ensureTeacherOverageInvoice } from '@/lib/teacherBilling';

// Minimal in-memory invoices fake: reuse-open returns nothing, insert captures the row.
function fakeSupabase(captured: { row?: Record<string, unknown> }) {
  const builder = () => {
    let inserted: Record<string, unknown> | null = null;
    const api: Record<string, unknown> = {
      select: () => api,
      eq: () => api,
      in: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      insert: (p: Record<string, unknown>) => {
        inserted = p;
        captured.row = p;
        return api;
      },
      single: () => Promise.resolve({ data: { id: 'ov-1', ...inserted }, error: null }),
    };
    return api;
  };
  return { from: builder } as unknown as SupabaseClient;
}

describe('teacher Scale overage', () => {
  it('overage amount: only Scale, only above 100', () => {
    expect(teacherOverageAmount('teacher_scale', 130)).toBe(600); // 30 × 20
    expect(teacherOverageAmount('teacher_scale', 100)).toBe(0);
    expect(teacherOverageAmount('teacher_standard', 130)).toBe(0);
    expect(teacherOverageAmount('teacher_pro', 130)).toBe(0);
  });

  it('Scale monthly 130 active → ONE overage invoice = 600 + 20 fee = 620', async () => {
    const captured: { row?: Record<string, unknown> } = {};
    const supabase = fakeSupabase(captured);
    const overageAmount = teacherOverageAmount('teacher_scale', 130); // 600
    const res = await ensureTeacherOverageInvoice(supabase, {
      teacherId: 't1',
      billingDayCairo: '2026-09-01',
      overageAmount,
      fee: 20,
    });
    expect(res).not.toBeNull();
    expect(res?.total).toBe(620);
    expect(captured.row?.invoice_type).toBe('teacher_overage');
    expect(captured.row?.base_amount).toBe(600);
    expect(captured.row?.total_amount).toBe(620);
    expect((captured.row?.metadata as { processing_fee?: number })?.processing_fee).toBe(20);
  });

  it('Scale at ≤100 active → no overage invoice (null)', async () => {
    const captured: { row?: Record<string, unknown> } = {};
    const supabase = fakeSupabase(captured);
    const res = await ensureTeacherOverageInvoice(supabase, {
      teacherId: 't1',
      billingDayCairo: '2026-09-01',
      overageAmount: teacherOverageAmount('teacher_scale', 100), // 0
      fee: 20,
    });
    expect(res).toBeNull();
    expect(captured.row).toBeUndefined();
  });

  it('processing fee off (fee=0) → overage invoice carries no fee', async () => {
    const captured: { row?: Record<string, unknown> } = {};
    const supabase = fakeSupabase(captured);
    const res = await ensureTeacherOverageInvoice(supabase, {
      teacherId: 't1',
      billingDayCairo: '2026-09-01',
      overageAmount: 600,
      fee: 0,
    });
    expect(res?.total).toBe(600);
    expect((captured.row?.metadata as { processing_fee?: number })?.processing_fee).toBe(0);
  });
});
