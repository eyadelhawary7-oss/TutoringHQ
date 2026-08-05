# State of the build — the complete gap file

**Produced 1 August 2026.** Not a status update. This is the complete accounting of what's live,
what's designed, and what's decided but unbuilt, across every source of truth this project keeps.
Nothing here is written from memory — every figure was pulled fresh tonight: `FILE-COMPLETION-TABLE.md`
and `BUILD-AFTER-REDESIGN.md` read end to end, `NEW-FEATURES.md` read for its appendices and open
questions, `CHANGE-LOG.md` for what actually shipped, and the six protected files surveyed fresh
section by section (read-only, nothing built) specifically for this document.

**How to read this file:**
1. The 26 merged design files — a hard structural number for each, classified, every gap named.
2. The six protected files — their real state, surveyed tonight for the first time.
3. Every feature decided but not built, pulled from `BUILD-AFTER-REDESIGN.md` and `NEW-FEATURES.md`,
   organized by what's blocking it.
4. What changed tonight that these permanent docs now reflect.
5. The open items with no owner — the ones nobody is currently driving to a close.

---

## 1 · The 26 merged files — hard numbers

**Verified identical (zero gaps): 0 / 26.** Every single row — including the three files that went
through a full token-and-structure restyle — carries at least one named, open gap. There is no file in
this catalog that has been diffed section-by-section against its design and found to match with
nothing left.

**Verified with specific logged gaps: 25 / 26.** Rows 1–19 (surveyed across late July) plus rows 21–26
(the six protected files, surveyed fresh tonight, 1 August — see §2 below for full detail).

**Verified, chrome real, content blocked: 1 / 26.** Row 20, Public-Legal — the routes, layout and
draft-notice banner are real and correct; the actual legal text in every section is the placeholder
`[This section will be completed upon legal review]`, on all four documents, both languages, blocked
on Adsero (**X4**) with nothing else to build until it lands.

The table below is the same 26 rows as `design/FILE-COMPLETION-TABLE.md`, current as of this document
— every gap named, not folded into a percentage. Codes (`R*`/`D*`/`V*`/`X*`/`F*`/`S*`) are defined in
§3 below.

