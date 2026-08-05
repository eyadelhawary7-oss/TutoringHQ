# Assumptions log — the non-blocking D-codes I decided without Eyad

**Opened 5 August 2026.** Eyad's instruction, verbatim:

> *"The rest, where the decision affects behaviour but not whether the screen can be built,
> take your recommendation and proceed. Log what you assumed."*
> *"…in one line each, so I can overturn any of them later without archaeology."*

This file is that log. It exists so that overturning any line is a lookup, not an
investigation.

## How to read it

Each row is one decision I made **in Eyad's place** because it changed behaviour rather
than blocking a build. Every row names the cost of reversing it, because that is the
number that matters when deciding whether to bother.

**Basis** says how far the assumption was checked, and the three values are not
interchangeable:

| basis | means |
|---|---|
| **verified** | checked against the live catalog or by reading the code, this session |
| **ledger** | taken from a `BUILD-AFTER-REDESIGN.md` entry that was itself live-verified on a stated date |
| **judgement** | no fact settles it; I picked a default |

A **judgement** row is the cheapest kind to overturn and the most likely to be wrong.
Start there.

**None of these is a money decision.** Every money question — D5, D14, D16, D19, D22,
D23, D25 — went to Eyad and is either answered or still open. Nothing in this file
changes what anyone is charged.

---

## The log

| # | Assumed | Why | Basis | Cost to overturn |
|---|---|---|---|---|
| **D0** | KPI/stat tile radius stays **12**, and the design files get corrected to match | 12 is `--radius-md`, §3's stated default for "cards, rows", and what `KpiCard` has shipped since #214. Two of three merged files draw 16; one shared component beats two drawings | verified | One-line token change in `KpiCard` + edits to two design files |
| **D3** | `students.payment_status` readers all move to `getStudentBalances` | The column is written once at creation and never updated; every reader was showing a stale value | verified | Already shipped. Reverting means restoring stale reads — don't |
| **D7** | Card-order **notify-me is omitted**, the rest of the screen ships | No destination table exists (`waitlist_notifications` is group waitlists). `CardOrdersTeaser`'s JSDoc already documented the deliberate omission | ledger | Add a table + the control. The screen around it is already built |
| **D8** | **No seat add-on built.** The broken *included* seat count is logged separately as F19 | Pricing an extra seat is moot while `centers.max_teachers`/`max_students` don't exist and every centre is invisibly capped at 2 | verified | Fix F19 first; the add-on is a separate decision afterwards |
| **D15** | `Mark collected` **built** (reuses the audited `mark-paid` endpoint + a method picker); `Send reminder` **deferred** | Mark-collected is a third caller of an existing idempotent, ownership-checked endpoint. Send-reminder is new functionality that spends WhatsApp credit per tap | ledger | Send-reminder is unbuilt — building it is additive, nothing to unwind |
| **D17** | Public teacher-profile page built **read-only**, no "add this teacher" action | The QR and link already point at a 404. A read-only page fixes the dead link; an add-teacher action changes account state and is Eyad's | ledger | Add the action later; the page is a prerequisite either way |
| **D21** | **Keep full-UUID join links.** No short codes | The live links already work and are shared via QR and WhatsApp. `group_join_links.token` exists but has 0 rows, no generator, no collision or rotation policy | verified | Build the generator; existing links must keep resolving |
| **D26** | **No new notification writers.** Display side finished ahead of the decision | Only 2 of ~11 drawn kinds have a live writer. Wiring some would look broken rather than honestly sparse — a "New student" alert for the first enrolment then silence | verified | Wire writers per subsystem; the feed renders them on arrival with no further work |
| **D27** | When a writer *is* wired, compose via **i18n key + params in `metadata` jsonb**, translated at render | The alternative (compose per-recipient at write time with `getTranslations`) is a pattern used nowhere else in this codebase. `metadata` already exists | verified | Reverses cleanly while there is exactly one writer. Gets expensive once D26 adds more — **decide this before D26, not after** |
| **D28** | **Value-demo onboarding stays**; the design is corrected to match it | Live onboarding (add student → create group → simulate scan → ROI) is a different flow with a different purpose, not a partial build of the drawn config wizard | ledger | Build the config wizard as a separate flow. Nothing here blocks it |
| **D29** | The **5 unbacked `/pricing` add-ons stay withheld**; only the parent WhatsApp pack renders | Only `pack_price_per_parent` (=12, live) has real backing config. The other five would advertise SKUs that do not exist | verified | Each needs a real price and billing path first — the withholding is not the obstacle |
| **D34** | **Drop** the "Withdrawals to your own account" bullet rather than reword it | No withdrawal mechanism exists for anyone. There is no narrower true claim to substitute, so the replacement wording *is* a product decision | verified | Reinstate with real copy once V4 lands |

---

## Two I did **not** decide, and why

**D25 — the `parent-balance-alerts` cron.** Correcting its targeting changes **who receives
a paid WhatsApp message** and **what EGP figure a real parent is told they owe**. The fix
direction is unambiguous (`payment_status='unpaid'` → `balance > 0` via `getStudentBalances`);
sending it is not mine. **Still open.**

**D4 and D11.** Both need columns that do not exist, so they stop under the standing
migration rule regardless of what anyone prefers. Not assumptions — blocks.

---

## One correction to how this list was described

I told Eyad there were "~11" of these. There are **12**, plus the two above. The count was
approximate when I gave it and I did not go back and fix it; recorded here so the
discrepancy is not mistaken for a missing entry.
