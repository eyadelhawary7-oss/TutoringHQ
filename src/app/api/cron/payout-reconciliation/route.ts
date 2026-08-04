// GET /api/cron/payout-reconciliation
//
// The reconciliation sweep. §6: "The reconciliation job is not optional."
//
// It sweeps `indeterminate` and other non-terminal payouts, inquires by
// reference, and repairs state. CALLBACKS ARE ADVISORY ONLY — the sweep is the
// primary mechanism, not the optimisation. Wallets fire NO CALLBACKS AT ALL.
//
// ── WHY THIS RUNS EVEN THOUGH IT CANNOT DO ANYTHING YET ─────────────────────
//
// Attack A12, verified: `vercel.json` schedules 42 crons while src/app/api/cron
// contains 43 route directories. `renewal-reminders` exists and is scheduled
// NOWHERE, and nobody has noticed. The watchdog only iterates `cron_health_log`
// rows that ALREADY EXIST, so a cron that never ran once is invisible to it.
//
// So this route is registered in vercel.json from day one and its health row is
// seeded in the same migration proposal that ships it. It runs, records that it
// ran, and records — every time — that it could do nothing and why. A cron that
// is silent because it is unconfigured is indistinguishable from a cron that is
// silent because it is dead.
//
// ── WHAT IT WILL DO WHEN THE CREDENTIALS ARRIVE (§6) ────────────────────────
//
//   - Inquiry endpoints are throttled to 5 requests/minute, 50 objects/page,
//     SHARED across transaction and budget inquiry. It needs a global token
//     bucket (Upstash is already a dependency) and must pack pages to the limit.
//   - It must query with the `bank_transactions` flag BOTH true and false and
//     conclude "not found" only when BOTH return zero. Paymob's docs classify
//     `bank_wallet` both ways. Attack A4.
//   - Budget exhaustion is detected STRUCTURALLY, from /budget/inquire/ with a
//     local projection — never by substring-matching the English prose "exceeds
//     you budget limit", which contains a typo Paymob may fix. Attack A7.
//   - Anything unrecognised is `indeterminate`, never terminal. §6(e).
//
// ── WHERE FINDINGS GO (attack A11) ──────────────────────────────────────────
//
// Verified precedent: src/lib/billing/reconciliation.ts writes to
// `billing_reconciliation_reports`, and a grep across all of src/ finds exactly
// two references — BOTH WRITERS, ZERO READERS. This reconciler must not inherit
// that shape, so every mismatch also creates a `ceo_action_queue` row — a table
// that HAS a UI. Verified live 2026-08-04: ceo_action_queue exists with columns
// id, type, priority, center_id, lead_id, title, subtitle, action_label,
// action_url, revenue_at_risk, snoozed_until, resolved_at, auto_generated,
// created_at, updated_at.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogPartial, insertCronLogFailure } from '@/lib/cron/cronLog';
import {
  COLLECTION_PAYOUT_CONFIG_POINT,
  loadCollectionPayoutConfig,
  refusalBody,
} from '@/lib/collectionPayout/config';
import { isNotMigrated } from '@/lib/collectionPayout/payoutEngine';
import { TERMINAL_PAYOUT_STATES, OPEN_PAYOUT_STATES } from '@/lib/collectionPayout/payoutStates';

export const dynamic = 'force-dynamic';

const CRON_NAME = 'payout-reconciliation';

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: 'server_misconfigured' }, { status: 500 });
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const config = await loadCollectionPayoutConfig(admin);

    if (!config.configured) {
      // FAIL VISIBLY, ON A SCHEDULE. A 'partial' cron_log row every run, with
      // the exact cause chain, so the reason this job does nothing is a record
      // rather than an assumption. Returns 200 so Vercel does not retry a
      // condition that will not change on a retry.
      const body = refusalBody(config);
      await insertCronLogPartial(admin, CRON_NAME, {
        duration_ms: Date.now() - startedAt,
        records_processed: 0,
        metadata: {
          skipped: true,
          reason: 'collection_payout_not_configured',
          configPoint: COLLECTION_PAYOUT_CONFIG_POINT,
          causes: body.causes,
          unsetKeys: body.unsetKeys,
        },
      });
      // `ok: true` means THE CRON RAN, not that anything was reconciled. The
      // two are kept as separate fields on purpose: collapsing them is how a
      // job that does nothing starts reading as a job that found nothing.
      return NextResponse.json({
        ok: true,
        ranAt: new Date().toISOString(),
        reconciled: 0,
        skipped: true,
        skippedReason: body.error,
        configPoint: body.configPoint,
        causes: body.causes,
        messageKeys: body.messageKeys,
        unsetKeys: body.unsetKeys,
        detail:
          'The reconciliation sweep ran and did nothing, because the payout rail credentials hold placeholders. This is recorded as a partial cron_log row every run so the silence is evidence, not an absence of evidence.',
      });
    }

    // Non-terminal payouts are the sweep's population. Terminal is enumerated
    // ({settled, failed, returned}) so a state added later defaults to being
    // swept rather than to being silently ignored.
    const { data, error } = await admin
      .from('center_payouts')
      .select('id, status, client_reference, provider_transaction_id, submitted_at')
      .in('status', [...OPEN_PAYOUT_STATES])
      .order('submitted_at', { ascending: true, nullsFirst: true })
      .limit(50); // the provider's inquiry page size

    if (error) {
      if (isNotMigrated(error)) {
        await insertCronLogPartial(admin, CRON_NAME, {
          duration_ms: Date.now() - startedAt,
          records_processed: 0,
          metadata: { skipped: true, reason: 'ledger_not_migrated' },
        });
        return NextResponse.json({
          ok: true,
          reconciled: 0,
          skipped: true,
          reason: 'ledger_not_migrated',
          detail:
            'center_payouts does not exist in the live catalog. Proposed in supabase/migrations/20260804140000_PROPOSAL_payout_system_1_ledger.sql; Eyad applies it by hand.',
        });
      }
      throw new Error(error.message);
    }

    const candidates = data ?? [];

    // The inquiry calls themselves are NOT built. Building an unauthenticated
    // HTTP client against an undocumented contract would be inventing a rail.
    // With credentials present but no inquiry client, the honest outcome is a
    // partial run that names what is missing — never a "reconciled: N" that did
    // not reconcile anything.
    await insertCronLogPartial(admin, CRON_NAME, {
      duration_ms: Date.now() - startedAt,
      records_processed: 0,
      metadata: {
        candidates: candidates.length,
        blocked: 'provider_inquiry_client_not_built',
        terminalStates: TERMINAL_PAYOUT_STATES,
      },
    });

    return NextResponse.json({
      ok: true,
      candidates: candidates.length,
      reconciled: 0,
      blocked: 'provider_inquiry_client_not_built',
      detail:
        'Credentials are present but the provider inquiry client is not built: the seven questions in PAYOUT-SYSTEM-SPEC.md §8 have no written answers, and the bank_transactions flag semantics (§8 q3) decide whether a "not found" is real. Building the client against a guess is attack A4.',
    });
  } catch (e) {
    await insertCronLogFailure(admin, CRON_NAME, e, { duration_ms: Date.now() - startedAt });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
  // NOTE: there is deliberately no `insertCronLogSuccess` path in this route
  // yet. A 'success' row would say the sweep reconciled, and it did not. Every
  // completing path above writes 'partial' with the reason. The success row
  // arrives with the provider inquiry client, not before it.
}
