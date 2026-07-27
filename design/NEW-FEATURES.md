# New features in the design — build spec

**Written 26 July 2026. Companion to `design/INVENTORY.md`. Nothing was built or changed.**
Model: `claude-opus-5`.

`INVENTORY.md` answers *which designs replace something live*. This document covers the other half:
the designs that were drawn **ahead of the platform**. They are not restyles. Applied as restyles
they render an empty screen, or worse, charge someone the wrong amount.

## How to read this

**Three sections, in the order you should work through them:**

- **A — build, no decision needed.** The design is complete and self-consistent, the dependencies exist, nothing is waiting on anyone.
- **B — blocked on a decision from you.** A number, a model, or a conflict between the design and what the platform charges today.
- **C — blocked on someone outside.** Valify, Paymob, Adsero, an accountant, or the ETA.

**Two kinds of feature appear here**, and the second is the dangerous one:

1. **From `INVENTORY.md` list 2** — no live route at all. Obvious.
2. **From `INVENTORY.md` list 1** — a live route exists, so it *looks* like a restyle, but the design specifies behaviour the route does not have. Eleven features in this document are of that kind. They are marked **`LOOKS LIKE A RESTYLE`**. A twelfth was `INVENTORY.md`'s Admin Center Assignments mapping, now confirmed wrong and split into A10 and a do-not-touch guardrail.

**Sources.** The 26 `Merged-*.html` files, read section by section, and the live code under `src/`.
No live database was queried — route and code existence come from the filesystem. Every column still
has to be checked against `information_schema.columns` at build time.

**Where I am not sure, I say so.** Appendix C lists the open questions rather than guessing at them.

## Decisions applied, 26 July 2026

Five of the questions this document raised have been answered. They are folded into the entries
below; this is the summary.

| | Decision | Effect |
|---|---|---|
| Receipt arithmetic | **Design error.** On a 1,000 fee the teacher receives 900. There is no 850 and no 105.26 in the money model. | **Do not build.** Design being corrected. → C4, Appendix D |
| "Processing fee" collision | The design's parent-side fee is renamed **PARENT PROCESSING FEE** throughout. | Renamed here; 5 design screens to rename. → B1, Appendix D |
| Referral step-down | **Live wins: 10% for twelve months.** The design's month-6 drop is wrong. | Not a build item. The rest of the screen is unblocked. → A9, Appendix D |
| Plan names | Starter/Growth/Scale are **placeholder**. Real: centers **Solo, Nano, Starter, Pro, Business, Enterprise**; teachers **Free, Standard, Pro, Scale**. | 12 design screens to correct. Build side unblocked. → Appendix D |
| Admin Center Assignments | The **live route is do-not-touch** commission machinery. The design is a separate feature needing its own route. | Split into A10 and a do-not-touch guardrail. → A10 |
| **Collection fee model** | **LOCKED.** 10% collection fee · 7.5% + 7.5 markup · parent processing 1.5% + 1.5. Provider screens quote the provider price, never the parent total. | **Unblocks B2→A11, B3→A12, B4→A13, B14→A14, and the fee half of C5.** → B1 |
| Analytics / Benchmarks add-ons | **Not decided.** Analytics keeps `canViewRevenue`; Benchmarks stays free. | Do not build either as a purchase. → B9, B10 |
| Group billing basis | **Not decided.** Live keeps `fee_per_class` only. | → B12 |
| Admin §07 prices, teacher Free tier, `top_centers`, the §02 fee wording | Four further design corrections. | → Appendix D5–D8 |

**Appendix D collects every design edit these decisions imply**, by file and section number.

## Feature summary

| | Feature | Touches |
|---|---|---|
| **A1** | Lead capture funnel — `/talk-to-us` + `/admin/demo-requests` | none |
| **A2** | Admin teacher list and teacher account detail | money (read) |
| **A3** | Coming Soon pattern and locked entry rows | account state |
| **A4** | Card orders coming-soon screen | account state |
| **A5** | Teacher student detail as its own surface | money |
| **A6** | Teacher earnings calculator as its own screen | none |
| **A7** | CEO centers benchmark, verified vs unverified | money (read) |
| **A8** | Empty and loading states, row-action patterns | none |
| **A9** | Referral rate display, countdown and step-date detail | money (read) |
| **A10** | Admin teacher ↔ center linking, on a new route | account state |
| ~~B1~~ | ~~The collection fee model~~ — **LOCKED 26 July**. Rate card below | money |
| **A11** | Online collection for centers (Collect for me) — *unblocked by B1, still needs C1* | money, account state |
| **A12** | Online collection for teachers (Collect for you) — *unblocked by B1, still needs C1* | money, account state |
| **A13** | Provider balance, clearing and withdrawal — *unblocked by B1, still needs C1* | money |
| **B5** | WhatsApp Pack as a one-time top-up | money |
| **B6** | Teacher WhatsApp screen and message allowance | money |
| ~~B7~~ | ~~Referral rate step-down window~~ — **resolved**, live wins. Build side moved to A9 | — |
| **B8** | Referral earnings: credit vs withdraw, and the minimum | money, account state |
| **B9** | Advanced Analytics as a paid add-on — **deferred 26 July, do not build as a purchase** | money, account state |
| **B10** | Benchmarks as a paid add-on — **deferred 26 July, stays free** | money, account state |
| **B11** | Extra team seats as a paid add-on | money |
| **B12** | Group billing basis — **deferred 26 July, live keeps `fee_per_class` only** | money |
| ~~B13~~ | ~~Admin Center Assignments~~ — **resolved**, split into A10 and a do-not-touch guardrail | — |
| **A14** | Parent payment page — *unblocked by B1, still needs C1* | money |
| ~~B15~~ | ~~Plan naming~~ — **resolved**, real names confirmed. Design correction only | — |
| **C1** | Identity verification (e-KYC via Valify) | auth, account state |
| **C2** | Verified as a second account state across the platform | money, account state |
| **C3** | Center → teacher split payouts | money |
| **C4** | Tax documents: ETA e-receipt and e-invoice | money |
| **C5** | Admin money ledgers for collection — *fee model locked; still needs C1 + C4* | money |
| **C6** | Legal document text | none |
| **C7** | Self-enrollment: the minor-consent question | account state |

---

# A. BUILD, no decision needed

## A1. Lead capture funnel

**What it is:** A five-field "have us call you" form at `/talk-to-us` whose submissions land in the
existing admin queue and route to the rep who owns that area.

**Designs:** `Merged-Public-Marketing` §04 (Lead Capture). The receiving end is `/admin/demo-requests`,
which has no design at all — see Appendix B.

**Exists today:** Partial, and more than expected.
- `POST /api/demo-request` exists.
- `/{locale}/admin/demo-requests` exists (180 lines) with `pending / contacted / approved / rejected` statuses.
- `/{locale}/demo-request` exists as a 55-line stub: a logo, one line of copy, and a hardcoded `wa.me/201001234567` link. No form.
- Territory data exists — `center_assignments` carries `territory_city` and `territory_override_reason`.

**Has to be built:**
- Route `/{locale}/talk-to-us` (and add the prefix to `AUTHENTICATED_ROUTE_PREFIXES`? No — it is public; confirm it is not caught by the CORS allowlist for `/api/*` mutations).
- Five fields: name, mobile, center name, **area**, rough student count. Verify each against the live `demo_requests` columns before writing the insert — the current stub writes nothing, so the table may not have `area` or `student_count`.
- Area → territory → rep routing on insert, reusing `territory_city`.
- Submitted state: names the covering area back to the user, then keeps "Start free trial now" on screen.
- Decide what happens to `/demo-request` (Appendix B) — the two cannot both be the lead door.
- Admin side: surface the new fields in `/admin/demo-requests`, which currently shows name / phone / email / center_name / status / notes.

**Touches:** none — no money, no auth, no account state.

**Depends on:** nothing. This is the cleanest build in the document.

**Design intent — do not "improve" these away:**
- **It is not a demo booking.** No calendar, no time slots. The design says so twice.
- **Area is the load-bearing field**, not a nice-to-have. It is what gives a rep's claim something to attach to. Do not make it optional or turn it into a free-text city.
- **The submitted state keeps the free trial in front of them.** The design's stated reason: waiting for a call is the most expensive thing that can happen to a warm lead. Do not replace it with a plain "thanks, we'll be in touch".
- **WhatsApp stays as a third door**, below the form, 10am–6pm. Do not remove it in favour of the form.

## A2. Admin teacher list and teacher account detail

**What it is:** The teacher half of the admin portal — a solo-teacher list beside the center list, and
a teacher account detail page.

**Designs:** `Merged-Admin-Platform` §01 (frame captioned `/admin/teachers`), `Merged-Admin-Accounts`
§01 (frame captioned `/admin/teachers/[id]`).

**Exists today:** Nothing. `/{locale}/admin/centers/page.tsx` has no `owner_type` filter and there is
no teacher list or teacher detail under `/admin`. Note that several *other* admin pages do carry an
owner filter (`/admin/billing`, `/admin/finance`, `/admin/renewals` all call `normalizeOwnerFilter`),
so the data model already distinguishes the two customer types — only these two screens do not.

**Has to be built:**
- Routes `/{locale}/admin/teachers` and `/{locale}/admin/teachers/[id]`.
- Register both under `AUTHENTICATED_ROUTE_PREFIXES` (`/admin` already covers them).
- Filter chips: All / Active / Trial / Overdue / Unverified. **The Unverified chip depends on C1.**
- Teacher detail: same shape as center detail minus staff and branches, which the design states teachers do not have.
- Admin overview: split customers, revenue and students across centers and teachers; revenue mix as Subscriptions / Add-ons / WhatsApp packs.

**Touches:** money (read only — MRR, revenue mix).

**Depends on:** C1 for the Unverified filter only. Everything else is buildable now.

**Design intent:** the overview treats centers and solo teachers as **two co-equal customer types**,
not one main type with an exception. Every headline number is split. Do not collapse them back into a
single total with a filter.

## A3. Coming Soon pattern and locked entry rows

**What it is:** One pattern for any feature that is not on yet — a calm full screen that names the
working alternative, plus a locked list row with a "Coming soon" badge.

**Designs:** `Merged-Lifecycle` §06.

**Exists today:** Nothing as a pattern. Live behaviour is ad hoc: the Orders sidebar item is *hidden
entirely* when `card_orders_enabled` is false (`src/components/Sidebar.tsx:166`), the scanner has a
settings page but no gate screen, and `WhatsAppTemplatesClient.tsx` has its own inline coming-soon
handling.

**Has to be built:**
- A shared `ComingSoon` screen component and a locked-row variant for settings lists.
- Wire the four cases the design names: attendance cards, ordering, printing, card scanning.
- Decide per case whether the entry is hidden or shown-and-locked. **The design says shown-and-locked.**

