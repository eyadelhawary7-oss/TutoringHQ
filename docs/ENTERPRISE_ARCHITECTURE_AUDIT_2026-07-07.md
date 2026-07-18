# Enterprise Architecture Audit — EH Group

> Point-in-time snapshot as of 2026-07-07. Reviewed against the live database and code on 2026-07-18 — findings preserved as recorded; only demonstrably-false current-state claims are annotated inline (verified live 2026-07-18). Live catalog counts drift; current figures are in the session ground truth.

**Date:** 2026-07-07
**Scope:** CenterHQ (TutoringHQ repo) — multi-tenancy, authorization, payment
security, and the automated billing engine. Plus the C-Suite operating layer
and skill upgrades delivered alongside this audit.
**Method:** three parallel source-level audits (payments-security, tenancy/auth,
billing engine). Every Critical/High finding below was re-verified by reading
the cited code directly — line references are current as of this commit.

---

## 0. Executive summary

The platform's **payment-finalization core is genuinely hardened** — timing-safe
HMAC, fail-closed webhooks and CSRF, atomic idempotent SQL finalizers,
per-transaction dedupe, and service-role kept server-only. Tenant isolation is
sound: `center_id` is server-derived everywhere and super-admin authority is
correctly divorced from tenant-writable data.

The real risk is concentrated in **two live revenue bugs in billing** and **two
pieces of legacy surface** that bypass the payment/suspension model. None are
subtle design flaws; all four are "an old path left in place while the model
moved on." Fix order:

| Rank | Finding | Severity | Impact |
|---|---|---|---|
| 1 | Annual signups activated as monthly (C1) | **Critical** | Every annual signup since 2026-07-05 double-billed at day 31 |
| 2 | `announcement_settlement` payment extends subscription free (C2) | **Critical** | Locked center unlocks a full cycle by paying a small settlement |
| 3 | `POST /api/onboarding` mints free active centers (T-H1) | **High** | Any auth user → active center, no payment, never billed |
| 4 | `/api/db` lets a center rewrite its own `centers` billing columns (T-H2) | **High** | Suspended center self-unsuspends / self-reprices |
| 5 | Auto-suspend fires on due-day morning, not next Cairo midnight (B-H2) | **High** | Violates single-day-lock promise; locks customers a day early |
| 6 | Two contradictory VAT formulas in live invoice code (B-H1) | **High** | Legal فاتورة ضريبية VAT line ≠ 14% of its own subtotal |
| 7 | Renewal invoice is one-shot, no catch-up (B-H3) | **High** | One bad cron day → cohort locked with no payable invoice |
| 8 | `top_centers` NULL-price guard missing on renewal path (B-H4) | **High** | Custom-price center silently billed 0 |

Full detail and fixes below. Mediums/Lows and confirmed strengths follow each
section.

---

## 1. Core skill upgrade (multi-tenant SaaS · automated billing · onboarding)

Delivered as versioned, repo-checked skills so the operating knowledge lives in
the codebase, not in chat history:

- **`.claude/skills/saas-multi-tenant-architecture/`** — tenancy invariants, the
  per-route protection checklist (prefix registration, CSRF, gate selection,
  webhook HMAC, cron secret, RLS-on-new-table), suspension enforcement, and
  cross-tenant leak-hunting heuristics.
- **`.claude/skills/automated-billing-and-fees/`** — the **current** fee model
  (VAT-only + flat 20 EGP processing fee; the cascading service/stamp tax is
  retired), plan invariants, legal invoice display order, the single-day lock
  model, the saved-card automation state machine (built but inert pending
  `PAYMOB_RECURRING_INTEGRATION_ID`), and hard rules for writing money code
  (Cairo time, idempotency-first, snapshot fees into invoice metadata).
- **`.claude/skills/client-onboarding-automation/`** — the canonical funnel,
  activation definition, idempotency requirements at every hop, and the
  approved automation roadmap (abandoned-signup win-back, activation drip,
  health scoring).

**Key correction captured in the skills:** `CLAUDE.md` still describes tax as
"cascading multiplication (VAT 14% + stamp 0.5% + service 6%)". Per
`docs/PRICING_SPEC.md` (2026-05-09) that model was **removed** — tax is now 14%
VAT only. The skills treat `PRICING_SPEC.md` as source of truth and flag the
stale CLAUDE.md text; a follow-up should correct CLAUDE.md itself. *(Update, verified live 2026-07-18: CLAUDE.md has since been corrected — it now states "Tax is 14% VAT only, inclusive". This follow-up is done.)*

---

## 2. Advanced future skill (algorithmic asset management — EHG Intelligence)

Delivered as **`.claude/skills/ehg-algorithmic-asset-management/`**: a passive,
rules-based execution framework for EH Group's own treasury (not client funds —
that would trigger Egyptian FRA licensing). It is a *structure*, not stock picks:

