# Group Proposals — Diff Findings (before any merge)

**Task:** Merge the doubled "group proposals" screen into one shared component.
**Files diffed:**
- Center side: `src/components/teachers/GroupProposalsTab.tsx` (731 lines)
- Teacher side: `src/app/[locale]/teacher/GroupProposalsSection.tsx` (786 lines)

**Golden-rule outcome:** the diff reveals **real behavior and rendering
differences on each side — not just different data plugged into an identical
body.** Per the brief, I paused before forcing a merge. This document is the
"diff first, report" deliverable. No code has been changed.

---

## 1. What IS genuinely shared (verbatim-extractable)

- The `Offer` / `Proposal.status` shape, `STATUS_KEY` map.
- The offer/counter **negotiation loop** concept: `respond(accept|counter|decline|withdraw)`.
- The counter-offer sub-form (cut + note inputs, `Number(counterCut) >= p.feePerClass` guard).
- The offer-history expand/collapse list.
- The `cut / message` form fields and the "fee bounds the cut" (`effectiveFee`) rule.
- The proposal-card middle band: fee, student count, latest offer, "expires on", attach badge.

These are ~parallel between the two files. This is the real overlap the audit counted.

## 2. What genuinely DIFFERS (a prop swap is not enough)

| Axis | Center (`GroupProposalsTab`) | Teacher (`GroupProposalsSection`) |
|---|---|---|
| **Wrapper / chrome** | plain `<div>` tab; `subtitleCenter`; boxed empty state w/ Handshake icon | `<section>` card w/ `title` heading + Handshake; plain-text empty state |
| **Data model** | `Proposal` has `teacherName`, `teacherPhone`, `openingMessage` | `Proposal` has `centerId`, `centerName`, `centerPhone` (no teacher fields) |
| **Counterparty picker** | teacher picker; source **linked / by-code**; loads teachers **and** attach-groups **eagerly** on form open (`loadFormData`) | center picker (from `centers` prop, no fetch); source **member / by-code**; loads joinable groups **lazily per selected center** via a `useEffect` (`loadJoinable`) |
| **Existing-group select** | picks from `attachGroups`; shows only a one-line fee; **does not pre-fill the cut** | picks from `joinableGroups` (carries `centerCutEgp`, `studentCount`); shows a rich info box (fee + current cut + student count); **pre-fills the cut** with `centerCutEgp`, and resets cut when the center changes |
| **targetMode toggle** | always shown | hidden when `byCode` (by-code is new-group only) |
| **Turn / action side** | acts when `latestOffer.madeBy === 'teacher'`; withdraws own **center** offer | acts when `latestOffer.madeBy === 'center'`; withdraws own **teacher** offer |
| **Waiting label** | `waitingTeacher` | `waitingCenter` |
| **Card badges / notes** | `linkPendingBadge`, `byCodeIncomingNote` | `combinedJoinNote`, `byCodePendingNote`, colored `initiatedBy` pill |
| **Endpoints** | `/api/center/group-proposals`, `/api/center/teachers`, `/api/center/attachable-groups`, `.../respond` | `/api/teacher/group-proposals`, `/api/teacher/joinable-groups`, `.../respond` |
| **Parent hook** | `onChanged?()` after submit/accept (a pending link may appear) | none; `refreshKey` prop re-triggers load |
| **submit body** | `teacher_code` / `teacher_id` ref | `center_code` / `center_id` ref; by-code branch is new-group-only |

## 3. Pervasive design-token DRIFT (the parity blocker)

The two copies use **different CSS custom properties for the same visual roles.**
This is cosmetic drift from independent editing — but it means the two screens
**render differently today**, so a single component cannot emit both without
per-side styling props:

| Role | Center | Teacher |
|---|---|---|
| Card / input border | `--color-border-subtle` (15×) | `--color-border` (14×) |
| Form panel background | `--color-surface-2` | `--color-surface-0` |
| "open" status pill | Tailwind `bg-teal-100 text-teal-800` | `--color-teal-soft` / `--color-teal-deep` |
| Danger text/border | raw `text-red-600` / `border-red-300` | `--color-danger` / `--color-danger`/50 |
| Counter/decline accents | raw `teal-600` / `red-300` | `--color-teal` / `--color-danger` |

Guardrail #1 says **neither side may look different than today.** Unifying to
one token set would change one side's appearance. Preserving both means
threading a full styling map as props — which erodes most of the dedup benefit.

## 4. Why this is the golden-rule "pause" case

- The screen is **entirely** the center↔teacher **cut (commission) negotiation**
  — guardrail #2 says keep that logic **byte-identical** when relocating.
- The differences above are **behavioral/structural** (cut pre-fill, lazy vs
  eager loading, different pickers, different badge sets, different chrome) plus
  **pervasive rendering drift** (different design tokens) — not "same body,
  different inputs."
- A forced single-component merge would either (a) change one side's look or
  behavior, or (b) become a large `variant === 'center' ? … : …` component with
  a styling-map prop, a picker prop, and a badge-set prop — arguably harder to
  maintain than two files, and carrying real parity risk on a commission screen.

## 5. Recommendation

Hold for Eyad. Three viable paths, in order of my recommendation:

1. **Partial extraction (safe, real win).** Extract the genuinely-identical,
   token-agnostic pieces into shared building blocks — the `Offer`/status types
   + `STATUS_KEY`, the counter-offer sub-form, and the offer-history list — and
   have both screens import them. Each screen keeps its own chrome, picker,
   data-loading, badges, and its own design tokens, so **neither side changes**.
   Removes the highest-risk-of-drift logic (the negotiation guards) without
   touching appearance. ~150–200 shared lines, zero parity risk.

2. **Full merge, both looks preserved.** One component parameterized by
   `variant` **and** a per-side styling map + picker/badge props. Achieves the
   "one file" goal but is a large conditional component; needs careful
   before/after screenshot parity on both sides.

3. **Full merge + unify the drift.** One component, one design-token set. Cleanest
   result but **changes how one side looks** — violates guardrail #1 unless Eyad
   explicitly signs off on standardizing the styling.

My pick: **Option 1** — it captures the audit's real intent (kill the drift-prone
duplicated *logic*) with zero risk to either side's look or behavior.
