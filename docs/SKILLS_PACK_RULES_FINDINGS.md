# Findings note — skills-pack & working-rules additions (2026-07-16 session)

Task: *"Run `BUILD_BRIEF_skills_pack_and_rules.md` exactly as written, with three additions
from the 2026-07-15 session. File 13 in project knowledge is the source."* Docs only, held
branch, PR, do not merge.

## The brief itself was not available in this environment

`BUILD_BRIEF_skills_pack_and_rules.md` (a.k.a. "File 13 in project knowledge") is **not present**
in this repo, in git history on any branch, or anywhere on the container filesystem. This is the
same situation a prior session recorded for `BUILD_BRIEF_summer_pricing_invoice.md` — see
`docs/SUMMER_2026_FINDINGS.md`: project-knowledge briefs are not synced into the web/remote
execution environment.

Consequence: the "everything else in the brief stands" body of the brief could **not** be
reproduced, and the interactive prompt to request it was unavailable (non-interactive session).
The three additions are fully specified in the task text, so they were applied verbatim. Nothing
was invented to stand in for un-seen brief content.

## What was applied

### Addition A — `CLAUDE.md`, new "Working rules" section (rule 4)
- Added a `## Working rules` section carrying **rule 4 exactly as written** (migrations are a
  manual production apply; Supabase Branching auto-applies to preview branches only; verified
  2026-07-15 that PR #159 / `80f82ba` left the migration absent from the prod catalog 8 min after
  merge; apply by hand, confirm columns in `information_schema`, then deploy; never merge and
  assume).
- **Rules 1–3 were not reproduced** — they live in the un-seen brief. An HTML comment in that
  section records this and asks that 1–3 be inserted when the full brief is run. Rule 4 keeps its
  original number rather than being renumbered, to stay faithful to the addition.

### Addition B — `automated-billing-and-fees` skill, new "Verification duties" section
- Added `## Verification duties` with the UTC-vs-Cairo / DST text **verbatim**.
- Dates sanity-checked against the calendar: last Friday of April 2026 = **24 Apr** (Friday), last
  Thursday of October 2026 = **29 Oct** (Thursday). Both match the addition.

### Addition C — `automated-billing-and-fees` skill, late fees + money invariants
- **Removed** the legacy late-fee math (`late fee = rate × subscription …`) from the "Combined
  invoices carry exactly ONE fee" bullet.
- **Added** `## Late fees are dead — never reintroduce` with the addition text **verbatim** (the
  five `late_fee_*` config keys and the `late_fee_rate` / `late_fee_amount` / `days_overdue`
  invoice columns are legacy and unreachable under the day-1 lockout vs day-4 trigger; never
  reintroduce).
- **Added** the VAT money invariant: the 20 EGP processing fee **is** VAT-bearing and
  `card_orders.delivery_fee` **is** VAT-bearing; VAT is the inclusive slice of the full
  VAT-inclusive total for every invoice type and every line; **no carve-outs**.
- **Reconciled a now-stale line.** The skill previously read *"Shipping (Bosta) sits ABOVE tax —
  reimbursement, not VAT-inclusive revenue."* That is contradicted by the "no carve-outs"
  invariant **and** by this branch's own code: commit `4089293` ("Card delivery fee is VAT-bearing:
  no VAT carve-outs remain") folded delivery into the VAT base, and `src/lib/invoiceTemplates.ts`
  (~L981) + `src/lib/processingFee.ts` `buildInvoiceTaxSnapshot` now take VAT on the full total.
  The stale line was replaced by the invariant above. The `autoBookBosta` courier fee remains an
  operational cost (not a customer invoice line) and is called out as such.

## Deferred / for the human reviewer
- Insert brief-defined **Working rules 1–3** into `CLAUDE.md` when `BUILD_BRIEF_skills_pack_and_rules.md`
  is available (or paste the brief so a follow-up session can run it in full).
- Confirm the "money invariants" placement: this repo's skill has no section literally named
  *money invariants*, so the invariant was added to the fee-model bullets (which are the de-facto
  money invariants). Rename/relocate if the brief defines a dedicated section.

Docs-only change. No code, migrations, or DB writes. Branch is held — not for merge.