| # | File | Structure fraction | Named gaps |
|---|---|---|---|
| 1 | **Design-Patterns** | primitives 6/6 built; live *adoption* 15.3% `EmptyState` (11/72), 0.7% loading states, 35.7% `ListRow`, 0% `ActionSheet`/`RecordActionBar`/`ExpandableRow` | ~196 remaining per-file conversions across 5 primitives, none blocked, adopted opportunistically per Eyad's explicit instruction not to force a batch conversion. Two intentional deviations re-confirmed tonight and ruled non-gaps by Eyad: a ~3-point RGB hairline-color difference, and a radius collision (`tailwind.config.ts`'s legacy `borderRadius` block intercepts `rounded-lg/md/sm/xl/2xl` before `tokens.css`'s `--radius-*` scale) |
| 2 | **Admin-Accounts** | 3.5/4 | **V1** verified chip/Valify · no `branches` table · no impersonation mechanism (needs a new auth primitive) · R7-CLOSED (built, then closed unmerged on Eyad's "one teacher console, not two") |
| 3 | **Admin-Platform** | 4.6/6 | **V1** unverified filter · **D5** WhatsApp-pack overview pricing · R7-CLOSED · 6 confirmed schema-absence gaps |
| 4 | **Teacher-Home** | 12/16 | **V1** unverified promo card ("Let us collect for you / Verify my ID") · **V3/V4** verified-state wallet card + recent payouts (no teacher-scoped payout ledger exists) — wholesale blocked, nothing else open |
| 5 | **Teacher-Students** | complete except D15 | **D15** Balance card "Mark collected"/"Send reminder" — money-state write + per-send WhatsApp cost, no decision made |
| 6 | **Teacher-Setup** | 15/16 | **V1 / D36** verified payout details — `teacher_profiles` has no `iban`/`bank_name`/`account_holder` column, needs a migration (the collect-payments toggle itself is now built, PR #322) · **D35** the proposal card's proposed-schedule line — `group_proposals` has no day/start/end column · **D16** center-class commission engine dormant, every "Owed" figure reads 0.00 EGP live · **D17** "Share your profile" QR/link leads to a 404 |
| 7 | **Teacher-Groups** | ~2.2/5 | **D18** §03 review gate doesn't exist, every enrollment auto-activates · **D19** private-lesson commission columns never populated, Teacher Analytics revenue reads 0.00 EGP · **D20** two divergent "run a class" builds exist, only one is reachable · **D21** join link is a full UUID not the design's 6-char code · §05 (Class Session Verified) entirely unbuilt, the design's own caption marks it "draft, pending legal review" |
| 8 | **Center-Orders** | 3.5/4 | **F18** Customize step has no per-field print toggle, needs a schema change · **D7** notify-me write has no destination table |
| 9 | **Center-Insight** | ~3.3/5 | **D22** the centre's own `/referrals` reads a table nothing live writes (`referral_reward_records`), while the real cron writes `referral_commissions` — a ticking time bomb, not yet a visible wrong number only because zero referrals have paid out yet · **S7** no CSRF on `/api/referrals/payout` · forecast tile needs an extrapolation methodology decided |
| 10 | **Center-WhatsApp** | §01 3/5, §02 0/5, §03 0/4 | **D4** per-template auto-send toggle, schema exists, zero readers, spends credit unattended if adopted blind · **D5** live billing model (monthly per-parent pack + capped blasts) is a different, already-shipped product than the design's one-time credit top-up — building the design changes what existing customers are charged |
| 11 | **Center-Groups** | ~3.0/5 | **D12** §02 billing basis, no schema · **D23** §04 add-branch pricing clones the parent's full plan price, no 199 EGP add-on · **D31** (new, 1 Aug) §04 is a wholesale different layout paradigm — a desktop table with zero row actions of any kind, not the design's card list with two fake chips · **D32** (new, 1 Aug) waitlist promotion has no working path end to end — the WhatsApp opt-in messages a parent but nothing ever reads the reply; the stale-waitlist-entry half fixed tonight, the promotion-model choice is open · **F11** `capacity_cap`/`kind` dead columns |
| 12 | **Center-Students** | ~2.45/4 | **F22** branch rollup has no cross-center query (needs an RLS-scope decision) + aging/next-due sub-line has no per-invoice fact under the running-balance model · **F12** `pending_enrollments` can't say invite-link vs. self-serve · **F14** parent-phone required in design copy, optional in live validation · **F15** lifecycle status and payment standing never fuse into one badge · **V1/V6** §03 unconditional "Verified" badge |
| 13 | **Center-Home** | §01 4/5 | balance card + "Verified" badge → **V3/V4/V6**, re-verified live 1 Aug (no `payouts`/`center_balances`/`wallets` table; `settled_at` still 0 populated rows; redefining the figure from other data was raised and explicitly declined by Eyad) · **D26** only 2 of ~11 drawn notification types have a live writer · **D27** the one real writer hardcodes English regardless of `preferred_locale` · **F23** two dashboard CTAs link to `/students` query params the page never reads |
| 14 | **Center-Setup** | ~2.9/5 avg | **F19** team invite/activate-deactivate/seat-cap are all broken in production (3 independent live outages, not a design gap) · **S8** no CSRF on any subscription-billing mutation, plus two fictitious money figures on the same screen · **D8** seats · **D10** scanner prefs (closed, do-not-build) · **D11** `/settings/general` is the settings hub, not a Region/Display screen — the design's General frame doesn't exist under any URL · **D28** Onboarding is a structural product divergence · **F24** My Teachers Slots tab is a different feature (attached-group confirm vs. open marketplace) · §08 → **V6** |
| 15 | **Public-Marketing** | strong on core pricing, weak elsewhere | **D29** 5 of 6 pricing add-ons have no real backing config — would advertise SKUs that don't exist · **D30** an "8–12 hours saved" claim the design's own header calls "banned by your own rules" is still live · **F25** two parallel WhatsApp support-number config sources used inconsistently · §01 flagship landing-page rearchitecture is a genuine scope divergence |
| 16 | **Center-Attendance** | ~0/2, wholesale-blocked | **V6** both sections wholesale-blocked — no unverified frame anywhere · **F20** six co-discovered scanner-payment bugs: two payment methods (Vodafone Cash, Bank) silently never wrote a row (fixed); the main path's error-swallow is deliberately not yet fixed pending a retry-dedup decision; "late entry" retries every ~30s re-charging the student each time; fee-exempt "admitted" status likely fails the DB constraint outright; 4 of 6 payment fields get Zod-stripped before they reach Postgres; no permission gate on the insert path at all |
| 17 | **CEO** | §01 superset, §02 IA divergence, §03 blocked | **V5** §03 Centers Benchmark blocked on Valify · **S9** no CSRF on 4 CEO/admin mutation routes, one a platform-wide kill switch · §01's Fee-revenue KPI needs V3 or a call on trending incomplete history · §02's 5-tab IA vs. the design's overview+leaderboard is a scope question |
| 18 | **Teacher-Insight** | ~50% overall | **D14** (corrected) a real, working teacher-referral loop already exists and pays out (flat +1 free month, idempotent) — the design draws the **center** program instead (25%/10%/5% recurring commission); replacing the working loop or running two systems side by side is Eyad's call, not a schema gap |
| 19 | **Teacher-WhatsApp** | 0/1, correctly blocked | **D6** credit-balance columns are real and marketed but the spend RPC has zero callers, so the number only ever goes up; 0 of 5 drawn templates deliver today, each for a different verified reason; no prepaid-pack model to extend from centers |
| 20 | **Public-Legal** | chrome ~100%, text 0% | **X4** legal text from Adsero — the only external blocker with no money or auth attached, ships the moment the text arrives |
| 21 | **Lifecycle** 🔒 | **~67%**, healthiest protected file | see §2 |
| 22 | **Public-App** 🔒 | **~45%** | see §2 |
| 23 | **Center-Money** 🔒 | **~21–26%** | see §2 |
| 24 | **Teacher-Money** 🔒 | **~29%** (~65% of non-Valify scope) | see §2 |
| 25 | **Admin-Money** 🔒 | **~19%** (~23% crediting `/status`) | see §2 |
| 26 | **Verification-Payouts** 🔒 | **~9–10%**, most blocked file in the catalog | see §2 |

---

## 2 · The six protected files — none have been touched, and here is exactly what that means

**Public-App, Center-Money, Teacher-Money, Admin-Money, Verification-Payouts, Lifecycle: zero code has
been written or changed in any of them, tonight or at any point in this redesign initiative.** Every
number below comes from a fresh, read-only survey done specifically for this document — design HTML
opened in full, every live route (or its confirmed absence) checked directly, database claims checked
against the live catalog via Supabase where the claim depended on schema. No file was edited. This is
the first time all six have real, section-by-section structural fractions instead of "not surveyed."

### Lifecycle — ~67% (4.0/6), the healthiest of the six

- **§01 Lifecycle Access (~60%)** — `/set-pin` matches the concept but uses two typed-input rows with
  the OS keyboard instead of the design's on-screen keypad and defaults to revealed digits, not hidden.
  `/accept-invite` never fetches or renders the inviter's name, has no role pill, no "You're invited"
  framing, and no decline path. The done-step copy is broken in both languages — `messages/en.json`'s
  `acceptInvite` keys read literally "Success", "Joined Center", "Your Pin"; the Arabic file is worse
  ("Joined سنتر", "Your الرمز السري").
- **§02 Lifecycle States (~85%)** — `/suspended`, `/reactivate`, `/session-expired` all substantially
  match, `/session-expired` is a full structural match with no gap at all. One real bug found:
  `/suspended` hardcodes `text-white` on a light paper background, rendering the headline effectively
  invisible. The §02 "Welcome back, Paused" interstitial frame is deliberately not built — per
  `INVENTORY.md`'s own note, §04 is the deeper screen and the two shouldn't be built separately.
- **§03 Lifecycle Status (~70%)** — `/status` matches the skeleton (banner → services → incidents) but
  draws a different service taxonomy: 5 product-facing services in the design (App, Attendance, Payment
  recording, WhatsApp, Sign-in) vs. 3 infra services live (API, Scanner, Payments) — Attendance/WhatsApp/
  Sign-in are unrepresented. One code bug: an empty uptime history renders a bare comma instead of an
  em dash next to each service.
- **§04 Center Resubscribe (~70%)** — all six real plans render correctly with the last plan
  pre-selected. Missing: the Monthly/Annual toggle, and any "nothing was deleted / welcome back"
  reassurance copy. **A direct contradiction, not just a gap:** the design states "No reactivation fee";
  live implements tiered fees (`reactivate.tier.tier1`/`tier2`, computed server-side) — a design-vs-
  billing-engine conflict for Eyad to adjudicate, not something a survey resolves.
- **§05 Teacher Resubscribe (~65%)** — trial-lapsed reassurance, Monthly/Annual toggle with "2 months
  free," and the credit callout all match. Live renders one fixed plan; the design draws a 3-plan
  chooser (Standard/Pro/Scale) — the same locked-pricing question as elsewhere in this file.
- **§06 Coming Soon (~50%)** — `ComingSoon.tsx` exists exactly as documented, but has **zero render
  sites today** — superseded by `CardOrdersTeaser` at the one gate it used to serve. The locked-row
  variant (**R2**, already logged as READY and unbuilt) is still exactly that: ready, protected, not
  built.

### Public-App — ~45% (2.7/6)

- **§01 Public Auth (~45%)** — the design's whole premise, a single unified signup fork for centers and
  teachers, doesn't exist: live still runs two separate flows (a 4-step center wizard, a single crowded
  teacher card), the exact split the design was drawn to retire. No OTP verification step for center
  signup. No in-flow teacher plan step. The review/consent screen is missing the free-until/first-
  invoice rows, the agent-relationship clauses, and a versioned Provider Agreement row — zero matches
  for "Provider Agreement" anywhere in `src/`. No done screen after PIN setup. Wrong-PIN and lockout
  diverge from the design's stated parameters (live: 5 attempts/15 minutes via Upstash; design: 3 tries
  then a 6-try/1-hour lock with visible countdown) and the UI never surfaces tries-remaining or unlock
  time at all. No trial-already-used screen — the data exists (`trial_claims`) but only a generic inline
  error renders.
