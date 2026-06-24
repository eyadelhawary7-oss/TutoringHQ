import { describe, it, expect } from 'vitest';
import { runBillingNudges, type NudgeRunDeps, type NudgeWaJob } from '@/lib/nudges/runBillingNudges';
import { selectBannerNudge } from '@/lib/nudges/evaluate';
import type { OwnerNudgeState } from '@/lib/nudges/types';

const TODAY = '2026-07-01';

function makeState(over: Partial<OwnerNudgeState> = {}): OwnerNudgeState {
  return {
    owner: { ownerType: 'center', ownerId: 'c1' },
    displayName: 'Test',
    billingDayCairo: '2026-07-04', // T-3 → prebill_t3
    cycleKey: '2026-07',
    paid: false,
    hasOpenInvoice: true,
    invoiceId: 'inv1',
    amountDue: 500,
    manualPayExpected: true,
    savedCard: null,
    ...over,
  };
}

interface FakeOpts {
  states: OwnerNudgeState[];
  whatsappEnabled?: boolean;
  approved?: boolean;
  enqueueThrows?: boolean;
  phone?: string | null;
}

function makeFake(opts: FakeOpts) {
  const ledger = new Set<string>(); // claimed (owner|cycle|step) keys
  const enqueued: NudgeWaJob[] = [];
  const deadLettered: { job: NudgeWaJob; error: string }[] = [];
  const waResults: { nudgeId: string; status: string }[] = [];
  const ensureCalls: string[] = [];
  let claimCounter = 0;

  const deps: NudgeRunDeps = {
    todayCairo: TODAY,
    whatsappEnabled: opts.whatsappEnabled ?? true,
    async listOwnerStates() {
      return opts.states;
    },
    async ensurePrebillInvoice(state) {
      ensureCalls.push(state.owner.ownerId);
      return { invoiceId: `auto-${state.owner.ownerId}`, amountDue: 750 };
    },
    async claimNudge({ owner, cycleKey, step }) {
      const key = `${owner.ownerType}:${owner.ownerId}|${cycleKey}|${step}`;
      if (ledger.has(key)) return null; // already claimed → idempotent skip
      ledger.add(key);
      claimCounter += 1;
      return `nudge-${claimCounter}`;
    },
    async resolvePhone() {
      return opts.phone === undefined ? '201000000000' : opts.phone;
    },
    async isTemplateApproved() {
      return opts.approved ?? true;
    },
    async enqueueWhatsapp(job) {
      if (opts.enqueueThrows) throw new Error('outbox_insert_failed');
      enqueued.push(job);
    },
    async setNudgeWhatsapp(nudgeId, status) {
      waResults.push({ nudgeId, status });
    },
    async deadLetter(job, error) {
      deadLettered.push({ job, error });
    },
  };

  return { deps, ledger, enqueued, deadLettered, waResults, ensureCalls };
}

describe('runBillingNudges — idempotency', () => {
  it('claims each step once; a re-run sends nothing new', async () => {
    const fake = makeFake({ states: [makeState()] });

    const first = await runBillingNudges(fake.deps);
    expect(first.claimed).toBe(1);
    expect(first.queued).toBe(1);
    expect(fake.enqueued).toHaveLength(1);

    const second = await runBillingNudges(fake.deps);
    expect(second.claimed).toBe(0);
    expect(second.queued).toBe(0);
    expect(fake.enqueued).toHaveLength(1); // unchanged — no double-send
  });
});

describe('runBillingNudges — both owner types', () => {
  it('processes a center and a teacher in one pass', async () => {
    const fake = makeFake({
      states: [
        makeState({ owner: { ownerType: 'center', ownerId: 'c1' }, billingDayCairo: '2026-07-01' }),
        makeState({ owner: { ownerType: 'teacher', ownerId: 't1' }, billingDayCairo: '2026-06-29' }),
      ],
    });
    const s = await runBillingNudges(fake.deps);
    expect(s.claimed).toBe(2);
    const steps = fake.enqueued.map((j) => `${j.ownerType}:${j.step}`);
    expect(steps).toContain('center:due_today');
    expect(steps).toContain('teacher:locked');
  });
});

describe('runBillingNudges — teacher pre-billing invoice pre-creation', () => {
  it('mints the invoice when a teacher has none yet at T-3, then nudges', async () => {
    const fake = makeFake({
      states: [
        makeState({
          owner: { ownerType: 'teacher', ownerId: 't9' },
          billingDayCairo: '2026-07-04', // T-3
          hasOpenInvoice: false, // no invoice yet
          invoiceId: null,
        }),
      ],
    });
    const s = await runBillingNudges(fake.deps);
    expect(fake.ensureCalls).toEqual(['t9']);
    expect(s.claimed).toBe(1);
    expect(fake.enqueued[0]?.step).toBe('prebill_t3');
  });

  it('does NOT pre-create for centers (they already have an invoice)', async () => {
    const fake = makeFake({
      states: [makeState({ owner: { ownerType: 'center', ownerId: 'c2' } })],
    });
    await runBillingNudges(fake.deps);
    expect(fake.ensureCalls).toEqual([]);
  });
});

describe('runBillingNudges — WhatsApp resilience', () => {
  it('routes an enqueue failure to dead-letter, keeps the pass alive, and the banner is unaffected', async () => {
    const state = makeState({ billingDayCairo: '2026-06-28' }); // locked
    const fake = makeFake({ states: [state], enqueueThrows: true });

    const summary = await runBillingNudges(fake.deps);

    // The pass did not throw; the nudge was claimed and dead-lettered.
    expect(summary.failed).toBe(1);
    expect(summary.errors).toBe(0);
    expect(fake.deadLettered).toHaveLength(1);
    expect(fake.waResults.some((r) => r.status === 'failed')).toBe(true);

    // The in-app banner is computed independently and still shows the nudge.
    expect(selectBannerNudge(state, TODAY, 'ar')?.kind).toBe('locked');
  });

  it('records "disabled" (banner only) when WhatsApp is off — nothing enqueued', async () => {
    const fake = makeFake({ states: [makeState()], whatsappEnabled: false });
    const s = await runBillingNudges(fake.deps);
    expect(s.claimed).toBe(1);
    expect(s.disabled).toBe(1);
    expect(s.queued).toBe(0);
    expect(fake.enqueued).toHaveLength(0);
    expect(fake.waResults[0]?.status).toBe('disabled');
  });

  it('records "disabled" when the template is not yet Meta-approved', async () => {
    const fake = makeFake({ states: [makeState()], approved: false });
    const s = await runBillingNudges(fake.deps);
    expect(s.disabled).toBe(1);
    expect(fake.enqueued).toHaveLength(0);
  });

  it('records "skipped" when there is no phone, without enqueueing', async () => {
    const fake = makeFake({ states: [makeState()], phone: null });
    const s = await runBillingNudges(fake.deps);
    expect(s.skipped).toBe(1);
    expect(fake.enqueued).toHaveLength(0);
  });
});

describe('runBillingNudges — card-expiry idempotency key', () => {
  it('uses a card-month cycle key independent of the billing period', async () => {
    const fake = makeFake({
      states: [
        makeState({
          paid: true,
          billingDayCairo: '2026-08-15',
          savedCard: { last4: '4242', expMonth: 7, expYear: 2026, status: 'active' },
        }),
      ],
    });
    const s = await runBillingNudges(fake.deps);
    expect(s.claimed).toBe(1);
    expect([...fake.ledger][0]).toContain('card:2026-07');
  });
});