**Touches:** account state (what a center can reach).

**Depends on:** nothing. Belongs in Session 2 foundations, not a screen PR.

**Design intent:** the full screen **always points to the working alternative** ("Take attendance with
the checklist"). A coming-soon screen with no exit is the failure mode this pattern exists to prevent.
Hiding the row entirely — what the sidebar does today — is explicitly not the pattern.

## A4. Card orders coming-soon screen

**What it is:** The teaser a center sees while card ordering is gated: card preview, four-point
feature list, notify-me, and the notified confirmation.

**Designs:** `Merged-Center-Orders` §04.

**Exists today:** The gate exists (`centers.card_orders_enabled`, checked in `Sidebar.tsx:166`) but
there is no screen — the nav item just disappears. `/{locale}/orders` itself is a full working
ordering flow.

**Has to be built:**
- The gated state of `/{locale}/orders`, rendered when `card_orders_enabled` is false, instead of hiding the route.
- A notify-me registration and its confirmation state. **Verify the destination table exists before writing to it** — no `card_order_waitlist` or equivalent was found.
- WhatsApp notification when the feature launches, which needs a template.

**Touches:** account state.

**Depends on:** A3 for the shared pattern. Template approval if the notify-me message is a WhatsApp
template rather than an internal list.

**Design intent:** the notify-me is the whole point of the screen. Without it this is just a hidden
nav item with extra steps.

## A5. Teacher student detail as its own surface

**What it is:** A teacher's view of one student — their contact, the parent's contact, an outstanding
balance collectable in place, attendance, and recent classes.

**Designs:** `Merged-Teacher-Students` §02. **`LOOKS LIKE A RESTYLE`** — `INVENTORY.md` maps it to
`/{locale}/teacher/students`, which is true only in the sense that the live version is a modal.

**Exists today:** Partial. `src/app/[locale]/teacher/AllStudentsList.tsx` opens a modal on
`openStudentId` with a small amount of detail. The design draws a full screen reached from four
places: Students, attendance, a session record, and a group.

**Has to be built:**
- Decide route vs modal. The design's "opens whenever a teacher taps a student's name, from Students, attendance, a session record or a group" implies a route, because a modal cannot be opened from four different screens without four wirings.
- Collect-in-place action on the outstanding balance — the modal has no such action today.
- Entry points from the three surfaces that do not have one.

**Touches:** money (outstanding balance, collection).

**Depends on:** the collect action's behaviour differs verified vs unverified (C2). The read-only
half is buildable now.

**Design intent:** the parent's contact sits beside the student's, because the parent is who gets
chased. Do not drop it to save vertical space.

## A6. Teacher earnings calculator as its own screen

**What it is:** Pick a plan, set students and average fee, see estimated monthly income and how small
the plan is as a share of it.

**Designs:** `Merged-Teacher-Money` §02. **`LOOKS LIKE A RESTYLE`** — mapped in `INVENTORY.md` to
`/{locale}/teacher` because the live version is a card on the home page.

**Exists today:** Partial. `src/app/[locale]/teacher/IncomeCalculator.tsx`, rendered once at
`teacher/(portal)/page.tsx:423`.

**Has to be built:**
- Promote to a screen, or decide it stays a card. The design draws it as a screen inside `Merged-Teacher-Money`, beside Income and Billing.
- Plan picker driven by live plan data, not hardcoded. The design's Standard / Pro / Scale ladder at 499 / 999 / 2,499 is **correct** for teachers — this is one of the nine screens that already uses the real names.

**Touches:** none — display-only arithmetic, no charge.

**Depends on:** nothing. Plan naming was settled on 26 July (resolved B15).

**Design intent, and it is unusually specific:** *"The percentage only ever appears as an output the
teacher generated, and it shrinks as they grow."* The plan cost is never presented as a headline
percentage. A builder tidying this into "your plan costs X% of income" inverts the entire argument
the screen exists to make.

## A7. CEO centers benchmark, verified vs unverified

**What it is:** An internal comparison of verified against unverified centers on revenue, students,
retention and overdue, plus the unverified centers worth chasing, ranked by MRR.

**Designs:** `Merged-CEO` §03.

**Exists today:** Nothing. `/{locale}/ceo/page.tsx` is 1,230 lines with sections for pipeline,
activation, health, cash, ops and control, and **zero occurrences of "verified"**.

**Has to be built:**
- Route or `/ceo` section — the design uses the admin five-item bottom nav, so placement needs settling with the wider admin IA question (Appendix C).
- Cohort aggregate: centers count, avg MRR, avg students, retention, overdue rate, growth MoM, split by verification.
- Chase queue: unverified centers sorted by MRR.

**Touches:** money (read only).

**Depends on:** **C1.** Buildable today, but every row reads 0 / 100% until verification ships. That
is a real dependency, not a soft one — do not build this expecting to see the design's numbers.

**Design intent:** it is *"a benchmark, not a full dashboard"*. Two screens, six metrics, one ranked
list. Do not grow it into a third exec dashboard beside `/ceo` and `/admin`.

## A8. Empty and loading states, and the row-action pattern set

**What it is:** Six pattern sheets covering the first hour of a real center and the second every
screen spends waiting, plus four alternative row-interaction gestures.

**Designs:** `Merged-Design-Patterns` §01 Empty States, §02 Loading States, §03 Row action patterns,
§04 Quick menu rows, §05 Group actions, §06 Expand sheet merge.

**Exists today:** Partial and inconsistent. Skeletons exist on a handful of screens
(`animate-pulse` blocks in the teacher portal, `loading.tsx` under `whatsapp-pack`). Empty states are
written per screen. The design's own note: the zero state *"was drawn nowhere across the other 26
files, which meant it would have been invented separately on each screen it appears on."*

**Has to be built:** the shared component set. This is **Session 2, PR 4** work from
`START-CLAUDE-CODE.md`, not screen work, and it should land before Phase A.

**Touches:** none.

**Depends on:** Session 2 PRs 1–3 (tokens, type, language system).

**Design intent:** §02 says explicitly *"Nothing here is new invention, it is the existing treatment
written down so it does not get reinvented."* Match what four screens already do; do not design a new
skeleton. §06 merges the expand-in-place and bottom-sheet patterns — build the merged one, not both.

## A9. Referral rate display, countdown and step-date detail

**What it is:** The part of the redesigned referrals screen that shows, per referral, which rate it
is on, what it pays monthly, and how many days until it drops — plus a detail view with the exact
step dates.

**Designs:** `Merged-Center-Insight` §03 (Referrals), `Merged-Teacher-Insight` §02 (Teacher
Referrals). **`LOOKS LIKE A RESTYLE`** for the center screen — `/{locale}/referrals` is live.

**Exists today:** The screen exists with active referrals, monthly totals and lifetime earnings. It
does **not** show the per-referral rate, the monthly figure that rate produces, a countdown to the
next step, or a detail view with step dates. The rate function itself is inline in
`src/app/api/referrals/process-commission/route.ts:105-108`.

**⚠ Build against the LIVE rates, not the drawn ones.** Live is **25% month 1 · 10% months 2–12 ·
5% month 13+**. The designs draw the 10% band ending at month 6. **That is a design error and the
design is being corrected** — people have already been told a rate. Every "Drops to 10% in 6 days"
style countdown in the design is computed off the wrong window; the mechanic is right, the number
is not.

**Has to be built:**
- Lift the rate function out of the cron route into one place both the job and the UI read, so the screen and the payment can never disagree.
- Per-referral row: current rate, monthly amount it produces, days until the next step.
- A rate-decay timeline showing 25% → 10% → 5% with the **twelve-month** band.
- Referral detail with exact step dates.
- Sort by "ending soon", which the design uses as the default.

**Touches:** money (read only — this displays a commission that is calculated elsewhere).

**Depends on:** nothing. The credit-versus-withdraw block on the same screen is **B8** and stays
blocked; build around it.

**Design intent:** *"New referrals start fresh at 25%. Refer more to keep the top rate flowing."*
The decay is a mechanic to drive more referring, not a tax. The countdown is what creates that
pressure — it is the reason the screen was redrawn, and it survives the rate correction intact.

## A10. Admin teacher ↔ center linking, on a new route

**What it is:** An internal view of which teachers are linked to which centers, with an assign form
that sets the link type.

**Designs:** `Merged-Admin-Accounts` §03. **Note the design is titled "Admin Center Assignments",
which is now a misleading name** — see the guardrail below and Appendix D.

**Exists today:** Nothing at admin level. Teacher ↔ center linking exists only center-side at
`/{locale}/my-teachers` (Teachers / Requests / Slots / Add tabs) and teacher-side at
`/{locale}/teacher/centers`. There is no admin view of it.

**Has to be built:**
- **A new route.** `/{locale}/admin/center-assignments` is taken by unrelated commission machinery, so this needs its own path — `/{locale}/admin/teacher-links` reads clearly and does not collide. **That name is my proposal, not a decision you made.**
- Three tabs: By center, By teacher, Unassigned.
- Assign form: teacher, center, and **link type Visiting or Permanent** — *"Visiting teachers keep their own private groups. The center only sees the classes they run there."*
- Verify what backs "Visiting vs Permanent" before writing a query. The center-side flow already models proposals, cuts and slots; whether a link-type column exists is a live-catalog question, not a code-reading one.

**Touches:** account state (what a center can see of a teacher's groups).

**Depends on:** nothing.

**Design intent:** the link type is a **visibility rule**, not a label. A visiting teacher's private
groups stay invisible to the center. Building this as a flat "assigned / not assigned" flag loses
the only thing the screen decides.

> ### ⛔ Do-not-touch: `/{locale}/admin/center-assignments`
>
> **The live route of that name is sales-rep commission attribution and must not be restyled,
> refactored or touched by any redesign PR.**
>
> `src/app/[locale]/(admin)/admin/center-assignments/page.tsx` carries `sourced_by: 'eyad' | 'sm' |
> 'sr'`, `is_primary`, `territory_city`, `territory_override_reason`, and error keys including
> `duplicate_primary`, `rep_required` and `rep_not_your_report`. **Reps start in September and this
> is the machinery that decides who gets paid.**
>
> It has **no design**, and that is correct — it should not get one as part of this redesign. Add it
> to Appendix B's decision-pending list, not to any screen PR.
>
> Separately and with the same deadline, `CLAUDE-CODE-HANDOFF.md` §1.1–§1.4 asks for database work
> on this exact table: the missing unique constraint on the center identifier, the missing claim
> expiry field, `sourced_by` lacking house-account and team-leader values, and the commission table
> gaps. **That work is real and should not wait behind the redesign** — but it is database work, not
> screen work, and it does not belong in a design PR either.

---

# B. BLOCKED ON A DECISION FROM YOU

## ~~B1. The collection fee model~~ — LOCKED 26 July

> **Decided. Use exactly this. B2, B3, B4, B14 and C5 are unblocked.**

### The rate card

**One rate card. Every provider keeps 90%, the platform keeps 10%.** Three revenue lines on a
provider fee of **X**:

| Line | Formula | Visible to |
|---|---|---|
| Collection fee | `0.10 × X` | **provider** |
| Price markup | `0.075 × X + 7.5` | **provider only — never a parent** |
| **Parent processing fee** | `0.015 × (X + markup) + 1.5` | **parent**, with the formula shown |

**Worked example, X = 150:**

```
provider enters              150.00
provider keeps               135.00     X − 10%
provider price               168.75     X + markup   ← provider screens quote THIS
parent processing fee          4.03     1.5% × 168.75 + 1.5
parent pays                  172.78     ← provider screens NEVER show this
```

### The presentation rule

**The parent never sees the underlying fee. The provider screens quote the provider price, not the
parent total.**

> **If a screen shows a provider the parent total, that is a bug.**

Provider-facing screens quote **168.75**. The parent's payment page is the only surface where
**172.78** appears, and there the split is `168.75` + `4.03` with the formula stated. The 10%
collection fee and the 7.5% + 7.5 markup are provider-visible; neither is ever rendered to a parent.

### Standing rules that come with it

- **All published subscription prices are VAT-inclusive at 14%.**
- **Paymob's ~2.75% comes out of company margin.** Never passed on, never shown.
- **No refunds.** Billing is post-paid, so the remedy is **void an unpaid link**, not a refund. Do not build a refund path on any screen.

### What this does not change

**`resolveProcessingFeeAmount()` is still the CENTER fee** — the flat 20 EGP on subscription, pack,
card-order and reactivation invoices. The naming rule below stands unchanged. The parent processing
fee gets its own module, its own config keys and its own snapshot field.

## ⚠ NAMING RULE — two different fees, one name, and it fails silently

**Two unrelated charges are both called "processing fee". They differ in rate, in payer, and in
which invoice they land on. Getting them confused charges the wrong party the wrong amount, and
nothing in the type system will catch it.**

| | **CENTER PROCESSING FEE** (exists, live) | **PARENT PROCESSING FEE** (new, B1) |
|---|---|---|
| Amount | **Flat 20 EGP** | **1.5% × (X + markup) + 1.5** |
| Paid by | The **center or teacher** | The **parent** |
| Applied to | Paymob-charged subscription, pack, card-order and reactivation invoices | Tuition collected on behalf of a provider |
| Config | `platform_config.processing_fee_enabled` / `processing_fee_amount` | its own keys, to be added |
| Snapshot | `invoices.metadata.processing_fee` | its own field, to be added |
| Code | `src/lib/processingFee.ts`, `resolveProcessingFeeAmount()`, `getProcessingFeeConfig()` | its own module |
| Spec | `docs/PRICING_SPEC.md` §5 | B1 above |

> **`resolveProcessingFeeAmount()` is the CENTER fee. It must never be used for a parent charge.**
> Nor may `getProcessingFeeConfig()`, `PROCESSING_FEE_DEFAULT_AMOUNT`, `applyProcessingFee()`, or
> `invoices.metadata.processing_fee`. A parent charge that reaches any of them bills a flat 20 EGP
> instead of the B1 formula, on the wrong invoice, against the wrong payer — and the amount is
> plausible enough that nobody notices.
>
> **The parent fee needs its own module, its own config key, and its own snapshot field.** Do not
> extend the existing one with a flag.

**Throughout this document the design's fee is written PARENT PROCESSING FEE.** In the design files
it is still called "processing fee" — Appendix D1 lists the five screens to rename, in both
languages. **Both meanings appear inside the same design set**, which is what makes this dangerous:
the WhatsApp Pack and Order Checkout designs correctly use the *existing* 20 EGP fee.

**Still open, and it is wording not maths:** the customer-facing Arabic term. Live uses
**رسوم المعالجة** for the center fee and the design uses the same phrase for the parent one.

## A11 (was B2). Online collection for centers ("Collect for me")

> **Fee model locked 26 July (B1). Unblocked as far as the money is concerned — the remaining
> dependency is C1, identity verification.**

**What it is:** A center verifies, TutoringHQ invoices each parent, collects, and processes the money
to the center's bank every Thursday.

**Designs:** `Merged-Center-Attendance` §02 (opt-in, activated, tax status). The verified states of
`Merged-Center-Home` §01, `Merged-Center-Students` §03, `Merged-Center-Groups` §02,
`Merged-Center-Money` §02, `Merged-Center-Setup` §08 all assume it is on.

**Exists today:** Nothing. Live payments are *recorded*, not processed — `/{locale}/payments` is a
ledger with methods cash / instapay / vodafone_cash / orange_cash / fawry / bank_transfer, and the
design's own note on the live model is *"The app records payments, it does not process them."*

**Has to be built:**
- Data model: center collection opt-in flag; a center balance with **Pending** and **Available** buckets; the Thursday clearing job that moves Pending → Available; per-payment split records (tuition, collection fee, markup, **parent processing fee** — its own field, never `invoices.metadata.processing_fee`).
- Routes: the opt-in screen, the activated online-collection screen, the tax-status sub-screen.
- Logic: invoice-per-parent generation on session billing; Paymob collection against those invoices; the per-student, per-session **cash switch** taken during attendance.
- Integrations: Paymob (collection), C4 (receipt issuance), C1 (the verification gate).
- Tax status: registered (tax card on file → e-invoice) vs unregistered (→ e-receipt), editable at any time, switching from the next document onward.

**Touches:** money, account state.

**Depends on:** **B1** (the rates), **C1** (verification), **C4** (documents).

**Design intent:**
- **"Every group collects digitally, always."** There is no cash-only group and no cash-only student. Cash is a switch made for **one student in one session, while taking attendance** — nothing else. A builder adding a "cash group" type or a per-student cash flag is undoing the central decision of this feature.
- **The center's price is untouched.** They enter their fee, they keep 90% of it, the parent pays their fee plus the markup. Do not present the markup as a discount on the center's fee.
- **Thursday is a clearing date, not a payout.** Money moves Pending → Available on Thursday; withdrawing is always the center's own action (see B4). Do not build an automatic Thursday payout.
- **"One fee, nothing else deducted."** The opt-in states exactly one deduction. Adding a second visible deduction breaks the promise the screen makes.

## A12 (was B3). Online collection for teachers ("Collect for you")

> **Fee model locked 26 July (B1): the teacher collection fee is 10%, same rate card as centers.
> Remaining dependency is C1.**

**What it is:** The same product for an independent teacher, opted into from a screen that states the
fee only in categories, never as a number.

**Designs:** `Merged-Teacher-Money` §05 (opt-in), `Merged-Verification-Payouts` §02 (automated vs
manual fee collection), and the verified halves of `Merged-Teacher-Home` §01, `Merged-Teacher-Money`
§01, `Merged-Teacher-Setup` §01, `Merged-Teacher-Groups` §05.

**Exists today:** Nothing. The teacher session flow calls `finish_class_and_bill`, which creates
pending charges the teacher then marks paid by hand
(`/api/teacher/private/transactions/[transactionId]/mark-paid`).

**Has to be built:** the same stack as B2, plus:
- The manual → automated transition on the fee-collection surface, with both states drawn.
- Teacher balance, distinct from the center balance.

**Touches:** money, account state.

**Depends on:** **B1**, **C1**, **C4**. Also **the fee number itself is not in the design** — see below.

**Design intent, and this one is deliberate and fragile:**
- The teacher opt-in screen states the fee as **plain categories with no figures beside them** — "Card and wallet fees · Payment processing · Taxes · Support · The platform" — under a heading marked *"Private to you"*. The design note says the intent is that *"the margin stays private without inventing anything."*
- `Merged-Verification-Payouts` §06 nevertheless shows a **10% collection fee** on the teacher expense receipt.
- **So the number is disclosed on the receipt but withheld on the opt-in.** That is either intentional (you agree to a fee, you see it once money moves) or an inconsistency. **This needs your call**, and it is exactly the "the amount shown differs from the amount charged" case `START-CLAUDE-CODE.md` asks for adversarial review on.
- The design is marked *"draft pending legal review"* — see C6.

## A13 (was B4). Provider balance, clearing and withdrawal

**What it is:** How a verified center or teacher gets collected money out — a free monthly payout, a
priced extra payout, and a priced instant payout.

**Designs:** `Merged-Center-Money` §04 (center withdrawal), `Merged-Teacher-Money` §04 (teacher
instant payout), `Merged-Center-Money` §05 (payout statements).

**Exists today:** Nothing for tuition. The only withdrawal in the product is **referral credit**
(`ReferralWithdrawalPanel`, `/admin/withdrawals`, `computeReferralPayout`), which is a different
balance with a different fee schedule.

**The fee schedule, as drawn (center):**

| Case | Charge |
|---|---|
| One payout a month | Free, at any amount, allowance resets on the 1st |
| Extra payout under 10,000 | 250 EGP |
| Extra payout over 10,000 | 2% |
| Instant, under 10,000 | 250 EGP |
| Instant, over 10,000 | 3% |

All prices stated VAT-inclusive. Instant is always charged, **even on the free monthly one**. There
is no minimum withdrawal. The teacher screen shows a flat 300 EGP instant fee on 8,400 — which is
3.57%, matching neither band, so **the teacher schedule is either different or the sample is loose.**

**Has to be built:**
- Balance model with Pending / Available, the Thursday clearing job, and a monthly free-payout allowance that resets on the 1st.
- Withdrawal request → bank batch, with the fee computed and shown before confirmation.
- The small-withdrawal guard: at 500 EGP the design shows the fee **as a share of the withdrawal** ("250 EGP, which is half of this withdrawal") with a "Leave it to build" option beside "Withdraw 250 anyway".
- Payout statements: tuition collected, collection fee, payout charge, paid to you, downloadable.

**Touches:** money.

**Depends on:** **B1**, **B2**/**B3**, **C1**. The bank-batch mechanics overlap **C3**.

**Design intent:**
- **The fee is shown as a share, not a bare number, on small withdrawals.** The stated reason: *"so nobody does it by accident."* Do not replace it with a flat "250 EGP fee" line.
- **"Our own banded cost never appears."** The design deliberately hides the platform's own banking cost and handles split-to-avoid-a-band behind the screen. Do not surface it.
- **Withdrawing is always the provider's action.** Never automatic.

## B5. WhatsApp Pack as a one-time top-up

**What it is:** Replacing the per-parent monthly pack with a one-time message credit that never
expires, in two non-fungible types.

**Designs:** `Merged-Center-WhatsApp` §02 (pack), §03 (custom-amount flow). **`LOOKS LIKE A RESTYLE`**
— `INVENTORY.md` maps both to `/{locale}/whatsapp-pack`, which exists and works.

**Exists today:** A different product at the same route.
- Live: `PACK_PRICE_PER_PARENT = 12`, `parent_pack_enabled`, `parent_pack_active_parents`, per-plan `ANNOUNCEMENT_CAPS` (nano 700 … top_centers 99999), `BLAST_PRICE_PER_PARENT`, plus a `pack_request_status` approval flow. Billed monthly, per parent.
- Design: buy N messages once, credit never expires and carries over.

**The design's price ladder:**

| Notifications | Rate | Promotions | Rate |
|---|---|---|---|
| 200 (Mini) | 1 EGP/msg → 200 EGP | 200 | 7 EGP/msg → 1,400 EGP |
| 1,000 (Standard) | 0.75 EGP/msg → 750 EGP | 1,000 | 7 EGP/msg → 7,000 EGP |
| 5,000 (Plus) | 0.5 EGP/msg → 2,500 EGP | 5,000 | 7 EGP/msg → 35,000 EGP |
| Custom | banded 1 / 0.75 / 0.5 | Custom | flat 7 |

VAT inclusive, plus the **existing flat 20 EGP processing fee**, billed via Paymob. Center and
teacher rates are identical.

**Has to be built:**
- Credit-balance data model, two separate non-fungible balances, never expiring.
- Custom-amount flow: amount → banded rate → total → Paymob confirm → done.
- Migration path for centers currently on the per-parent monthly pack, including anyone mid-cycle and anyone with a `pack_request_status` in flight.
- Retire or keep `ANNOUNCEMENT_CAPS` — plan-based caps make no sense against a never-expiring purchased balance.

**Touches:** money. **This changes what an existing customer is charged**, which is why it is in B.

**What has to be decided:**
1. Do you want the model change at all, or the design's layout on the current model?
2. What happens to centers already billed per-parent — grandfathered, migrated with a credit grant, or switched at renewal?
3. Do the plan-based announcement caps survive?
4. The design says center and teacher rates are identical. Live has no teacher pack at all (see B6).

**Design intent:**
- **Two credit types that cannot be spent on each other.** *"so a reminder pack can't be spent on promotions."* A single pooled balance is simpler and is the wrong answer.
- **Promotions price flat, notifications step down by volume**, because marketing messages cost more to send. Do not apply the volume ladder to promotions.
- **Credit never expires and carries over.** This is the whole pitch — *"like topping up phone credit."*

## B6. Teacher WhatsApp screen and message allowance

**What it is:** The teacher portal's WhatsApp surface — balance, what used it, the template list, and
a split between messages the platform pays for and messages the teacher pays for.

**Designs:** `Merged-Teacher-WhatsApp` §01.

**Exists today:** Nothing. The design's own note: *"The teacher portal had no WhatsApp screen at all,
despite teachers getting bundled credit, buying the same packs at the same rate, and messaging
parents every week."* No `/teacher/whatsapp` route, no teacher pack.

**Has to be built:**
- Route `/{locale}/teacher/whatsapp`.
- **A plan-included monthly message allowance** — the design says *"Your Pro plan includes 50 a month. They reset on the 1st."* No such entitlement exists in live plan data.
- Teacher-side pack purchase at the same rates as centers (depends on B5).
- The platform-paid vs teacher-paid split: payment links, receipts and collected-session reminders are *"on us"* and cannot be turned off; welcome / fee reminder / session-changed come out of the teacher's balance.
- A teacher template set, deliberately shorter than the center's.

**Touches:** money.

**Depends on:** **B5** (the pack model), and the allowance decision below. The platform-paid half
depends on **B3**, since those messages only exist when the platform collects.

**What has to be decided:** how many messages each teacher plan includes, and whether the allowance
resets or accrues. The design says resets on the 1st while purchased credit never expires — two
different behaviours in one balance, which needs to be modelled deliberately.

**Design intent:** the screen **separates what we pay for from what they pay for**, so a teacher is
never surprised by a charge. Merging the two counters back into one total defeats the screen.

## ~~B7. Referral rate step-down window~~ — RESOLVED 26 July, design is wrong

> **Live wins: 25% month 1 · 10% months 2–12 · 5% month 13+.** People have already been told a rate,
> so the live schedule stands and the design's month-6 drop is a **design error**.
>
> **This is not a build item.** Do not change `process-commission/route.ts:105-108`. The design files
> need correcting — see Appendix D. The rest of the redesigned referrals screen is unblocked and has
> moved to **A9**.
>
> Original analysis retained below for the record.

### Original entry

**What it is:** The design shortens the 10% commission window from eleven months to five.

**Designs:** `Merged-Center-Insight` §03 (Referrals), `Merged-Teacher-Insight` §02 (Teacher Referrals).
**`LOOKS LIKE A RESTYLE`** — `/{locale}/referrals` is live and `INVENTORY.md` lists it as a restyle.

**Exists today:** `src/app/api/referrals/process-commission/route.ts:105-108`:

```
months === 1        → 0.25
months <= 12        → 0.10
else                → 0.05
```

**The design states, on both screens:** 25% month 1 · 10% **months 2–6** · 5% **month 7+**.

**This roughly halves what a referrer earns in year one.** On a 899 EGP/mo plan: live pays
225 + (11 × 90) + … ; the design pays 225 + (5 × 90) + (6 × 45). It is a live commission change
affecting people who have already been told a rate.

**Outcome:** the live schedule stands. No rate change, no grandfathering question, nothing to migrate.
The screen work that sat behind this decision — the rate function extraction, the per-referral
display, the countdown and the step-date detail — is unblocked and specified in **A9**, against the
twelve-month band.

**Touches:** nothing any more.

## B8. Referral earnings: credit versus withdrawal

**What it is:** Verified users can withdraw referral earnings to a bank **or** spend them as in-app
credit. Unverified users can only spend as credit.

**Designs:** `Merged-Center-Insight` §03, `Merged-Teacher-Insight` §02,
`Merged-Verification-Payouts` §02 (the withdraw gate), §04 (payout details).

**Exists today:** Partial, and closer than most.
- 5% withdrawal fee exists and matches the design: `REFERRAL_WITHDRAWAL_FEE_RATE = 0.05`, and §04's "2,100 → −105 → 1,995" is exactly 5%.
- Fee order is defined live: flat 20 EGP first, then 5% on the remainder (`computeReferralPayout`). **The design shows only the 5%** and no 20 EGP line.
- A credits system exists (referenced as 2,000 credits = 1,000 EGP, 2:1).
- `/admin/withdrawals` exists and approves these.

**Two conflicts:**
1. **Minimum withdrawal.** Live `REFERRAL_WITHDRAWAL_MIN_EGP = 1000`. The design says **200** (`Merged-Verification-Payouts` §04 and §06 both state it).
2. **Payout destination.** Live stores `instapay_number` on the withdrawal row. The design stores **bank details / IBAN**, saved once, with a Bank / Mobile wallet toggle.

**Has to be built:**
- Saved payout-details record (method, account holder, IBAN or wallet), owned by the user, editable only by them.
- The unverified state: credit-only, with withdrawal shown as locked rather than hidden, and earnings still accruing.
- Whichever minimum you settle on, applied in one place.
- The 20 EGP line reconciled with the design, or the design corrected.

**Touches:** money, account state.

**Depends on:** **C1** for the gate. The rest is decision-only.

**Design intent:** *"Earnings keep accruing while unverified."* Verification gates the **withdrawal**,
never the earning. Do not stop accrual for unverified accounts. And the locked state shows the amount
— hiding the number removes the reason to verify.

## B9. Advanced Analytics as a paid add-on — DEFERRED 26 July

> **Not decided. Do not build Analytics as a purchase.** `/{locale}/analytics` keeps its existing
> `canViewRevenue` permission gate. The design's richer *content* — forecast, projected-revenue bar,
> collection-rate gauge, methods donut, revenue by group, P&L, aging report — is not itself blocked;
> only the add-on gate and the purchase flow are. Build the content behind the existing permission,
> or leave the screen alone until this is decided.

**What it is:** The design turns Analytics from a permission-gated screen into a **purchased monthly
add-on**.

**Designs:** `Merged-Center-Insight` §01. **`LOOKS LIKE A RESTYLE`** — `/{locale}/analytics` is live.

**Exists today:** The screen exists and is gated on `canViewRevenue`, a **permission**
(`analytics/page.tsx:119`). There is no add-on, no purchase, no price. The design's wording — *"The
gate is now an Advanced Analytics add-on"* — confirms it is a change, not a description.

**Has to be built:**
- Add-on entitlement model and its price.
- Purchase flow via Paymob, and the locked/blurred preview state the design draws.
- New content the live screen does not have: month-end forecast, projected-revenue bar, collection-rate gauge, payment-methods donut, revenue by group, P&L with CSV export, aging report with per-bucket WhatsApp reminders.

**Touches:** money, account state.

**What has to be decided:** the price, and whether the add-on **replaces** the `canViewRevenue`
permission gate or stacks on top of it. Stacking means a staff member with the permission still
cannot see a screen the center paid for — probably not what you want, but the design does not say.

**Design intent:** *"A premium add-on, not a plan tier."* It is deliberately not bundled into a
higher plan. The aging report's per-bucket **Remind** buttons spend WhatsApp credit — which ties
this to B5.

## B10. Benchmarks as a paid add-on — DEFERRED 26 July

> **Not decided. Benchmarks stays free.** Do not build the 99 EGP/mo enable sheet or any entitlement.
> The existing data-sufficiency gate (`insufficient_data`, `centers_needed: 10`) stands.

**What it is:** Benchmarks becomes a 99 EGP/month add-on with a locked state and an enable sheet.

**Designs:** `Merged-Center-Insight` §02. **`LOOKS LIKE A RESTYLE`** — `/{locale}/benchmarks` is live
and carries a "New" badge in the sidebar.

**Exists today:** The screen exists, free, gated on **data sufficiency** — the district needs enough
centers, and short of that it renders a sample overlay (`benchmarks/page.tsx:129`, `insufficient_data`,
`centers_needed: 10`). There is no payment anywhere near it.

**Has to be built:**
- Add-on entitlement, 99 EGP/mo, billed via Paymob, cancel anytime.
- Locked state with the enable sheet.
- Content the live screen lacks: overall standing percentile, local median marked per metric, "room to raise" annotation on below-median rows.
- How the paid gate and the existing data-sufficiency gate compose — a center that pays and then has too few neighbours must not get a bill for a sample overlay.

**Touches:** money, account state.

**What has to be decided:** the price is drawn as 99 EGP/mo — confirm it; and whether an existing
free user is grandfathered.

**Design intent:** *"Fully anonymized. No other center sees your numbers, and you don't see theirs."*
Percentiles and medians only, never a named competitor. This is the constraint that makes the feature
sellable and it is the easiest one to erode.

## B11. Extra team seats as a paid add-on

**What it is:** Plans include a seat count; extra seats are billed monthly per seat.

**Designs:** `Merged-Center-Setup` §07 (Settings Team). **`LOOKS LIKE A RESTYLE`** —
`/{locale}/settings/team` is live at 782 lines.

**Exists today:** Nothing. No seat limit, no seat count, no add-on. Live team management has no
concept of a cap.

**Has to be built:** per-plan seat allowance, seat counting, an "Add seats" purchase, and enforcement
when the cap is hit.

**Touches:** money.

**What has to be decided:** **the design says the price is not set** — *"extra seats are a paid
monthly add-on, billed per seat, price still to be set"*, and the screen renders it as `•• EGP /mo`.
Also: how many seats each plan includes (the design shows "Growth plan includes 5 seats" — see B15
on plan names), and what happens to a center already over the new cap.

**Design intent:** the seat line sits next to the member list, not buried in billing, so the cost of
adding someone is visible at the moment you add them.

## B12. Group billing basis: per session, monthly, bundle — DEFERRED 26 July

> **Not decided. Live keeps `fee_per_class` only.** Do not add a billing-basis column, monthly group
> billing, or bundle draw-down. The design's Monthly and Bundle rows in `Merged-Center-Groups` §02 are
> out of scope until this is decided.

**What it is:** A group can bill per session, monthly, or as a bundle of N sessions that draws down
by attendance.

**Designs:** `Merged-Center-Groups` §02. **`LOOKS LIKE A RESTYLE`** — `/{locale}/groups` is live at
848 lines.

**Exists today:** One basis. `student_groups.fee_per_class` is the only fee field the live groups
page reads or writes. The design draws four groups across three bases: "Per session 150", "Monthly
1,200", "Bundle · 8 — 1,100".

**Has to be built:**
- A billing-basis column on the group, plus whatever a bundle needs (size, remaining count per student).
- Bundle draw-down driven by **attendance, not by date** — the design is explicit.
- Monthly billing for a group, which the per-class charge engine does not do.
- The group sheet showing what the parent will see, at the moment the price is set.

**Touches:** money.

**Depends on:** **B1** for the parent-facing figure. The basis itself could ship without online
collection, since it changes what a parent owes either way.

**What has to be decided:** whether you want three bases at all. The design says per session
*"covers almost all real usage"* — this may be scope you do not need in the first pass.

**Design intent:** *"a bundle draws down by attendance rather than by date."* A bundle that expires
monthly is a different product and the easy thing to build by mistake. And *"The sheet shows what the
parent will see, so the price is never set blind"* — the parent-facing figure belongs on the
price-setting screen, not only on the parent's.

## ~~B13. Admin Center Assignments~~ — RESOLVED 26 July, split in two

> **Confirmed: they are two different features that happen to share a name.**
>
> - **The live route is do-not-touch.** `/{locale}/admin/center-assignments` is sales-rep commission attribution. Reps start in September. It gets no design and no redesign PR. The guardrail box sits at the end of section A.
> - **The design is a separate feature needing its own route** — admin teacher ↔ center linking, now **A10**, buildable with no further decision.
>
> Original analysis retained below for the record.

### Original entry

**What it is:** The design and the live route at the same name are **different features**, and I am
not certain which the design intends.

**Designs:** `Merged-Admin-Accounts` §03. `INVENTORY.md` mapped this to
`/{locale}/admin/center-assignments` as a restyle. **On closer reading that mapping is wrong or at
least unsafe**, which is why it is here.

**The design** shows teacher ↔ center linking: tabs By center / By teacher / Unassigned, a list of
centers with their teachers, unassigned teachers, and a "New assignment" form with **Link type:
Visiting / Permanent** — *"Visiting teachers keep their own private groups. The center only sees the
classes they run there."* No rep, no territory, no commission.

**The live route** is sales-rep attribution:
`src/app/[locale]/(admin)/admin/center-assignments/page.tsx` carries `sourced_by: 'eyad' | 'sm' | 'sr'`,
`is_primary`, `territory_city`, `territory_override_reason`, and error keys including
`duplicate_primary`, `rep_required`, `rep_not_your_report`.

**Two possible readings, and they lead opposite ways:**
1. **The design is a new admin feature** — an admin view of teacher-center employment links, which today only exists center-side at `/my-teachers`. Then the live rep-attribution screen has **no design**, and belongs on the Appendix B list.
2. **The design replaces the live screen.** Then applying it deletes the rep attribution UI — `sourced_by`, `is_primary`, territory — **weeks before reps start in September**, and while `CLAUDE-CODE-HANDOFF.md` §1.1 is still asking for a unique constraint on that exact table.

**I read (1) as far more likely**, but it is a guess and the cost of guessing wrong is high.

**Touches:** money (commission attribution).

**Depends on:** your call. Related and separately tracked in `CLAUDE-CODE-HANDOFF.md` §1.1–§1.4: the
missing unique constraint on the center identifier, the missing claim-expiry field, `sourced_by`
lacking house-account and team-leader values, and the commission table gaps. Those are database work
with a September deadline and are **not** design-driven — they should not wait behind this.

## A14 (was B14). Parent payment page

**What it is:** One public page for paying any provider by link, no account needed.

**Designs:** `Merged-Public-App` §04.

**Exists today:** Nothing. `src/lib/paymob.ts:187` returns the Paymob hosted iframe URL directly, so
today a payment link lands on Paymob's page, not ours. `/parent/[token]` is a read-only parent portal
with no pay action (Appendix B).

**Has to be built:**
- Public route, tokenised, no auth, exempt from the CORS mutation allowlist the way webhooks are.
- Provider header with a **Verified** badge (C1), showing whether they are a center or an independent teacher.
- Line items: what is being paid for, the provider's price, the **parent processing fee** with its formula, the total. **Not `resolveProcessingFeeAmount()`** — see the naming rule in B1.
- Payment methods: Card, Mobile wallet, and **InstaPay shown as Soon** — do not enable it.
- Confirmation state and a WhatsApp receipt.

**Touches:** money.

**Depends on:** **B1** (which fees show), **B2**/**B3** (there is nothing to pay without collection),
**C1** (the badge), **C4** (the receipt).

**Design intent:**
- **"There is no breakdown of it."** The provider's price is one figure. Only the parent processing fee is broken out, *"stated with its formula so a parent can check it against the price in front of them, sitting where a card fee normally would."*
- **The provider is named as the one who sets the price and teaches.** *"TutoringHQ collects the payment on her behalf."* The design calls this *"the record that the money was theirs"* — it is a legal position, not a courtesy. Do not reword it.
- **Questions about the sessions go to the provider**, stated on the confirmation. Do not route parent support to us.

## ~~B15. Plan naming~~ — RESOLVED 26 July, designs are placeholder

> **Starter / Growth / Scale in the center designs are placeholder names.** The real plans are:
>
> | | Plans |
> |---|---|
> | **Centers** | Solo · Nano · Starter · Pro · Business · Enterprise |
> | **Teachers** | Free · Standard · Pro · Scale |
>
> **The build side is unblocked** — read plan names from live plan data (`src/lib/pricing/plans.ts`
> keys `solo, nano, starter, pro, business, enterprise`), never from the design frames. **Twelve
> design screens need correcting**; the list is below and in Appendix D.

**Nine screens already use the correct names**, and they are the customer-facing ones — the
placeholder ladder never reached the public surface:

`Merged-Public-Marketing` §02, §03 · `Merged-Public-App` §01 · `Merged-Public-Legal` §01 ·
`Merged-Lifecycle` §04, §05 · `Merged-Teacher-Money` §02, §03 · `Merged-Teacher-Insight` §02

`Merged-Public-Marketing` §03 carries the canonical ladder in a `PLANS` const —
Solo 999 · Nano 1,999 · Starter 4,499 · Pro 7,999 · Business 12,999 · Enterprise 18,499, and
teachers Standard 499 · Pro 999 · Scale 2,499. **Use that as the reference when correcting the
other twelve.**

**Twelve screens render a wrong plan name.** Every one is internal or center-facing:

| Design | What is wrong | Languages |
|---|---|---|
| `Merged-Admin-Accounts` §01 Admin Account Detail | Center badge "Growth"; **a solo teacher is also shown on "Growth"**, which is not a teacher plan either | EN + AR |
| `Merged-Admin-Accounts` §03 Admin Center Assignments | Teacher "· Growth", center "· Growth" | EN + AR (النمو) |
| `Merged-Admin-Money` §03 Admin Finance Health | "REVENUE BY PLAN — Starter / Growth / Scale" | EN + AR (البداية / النمو / التوسّع) |
| `Merged-Admin-Money` §07 Admin Billing Pricing | "CENTER PLANS · PER MONTH — Starter 300 / Growth 700 / Scale 1,500". **The prices are wrong too** — see the note below | EN + AR |
| `Merged-Admin-Platform` §01 Admin Overview | Center rows "Growth"; teacher row "Dina Fouad · Growth" | EN + AR |
| `Merged-Admin-Platform` §02 Admin Analytics | "NT Nafham Tutors **Scale**" (a center on a teacher plan), "AN Al-Nahda Growth", "BY PLAN — Growth 98 / Starter 76 / Scale 44" | EN + AR |
| `Merged-CEO` §03 CEO Centers Benchmark | Chase queue row "NA Nile Academy Giza · Growth" | EN + AR |
| `Merged-Center-Insight` §03 Referrals | "Nafham Tutors Growth · 899", "Al-Manar Center Growth · 899", "25% of their **Growth plan**", "Roqaya Study **Scale** · 1,499" (a center on a teacher plan) | EN + AR |
| `Merged-Center-Money` §03 Billing | "Everything on **Growth**, plus:", "**Upgrade to Scale**" | EN + AR |
| `Merged-Center-Setup` §02 Settings | "Nasr City · **Growth plan**", "Billing & plan — Growth" | EN + AR (خطة Growth) |
| `Merged-Center-Setup` §03 Settings Billing | "Billing & plan — **Growth** Active 8,990 EGP / year", "**Growth plan** · yearly" | EN + AR |
| `Merged-Center-Setup` §07 Settings Team | "3 of 5 seats used — **Growth plan**", "**Growth plan** includes 5 seats" | EN + AR (خطة Growth) |

**Two rules make the corrections mechanical:**
1. **"Growth" is never a plan.** Not for centers, not for teachers. It appears in the designs only as placeholder. (Watch for false positives: "Growth MoM +11%" in `Merged-CEO` §03 and "Growth +9%" in `Merged-CEO` §01 are the English word for a metric and are correct as they stand.)
2. **"Scale" is a teacher plan only.** It is correct on `Merged-Teacher-Money` §02/§03, `Merged-Teacher-Insight` §02, `Merged-Lifecycle` §05, `Merged-Public-App` §01, `Merged-Public-Marketing` §02/§03 and on the teacher row in `Merged-Admin-Platform` §01. It is wrong wherever it labels a center.

**Two things to check while you are in there:**

- **`Merged-Admin-Money` §07 also has the wrong prices.** It shows center plans at 300 / 700 / 1,500 EGP per month against the canonical ladder's 999 / 1,999 / 4,499 / 7,999 / 12,999 / 18,499. This is the screen that sets what customers are charged, so the numbers matter as much as the names.
- **No design shows the teacher "Free" tier.** The teacher ladder is drawn as Standard / Pro / Scale throughout. Live models the free state as the "free zone" (`hasPrivateAccess: false`) rather than a named plan, so this may be intentional — but if Free is a plan, it is missing from every teacher pricing frame.

**One open question, small:** live carries a seventh center plan, `top_centers` (ميجا سنتر), custom-priced
from `centers.all_in_price`. It is not in the six you named and appears in no design. Intentionally
out of scope, or an omission?

**Touches:** money (plan names sit next to prices).

**Depends on:** nothing. Build reads live plan data; the design edits are Appendix D.

---

# C. BLOCKED ON SOMEONE OUTSIDE

## C1. Identity verification (e-KYC via Valify)

> **DECIDED 26 July: verification is a redirect to a Valify-hosted flow; the ID document never
> touches our infrastructure; we receive an outcome and store only that.** Valify's Web Verification
> Flow confirmed as the integration (redirect + account-level webhook; no web SDK exists, so this is
> also the only option for a Next.js PWA). Minimum stored footprint is **four fields**.
>
> **Fully specified: see `design/VERIFICATION-SPEC.md`**, §9 for every frame the decision changes. The design specifies a two-state world,
> `not verified` and `verified`, and nothing else — no failure state, no in-progress state, no retry,
> no expiry, anywhere in 26 files. That document lists what the design does specify (documents
> collected, stored record, per-state gating) and the **13 decisions** needed before this can be
> built. Blocked on Valify as a vendor *and* on those decisions.

**What it is:** A one-time hosted identity check that unlocks online collection and withdrawals, and
keeps the National ID on file for receipts.

**Designs:** `Merged-Verification-Payouts` §01 (settings), §02 (in context), §03 (the hand-off and
return). Referenced in `Merged-Center-Attendance` §02, `Merged-Teacher-Money` §05,
`Merged-Center-Setup`, `Merged-Admin-Accounts`, `Merged-Admin-Platform`. **Valify is named 27 times
in `Merged-Verification-Payouts` alone**; National ID appears 19 times there and 9 more in
`Merged-Admin-Money`.

**Exists today:** **Nothing.** `Valify`, `national_id` and `identity_verif*` return zero matches
across `src/`. There is no verification flow, no verified flag, no ID storage.

**Has to be built:**
- Data model: verification status, verified-at date, National ID on file, provider reference. **This is minors-adjacent PII on a multi-tenant platform** — the `saas-multi-tenant-architecture` rules apply in full, and ID storage needs an explicit retention decision.
- Routes: the settings verification screen (both account types, verified and not), the hand-off screen, the return screen.
- Integration: hosted redirect to Valify and a signed return. The design states it is *"the same pattern as Paymob"* — so a callback/webhook that verifies its own signature, not a trusted redirect parameter.
- What it unlocks, which differs by type: **centers** get online collection **and** withdrawals; **teachers** get fee collection **and** withdrawals.
- Verified badge, surfaced on the provider-facing screens and on the parent payment page.

**Touches:** auth, account state.

**Depends on:** **Valify** — a vendor agreement, sandbox credentials, and their hosted flow. Nothing
in the repo suggests this has started.

**This is the single longest pole in the document. At least 21 of the 105 designs sit behind it:**
the 12 that render a verified state (C2), plus 9 that exist only because of it —
`Merged-Verification-Payouts` §01, §02, §03, §05, §06 · `Merged-Center-Attendance` §02 ·
`Merged-Teacher-Money` §04, §05 · `Merged-CEO` §03. The four admin ledgers in C5 and the verified
badges on `Merged-Public-App` §04, `Merged-Center-Insight` §03, `Merged-Teacher-Insight` §02 and
`Merged-Admin-Platform` §01 depend on it too, in part.

**Design intent:**
- **Verification is a one-time step, about 2 minutes, and the screen says so.** Both the two-minute estimate and "one-time" appear on every entry point. They are there to reduce drop-off; do not trim them as marketing copy.
- **The ID scan and selfie happen on Valify's side, never ours.** Do not build a capture UI.
- **The National ID stays on file because the e-receipt needs it** — the screen explains why. That explanation is a PDPL nicety and a trust device at once; keep it.
- **Unverified accounts keep working.** They accrue referral earnings, they record payments by hand. Verification unlocks; it never blocks what already worked.

## C2. Verified as a second account state across the platform

**What it is:** Verification is not one screen. It is a second state that most of the platform has to
render.

**Designs — 12 screens.** Nine carry "Verified" in their name:
`Merged-Center-Attendance` §01 · `Merged-Center-Groups` §02 · `Merged-Center-Home` §01 ·
`Merged-Center-Money` §02, §04, §05 · `Merged-Center-Setup` §08 · `Merged-Center-Students` §03 ·
`Merged-Teacher-Groups` §05.
Three more draw both states without saying so in the title:
`Merged-Teacher-Home` §01 (*"Home in both account states"*) · `Merged-Teacher-Money` §01 (*"Income in
both states"*) · `Merged-Teacher-Setup` §01 (payment details become payout details once verified).

**Exists today:** **Ten of the twelve** have a live route working in its unverified form —
`/dashboard`, `/students`, `/groups`, `/attendance`, `/payments`, `/settings/team`, `/teacher`,
`/teacher/income`, `/teacher/settings`, `/teacher/groups/[groupId]/sessions/[sessionId]`. The
remaining two — `Merged-Center-Money` §04 Center Withdrawal and §05 Center Receipts — have no route
at all and are covered by B4 and C4.

**`INVENTORY.md` lists all ten in list 1 as restyles, and that is only half true:** the unverified
half is a restyle, the verified half is a new build on top of a product that does not exist.

**Has to be built:** the verified variant of each screen, behind a flag, plus:
- `Merged-Center-Setup` §08 introduces a permissions split the live team page does not have: **daily actions and money actions in separate groups**, with two permissions **locked to the owner and undelegatable** — moving money out, and changing where it goes.
- `Merged-Center-Money` §05 introduces a three-tab records screen (Payments / Payouts / Tax) that does not exist at all.

**Touches:** money, account state.

**Depends on:** **C1**, **B1**, **B2**, **B3**.

**Design intent:**
- **The two permissions locked to the owner are not a default, they are a rule.** *"That cannot be delegated."* Do not build them as switches that happen to be off.
- **`Merged-Center-Money` §05's three lists are deliberately not merged.** Payment confirmations are proof of payment. Payout statements are what reached the bank. Tax documents are the only items with legal standing and **cover our commission alone, never the tuition**. The design's own words: merging them *"is what would make the whole arrangement incoherent to an inspector, so the split is structural rather than cosmetic."* This is the single most likely thing for a builder to tidy into one "Receipts" list.

## C3. Center → teacher split payouts

**What it is:** A center sends its balance either all to itself or split directly to its teachers,
each paid to a method the teacher maintains themselves.

**Designs:** `Merged-Verification-Payouts` §05.

**Exists today:** Nothing. `/my-teachers` tracks cuts, proposals and slots but has no payout action.

**Has to be built:**
- Teacher-held payout method, editable only by the teacher (*"Only you can change this"*), with a name-match rule against their verified ID.
- Center-side split UI: teachers ready to receive vs not set up, per-teacher amounts, running total, charges, and what stays in the balance.
- Charge model: one payout a month free, then **250 EGP per teacher after the first**. Splitting eight ways uses the free one and charges 250 × 7 = 1,750.
- Batch send.

**Touches:** money.

**Depends on:** **Paymob**. The design says so outright: *"Payment method options are placeholders
until Paymob confirms what Send actually supports."* Also **C1** (both sides verified) and **B4**
(the balance).

**Design intent:**
- **The center never stores anyone's bank details.** Each teacher holds their own account and maintains their own method, so the center picks a name and nothing else. This is a liability decision. Do not add a convenience field letting the center type a teacher's IBAN.
- **The cost is shown on the choice, not buried.** 1,750 EGP appears on the split option itself, before it is picked. *"Split when the convenience is worth 1,750, not by default."*
- **Teachers with no method are shown, not hidden**, so the center can chase them.

## C4. Tax documents: ETA e-receipt and e-invoice

**What it is:** The tax receipt sent to the parent and filed with the ETA, the teacher subcontractor
expense receipt, and the referral expense receipt.

**Designs:** `Merged-Verification-Payouts` §06, `Merged-Center-Money` §05 (tax tab),
`Merged-Center-Attendance` §02 (tax status), `Merged-Admin-Money` §04.

**Exists today:** Partial infrastructure, no tax documents. `generateInvoicePdf.ts` and
`invoiceTemplates.ts` produce customer invoices and referral payout receipts. There is no ETA
integration and no e-receipt.

**Has to be built:**
- Tax status per provider: registered (tax card number on file → e-invoice) vs unregistered (→ e-receipt), changeable at any time, switching from the next document onward.
- Parent tax e-receipt: VAT-exempt educational service line, collection fee line, VAT at 14% on the fee, total, filed with the ETA automatically.
- Teacher subcontractor expense receipt against the verified National ID, with the design's stated rule *"no tax is withheld on payouts."*
- Referral expense receipt, logged as a marketing expense against the referrer's National ID.
- ETA filing integration.

**Touches:** money.

**Depends on:** **an accountant and legal.** Every frame in `Merged-Verification-Payouts` §06 is
stamped **Draft** and the section note says *"pending legal and accountant review."* Also **the ETA**
as an integration, and **C1** for the National ID.

**⚠ RESOLVED 26 July — the teacher payout receipt is a design error. Do not build it.**

`Merged-Verification-Payouts` §06, the teacher subcontractor expense receipt, shows:

```
Gross tuition base        1,000.00
Collection fee             −92.34     ← not in the money model
VAT (14% on fee)           −12.92     ← not in the money model
Tuition collected         1,000.00
Collection fee (10%)      −100.00
Net to wallet               850.00    ← wrong
```
…with a footnote reading *"The teacher receives 900.00."*

**The correct figure is 900.** On a 1,000 fee the collection fee is 10% and the teacher receives
900. **There is no 850 and no 105.26 anywhere in the money model** — those lines are artifacts of
the draft, not an alternative fee structure.

**Do not implement this receipt as drawn, and do not try to reconcile the three numbers — there is
nothing to reconcile.** Eyad is correcting the design. Build against 1,000 − 10% = 900 once the
surrounding legal and accountant review lands.

The same section's parent tax e-receipt and referral expense receipt were not flagged and are not
part of this correction, but they carry the same **Draft** stamp and the same pending review.

**Design intent:** tax documents *"cover our commission alone, never the tuition, because the tuition
was never our sale."* The provider issues their own document for the tuition. Getting this backwards
is a compliance problem, not a UI one.

## C5. Admin money ledgers for online collection

> **Fee model locked 26 July (B1)** — the three revenue lines these ledgers reconcile are now fixed.
> Remaining dependencies are C1 (verification) and C4 (tax documents), plus the pending legal and
> accountant review on §02 and §04.

**What it is:** The four internal screens that exist only once the platform collects money on behalf
of providers.

**Designs:** `Merged-Admin-Money` §01 (Fee Collection), §02 (Settlement), §04 (Receipts,
frame-captioned `/admin/receipts`), §06 (Unpaid Recovery).

**Exists today:** Nothing that corresponds. Two live screens are easy to mistake for these and are
not:
- `/{locale}/admin/finance` is **subscription MRR** — north star, unit economics, cohort retention. Not parent collection.
- `/{locale}/admin/renewals` is **center subscription renewals**. Not parent payments.
- `/{locale}/admin/payouts` is **internal staff salaries** (`staff_id`, `base_salary`, `period`). Not provider settlement.

**Has to be built:**
- **Fee Collection (§01):** three views — Money (collected from parents → paid out to providers → our revenue, split into collection fees / price markup / processing), Providers (one ranked list with a centre/teacher filter), Health. The design reconciles exactly; the implementation must too.
- **Settlement (§02):** the biweekly payout run — settled-in from Paymob, paying out to providers, retained fees; the batch itself, bank first with wallet fallback, and below-minimum amounts **rolling over rather than failing**.
- **Receipts (§04):** the log behind the write-offs, filtered by type, each tied to a verified National ID.
- **Unpaid Recovery (§06):** every stuck payment across every provider, split by cause — declined card versus link never opened versus opened-not-completed — with a bulk remind that **excludes anyone the provider reminded in the last two days**.

**Touches:** money.

**Depends on:** **C1**, **C4**, **B1**, **B2**, **B3**, **B4**. §02 and §04 are additionally marked
*"pending legal and accountant review."*

**Design intent:**
- §06's split is the feature: *"a declined card is our problem, an unopened link is the parent's, and treating them the same wastes effort on the wrong half."* A single "unpaid" list is the wrong build.
- §06: **admin reminders come out of company credit, not the provider's.** Easy to get wrong once B5 exists.
- §02: *"What is held for teachers stays ring-fenced from platform revenue."* This is an accounting constraint on the data model, not a display choice.
- §01: money is *"a single top-to-bottom flow from what parents paid down to what we keep."* Do not reorganise it into independent cards.

## C6. Legal document text

**What it is:** The real text of the four footer documents, plus the data-rights form copy.

**Designs:** `Merged-Public-Legal` §01. **`LOOKS LIKE A RESTYLE`** and mostly is — the routes and
chrome are live.

**Exists today:** The full surface is built: `/legal/privacy`, `/legal/terms`, `/legal/cookie`,
`/legal/dpa` and `/legal/privacy-request`, with `LegalDoc.tsx`, a shared layout and footer, and
`POST /api/privacy-request` behind the form. **Every section body is a placeholder** —
`[This section will be completed upon legal review]` — under a draft-notice banner naming Adsero.

**Has to be built:** nothing structural. The layout is a restyle. What is missing is the **text**, and
per `IMPLEMENTATION-PLAN.md` it should be pulled from **one source** so the page and the drafts cannot
drift apart.

**Touches:** none.

**Depends on:** **Adsero.**

**Design intent:** *"Students and parents are sent to their center first, because the center is the
controller and the platform is only the processor."* That routing is a legal position and it is the
one thing on this surface that is not cosmetic. Also: **the form never asks for a PIN**.

## C7. Self-enrollment: the minor-consent question

**What it is:** A student proves their own number with a WhatsApp one-time code and joins a group
**immediately, with no center approval**.

**Designs:** `Merged-Public-App` §03. **`LOOKS LIKE A RESTYLE`, and it is one** — the route is live.

**Exists today:** Built, and more completely than `TutoringHQ-Screen-Tracker.md` claims.
`/{locale}/join/g/[groupId]/page.tsx` + `JoinFlowClient.tsx` render a three-step flow;
`/api/join/g/[groupId]/send-otp` and `/verify-otp` exist against an `enrollment_otps` table with
attempt counting; delivery is queued to `webhook_outbox` and sent by a `send_enrollment_otp_wa`
worker.

**What is not resolved:** `IMPLEMENTATION-PLAN.md` records two blockers, and neither is visible in
the code:
1. **The Adsero question about a minor self-enrolling without center approval.** The design collects the parent's number *"because the parent receives every receipt and every alert, and a student cannot opt his own parent out"* — but collecting a number is not consent.
2. **Meta approval of the `chq_enrollment_otp` template.** I cannot verify template approval from the filesystem; the worker name suggests a template is referenced. **Check the live `wa_templates` state before assuming this path works.**

**Touches:** account state, and minors' data.

**Depends on:** **Adsero** for (1), **Meta** for (2).

**Design intent:** *"The first one, `/j/[code]`, waits for the center to approve. This one does not."*
The two join paths are deliberately different and **self-enrollment does not replace the approval
path**. A builder consolidating them removes the center's control over its own roster. Note the design
calls the approval path `/j/[code]`; live it is `/join/[center_code]/[group_id]`.

---

# Appendix A — Duplicate money surfaces

Four pairs where two live routes do the same job. In each case the designs assume **one**. Deciding
which survives is a prerequisite for the money PRs, not something to settle inside them.

| Pair | What each is | The designs assume | Note |
|---|---|---|---|
| `/{locale}/billing` vs `/{locale}/settings/billing` | `(dashboard)/billing/page.tsx` → `BillingPageClient.tsx` (subscription, plan, past-due banner) · `settings/billing/page.tsx`, 2,629 lines (subscription, invoices, upgrades, withdrawal window, processing fee) | **Both, as separate screens.** `Merged-Center-Money` §03 "Billing" is the membership-management view; `Merged-Center-Setup` §03 "Billing & plan" is the settings view with the invoice cards. The two designs overlap heavily but are drawn as two screens. | This is the one pair the designs do *not* clearly resolve. Decide whether you want two. |
| `/{locale}/teacher/billing` vs `/{locale}/teacher/pay` | Plan section + billing history · the shared `CustomerInvoicesView` invoice list, deliberately reachable while the account is locked | **`/teacher/billing` only.** `Merged-Teacher-Money` §03 carries invoices inside the billing screen. `/teacher/pay` has no design. | `/teacher/pay` carries a load-bearing rule no design records: it uses `requireTeacherAuth`, **not** the private-access gate, so a lapsed teacher can pay to restore access. Folding it into a gated screen locks a paying customer out of paying. |
| `/{locale}/referrals` vs `/{locale}/settings/referrals` | Both render `ReferralWithdrawalPanel`; both list active referrals | **`/referrals` only.** `Merged-Center-Insight` §03 is the single referrals design. | `/settings/referrals` additionally has a CSV/statement download the other does not. Check before consolidating. |
| `/{locale}/legal/*` vs `/{locale}/privacy` and `/{locale}/terms` | `legal/*` — four documents with shared chrome, footer and draft banner · `/privacy`, `/terms` — standalone placeholder pages | **`/legal/*` only.** `Merged-Public-Legal` §01 draws the four-document reader with its own contents list. | **⚠ `/terms` is not a clean duplicate.** `src/app/[locale]/terms/page.tsx` renders a **processing-fee disclosure** — heading, body with the live amount via `formatCurrency`, and a placeholder note — gated on `processing_fee_enabled` so it disappears when the fee is off. **`/legal/terms` has no such section.** Removing `/terms` without moving that disclosure first silently drops a fee disclosure from the site. Move it, then decide. |

---

# Appendix B — The 23 live screens with no design

From `INVENTORY.md` list 3a, restated, **plus one added on 26 July**: `/admin/center-assignments`
moves here now that the design of that name is confirmed to be a different feature (A10).

**All are marked decision pending. Nothing here is proposed for deletion** — each needs a design or
an explicit decision, and that decision is yours. The one exception is the first row, which has
already been decided: it is not to be touched.

| Route | What it does | Status |
|---|---|---|
| `/{locale}/admin/center-assignments` | **Sales-rep commission attribution** — `sourced_by`, `is_primary`, `territory_city`, `duplicate_primary` / `rep_required` guards. Reps start in September | ⛔ **do not touch** — decided 26 July. No design, no redesign PR. See the guardrail after A10 |
| `/{locale}/pay` | Center's own invoice list with pay and PDF, on the shared `CustomerInvoicesView` | decision pending |
| `/{locale}/teacher/pay` | Teacher's own invoices, same shared view, reachable while the account is locked so a lapsed teacher can pay | decision pending — see Appendix A |
| `/{locale}/teacher/subscription/upgrade` | Standard → Pro upgrade surface, renders `PlanComparison` | decision pending |
| `/{locale}/settings/money` | Center money settings — InstaPay number and card-order opt-in. The only place the InstaPay destination is set | decision pending |
| `/{locale}/settings/referrals` | Second center referral surface, shares `ReferralWithdrawalPanel` with `/referrals`, adds a download | decision pending |
| `/{locale}/privacy` | Placeholder privacy page reading `legal.privacy.placeholderBody` | decision pending |
| `/{locale}/terms` | Placeholder terms page **plus the processing-fee disclosure** `/legal/terms` does not carry | decision pending — see Appendix A |
| `/{locale}/students/print` | Printable roster; print CSS is a documented RTL exemption | decision pending |
| `/parent/[token]` | Public parent portal by token — balance, scan history, next sessions, WhatsApp the center. Read-only, no pay action. Outside `[locale]` | decision pending — distinct from B14 |
| `/{locale}/admin/orders` | Admin card-order queue | decision pending |
| `/{locale}/admin/card-orders/[orderId]` | Admin card-order detail, gated against `internal_viewer` | decision pending |
| `/{locale}/admin/payouts` | **Internal staff salary payouts** — `staff_id`, `base_salary`, `period`. Not provider settlement | decision pending — easy to confuse with C5 §02 |
| `/{locale}/admin/commissions` | Sales-rep commission ledger, T2 eligibility window 180 days | decision pending — see B13 |
| `/{locale}/admin/renewals` | Center subscription renewals, overdue filter, manual record-payment | decision pending |
| `/{locale}/admin/plan-requests` | Queue of center plan-change requests | decision pending |
| `/{locale}/admin/demo-requests` | Inbound demo-request queue — pending / contacted / approved / rejected | decision pending — **this is the receiving end of A1** |
| `/{locale}/demo-request` | 55-line stub: logo, one line, hardcoded `wa.me/201001234567` | decision pending — **collides with A1** |
| `/{locale}/blog` | Marketing stub | decision pending |
| `/{locale}/compare/spreadsheets` | Marketing comparison page | decision pending |
| `/{locale}/features/qr-attendance` | Marketing feature page | decision pending |
| `/{locale}/features/student-management` | Marketing feature page | decision pending |
| `/{locale}/features/whatsapp-notifications` | Marketing feature page | decision pending |

The last five were recorded as "Dropped" in `TutoringHQ-Screen-Tracker.md`. The decision was written
down; the pages are still live and still served. That is a state to resolve, not evidence either way.

---

# Appendix C — Where I am not sure

**Three of the original eleven were answered on 26 July** — the receipt arithmetic, the plan names,
and Admin Center Assignments. Eight remain, stated rather than guessed.

1. **B12, group billing basis.** I read "Monthly 1,200" and "Bundle · 8" as new data, because live has only `fee_per_class`. It is conceivable these are display labels over an existing convention I did not find.

2. **`/teacher/pricing`.** The design folds center and teacher plans into one `/pricing` page; live has two routes. `INVENTORY.md` lists it as a restyle. Consolidating is a routing change, and I do not know whether that is intended.

3. **B9, Analytics add-on.** I do not know whether the add-on **replaces** the `canViewRevenue` permission gate or stacks on it. The design does not say and the two answers behave very differently for staff accounts.

4. **B3, the teacher collection fee.** The opt-in screen states the fee only in categories; the expense receipt states 10%. I cannot tell whether that is deliberate staging or an inconsistency. **Partly narrowed by the 26 July receipt correction** — 10% is confirmed as the rate; what remains open is whether the opt-in screen should say so.

5. **C7, `chq_enrollment_otp`.** The worker and API routes exist. Whether Meta has approved the template is live state I cannot read from the filesystem. Check `wa_templates` before relying on the path.

6. **B6, teacher message allowance.** "Your Pro plan includes 50 a month" — I found no live entitlement. It is possible one exists in `platform_config` under a key I did not search.

7. **The admin information architecture.** Every admin design uses a five-item bottom nav (Overview · Money · Accounts · Platform · More). Live is a 17-item sidebar. Whether the IA change is in scope decides where several of these features land, and no design states it.

8. **B4, the teacher instant-payout fee.** The center schedule bands at 250 EGP / 2% / 3%. The teacher screen shows a flat 300 EGP on 8,400, which is 3.57% and matches no band. Either teachers have a different schedule or the sample is loose.

**Two smaller ones raised by the 26 July answers**, both in the resolved B15 entry: whether the
seventh live center plan `top_centers` is deliberately out of scope, and whether the teacher **Free**
tier is missing from the designs or is correctly modelled as the free zone rather than a named plan.

---

# Appendix D — Design corrections needed

**Edits to the `Merged-*.html` files, not to code.** Four corrections, 19 screens. Nothing in this
appendix is a build item; every one of them is a design file that says something the platform will
not do.

## D1. Rename the parent-side fee — 5 screens

The design calls the parent's 1.5% + 1.5 EGP charge a **"processing fee"**, which is already the
name of the live flat 20 EGP fee charged to a *center*. See the naming rule in B1. Rename to
**parent processing fee** in both languages; the Arabic is currently **رسوم المعالجة** for both.

| Design | What it shows | Instances |
|---|---|---|
| `Merged-Public-App` §04 Parent Payment | "Processing fee — 1.5% + 1.5 EGP · includes VAT" on the teacher frame, the center frame and the confirmation, plus AR mirrors | 6 |
| `Merged-Admin-Money` §01 Admin Fee Collection | "Processing fees · 1.5% + 1.5 — 7,095" as one of the three revenue sources, EN + AR | 3 |
| `Merged-Center-Attendance` §02 Center Collect ForMe | Prose: *"parents see one price plus a small processing fee"* | 1 |
| `Merged-Center-Setup` §01 Onboarding | Prose: *"Parents see one price plus a small processing fee."* | 1 |
| `Merged-Verification-Payouts` §02 Verification In Context | *"A small processing fee applies per collection"*, EN + AR. **Ambiguous** — reads like a deduction from the teacher rather than a parent charge. Worth deciding which it means while renaming | 2 |

**Leave these four alone — they correctly use the existing center fee:**
`Merged-Center-Orders` §03 (Order Checkout, "Processing fee 20") ·
`Merged-Center-WhatsApp` §02 and §03 ("20 EGP processing fee") ·
`Merged-Teacher-WhatsApp` §01 ("20 EGP processing fee").

## D2. Correct the referral step-down — 2 screens

Live is **25% month 1 · 10% months 2–12 · 5% month 13+**. Both screens draw the 10% band ending at
month 6.

| Design | What to change |
|---|---|
| `Merged-Center-Insight` §03 Referrals | The rate-decay timeline ("10% months 2–6 / 5% month 7+" → months 2–12 / month 13+), and every countdown computed off it. EN + AR |
| `Merged-Teacher-Insight` §02 Teacher Referrals | Same timeline, same countdowns. EN + AR |

The sample countdowns ("Drops to 10% in 6 days", "in 18 days", "in 41 days") are placeholder data and
only need to be plausible against the twelve-month band.

## D3. Correct the plan names — 12 screens

Full table in the resolved **B15** entry above. Summary: **"Growth" is never a plan**; **"Scale" is a
teacher plan only**. Reference ladder is the `PLANS` const in `Merged-Public-Marketing` §03.

`Merged-Admin-Accounts` §01, §03 · `Merged-Admin-Money` §03, §07 · `Merged-Admin-Platform` §01, §02 ·
`Merged-CEO` §03 · `Merged-Center-Insight` §03 · `Merged-Center-Money` §03 · `Merged-Center-Setup`
§02, §03, §07.

**`Merged-Admin-Money` §07 additionally has the wrong prices** — 300 / 700 / 1,500 against the
canonical 999 / 1,999 / 4,499 / 7,999 / 12,999 / 18,499.

## D4. Fix the teacher payout receipt — 1 screen

`Merged-Verification-Payouts` §06. On a 1,000 fee the teacher receives **900**. Remove the −92.34 and
−12.92 lines and the 850 net; they are draft artifacts with no place in the money model. Detail in
**C4**.

## D5. Replace the stale prices in `Merged-Admin-Money` §07 — 1 screen

The screen shows center plans at 300 / 700 / 1,500 EGP. Those are placeholder. **The real ladders,
confirmed 26 July:**

| Center plan | Price / mo | Students / week |
|---|---|---|
| Solo | 999 | 50 |
| Nano | 1,999 | 120 |
| Starter | 4,499 | 300 |
| Pro | 7,999 | 600 |
| Business | 12,999 | 1,200 |
| Enterprise | 18,499 | 2,000 |

| Teacher plan | Price / mo | Students |
|---|---|---|
| Free | 0 | — |
| Standard | 499 | 20 |
| Pro | 999 | 50 |
| Scale | 2,499 | 150, then **+16 per student above 150** |

These match the canonical `PLANS` const in `Merged-Public-Marketing` §03, which already carries the
center ladder and the Standard / Pro / Scale teacher ladder including the `over:16` overage. **The
only thing §03 is missing is the Free tier** — see D6.

## D6. Add the teacher Free tier — every teacher pricing frame

**No design shows it.** The teacher ladder is drawn as Standard / Pro / Scale throughout. Free at
0 EGP is a real plan and needs a frame wherever the teacher ladder appears:

`Merged-Public-Marketing` §02 Public Audience · `Merged-Public-Marketing` §03 Public Pricing (the
`PLANS.teacher` array) · `Merged-Public-App` §01 Public Auth · `Merged-Lifecycle` §05 Teacher
Resubscribe · `Merged-Teacher-Money` §02 Earnings Calculator · `Merged-Teacher-Money` §03 Teacher
Billing · `Merged-Public-Legal` §01 (the sentence *"Teachers have Standard, Pro and Scale"*).

Live models the free state as the free zone (`hasPrivateAccess: false`) rather than a named plan, so
the design work includes deciding whether Free is presented as a plan card or as the pre-plan state.

## D7. Note `top_centers` so nobody deletes it — no design needed

`top_centers` (ميجا سنتر) exists live as a seventh center plan: **custom-priced from
`centers.all_in_price`, `is_active` false**. It is deliberately not in the published six and needs no
design frame.

**Recorded here so a future pass does not remove it as an orphan.** `src/lib/pricing.ts` defines it
outside the fixed tier list (`PlanKey = SubscriptionPlanKey | 'top_centers'`), and per `CLAUDE.md`
code must throw and Sentry-warn when `all_in_price` is NULL. Leave both behaviours in place.

## D8. Reword the ambiguous fee line in `Merged-Verification-Payouts` §02 — 1 screen

The teacher fee-collection frame reads *"A small processing fee applies per collection"*, EN and AR.
**That is the collection fee — 10% — not the parent processing fee.** Reword to name it explicitly:

> **EN:** "A 10% collection fee applies per collection."
> **AR:** "يُخصم رسم تحصيل ١٠٪ من كل عملية تحصيل."

This resolves the ambiguity flagged in D1, which listed the same two instances pending a decision.
**D1's row for this screen is superseded by D8** — it is a reword, not a rename.

**Knock-on:** `Merged-Teacher-Money` §05 Teacher Collect Optin deliberately states the fee only in
categories with no figure. With 10% now named on the §02 screen, the two are inconsistent. That is
open question 4 in Appendix C and is not resolved by this correction.

## Overlap and totals

`Merged-Center-Insight` §03 appears in D2 and D3. `Merged-Admin-Money` §07 appears in D3 and D5.
`Merged-Verification-Payouts` §02 appears in D1 and D8, where **D8 supersedes the D1 row**.
`Merged-Public-Marketing` §03 appears in D6 as the canonical ladder needing a Free tier.

**Eight corrections, 26 distinct screens.** D7 is a note rather than an edit.