- **§02 Public Join (~25%)** — no invitation pre-screen (verified badge, center type/city, teacher name,
  per-session price, "what happens next" steps, or the "nothing is billed" guard sentence) renders
  anywhere. **The design's own core rule is inverted in live:** parent phone is stated as required
  ("every payment link and receipt goes to this number") but the live form marks it optional and the
  database column is nullable. No detail card or WhatsApp CTA on the sent screen. No distinct
  "link closed" state (falls through to a generic not-found). No "already enrolled" state. The `/parents`
  trust page has no route at all.
- **§03 Public Self Enrollment (~55%)**, the best-matched flow in this file — the 3-step
  details→OTP→done flow, expiry countdown, and resend-cooldown all match closely. Live lets a student
  skip the parent number entirely via a "who pays" toggle; the design states no student can opt his own
  parent out of that. No anti-phishing warning string exists anywhere in the messages. Live's WhatsApp-
  timing copy ("before each class") directly contradicts the design's stated rule ("after the session,
  never before").
- **§04 Parent Payment — 0%.** No public payment page exists at all. `/pay` is the center's own
  authenticated invoice list; `/parent/[token]` is read-only with no pay action. Every real payment link
  a parent receives is a bare Paymob-hosted iframe URL. The design's 1.5%+1.5 EGP parent processing fee
  has no matching constant anywhere in `src/lib/pricingConfig.ts` — the whole feature this fee belongs to
  is dormant behind a default-false flag.
- **§05 Referral Landing (~50%)** — inviter name and auto-applied code both work correctly. Both perk
  lines the design draws (14-day trial, welcome credit) are never stated to the visitor. The CTA button
  reads "Book your demo" while linking straight to signup — internally inconsistent copy. No "already
  have an account, log in" line.
- **§06 Offline (~95%)**, the one near-complete section in the whole 35-screen set — icon, heading,
  description and the attendance-safety note all match. One caveat worth flagging, not a structural gap:
  the service worker's precache list doesn't include `/offline` itself, and the route sits behind
  `AUTHENTICATED_ROUTE_PREFIXES`, so an anonymous user online can never seed the cache that would let
  this screen actually render offline for them.

### Center-Money — ~21–26%

