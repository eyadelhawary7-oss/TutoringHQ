---
name: ehg-algorithmic-asset-management
description: >
  EHG Intelligence execution framework for passive, rules-based, highly
  automated asset management of EH Group treasury and surplus cash flows.
  Use when designing allocation policy, automation pipelines, rebalancing
  logic, risk controls, or reporting for group capital - NOT for
  CenterHQ product billing (see automated-billing-and-fees).
---

STATUS: DRAFT. Not an active business function. Do not apply or extend without an explicit instruction from Eyad. International structure and treasury decisions are parked pending Adsero and tax-advisor review.

# EHG Intelligence - Algorithmic Asset Management Framework

**Scope:** management of EH Group's own capital (operating float, reserves,
surplus). This is an *operational execution framework* - a structure for
making capital decisions systematic, auditable, and automated. It is not
investment advice; parameter values below are placeholders the principal
(Eyad) sets and signs off.

## Layer 0 - Capital segmentation (before any algorithm)

Every EGP entering the group is classified on arrival:

| Bucket | Purpose | Horizon | Instruments (policy-eligible) |
|---|---|---|---|
| **Operating float** | payroll, Paymob settlement gaps, Bosta/WhatsApp/vendor payables | 0–30d | current accounts only |
| **Reserve buffer** | N months of fixed burn (N set in IPS, typ. 3–6) | 1–12m | bank TDs, EGP money-market funds, T-bills |
| **Strategic surplus** | compounding capital | 3y+ | passive index vehicles, gold, hard-currency assets per IPS |
| **Venture/experiment** | capped high-risk allocation | any | hard cap: ≤ X% of surplus, loss-limited |

**Rule:** algorithms only ever touch *strategic surplus*. Float and reserve
are policy-managed (laddered, boring), never optimized.

## Layer 1 - Investment Policy Statement (IPS) as code

The IPS is a versioned config file (YAML/JSON in a private repo), not a
document in someone's head. It defines:

- Target allocation weights per asset class + permitted bands (e.g. ±5pp).
- Eligible instrument whitelist (asset-class → specific tickers/funds).
- FX policy: EGP devaluation is a first-class risk - define the minimum
  hard-currency (USD/gold) share of strategic surplus.
- Contribution rule: what % of monthly free cash flow sweeps to surplus.
- Drawdown/kill-switch thresholds and who can override (see Layer 4).
- Review cadence (quarterly) + amendment procedure (principal sign-off,
  git history = audit trail).

Any automation reads the IPS file; changing behavior = changing the file
via reviewed commit. **No parameter lives only inside a script.**

## Layer 2 - Passive execution engine (the automation)

Design principle: **calendar-driven, threshold-gated, human-confirmed at
the money boundary** until a full year of dry-run history exists.

1. **Monthly sweep (accumulation):** cron computes free cash flow from
   the finance source of truth → proposes the sweep amount per IPS →
   executes contribution into target instruments *pro-rata to
   underweight* (contributions do the rebalancing - cheapest possible
   rebalance, minimizes transactions).
2. **Band rebalancing (quarterly check):** if any asset class drifts
   outside its IPS band, generate a rebalance order set (sell overweight
   → buy underweight) sized to return to target, not to band edge.
   Otherwise do nothing. No momentum, no timing, no discretion.
3. **Execution modes:**
   - *Mode A (current, recommended start):* engine produces a signed
     order sheet (PDF/message) → principal executes manually at the
     bank/broker → confirms → engine reconciles.
   - *Mode B (later):* broker/bank API execution with per-order and
     per-day caps, allowlisted instruments only, 2-key confirmation for
     anything above a threshold.
4. **Idempotency + ledger:** every proposed and executed action gets a
   deterministic id (period + bucket + instrument) and lands in an
   append-only ledger table. Re-running a period is a no-op. This mirrors
   the CenterHQ billing-cron idempotency discipline.

## Layer 3 - Data & reconciliation

- Positions ledger reconciled monthly against bank/broker statements;
  any unexplained delta > threshold freezes automation until resolved.
- Valuation snapshots (like `mrr_snapshots`): monthly NAV per bucket,
  stored append-only, feeding the CEO dashboard.
- Performance reporting: money-weighted return per bucket vs. its policy
  benchmark; report *tracking error to policy*, not "alpha".

## Layer 4 - Risk controls & kill-switches (non-negotiable)

- **Hard caps:** max single-instrument weight; max monthly deployed
  amount; venture bucket loss-capped at funding (never topped up
  intra-year).
- **Kill-switch:** a single flag (like `processing_fee_enabled`) that
  halts all automated execution; anyone in the group can pull it, only
  the principal can reset it.
- **No leverage, no derivatives, no yield products requiring lockups
  beyond bucket horizon** - until explicitly added to the IPS whitelist.
- **Two-person rule** at Mode B: automation proposes, a human key
  approves above threshold.
- **Regulatory note:** managing *own* group capital is fine; managing
  third-party money in Egypt triggers FRA licensing - this framework
  must never be pointed at client funds without legal counsel.

## Layer 5 - Cadence & governance

- Monthly: sweep + reconciliation (automated, 30 min human review).
- Quarterly: band check, IPS compliance report, benchmark review.
- Annually: IPS re-ratification, custodian/broker review, disaster
  drill (restore ledger from statements alone).
- Every decision that deviates from the IPS is logged with a one-line
  reason - the log IS the governance.

## Build order (when EHG Intelligence gets engineering time)

1. IPS file + ledger schema + monthly NAV snapshot (pure bookkeeping).
2. Order-sheet generator (Mode A) + reconciliation report.
3. 12 months of Mode-A history → evaluate Mode B with caps.
Reuse CenterHQ patterns: Cairo-time helpers, cron + `CRON_SECRET`,
append-only audit tables, Sentry alerts on invariant violations.
