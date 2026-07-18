# Billing nudges / dunning — unified center + teacher engine

> Synced against the live database and code on 2026-07-18. Shipped feature; `src/lib/nudges/*`, the `billing-nudges` cron, `NudgeBanner.tsx`, and the `billing_nudges` ledger table (RLS on, service-role only, 0 user policies) all exist live (verified live 2026-07-18). The ledger migration was folded into the baseline snapshot and now lives under `supabase/migrations_archive/`. Auto-charge is still inert (`PAYMOB_RECURRING_INTEGRATION_ID` placeholder), so the manual-pay population is effectively everyone.

Get customers to pay on time and recover the ones who don't, through reminders
before billing and a chase sequence after a missed/failed payment. **One engine,
one banner component** for both centers and teachers, off the shared `invoices` +
subscription tables. Two channels: an always-on in-app banner and (gated)
WhatsApp. Every nudge carries a one-tap pay link into the **existing** pay flow.

## Files

| Layer | Path |
|-------|------|
| Pure decision core (testable) | `src/lib/nudges/evaluate.ts` |
| Types | `src/lib/nudges/types.ts` |
| Template + kill-switch config (one place) | `src/lib/nudges/config.ts` |
| Pay / update-card deep links | `src/lib/nudges/payLinks.ts` |
| WhatsApp message params | `src/lib/nudges/messages.ts` |
| Center-agnostic WA sender | `src/lib/nudges/send.ts` |
| Orchestrator (pure over an adapter) | `src/lib/nudges/runBillingNudges.ts` |
| Supabase adapter (live data) | `src/lib/nudges/store.ts` |
| process-outbox handler | `src/lib/nudges/outboxHandler.ts` |
| Scheduled cron | `src/app/api/cron/billing-nudges/route.ts` (vercel `0 8 * * *`) |
| Live banner endpoint | `src/app/api/billing/nudge-status/route.ts` |
| Banner component (both shells) | `src/components/billing/NudgeBanner.tsx` |
| Ledger migration | `supabase/migrations_archive/20260626120000_billing_nudges_ledger.sql` (archived into baseline) |

## The sequence

Manual-pay = the population that must pay by hand this cycle: no usable saved card,
**or** recurring auto-charge is not configured (`PAYMOB_RECURRING_INTEGRATION_ID`
unset → currently everyone), **or** the saved card expires before the billing day.
This is broader than just wallet users, exactly as intended.

| Step | When | Who | Channels |
|------|------|-----|----------|
| `prebill_t3` | T-3 days | manual-pay, open invoice | WA + banner |
| `prebill_t1` | T-1 day | manual-pay, open invoice | WA + banner |
| `due_today` | billing day, unpaid | manual-pay **or** failed auto-charge (= one-day grace) | WA + banner |
| `locked` | after lock, unpaid | both owner types | WA + banner |
| `card_expiry_t30` | card expires before next billing, ~30d | any active card | WA + banner |
| `card_expiry_t7` | ~7d to expiry | any active card | WA + banner |

≈3–4 billing touches max (T-3 → T-1 → due-today/grace → locked). **The sequence stops
the instant the invoice is satisfied** — every billing step is gated on `!paid`, so a
cleared invoice yields zero steps. Healthy auto-charge owners (usable card + recurring
configured) get **no** pre-billing nudges; if their charge later fails they enter at
`due_today`.

Teacher invoices are normally minted at midnight, so the cron **pre-creates** a teacher's
subscription invoice (reusing `ensureTeacherSubscriptionInvoice`) the first time a T-3/T-1
reminder is due, so the pay link has a payable target — mirroring how centers already have
an invoice from T-7. Centers are untouched here.

## Reliability

- **Idempotent.** `billing_nudges` has `UNIQUE(owner_type, owner_id, cycle_key, step)`.
  The cron claims each step by inserting that row; a conflict → skip. A re-run never
  re-sends. `cycle_key` is the `YYYY-MM` billing period for cycle steps and
  `card:YYYY-MM` for card-expiry.
- **Banner is independent of WhatsApp.** `/api/billing/nudge-status` computes the live
  banner straight from billing state and never reads the ledger, so it works fully even
  when WhatsApp is off or templates are unapproved. Fails closed (no banner) on error —
  never breaks the dashboard.
- **WhatsApp via the resilient outbox.** Sends are enqueued to `webhook_outbox`
  (`job_type='send_billing_nudge_wa'`) and drained by `process-outbox`, which already
  owns retry/backoff → `dead_letter_queue`. An enqueue failure in the pass itself is
  dead-lettered and the pass continues — one owner's failure never aborts the run.
- **Audit.** Every nudge records channel, template, result and timestamp on the ledger.

## WhatsApp on/off

Off by default. The channel turns on only when **both**:
1. `NUDGE_WHATSAPP_ENABLED=true` (Vercel env — set once WhatsApp is in live mode), and
2. the step's template is Meta-approved (`wa_meta_templates.status='APPROVED'`).

Until then each due nudge is recorded `disabled` and only the banner shows. Flipping a
template on is a one-line state change (approve on Meta → sync). Templates are listed in
one place: `src/lib/nudges/config.ts`. See `docs/WA_TEMPLATES.md` for the submission list.

Auto-charge itself still waits on `PAYMOB_RECURRING_INTEGRATION_ID` — nudges do not change
that, but they make the manual-pay path (most of the real population until issuer
acceptance is proven) work well.

## Retired legacy

The new engine is the single source of center + teacher dunning. Retired:
- `/api/cron/renewal-reminders` (freeform 7d/1d) — route no-ops, removed from `vercel.json`.
- The day+3 / day+7 overdue WhatsApp reminders in `subscriptionBillingCron`
  (`LEGACY_CENTER_OVERDUE_REMINDERS = false`). Invoice creation and auto-suspend in that
  cron are unchanged.
