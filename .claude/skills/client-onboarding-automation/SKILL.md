---
name: client-onboarding-automation
description: >
  Automated client (center) onboarding playbook for CenterHQ (EH Group).
  Use when touching signup, pending_signups, first payment, onboarding
  checklist APIs, WhatsApp welcome/PIN flows, card orders for new rosters,
  or when designing activation automation and diagnosing onboarding
  drop-off.
---

# Automated Client Onboarding — CenterHQ

> Synced against the live database and code on 2026-07-18. Load-bearing money/tenant facts verified live are tagged (verified live 2026-07-18). ("CenterHQ"/"@centerhq.local" are the retained internal/company + auth-email names; the product is TutoringHQ.)

## Canonical funnel

```
/[locale]/signup (3 steps)          → api/signup/persist   (pending_signups staging)
  step 3 = payment summary/review   → api/signup           (Paymob first payment,
                                                            carries flat 20 EGP fee)
payment webhook verified            → api/signup/complete  (center + owner user +
                                                            subscription created)
first login                         → api/onboarding/*     (guided activation:
                                      complete-step · create-group · first-student ·
                                      add-student · simulate-scan)
```

Support routes: `api/signup/check-pending` (resume abandoned signups),
`api/signup/pin-setup-readiness`, `api/accept-invite` + `api/invite-user`
(staff onboarding into an existing center), `api/join` (student/parent side).

## Invariants (product decisions — do not "improve" without approval)

1. **Signup stays 3 steps.** Step 3 (payment summary) IS the review step —
   never add a fourth screen (`docs/EH_GROUP_MASTER_CONTEXT_v24.md` #11).
2. **`pending_signups` is a staging table**, not a tenant. No center,
   subscription, or auth rows exist until payment completes. Abandoned rows
   are expected inventory for win-back — treat as a funnel metric, don't
   eagerly purge.
3. **First payment = selected plan price (VAT-inclusive) + one flat 20 EGP
   processing fee** (verified live 2026-07-18). Only **monthly** and
   **annual** are offered — quarterly is DEAD (`centers.billing_period` CHECK
   is `('monthly','annual')`, verified live 2026-07-18). The monthly baseline
   is `pricing_plans.all_in_price` (Solo 999 … Enterprise 18,499); annual =
   monthly × 10 ("2 months free", `pricing.interval.annual_multiplier` = 10).
   NOTE: the signup form still carries a legacy variable named `quarterlyAllIn`
   whose value IS that monthly price — a naming artifact, not a quarterly
   product. There is no live +15/−15% toggle or `.99` price ending; do not
   describe one.
4. **`chq_parent_welcome`** WhatsApp template is approved but **manually
   sent** — do not auto-wire to approvals until ops flips it on.
5. **`chq_pin_delivery`**: the Meta template exists (AUTHENTICATION,
   IN_REVIEW — verified live 2026-07-18), but PIN delivery is **not wired
   live** — no live PIN blasts until the Vodafone SIM + SMS fallback exists.
   (Template registration vs. delivery wiring are separate; see
   `.claude/skills/tutoringhq-product-reference` and `docs/WA_TEMPLATES.md`.)
6. Card style tiers: only **B (Dark)** and **C (Light)** are exposed; A is
   reserved.

## Activation definition (what "onboarded" means)

A center is *activated*, not merely signed up, when: owner logged in ≥1×,
first group created, ≥1 real student added, ≥1 scan performed (or
simulated via `api/onboarding/simulate-scan`). The onboarding API's
`complete-step` checklist is the system of record — new activation steps
belong there, not in ad-hoc flags.

## Engineering rules for this surface

- **Idempotency at every hop**: `signup/complete` must tolerate webhook
  replay and double-submit without creating duplicate centers/subscriptions
  (dedupe on pending_signup id / payment reference). Verify before shipping
  any change here.
- **Never create tenant rows from unverified webhooks** — HMAC first
  (`verifyHmac.ts`), then amount re-check against the pending signup's
  expected total, then completion.
- Phone is the identity anchor: Supabase auth email format is
  `{digits}@centerhq.local`. Validate Egyptian numbers early (step 1),
  not at payment.
- New-center defaults must include: `is_test = false`, correct
  `billing_period`, `next_payment_due` + `auto_suspend_at` from Cairo-time
  helpers (`autoSuspendAtFromDue`), locale from signup context (`ar`
  default).
- Onboarding UI is bilingual RTL-first — logical Tailwind properties only.

## Automation roadmap hooks (where to extend)

- **Abandoned-signup win-back**: cron scanning `pending_signups` older than
  N hours → WhatsApp nudge (template must be approved first). Gate on
  `CRON_SECRET`, register in `vercel.json`.
- **Activation drip**: drive off `complete-step` state, never raw
  timestamps; suppress for `is_test` centers.
- **Auto-provisioned demo data**: reuse the e2e seed conventions
  (`notes = e2e_seed:v1`, `TEST-xxxxx` student numbers) so cleanup stays
  idempotent; roster demo rows must be `is_test = true`.
- **Health scoring for CS**: activation-step completion + scan velocity +
  billing status → feed `/admin` views; exclude test centers by default.