- **§01 Payments (~75%)** — the strongest section in this file: KPI trio, dual filter rows, inline
  pending-confirm, and paid-gated CSV export all mirror the design. No per-row kebab/drill-in menu
  exists (rows are inert; the design's own masthead calls out the three-dot on every row). The receipt
  is thinner than drawn — no reference number, no "Send receipt on WhatsApp" button. Live's payment
  methods don't include Card, only cash/instapay/bank_transfer are offered in the record modal against
  the design's five.
- **§02 Center Payments Verified — 0%.** There is no verified-state rendering path in `payments/page.tsx`
  at all — the string "verified" never appears in the file. This is the expected, correctly-blocked
  V1/V3/V4 state, but the *existing* mapping claim (that it's "the verified-state rendering path within
  payments/page.tsx") describes a code path that doesn't exist, not a partially-built one.
- **§03 Billing (~30% on the claimed file, ~55% crediting the duplicate route)** — the "membership card"
  (plan, price, next renewal, Early-adopter badge) matches on `(dashboard)/billing`. The membership-
  management rows (manage plan, switch plan, payment method), the upgrade hero, add-ons management, the
  downgrade card and the switch-billing sheet are all absent from that file — but substantially present
  on the parallel `settings/billing/page.tsx` (2,629 lines), a duplicate-route split already flagged in
  `DUPLICATE-ROUTES.md` and never resolved. No payment-method row and 2 of 3 designed add-ons
  (Advanced Analytics, Extra branch) exist on neither route.
- **§04 Center Withdrawal Verified — 0%.** No live route of any kind. The only withdrawal in the whole
  product is referral-credit withdrawal (`payout_requests`) or scanner-credit cash-out
  (`withdrawal_requests`) — neither is a tuition-balance withdrawal, and no such balance or table exists.
- **§05 Center Receipts Verified — 0%.** No live route. `ReceiptModal.tsx` is the closest artifact and
  covers none of this section's IA (no Records list, no Payments/Payouts/Tax segments, no payout
  statement or commission e-invoice card).

### Teacher-Money — ~29% overall (~65% of the non-Valify scope)

- **§01 Teacher Income** — unverified half strong (~83%: three lifetime/best-month/average KPIs, the
  monthly chart, collected-vs-outstanding, by-group rows and the export-lock copy all match, live is
  arguably richer). Missing only the "tired of chasing that 900, verify and we collect it" nudge. The
  entire verified half (wallet balance, recent bank payouts, "how your fee works") is 0% built —
  correctly V1/V3/V4-blocked.
- **§02 Teacher Earnings Calculator (~43%)** — a live component exists (`IncomeCalculator.tsx`, mounted
  on the teacher home page, free-zone only), with matching heading copy and matching default slider
  values. **The core arithmetic uses the wrong, retired fee model**: live computes a flat 5% commission
  ("TutoringHQ fee: X (5% on digital, zero on cash)"); the design's entire point is a fixed-plan cost
  shown as a *shrinking share* of income as the teacher grows ("Your plan is about 2%... at 30 students
  it drops to about 1%"). No plan picker exists even though the exact plan ladder (Standard/Pro/Scale,
  499/999/2,499) is already live elsewhere in the codebase. No dedicated route — **R3**'s "promote it to
  its own screen" undersold this: it needs a fee-model rewrite, not a relayout.
- **§03 Teacher Billing (~50%)** — the billing-cycle math (annual = 10× monthly, "2 months free") and
  the Pro-upgrade content match closely. Several design rows exist as real functionality, just scattered
  onto *other* routes: payment-method saving lives inside invoice payment at `/teacher/pay`; "Refer a
  teacher" is a card on the teacher home, not this screen; "Redeem a code" has no teacher-facing surface
  anywhere; the Invoices section (first-charge-upcoming, receipts) lives at `/teacher/pay`, not here;
  "Cancel subscription" lives on `/teacher/settings`. **Two real, live money-terms conflicts, independent
  of layout:** the design's Scale plan caps at 150 students then +16 EGP/student above; live caps at
  100 students then +20 EGP. The design's Pro plan states "50 WhatsApp messages a month"; live grants
  "100 EGP WhatsApp credit monthly" — a different unit, not just a different number.
- **§04 Teacher Instant Payout — 0%.** No route, component, or API anywhere. One dormant building block:
  `teacher_profiles.payout_destination` (jsonb) exists in the live schema with zero references in `src`.
- **§05 Teacher Collect Optin — 0%.** No opt-in surface, no Valify integration, no ID capture anywhere.

### Admin-Money — ~19% (~23% crediting `/status`)

- **§01 Admin Fee Collection — 0%, but not because the data doesn't exist.** No admin route anywhere in
  either admin tree. The underlying `transactions` table already carries the design's entire fee stack
  (`lesson_fee`, `customer_commission_amt`, `processing_fee_amt`, `platform_gross`, `platform_net`,
  `snap_vat_amount`, …) — confirmed live — but every consumer of it is teacher-side or cron; zero admin
  code touches this table. This is a pure build gap sitting on top of a fully-populated ledger, not a
  Valify block.
- **§02 Admin Settlement — 0%.** No biweekly-payout-run screen exists. `/admin/payouts`, which shares
  the design's URL intuition, is confirmed to be **internal staff salary payouts** (`staff_id`,
  `base_salary` columns) — a completely different concept.
- **§03 Admin Finance Health (~38%)** — the Finance frame's hero, MRR KPI, churn, and 6-month trend chart
  all have live analogs (composed differently); ARR, revenue-per-account, and the entire fee-collection-
  revenue KPI group (net profit, gateway cost, ETA remittance) are missing entirely — the last group
  ties directly back to §01's absent product. The Health frame's actual IA (uptime, per-service status,
  incidents) doesn't live on `/admin/health` at all — it's the public `/status` page instead, feeding the
  CEO dashboard, while `/admin/health` shows unrelated cron/ops internals.
- **§04 Admin Receipts — 0%.** No route anywhere, despite the design's own frame caption naming
  `/admin/receipts` directly. `transactions.e_receipt_ref`/`e_receipt_status` columns exist, unused.