- **Layer 0 — capital segmentation:** float / reserve / strategic surplus /
  venture. Algorithms only ever touch strategic surplus.
- **Layer 1 — IPS as code:** the Investment Policy Statement is a versioned
  config file (target weights, bands, FX/EGP-devaluation policy, contribution
  rule, kill-switch thresholds). No parameter lives only inside a script.
- **Layer 2 — passive execution engine:** calendar-driven monthly sweep
  (contributions rebalance pro-rata to underweight — cheapest rebalance),
  quarterly band-check rebalancing, human-confirmed at the money boundary
  (Mode A order sheets) until a year of dry-run history justifies Mode B API
  execution with per-order/day caps and a two-key rule.
- **Layers 3–5 — reconciliation, kill-switches, governance:** append-only
  positions ledger reconciled to statements, a single halt flag, hard caps, no
  leverage/derivatives/lockups beyond bucket horizon, and quarterly IPS
  compliance review. Reuses CenterHQ discipline: Cairo-time helpers, cron +
  `CRON_SECRET`, append-only audit tables, Sentry on invariant violations.

---

## 3. Gap & security analysis (findings + fixes)

### 3.1 Critical

**C1 — Annual signups are activated as monthly; customer pays ~10 months, gets 30 days.**
`src/app/api/signup/route.ts:333-335` pins `subscription_billing_period='monthly'`
**only** when `periodResolved === 'monthly'`; annual signups leave the column
unset. Migration `20260705050120_billing_period_monthly_default.sql` sets that
column's DB **default to `'monthly'`**. `resolveBillingForAutoApprove`
(`src/lib/signupPaymobAutoApprove.ts:220-221`) then resolves cadence as
`subscription_billing_period ?? billing_period` → `'monthly'`, activating with a
monthly `billing_amount` and `next_payment_due = today + 30d` — even though the
customer already paid the annual total up front (`getPlanPrice(planKey,'annual')`,
`route.ts:276`). At day 31 the renewal cron issues a *monthly* invoice and locks
the center if unpaid.
*Latent second bug:* if `subscription_billing_period` is ever NULL, `period`
resolves `'annual'` and a later write puts `'annual'` into a column whose CHECK
now allows only `{'monthly','yearly'}` → the post-payment activation UPDATE
fails. Flagged in `docs/MONTHLY_ANNUAL_BILLING_FINDINGS.md:25`, never fixed.
**Fix:** set `subscription_billing_period='yearly'` for annual signups (translate
`'annual'→'yearly'` before any write to that column); normalize both period
columns consistently in `resolveBillingForAutoApprove`; backfill affected annual
centers created since 2026-07-05.

**C2 — Paying an `announcement_settlement` invoice extends the subscription for free.**
`announcement_settlement` is in `payableTypes` but has no typed branch in
`finalizeInvoicePaymentSuccess` (`src/lib/invoicePaymobPayment.ts:534-567`), so it
hits the legacy fallback that advances `centers.next_payment_due` by a full cycle,
sets `billing_status='paid'`, and **reactivates a suspended center**. A locked
center pays a small announcement settlement → unlocks a full subscription cycle
without paying the subscription. Same block also has a local-TZ date parse +
`setMonth` overflow (Jan 31 → Mar 3).
**Fix:** give `announcement_settlement` (and every non-subscription payable type)
an explicit branch that only marks the invoice paid; fence off the legacy
subscription-advancing fallback.

### 3.2 High

**T-H1 — `POST /api/onboarding` is a payment-bypass center factory.**
`src/app/api/onboarding/route.ts:126-181`: any authenticated Supabase user with no
`users.center_id` can create a center with `subscription_status:'active'`,
`plan:'starter'`, a full-permission owner row, and **no payment, no invoice, no
billing anchor** (`next_payment_due` never set — no billing cron will ever charge
or suspend it). No frontend calls this route (grep-confirmed); it is live legacy
surface reachable by anyone who can mint an auth user (e.g. teacher signup).
**Fix:** delete the route, or gate it behind the paid-activation state machine.

