import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Commission clawback must fire on a GENUINE Paymob chargeback (is_voided / is_refunded),
 * and NEVER on a cancellation, suspension, or blacklist/ban. A rep is not penalised for a
 * customer the CEO bans; only the card issuer taking the money back reverses commission.
 *
 * This proves both halves of that rule:
 *   1. behaviourally — finalizeInvoiceChargeback (the void/refund finalizer) DOES claw back;
 *   2. structurally  — clawbackCommissionsForOwner is CALLED from exactly one module (that
 *      finalizer) and is referenced nowhere in the admin ban/suspend/cancel route. If anyone
 *      ever wires clawback into a cancellation path, part 2 breaks loudly.
 *
 * The webhook → finalizer routing (that an is_voided/is_refunded event reaches this finalizer
 * even though the invoice is already 'paid') is pinned separately in
 * tests/unit/api/paymobChargebackReachability.test.ts.
 */

const H = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://clawback-trigger-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key';
  return { clawbackSpy: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  withScope: (fn: (s: { setTag: () => void }) => void) => fn({ setTag: () => {} }),
}));

// Keep every real commissions export; swap only the clawback for a spy.
vi.mock('@/lib/commissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commissions')>();
  return { ...actual, clawbackCommissionsForOwner: (...a: unknown[]) => H.clawbackSpy(...a) };
});

import { finalizeInvoiceChargeback } from '@/lib/invoicePaymobPayment';

// Minimal awaitable Supabase fake: select().eq().maybeSingle() yields the invoice row;
// update().eq() and insert() resolve.
function fakeClient(invoiceRow: Record<string, unknown> | null) {
  const api: Record<string, unknown> = {};
  api.select = () => api;
  api.eq = () => api;
  api.update = () => api;
  api.insert = () => api;
  api.maybeSingle = async () => ({ data: invoiceRow, error: null });
  api.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
    resolve({ data: null, error: null });
  return { from: () => api } as never;
}

beforeEach(() => {
  H.clawbackSpy.mockClear();
});

describe('clawback fires on a genuine chargeback (finalizeInvoiceChargeback)', () => {
  it('claws back the invoice owner when a PAID invoice is voided/refunded', async () => {
    const client = fakeClient({
      id: 'i1',
      owner_type: 'teacher',
      center_id: null,
      teacher_id: 't1',
      status: 'paid',
      total_amount: 999,
    });
    await finalizeInvoiceChargeback(client, 'ORD-1', 'TXN-1');
    expect(H.clawbackSpy).toHaveBeenCalledTimes(1);
    expect(H.clawbackSpy).toHaveBeenCalledWith('teacher', 't1', expect.stringContaining('chargeback'));
  });

  it('does NOT claw back when the invoice was never paid (nothing to reverse)', async () => {
    const client = fakeClient({
      id: 'i2',
      owner_type: 'center',
      center_id: 'c1',
      teacher_id: null,
      status: 'pending',
      total_amount: 999,
    });
    await finalizeInvoiceChargeback(client, 'ORD-2', 'TXN-2');
    expect(H.clawbackSpy).not.toHaveBeenCalled();
  });
});

describe('clawback is wired ONLY to the chargeback finalizer — never to ban/cancel/suspend', () => {
  const SRC = path.join(__dirname, '..', '..', '..', 'src');

  function walk(dir: string, acc: string[]): void {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.next') continue;
        walk(p, acc);
      } else if (/\.(tsx|ts)$/.test(ent.name)) acc.push(p);
    }
  }

  it('the clawbackCommissionsForOwner identifier appears only in its definition and the finalizer', () => {
    const files: string[] = [];
    walk(SRC, files);
    const withIdentifier = files
      .filter((f) => fs.readFileSync(f, 'utf8').includes('clawbackCommissionsForOwner'))
      .map((f) => path.relative(SRC, f).replace(/\\/g, '/'))
      .sort();
    // commissions.ts = definition; invoicePaymobPayment.ts = the sole caller (the finalizer).
    expect(withIdentifier).toEqual(['lib/commissions.ts', 'lib/invoicePaymobPayment.ts']);
  });

  it('the admin centers route (blacklist / suspend / cancel actions) never calls clawback', () => {
    const routeText = fs.readFileSync(
      path.join(SRC, 'app', 'api', 'admin', 'centers', '[id]', 'route.ts'),
      'utf8',
    );
    expect(routeText).not.toContain('clawbackCommissionsForOwner');
  });
});