- **§05 Admin Withdrawals Analytics (~38%)** — the Withdrawals frame mostly matches (pending-payout sum,
  method + approve/decline rows), though it serves scanner-credit cash-outs rather than the design's
  broader referrer-payout concept, and has no Bank-transfer method (only InstaPay exists in the schema).
  The Analytics frame was built to a **different design file entirely** — its own code comments cite
  `Merged-Admin-Platform §02`, not this file — so none of this section's specific KPIs (active accounts,
  sessions this week, feature-adoption bars) exist.
- **§06 Admin Unpaid Recovery — 0%.** No route. `/admin/renewals`, the plausible URL match, is confirmed
  to be center/teacher **subscription renewals** — a different ledger than parent-payment recovery.
- **§07 Admin Billing Pricing (~55%)** — the center-plans editor is present and richer than drawn
  (weekly limits, derived annual pricing, active toggles over `pricing_plans`). Missing: a teacher-plan
  editor (`pricing_plans` has zero teacher rows; the teacher ladder is code-defined with no admin UI to
  change it) and a "new prices apply to new signups" note.

### Verification-Payouts — ~9–10%, the most blocked file in the catalog

- **§01 Settings Verification, §02 Verification In Context, §03 Payout Verification — all 0%.** No
  Valify integration exists anywhere in `src/` — confirmed by fresh grep, zero matches beyond comments
  documenting the absence. §02's gate (showing a locked "Verify to withdraw" state on `/referrals` and
  teacher collection screens) doesn't exist either — those surfaces render unconditionally.
- **§04 Withdrawal Payout Details (~40%, but the wrong money product).** The one section in this file
  with any live route (`/admin/withdrawals`) — but it serves **scanner-credit cash-outs, not referral-
  earnings payouts**. No bank/IBAN/account-holder columns exist anywhere in the live schema (only
  `instapay_number`); the design's Amount/collection-fee/net-payout breakdown has no equivalent — and
  the one live number close to it, `fee_amount`, is fetched by the page but never rendered.
- **§05 Center Teacher Payouts — 0%.** `/my-teachers` is confirmed, in its own code comments,
  "VIEW-ONLY... no mutating actions live here." No center-to-teacher money movement exists anywhere in
  the app.
- **§06 Receipts (~15%, helpers only, stronger than previously claimed).** No in-app receipts screen and
  no ETA integration. But the PDF-generation building block is real, live, and more complete than the
  prior record credited: `generatePayoutReceiptPdf` produces a genuine Arabic referral-payout receipt
  today, served at `/api/payouts/[id]/pdf` — it just isn't wired to any in-app screen, has no National ID
  line, and isn't framed as an ETA e-receipt.

---

## 3 · Every feature decided but not built — `BUILD-AFTER-REDESIGN.md` and `NEW-FEATURES.md` in full

This section indexes every open item across both ledgers. `BUILD-AFTER-REDESIGN.md` is the actively-
maintained work queue (read end to end for this document, all 1,299 lines); `NEW-FEATURES.md` is the
frozen-since-26-July feature spec (read end to end for its appendices and open questions). Where an
item exists in both under different names, it's listed once, cross-referenced.

### §1 · READY — nothing blocks these except developer time