**T-H2 — A center can rewrite its own billing/suspension columns via `/api/db`.**
`centers` is allow-listed in the proxy as `{kind:'direct', column:'id'}`
(`dbProxyScope.ts:36`), is exempt from forced-payload rewriting
(`dbProxyScope.ts:193`), and — unlike `users` and `card_orders` — has **no
protected-columns list** (`dbProxyProtectedColumns.ts` defines only `USERS_*` and
`CARD_ORDERS_*`). The proxy's inline auth (`db/route.ts:147-183`) never reads
`centers.status`, and middleware skips `/api/*`. A suspended center can therefore
`POST /api/db {table:'centers', operation:'update', data:{status:'active',
billing_status:'paid', auto_suspend_at:null, is_blacklisted:false}}` and
self-unsuspend; a `top_centers` center can rewrite its own `all_in_price`.
**Fix:** add `CENTERS_PROTECTED_COLUMNS` (`status, billing_status,
subscription_status, next_payment_due, auto_suspend_at, is_blacklisted, plan,
billing_amount, all_in_price, approved_at, subscription_start_date, …`) mirroring
the `card_orders` pattern, and add a suspension gate to `/api/db` (or route
`centers` writes through `requireCenterAuth`).

**B-H1 — Two contradictory VAT formulas run in live invoice code.**
`src/lib/pricing/taxMath.ts:21-49` decomposes VAT as `inclusive × 0.14` (base ×
0.86), while `src/lib/processingFee.ts:74-79` (`vatInsideInclusive`) uses the
arithmetically correct `inclusive × 0.14/1.14`, and referral base uses `÷1.14`
again. Both live formulas are used in `src/lib/invoiceTemplates.ts`. For a 60 EGP
total: taxMath prints VAT 8.40 / base 51.60 (an effective 16.28% on the base),
`processingFee` prints VAT 7.37 / base 52.63. A legal فاتورة ضريبية whose "VAT
(14%)" line is not 14% of its own subtotal is non-compliant, and admin "net",
referral bases, and tax filings disagree ~2%.
**Fix:** standardize on the `÷1.14` inclusive split; route `explodeInclusive` /
`calcExclusive` through it; regenerate card unit base; reconcile `PRICING_SPEC.md`
(which currently documents both).
*(Update, verified live 2026-07-18: B-H1 is FIXED. `src/lib/pricing/taxMath.ts` now decomposes VAT as `P × 0.14 / 1.14` via `VAT_DIVISOR = 1.14` (`baseFromInclusive` = `P / 1.14`, `explodeInclusive` uses `vatInside`), matching `processingFee.vatInsideInclusive` exactly — the two formulas no longer disagree, and the printed "VAT (14%)" line equals 14% of its own subtotal. `CARD_UNIT_BASE_EGP = 60 / 1.14`. Ground truth confirms per-invoice snapshot INV-007 vat_amount 125.26 = 1020 × 0.14 / 1.14.)*

**B-H2 — Auto-suspend fires the due-day morning, not the next Cairo midnight.**
`lockAtFromBillingDay` correctly computes 00:00 Cairo on due+1, but
`centers.auto_suspend_at` is a **`date`** column (baseline.sql:467; RPC casts
`::date` at `20260625000004…:106`), truncating to the due day itself. The
`process-renewals` cron (07:00 UTC ≈ 09:00 Cairo) then suspends unpaid rows on
their due day and the proxy locks immediately — violating the single-day-lock
promise (full access until 23:59:59 Cairo). The request-time gate
(`billingAccessGate.ts:21-27`) is correct; the cron undermines it. The same-day
match window also means a row missed once is never cron-suspended.
**Fix:** migrate `auto_suspend_at` to `timestamptz` (drop the `::date` cast), and
change the cron to suspend rows whose due day is *before* Cairo-today (`lte`
catch-up), aligned with `resolveBillingAccess`.

**B-H3 — Renewal invoice creation is a one-shot window with no catch-up.**
`subscriptionBillingCron.ts:126` selects `eq('next_payment_due', today+7)`, so the
renewal invoice is created only if the cron runs on that exact day. A missed run
(deploy/outage/Vercel miss) means no invoice is ever created, yet the proxy still
locks the center on `next_payment_due` — customer locked with nothing payable on
`/pay`. The reconciliation cron only heals Paymob-paid-but-unfinalized, not
missing invoices.
**Fix:** change the selector to `lte(next_payment_due, in7)` plus the existing
per-period existence check (already idempotent), or have the midnight engine
`ensure` center invoices like it does for teachers.

**B-H4 — `top_centers` NULL-price guard exists only on the MRR path.**
`requireTopCentersAllInPrice` (`topCentersPrice.ts:6-16`) correctly throws +
Sentry-warns, but is called only from the MRR aggregate. The renewal path
(`centerRenewal.ts:42-56`, `subscriptionBillingCron.ts:190-213`) never checks the
plan: an annual `top_centers` center with NULL `all_in_price` gets
`getAnnualChargeRounded(0) = 0` → a renewal invoice for `0 + 20` EGP, silently, no
Sentry. (`packBilling.ts:43-77` does guard it — copy that pattern.)
**Fix:** call `requireTopCentersAllInPrice` in `centerRenewalBaseAmount` when
`plan==='top_centers'`, skip invoice creation on throw, and enqueue a red CEO
ops action.

### 3.3 Medium (abridged — full detail in the source audits)

- **Payments:** the two git-tracked root scripts `reset-password.js` and
  `fix-audit-passwords.mjs` provision a `super_admin` (`+201111111111`) / reset
  passwords to trivial 6-digit values via the service-role key with **no prod
  guard** — a footgun if run against an `.env.local` pointed at prod. Move to
  `scripts/audit/`, add a non-prod project-ref assertion + explicit flag, or
  untrack them.
- **Tenancy:** middleware **fails open** on exception (`proxy.ts:374-376`) —
  during a Supabase Auth blip, suspension/blacklist walls evaporate for
  top-level pages; fail closed for authenticated prefixes. `/billing` and
  `/financial-intelligence` are missing from `AUTHENTICATED_ROUTE_PREFIXES`
  (covered today only by a route-group layout). Ad-hoc inline auth copies
  (`whatsapp/send-balance-reminder`, `students/at-risk`, `analytics/revenue`)
  skip the suspension gate baked into `requireCenterAuth` — unify them.
  `/api/db` scopes tenant but not per-permission flags (a zero-permission staff
  member can `insert` into `payments` directly). `GET /api/signup/check-pending`
  is an unauthenticated PII/enumeration oracle. Abandoned `pending_payment`
  signups strand the phone's unique index with a generic 500 and no cleanup/reuse.
- **Billing:** partial-payment application is a read-modify-write race
  (`invoicePaymobPayment.ts:295-347`) — move into a SQL RPC. `UNK` invoice-number
  collisions (centers lacking a code) silently skip billing, worst on PAYG where
  the existence check is by invoice_number only. Several proration/metering
  windows use UTC/local dates instead of Cairo helpers. Stale 7-day-grace
  machinery still feeds the billing dashboard UI (shows a lock date 6 days late).

### 3.4 Deployment-velocity gaps

- **Middleware does up to 4 sequential uncached Supabase round-trips per
  authenticated page view** (`auth.getUser` → `users` → `centers` →
  `subscriptions`). Fold into one RPC/join, push `center_id`+role into JWT
  `app_metadata` claims to drop the `users` lookup, and cache center status per
  user in a short-TTL cookie/Upstash (the suspension wall tolerates ~60s
  staleness). This is the single biggest latency + Supabase-Auth-load multiplier.
- The May-13 N+1 hot-path finding **was fixed** (`admin/centers/route.ts:506-508`
  batches the `parent_portal_tokens` delete). Index coverage is healthy (272
  indexes, 86 on `center_id`); a few duplicate indexes are free write
  amplification to trim.
- CSP duplicated across `next.config.ts` and `src/proxy.ts` remains a
  keep-in-sync tax (already documented).

### 3.5 Confirmed strengths (verified, not assumed)

Timing-safe HMAC across Paymob/Bosta/WhatsApp webhooks (all fail closed on
missing secret); server-side amount re-verification (never trusts client
amounts); layered idempotency (`webhook_inbox` + atomic SQL finalizers +
`applied_txns` ledger); CSRF fail-closed in every env and bound to the auth user;
`/api/db` tenant scoping with protected-column gates on `users`/`card_orders`;
super-admin authority never derived from tenant-writable `users.role`; service
role `server-only`; `CRON_SECRET` timing-safe and checked first in every cron;
`BILLING_RELIABILITY.md` fully implemented (tamper trigger, reconciliation cron,
`logBillingEvent` at every chokepoint); card-order shipping correctly sits above
VAT; processing-fee snapshotting makes breakdowns deterministic.

---

## 4. C-Suite operating layer

Five role-specialized subagents under `.claude/agents/`, each grounded in the
skills above and the intentional-design-decisions list, to act as the standing
C-Suite:

- **`cto-architect`** — architecture decisions, tenant-isolation and money-path
  review, deployment velocity, simplicity bias.
- **`cfo-controller`** — pricing/fee changes, MRR, VAT/invoice compliance,
  treasury via the EHG framework.
- **`coo-operations`** — onboarding funnel, activation/churn, logistics
  (WhatsApp/Bosta/card orders), cron operational health.
- **`ciso-security`** — security review of auth/payment/webhook/tenant diffs,
  incident triage, secret rotation, pre-launch gates.
- **`ceo-chief-of-staff`** — synthesizes the specialists into one ranked action
  list under a strict WIP limit, guards the principal's constraints and settled
  decisions.

**How to use:** invoke a specialist for its domain (e.g. `cfo-controller` for a
pricing change), then `ceo-chief-of-staff` to reconcile and prioritize across
them. For this audit, the chief-of-staff ranking is Section 0's table:
C1 → C2 → T-H1 → T-H2 → B-H2 → B-H1 → B-H3 → B-H4.