| Code | What | Status |
|---|---|---|
| **R0** | `summer.first_charge_release` is HELD, 30 Aug first-invoice floor | **Open — see §5, no owner** |
| **R1** | Lead capture funnel, `/talk-to-us` | Built 31 Jul, mostly — area→territory→rep routing itself still not built (matching a fixed governorate list against ungoverned free-text `territory_city`) |
| **R2** | Coming Soon locked-row variant | Still unbuilt — `Lifecycle` §06, protected file |
| **R3** | Teacher earnings calculator as its own screen | Component exists, but per tonight's Teacher-Money survey the fee model itself is wrong (5% commission vs. the design's shrinking-share-of-fixed-plan-cost) — this is now a bigger build than "promote to a route" |
| **R4** | Design-Patterns primitives | Built (#220); adoption is the ongoing, opportunistic §1 item — see row 1 above |
| **R5** | Admin teacher↔center linking | Built and closed, #221 |
| **R6** | Referral rate/countdown display | **Moved to D22** — the table it would display sits on is unwritten |
| **R7** | Admin teacher list/detail | Built 28 Jul, then **closed unmerged** on Eyad's call — "one teacher console, not two," `/ceo/teachers` already covers it |
| **R8** | Card-orders coming-soon screen | Built and closed, #231 — the notify-me control specifically still blocked on **D7** |
| **R9** | Centre-side outgoing teacher-link requests list | Not yet built — data already served by a live GET, thrown away by the UI |
| **R10** | `/students/import` sends two nonexistent columns, every import fails | Built and closed, #243 |

### §2 · BLOCKED ON EYAD — one decision each

| Code | What | Blocking |
|---|---|---|
| D1 | `demo_requests.area`/`student_count` | **Decided 28 Jul: add both.** Built. |
| D2 | `schedule_slots.day_of_week` convention | **Resolved — was already fixed before the entry was written**, confirmed 31 Jul |
| D3 | `students.payment_status` dead column | 4 real readers found and fixed onto `getStudentBalances`; the `parent-balance-alerts` cron reader flagged separately as **D25** |
| D4 | WhatsApp auto-send toggle | Open — schema exists, zero readers, spends credit unattended if adopted blind |
| D5 | WhatsApp Pack as one-time top-up | Open — live is a different, already-shipped monthly-pack model; changes what customers are charged |
| D6 | Teacher WhatsApp screen + allowance | Open — credit balance is real but the spend RPC has zero callers (number only ever goes up); 0/5 templates deliver |
| D7 | Card-order notify-me destination | Open — no backing table |
| D8 | Team seats as a paid add-on | Open — and the *included* seat count is itself dead code (`centers.max_teachers`/`max_students` don't exist; every center is silently hard-capped at 2 seats, see F19) |
| D9 | Owner notification preferences | **Decided 28 Jul: do not build** |
| D10 | Scanner behaviour preferences | **Decided 28 Jul: do not build** |
| D11 | Region and display preferences | Open — and the design's General frame doesn't exist under *any* live URL, `/settings/general` is the settings hub |
| D12 | Group billing basis | **Deferred, not rejected** — live keeps `fee_per_class` only |
| D13 | Analytics/Benchmarks as paid add-ons | **Closed 26 Jul, parked** until AI features ship |
| D14 | Teacher referral model | Open, corrected — a real, working free-month referral loop already pays out; design draws the center's recurring-commission model instead; replacing it is Eyad's call |
| D15 | Teacher student-detail "Mark collected"/"Send reminder" | Open |
| D16 | Center-class commission engine dormant | Open — every teacher's "Owed" figure reads 0.00 EGP, live, today |
| D17 | "Share your profile" links to a 404 | Open |
| D18 | Teacher-Groups §03 review gate doesn't exist | Open |
| D19 | Private-lesson commission columns never populated | Open — Teacher Analytics revenue reads 0.00 EGP, live |
| D20 | Two divergent "run a class" builds | Open |
| D21 | Join link uses full UUID not 6-char code | Open |
| D22 | `/referrals` reads a table nothing writes | Open — ticking time bomb, invisible only because zero referrals have paid out yet |
| D23 | Add-branch clones full plan price, no 199 EGP add-on | Open |
| D24 | `students.is_active` overloaded meanings | **Approved and built, PR #242** |
| D25 | `parent-balance-alerts` cron reads dead columns | Open |
| D26 | Center-Home notification feed, 2 of ~11 types wired | Open |
| D27 | The one real notification writer hardcodes English | Open |
| D28 | Center-Setup Onboarding is a structural divergence | Open — scope decision |
| D29 | Public-Marketing pricing add-ons mostly fabricated | Open |
| D30 | "8–12 hours saved" claim contradicts the design's own "banned" note | Open |
| **D31** | *(new, 1 Aug)* Center-Groups §04 Branches is a wholesale different layout paradigm | Open |
| **D32** | *(new, 1 Aug)* Waitlist promotion has no working path end to end | Open — stale-entry half fixed tonight |

### §3 · BLOCKED ON VALIFY — nothing here starts until identity verification (V1) lands

| Code | What | Drawn in |
|---|---|---|
| V1 | Identity verification (e-KYC via Valify) | `Verification-Payouts` §01–03 |
| V2 | Verified as a second account state platform-wide | — |
| V3 | Online collection (center "collect for me," teacher "collect for you") | `Center-Attendance` §02, `Teacher-Money` §05, `Verification-Payouts` §02 — rate card **locked**: 10% collection fee · 7.5%+7.5 markup · 1.5%+1.5 parent processing fee |
| V4 | Provider balance, clearing, withdrawal | `Center-Money` §04, `Teacher-Money` §04 — schema scaffolding exists (`settlement_status` etc.), entirely dormant, re-confirmed 1 Aug: all 3 live `transactions` rows read `settlement_status = 'not_applicable'` |
| V5 | CEO centers benchmark, verified vs. unverified | `CEO` §03 — technically buildable, every row would read 0/100% until V1 ships |
| V6 | Verified state across `Center-Setup` §08, `Center-Home` §01, `Center-Attendance` §01–02, `Center-Students` §03 | `Center-Attendance` is blocked **wholesale** |

### §4 · BLOCKED EXTERNAL — not Valify, not Eyad

| Code | What | Blocked by |
|---|---|---|
| X1 | Center→teacher split payouts | **Paymob** — design states payment-method options are placeholders |
| X2 | Tax documents, ETA e-receipt/e-invoice | **An accountant and legal** |
| X3 | Admin money ledgers for online collection | V1, V3, X2 combined |
| X4 | Legal document text | **Adsero** — the only external blocker with no money/auth attached |
| X5 | Self-enrollment minor-consent question | **Adsero** (consent) + **Meta** (template) |
| X6 | Parent payment page | V1, V3 — nothing to pay without collection existing first |

### §5 · DESIGN CORRECTIONS — edits to the merged files, not builds

D0 (KPI tile radius drawn at two different values, 12 vs 16 — decision needed on which is correct) plus
ten corrections cataloged in `NEW-FEATURES.md` Appendix D, 28 distinct screens: renaming the parent
processing fee apart from the center's flat-20-EGP fee (D1/D10), correcting the referral step-down to
12 months not 6 (D2, confirmed against 5 independent live sources), removing a fabricated signup-reward
block (D11), correcting plan names across 12 screens (D3), fixing the teacher payout receipt's
fabricated arithmetic (D4), replacing stale Admin-Money §07 prices (D5), adding the teacher Free tier
(D6), documenting `top_centers` so it survives a cleanup pass (D7), rewording an ambiguous fee line
(D8), and correcting the Benchmarks metric set (D9, four metrics live vs. five drawn).

### §0 · SECURITY — read first, not empty today

| Code | What | Status |
|---|---|---|
| S1 | `users.teacher_group_ids` self-writable, feeds a cross-tenant read policy | **CLOSED**, PR #213, applied to production 29 Jul |
| S2 | Three more self-writable columns feed policy decisions | **CLOSED**, same migration as S1 |
| S3 | Defence-in-depth posture confirmed live (RLS + application layer, both load-bearing) | Informational, no action |
| S4 | Per-family cross-tenant denial tests | Open — wants a reachable test tenant (**F6**) |
| S5 | Move remaining service-role reads behind RLS | Open — do S4 first |
| S6 | No CSRF on 5 WhatsApp-Pack mutation routes | Open — waiting on Eyad's go-ahead |
| S7 | No CSRF on referral payout route | Open — low blast-radius only because D22 keeps the balance at 0; the two should land together |
| S8 | No CSRF on any subscription-billing mutation + two fictitious money figures on `/settings/billing` | Open |
| S9 | No CSRF on 4 CEO/admin routes, one a platform-wide kill switch | Open |
| S10 | A super-admin can exist with no `admin_users` row (`SUPER_ADMIN_PHONES` alone grants it), and `requireSuperAdminRow` reads the same env var rather than requiring a row — authority with no forensic trail, no `check-env` coverage | Open — needs Eyad. **Sequencing:** create the rows *before* changing the gate, or the change locks the only super-admin out |

### §6 · FOUNDATIONS DEBT

F1 (1,341 off-scale spacing utilities, fixed screen-by-screen as restyled) · F2 (off-scale heading
sizes, 16 sites) · F3 (`text-2xl`/`text-3xl` collapse to the same 30px) · F4 (four status colors with
no §4 token slot — needs Eyad) · F5 *(two entries share this code — see file)* (`custom_permissions`
dead column, drop pending Eyad's call; Tailwind scanning `docs/`/`design/`, fixed #209) · F6 (audit seed
unreachable, migration history says otherwise — needs Eyad, a reachable test tenant blocks S4) ·
F7 (pre-existing contrast bug, teacher-landing money card) · F8 (`src/lib/tokens.ts` stale dark-theme
mirror) · F9 (`teacher_split_pct`/`assign_teacher_to_group` dead, drop pending Eyad) · F10 (no live
elapsed-time timer on a class session, low priority) · F11 (Center-Groups dead controls — mostly closed
this pass, `capacity_cap`/`kind` remain) · F12 (`pending_enrollments` can't distinguish invite-link vs.
self-serve) · F13 (`students.grade_level` has zero writers) · F14 (import treats parent phone as
optional, design says required) · F15 (lifecycle and payment-standing badges never fuse) · F16 (the
"one number, two sources" pattern — six co-discovered instances, all fixed onto `getStudentBalances`) ·
F17 (Center-Home's Schedule section built on the correct table, `schedule_slots`, which has exactly 1
row platform-wide — fixed with an honest empty state, #296) · F18 (card-order per-field print toggle
needs a schema change) · F19 (team management broken three independent ways in production — invite
500s every time, activate/deactivate always fails, seat cap silently hardcoded to 2) · F20 (six
co-discovered scanner-payment bugs — two methods fixed this pass, four still open pending Eyad) ·
F21 (teacher-tier price fallback duplication — **CLOSED**, PR #288) · F22 (Center-Students branch
rollup + aging/next-due, both need product decisions) · F23 (two dashboard CTAs link to unread query
params) · F24 (My Teachers Slots is a different feature than drawn) · F25 (two parallel WhatsApp
support-number sources) · **D31/D32** *(logged as D-codes, not F-codes, since each needs a decision —
see §2 above)*.

### From `NEW-FEATURES.md` — what's genuinely additive to the above

- **Appendix A, four duplicate money surfaces**, decision pending on each: `/billing` vs.
  `/settings/billing` (the design draws both as separate screens — the one pair the designs don't
  resolve for you); `/teacher/billing` vs. `/teacher/pay` (the design wants one; `/teacher/pay` carries
  a load-bearing rule no design records — a lapsed teacher can still pay there to restore access);
  `/referrals` vs. `/settings/referrals` (design wants one; the settings copy has a CSV download the
  other lacks); `/legal/*` vs. `/privacy`+`/terms` (design wants the legal reader only; `/terms`
  uniquely carries a live processing-fee disclosure gated on `processing_fee_enabled` that would
  silently vanish if deleted without moving it first).
- **Appendix B, 22 live routes with no design at all**, every one marked "decision pending" except the
  one explicitly do-not-touch guardrail: `/admin/center-assignments` (sales-rep commission attribution,
  reps start September, no redesign PR may touch it). The rest: `/pay`, `/teacher/pay`,
  `/teacher/subscription/upgrade`, `/settings/money`, `/settings/referrals`, `/privacy`, `/terms`,
  `/students/print`, `/parent/[token]`, `/admin/orders`, `/admin/card-orders/[orderId]`,
  `/admin/payouts`, `/admin/commissions`, `/admin/renewals`, `/admin/plan-requests`,
  `/admin/demo-requests`, `/demo-request`, plus five marketing stub pages (`/blog`,
  `/compare/spreadsheets`, three `/features/*` pages) recorded as "Dropped" in an old tracker while
  still live and still in `sitemap.ts`'s reach — a decision written down that was never executed.
- **Appendix C, 8 open questions the document's own author flagged rather than guessed at.** Cross-
  checked against tonight's surveys for whether each is now resolved:
  1. Group billing basis (B12) — **resolved as D12**, deferred not decided.
  2. `/teacher/pricing` vs. one consolidated `/pricing` — **still open**, no survey has touched this.
  3. Whether the Analytics add-on replaces or stacks on `canViewRevenue` — **still genuinely
     ambiguous**; D13 only decided not to build a purchase flow, not this specific interaction.
  4. Teacher collection-fee wording (categories vs. 10% figure) — **still open**, D8 named the number
     but explicitly left this exact inconsistency unresolved.
  5. Whether Meta has approved `chq_enrollment_otp` — **not independently re-checked tonight**; worth a
     direct `wa_meta_templates` query before the next Public-App pass.
  6. Teacher WhatsApp allowance in `platform_config` — **resolved**: confirmed live and real (D6),
     the gap is the spend side having zero callers, not a missing entitlement.
  7. **The admin information architecture** (5-item bottom nav drawn vs. 17-item live sidebar) —
     **still fully open**, raised again independently by tonight's own protected-file surveys
     (Admin-Money, Public-App) with no resolution in any doc.
  8. Teacher instant-payout fee schedule mismatch (flat 300/8,400 = 3.57%, matches no band) — **moot
     for now**, §04 is 0% built and wholesale Valify-blocked regardless.

---

## 4 · Decisions made tonight — reflected in the permanent record, not left in chat

Every substantive call made this session has already been written into `BUILD-AFTER-REDESIGN.md`,
`FILE-COMPLETION-TABLE.md` or `CHANGE-LOG.md` directly, not left to live only in conversation. For the
record, so nothing here is assumed rather than checked:

- **Design-Patterns radius/color deviations ruled intentional, not gaps.** Confirmed in
  `CHANGE-LOG.md`'s prose narrative and reflected in row 1's fraction above — no fix pending.
- **Center-Home's balance card stays unbuilt, and the decision not to redefine it from other data was
  made explicitly, not by default.** Recorded in full in `BUILD-AFTER-REDESIGN.md`'s V4 addendum and
  `CHANGE-LOG.md` — the alternative (inventing a headline figure from a running-collections total) was
  raised and declined on the record.
- **PR #248's "closed, not merged" GitHub status was resolved as a false signal** — the squash commit
  is a confirmed ancestor of `origin/master`, timestamped to the same second as the PR's own `closed_at`.
  No work was lost; recorded in full in tonight's `CHANGE-LOG.md` entry and `D31`/`D32`'s own text.
- **D31 and D32 are new tonight** and are the freshest items in this whole document — both already
  carry full entries in `BUILD-AFTER-REDESIGN.md` and a row-11 update in `FILE-COMPLETION-TABLE.md`.
- **The six protected files' fractions in §2 above are new tonight** and have been folded into
  `FILE-COMPLETION-TABLE.md`'s own rows 21–26, replacing "not surveyed" — this document and that table
  now agree, not describe two different realities.

Nothing surfaced tonight is sitting undocumented anywhere else in this conversation only.

---

## 5 · Open items with no owner — nobody is currently driving these to a close

Three items where a real decision, a real deadline, or a real fact already exists, but nobody is
actively working the next step:

1. **`summer.first_charge_release` is HELD, and the first-invoice floor is 30 August 2026 (R0).** The
   summer trial is fully built and working; the single config flag standing between it and revenue has
   no owner assigned to flip it, and no alarm exists if 30 August passes with it still `HELD` — that
   state is silent and indistinguishable from healthy. Flipping it *late* is its own separate risk (the
   1-day pay window collapses, invoicing and locking a whole cohort back-to-back with no real chance to
   pay) — worth a decision on re-anchoring the lock date before the 30th arrives, not after.

2. **The PDPL/Law 151-2020 licensing question, sitting with Adsero since 26 July, unanswered.**
   `design/DECISION-national-id-2026-07-26.md` records a single, narrow question sent to counsel: does
   TutoringHQ, as controller, require registration or a licence under Law 151/2020 to process the
   National ID numbers ETA requires on provider e-receipts — and what retention period actually applies
   given the tension between the PDPL's 30-day erasure right and the 5-year tax-record retention
   requirement? The document's own words: *"the answer either confirms the position or prevents
   twenty-one screens being built on a wrong one."* Adsero is "already engaged and already reviewing
   these documents" as of 26 July — no update on this specific question appears in any doc read for
   this file. Two smaller open questions from the same document ride alongside it, also unanswered:
   whether payouts can ship on bank-verification alone (IBAN + holder name, neither sensitive data)
   while identity verification waits, and whether ETA has a threshold below which small providers don't
   need an ID on the receipt at all — both flagged as "may be a shippable route in the meantime," worth
   asking Adsero at the same time rather than as a separate follow-up.

3. **The payout system's real shape was decided by omission tonight, not by design.** Eyad's explicit
   ruling on the Center-Home balance card — don't invent a headline figure from a running-collections
   total, because the card's actual meaning depends on a payout flow that doesn't exist yet — was the
   right call and is recorded (§4 above). But the ruling itself changes nothing about *when* V1/V3/V4
   (identity verification → online collection → provider withdrawal) actually gets built. That entire
   chain — 14 of the 35 protected-file screens in §2, plus rows 4, 12, 13, 16, 17 of the main 26-file
   table — has no owner driving it forward beyond "waiting on Valify." Nobody in any document reviewed
   for this file is named as the person chasing a Valify vendor agreement, sandbox credentials, or a
   go-live date. Until someone is, "blocked on Valify" is not a schedule, it's an open-ended pause.

   **Amended 3 August 2026 — half of this is now closed, and the half that isn't is unchanged.**
   `design/PAYOUT-SYSTEM-SPEC.md` exists and its nine decisions are all answered by Eyad. But the spec's
   own §0 splits the problem in two, and only one half moved:
   - **System 1 (referral and credit payouts) is decided and shippable.** It pays out platform-owed
     credit, needs no Valify and no third-party fund custody, and is no longer ownerless.
   - **System 2 (tuition settlement — the V1→V3→V4 chain this item describes) is unchanged.** Still
     blocked, still unowned, and the spec deliberately cross-references it rather than speccing it,
     because there is no point designing a ledger for a switch that isn't wired
     (`digital_student_fee_collection.enabled` has no row in `platform_config` at all, so the module
     reads fail-closed to false). The Valify-chasing gap above stands exactly as written.
   - **One new owner-shaped item the spec produced:** the Paymob Payouts commercial conversation.
     Onboarding is manual on Paymob's side and gates the whole integration, and the seven questions in
     spec §8 need written answers from them. Nobody is named for it. This is the one item where the
     delay is external and starting late costs calendar time directly.
