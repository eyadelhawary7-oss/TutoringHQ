# The 26 merged files, ordered by how close each is to completable

**Produced 29 July 2026.** Ordered by how close each file is to reaching 100% — structure *and*
features — in one sitting, without a decision from Eyad, without Valify, and without an external
party.

## Read this before using the table

**Two different numbers, and they are not the same thing.**

- **Route coverage** is *measured*. It is the fraction of the file's design sections that have a
  live route serving them today, computed from `INVENTORY.md`'s section→route map. A file at 5/5
  has somewhere for every screen to live.
- **Structure coverage** is *not* in this table for most files, and that is deliberate. It is the
  fraction of the design's **information architecture** — the sections, in the design's order,
  carrying the design's data — that the live screen actually renders. It cannot be computed from a
  route map. It needs the screen read against the drawing, section by section.

**Where structure coverage IS given, it was surveyed.** Three files have been through a restyle and
I have read them against the design. Those numbers are honest and they are low.

> **The correction this table exists to fix.** `#214`, `#216` and `#218` applied the design's
> **tokens** — colour, radius, type, borders, chips, avatars — to the **existing layout**. They did
> not apply its structure. They were reported as "restyled", which read as "done". Route coverage
> was high for all three, which is exactly why the gap was invisible: having a route is not having
> the screen.

**Blocked-by codes** come from `BUILD-AFTER-REDESIGN.md`: `R*` READY · `D*` needs a decision from
Eyad · `V*` Valify · `X*` external party · `F*` foundations debt · `S*` security.

**Protected** marks the six money/auth files. They can reach 100% technically, but they never
auto-merge — they come to Eyad. That is a routing rule, not a difficulty rating.

---

## The table

| # | File | Route cov. | Structure cov. | Entries that belong here | Buildable now | Blocked by | 100% today? |
|---|---|---|---|---|---|---|---|
| 1 | **Design-Patterns** | 0/6 | **primitives 6/6 built (#220); live adoption audited 31 Jul — `EmptyState` 15.3% (11/72, final, #292+#294), loading states 0.7%, `ListRow` 35.7%, `ActionSheet`/`RecordActionBar`/`ExpandableRow` 0%** | R4 (corrected) | `EmptyState` fully migrated + old component deleted (#292, #294) | not external — ~196 other per-file conversions outstanding across the five remaining primitives, none blocked, adopted opportunistically per-file going forward, not as a forced batch — see **R4** / `PATTERN-ADOPTION-LEDGER.md` | **no — was wrongly marked YES, corrected 31 Jul** |
| 2 | **Admin-Accounts** | 4/4 | **3.5/4** (survey, 31 Jul; teacher half of §01 excluded, see below) | R5 (built, #221) | — | **V1** verified chip/Valify · no `branches` table · no impersonation mechanism (needs a new auth primitive) · **R7-CLOSED** — built 28 Jul, closed unmerged on Eyad's call ("one teacher console, not two") | no — V1, two schema-absence gaps, an auth-infra gap, and R7-CLOSED |
| 3 | **Admin-Platform** | 6/6 | **4.6/6** (survey, 31 Jul) | V1, D5, R7-CLOSED | §02 done (this pass) | **V1** unverified filter · **D5** WhatsApp-pack overview pricing · R7-CLOSED · 6 confirmed schema-absence gaps (no dedicated code) | no — V1, D5 |
| 4 | **Teacher-Home** | 2/2 | **12/16** (survey #225, 30 Jul; re-confirmed unchanged 31 Jul) | V1, V3, V4 | — | **V1** unverified promo card, "Let us collect for you / Verify my ID" (Valify identity verification not live) · **V3/V4** verified-state wallet card + recent payouts (no teacher-scoped payout ledger exists) | no — V1, V3/V4 |
| 5 | **Teacher-Students** | 2/2 | **confirmed complete except D15** (survey, 31 Jul; §01 unchanged from #226, §02's one gap closed via #264) | D15 | — (gap closed this pass) | **D15** Balance card "Mark collected" / "Send reminder" — money-state write + per-send WhatsApp cost, no decision from Eyad | no — D15 |
| 6 | **Teacher-Setup** | 2/2 | **14/16** (survey #227, 29 Jul; re-confirmed + 1 gap corrected 31 Jul) | D16, D17, V1 | counter-offer autonote (this pass) | **V1** collect-payments toggle + verified-state payout details (Valify not live) · **D16** center-class commission engine dormant, "Owed" reads 0.00 EGP · **D17** "Share your profile" links to a route that does not exist | no — V1, D16, D17 |
| 7 | **Teacher-Groups** | 5/5 | **~2.2/5** (section-level survey, 31 Jul — §01/§02 largely intact, §03's review-gate structure absent, §04 missing mark-collected/Vodafone Cash, §05 unbuilt; coarser than rows 2–6's sub-element counts, see notes) | D18, D19, D20, D21 | roster avatars + pending-count banner (this pass, #273) | **D18** §03 review gate doesn't exist — every enrollment auto-activates, no schema for school/note fields · **D19** `finish_class_and_bill` never populates commission/net columns · **D20** `SlotActionSheet` recorded phase is read-only (no mark-collected, no Vodafone Cash) · **D21** join link is a full UUID, not the design's 6-char code · §05 (Class Session Verified — Digital/Cash split, CIB payout) is entirely unbuilt and the design's own caption marks it "draft, pending legal review" — money/legal-adjacent, left untouched like the protected files | no — D18, D19, D20, D21, §05 |
| 8 | **Center-Orders** | 4/4 | **3.5/4** (survey, 31 Jul) | **R8** (built, #231), D7, F18 | Arabic `ordersEmpty` string fixed + §01 empty-state illustration built (this pass, #272) | **F18** Customize step has no per-field print toggle (`card_order_carts` has only `card_style`/`vendor_notes` — schema change) · **D7** notify-me has no destination table | no — F18, D7 |
| 9 | **Center-Insight** | 3/3 | **≈3.3/5** (§01 4/5, §02 4.5/5, §03 1.5/5 — survey #252, 31 Jul; re-confirmed unchanged by batch-3's survey-Center-Insight agent, same day) | D13-CLOSED, D9-CLOSED, D22, S7 | — | **D22** §03's KPIs and R6's rate/countdown UI all read `referral_reward_records`, a table with zero live writers, instead of the real cron target `referral_commissions` — Eyad's call on which table is canonical · **S7** no CSRF on `/api/referrals/payout` (money-adjacent, low-blast-radius only because D22 keeps the balance at 0) · forecast tile needs a decided extrapolation methodology, not just data · D13/D9 are **closed** decisions (paid-add-on gate parked, benchmark metric drawing corrected 4-not-5) — correctly not built, not a re-open | no — D22, S7, forecast methodology (D13/D9 are resolved, not gaps) |
| 10 | **Center-WhatsApp** | 3/3 | **§01 3/5, §02 0/5, §03 0/4** (§01 built this pass, #275; §02/§03 re-confirmed unchanged) | D4, D5 | search + WhatsApp-style preview + variables-used (this pass, #275) | **D4** per-template auto-send toggle — schema exists (`center_message_templates.auto_send`), 0 rows, zero readers, unmade product decision that spends WhatsApp credit unattended · **D5** §02/§03 are a different, already-shipped billing model (monthly per-parent pack + capped blasts) vs. the design's one-time credit top-up — building the design changes what existing customers are charged | no — D4, D5 |
| 11 | **Center-Groups** | 5/5 | **~3.0/5** (full re-survey + build, 1 Aug — §01 ≈0.92 after this pass's waitlist-integrity fix, §02 ≈0.05 fully blocked unchanged, §03 (Rooms) ≈0.9 re-confirmed accurate unchanged, §04 (Branches) ≈0.35 — corrected down, see D31, §05 (Schedule) ≈0.85 unchanged) | D2-CLOSED, D12, D23, D31, D32, F11 | waitlist stale-entry bug fixed + position-assignment race fixed (this pass, no schema/decision needed) | **D12** §02 billing basis, no schema · **D23** §04 add-branch pricing clones the parent's price wholesale, no 199 EGP add-on · **D31** §04 is a wholesale different layout paradigm (desktop table vs. design's card+action-chips list), not just missing chips — zero row actions of any kind exist, re-verified 1 Aug · **D32** waitlist promotion has no working path end to end — the WhatsApp opt-in notifies a parent but nothing ever reads their reply; fixed the stale-waitlist-entry half, the promotion-model choice (automatic-on-reply vs. manual) is Eyad's call · **F11** `capacity_cap`/`kind` dead columns, drop-or-document | no — D12, D23, D31, D32, F11 |
| 12 | **Center-Students** | 4/4 | **~2.45/4** (§01 0.8/1, §02 0.75/1, §03 0.05/1, §04 0.85/1 — survey #257 baseline ~54%, re-verified + built 31 Jul, PR #277) | F12, F14, F15, F22, V1/V6 | ID card tile, tinted balance card, sibling rows, lifetime-paid-since, import inline Fix (this pass, #277; closes F22 items 3–4) | **F22** item 1 branch rollup — no cross-center query exists, needs an RLS-scope decision, not a display fix · item 2 aging/next-due sub-line — `getStudentBalances()` is a running aggregate with no per-invoice "next due" fact to read · **F12** `pending_enrollments` has no origin column · **F14** parent-phone-required copy vs. actually-optional validation · **F15** lifecycle+payment-badge fusion is a design decision · **V1/V6** §03 unconditional "Verified" badge, Valify not live (V6 amended to name this section) | no — F22 (2 open items), F12, F14, F15, V1 |
| 13 | **Center-Home** | 2/2 | **§01 4/5** (audit + #245/#247, 30–31 Jul; re-confirmed unchanged PR #280; balance-card and Schedule re-verified live against the actual DOM, 1 Aug, PR #296) | D26, D27, F23, V3/V4/V6 | Schedule section empty-state added — `schedule_slots` has 1 row platform-wide, the section was silently vanishing for virtually every center (this pass, #296) | §01 balance card + "Verified" badge → **V3/V4/V6**, re-confirmed live 1 Aug (no `payouts`/`center_balances`/`wallets` table; `settled_at` still 0 populated rows; the 3 rows carrying a non-null `settlement_status` all read `not_applicable`) — redefining the headline figure from other existing data was considered and explicitly declined, not guessed at · §02 further parity → **D26** (only 2 of ~11 drawn notification types have a live writer) · **D27** the one real writer hardcodes English regardless of `preferred_locale` · **F23** two dashboard CTAs link to `/students` query params the page never reads (fix belongs to Center-Students) | no — V3/V4/V6, D26, D27 |
| 14 | **Center-Setup** | 9/9 | **~2.9/5 avg across §02–§09** (survey #253, 31 Jul; §02/§05 nudged up, §09 corrected down, PR #282, same day) — §01 not scored (structural divergence, **D28**), §02 ~2.7/5, §03 ~4/5, §04 ~4.5/5, §05 ~1.7/5, §06 ~2/5, §07 structural ~4/5 / functional ~1.5/5 (**F19**), §08 ~1/5 (**V6**), §09 ~2.5/5 (revised down — see notes) | D8, D9, D10, D11, D28, F19, F24, S8, V6 | Account personal-info card, Support email+Legal links, `passwordIs` i18n fix (this pass, #282) | **F19** team invite/activate-deactivate/seat-cap are all broken in production (schema + account-state issues, Eyad's go-ahead needed) · **S8** no CSRF on any subscription-billing mutation · **D8** seats · **D9** notif prefs (closed) · **D10** scanner prefs · **D11** `/settings/general` is the hub, not a language/region screen · **D28** Onboarding is a structural product divergence, not an unbuilt design · **F24** My Teachers Slots tab is a different feature than drawn (attached-group confirm vs. open marketplace) · §08 → **V6** | no — F19, S8, D8, D9(closed)/D10/D11/D28 decisions, V6 |
| 15 | **Public-Marketing** | 4/4 | **structural rebuild, PR #314 (`f74d71c4`→`56666276`), merged to master 4 Aug — all four screens (`/`, `/centers`, `/teachers`, `/pricing`, `/talk-to-us`) rewritten to the design's IA, not restyled onto the old layout: §01 (`SplashClient.tsx`) is one shared session-row object with the tap-to-settle animation and all 6 FAQ items answered; §02 (`CentersClient.tsx`/`TeachersClient.tsx`) both carry the design's 6-row comparison table and all 4 FAQ items with real answers, scoped to what's actually billed (export gated to Pro, card-only payment, monthly not weekly teacher capacity); §03 (`PricingPageClient.tsx`) is one capacity-controlled object per audience with 1 of 6 add-ons real and the other 5 + the "what changes with size" rows correctly withheld (no backing config, confirmed live); §04 (`talk-to-us/page.tsx`) rebuilt to the fixed-brand-bar/scrolling-body/pinned-foot layout with free-text area. Re-surveyed this pass (4 Aug) against the live catalog and the actual DOM, not against prior session notes: D29 narrowed (1/6 add-ons now real, confirmed against `platform_config` directly), D30 and F25 confirmed closed (old `ComparisonTable` component deleted, `supportWhatsApp.ts` unified on `SITE`), one live bug found and fixed (F30 — `/teachers`' comparison table still carried the "card or wallet" fabrication `/centers`' twin had already been corrected for), one new gap found and logged (D34 — "Withdrawals to your own account" claimed as a live feature on `/pricing`, but the underlying mechanism is the same one **V4** already documents as entirely dormant for everyone). §01's flagship-rearchitecture divergence noted in the prior survey no longer applies — §01 now matches the design's rebuilt IA directly, confirmed by re-reading `SplashClient.tsx` in full against §01. | D29 (narrowed), D34 (new), F30 (closed this pass) | full IA rebuild across all 4 screens (PR #314, merged before this pass) — re-verified this pass; F30 fixed this pass (mirrored the already-adjudicated wallet-claim correction from `/centers` onto `/teachers`) | **D29** 5 of 6 pricing add-ons still have no real backing config, would advertise SKUs that don't exist · **D34** "Withdrawals to your own account" on `/pricing` claims a live capability that has zero code path for anyone, centers or teachers — overlaps the protected `Center-Money`/`Teacher-Money`/`Verification-Payouts` files and the already-logged **V4** | no — D29, D34 |
| 16 | **Center-Attendance** | 1/2 | **~0/2, wholesale-blocked** (survey #255, 31 Jul; re-confirmed unchanged, PR #284) — both sections draw the "Verified" badge/digital-collection-by-default unconditionally, no unverified frame anywhere in either | F20, V6 | 3 real bugs fixed this pass, none a design-structure gap: `paidVia` untranslated string, a stale-balance-display leak across consecutive scans, a `formatCurrency`-convention fix (#284) | **V6** both sections wholesale-blocked (no `national_id`/`verification_status`/`kyc` column, zero verification-aware code branches) · **F20** scanner payment-recording — the Vodafone-Cash/Bank method-value mismatch is fixed (#255), but the coordinated retry-dedup fix, the `'admitted'` constraint gap, the `'late_entry'` schema gap, Zod field-stripping, and the missing permission gate on this insert path are all still open, all needing Eyad's call | no — V6, F20's remaining items |
| 17 | **CEO** | 2/3 | **§01 structural superset but §01's "Fee revenue"/6-month chart confirmed absent (was "unconfirmed", PR #288), §02 real IA divergence (5 live tabs vs. the design's overview+leaderboard), §03 0/2 correctly blocked** (survey #256, 31 Jul; re-confirmed + sharpened, PR #288, same day) | V5, S9, F21 (closed) | F21 price-source fixed, dead `legacyPayload` removed (7 unused Supabase queries/30s poll), "second CEO dashboard" confirmed unreachable dead code not a live duplicate (this pass, #288) | **V5** §03 Centers Benchmark blocked on Valify, now schema-catalog-confirmed (zero verification columns/constraints on `centers`) · **S9** no CSRF on 4 CEO/admin mutation routes · §01's Fee-revenue KPI/chart needs V3 (blocked by V1) or a product call on trending incomplete history (`mrr_snapshots` only has ~4 months) · §02's 5-tab IA vs. the design's overview+leaderboard is a product-scope question, not a bug | no — V5, S9, §01/§02 scope questions |
| 18 | **Teacher-Insight** | 1/2 | **§01 Analytics 0.9/1, §02 Referrals 0.1/1, ~50% overall** (survey #259, 31 Jul; re-confirmed unchanged, batch-4 sweep, same day) | D14 (corrected) | 2 missing roadmap cards on §01's Pro-gate teaser, referral-share-link attribution bug fixed (#259) | **D14** — corrected, not stale: a real teacher-to-teacher referral loop already exists and pays out (flat +1 free month, idempotent, wired into `combinedPaymentFinalize.ts`), but the design draws the **center** program instead (25%/10%/5% recurring commission, monthly income aggregate, verification-gated withdrawal) — replacing the working free-month loop or running two systems side by side is Eyad's call, not a schema gap | no — D14 |
| 19 | **Teacher-WhatsApp** | 0/1 | **0/1, correctly blocked** (survey #261, 31 Jul; re-confirmed unchanged, batch-4 sweep, same day) | D6 | — | **D6** — credit-balance columns are real and marketed but the spend RPC has zero callers, so the number only ever goes up; 0 of 5 drawn templates deliver today, each for a different verified reason (1 platform-wide Meta-approval gap, 3 never submitted, 1 pair that doesn't exist for anyone); no prepaid-pack model to extend from centers | no — D6 |
| 20 | **Public-Legal** | 1/1 | chrome/routing ~100%, text 0% — the four documents, footer and draft banner are real; every section body is `[This section will be completed upon legal review]` | — | — | **X4** legal text from Adsero — the only external blocker with no money/auth attached | no |
| 21 | **Lifecycle** 🔒 | 5/6 | **~67%** (full survey, 1 Aug — §01 ≈0.6, §02 ≈0.85, §03 ≈0.7, §04 ≈0.7, §05 ≈0.65, §06 ≈0.5; healthiest of the six protected files) | **R2** | R2 | §01 different PIN-entry IA + missing invite-inviter-name/role-pill/decline + broken placeholder copy (`acceptInvite.*` literally reads "Joined Center"/"Your Pin" in en, worse in ar) · §02 real bug: white-on-paper CSS on `/suspended` (`text-white` on a light surface, effectively invisible) · §03 wrong service taxonomy (3 infra services shown vs. design's 5 product-facing ones) + a comma-placeholder render bug · §04 missing Monthly/Annual toggle + missing "nothing was deleted" reassurance copy + **direct contradiction**: design says "No reactivation fee," live charges tiered fees · §05 single fixed plan vs. design's 3-plan chooser · §06 `ComingSoon.tsx` has zero render sites today (superseded by `CardOrdersTeaser`); locked-row variant (**R2**) still never built | no — R2, plus the §04 fee-copy contradiction needs Eyad's call |
| 22 | **Public-App** 🔒 | 5/6 | **~45%** (full survey, 1 Aug — §01 ≈0.45, §02 ≈0.25, §03 ≈0.55, §04 0%, §05 ≈0.5, §06 ≈0.95, the one near-complete section) | — | — | §01 no unified center/teacher auth fork (design's whole reason for existing), no OTP step for centers, no teacher plan step, review screen missing agent-clauses/provider-agreement-version row, no done screen, lockout params diverge from the design (5 attempts/15 min vs. drawn 3-tries/6-tries-1hr) with no tries-left UI, no trial-already-used screen · §02 no invitation pre-screen, **parent phone is optional in live, required in the design** (the section's own core rule, inverted), no sent-detail-card/WhatsApp CTA, no closed-link state, no already-enrolled state, `/parents` trust page missing entirely · §03 parent number skippable via a "who pays" toggle, no anti-phishing warning, no pre-screen, WhatsApp-timing copy contradicts the design · §04 0% — no public payment page exists anywhere, Paymob-iframe links only · §05 missing both perk-copy lines, CTA reads "Book your demo" but links to signup, missing login link · §06 service-worker precache list omits `/offline` itself | no — X5 minor consent, X6 parent payment, plus every gap above |
| 23 | **Center-Money** 🔒 | 3/5 | **~21–26%** (full survey, 1 Aug — §01 ≈0.75, §02 0%, §03 ≈0.3 on the claimed file/≈0.55 crediting the `settings/billing` duplicate, §04 0%, §05 0%) | R0 | — | §01 no per-row kebab/drill-in, no WhatsApp receipt-send, no Card payment method, receipt missing a reference number · §02 0% — no verified-state rendering path exists at all, contrary to the prior mapping · §03 split across two live routes (`(dashboard)/billing` display-only, `settings/billing` has the actions) — payment-method row and 2 of 3 add-ons exist nowhere · §04 0% — only referral-credit withdrawal exists, a different feature · §05 0% — `ReceiptModal` is a transient 4-line dialog, nothing like a Records/statement screen | no — V3 online collection · protected |
| 24 | **Teacher-Money** 🔒 | 3/5 | **~29%** overall, **~65% of the non-Valify scope** (full survey, 1 Aug — §01 unverified half ≈0.83/verified half 0%, §02 ≈0.43, §03 ≈0.5, §04 0%, §05 0%) | **R3** | R3 | §01 unverified half missing only the verify-nudge copy; verified half (wallet/payouts) fully unbuilt · §02 the live component uses the **old 5%-commission fee model the design explicitly retires**, no plan picker, no dedicated route — R3 undersold this as a restyle · §03 several rows live on other routes entirely (payment-method, refer-a-teacher, redeem-code, invoices, cancel-subscription), plus **two real money-terms conflicts**: Scale caps at 100 students/+20 EGP live vs. 150/+16 in the design; Pro WhatsApp is "100 EGP credit" live vs. "50 messages" drawn · §04 0% — no live route · §05 0% — no live route | no — V3 · protected, plus §02's fee-model change and §03's terms conflicts need Eyad's call |
| 25 | **Admin-Money** 🔒 | 3/7 | **~19%** (**~23%** crediting `/status`) (full survey, 1 Aug — §01 0%, §02 0%, §03 ≈0.38, §04 0%, §05 ≈0.38, §06 0%, §07 ≈0.55) | R0 | — | §01 0% — no admin screen despite the underlying `transactions` fee ledger being fully populated and correctly structured · §02 0% — `/admin/payouts` is internal staff salaries, a different concept entirely · §03 missing ARR, revenue-per-account and the whole fee-collection-revenue KPI group; the design's health frame's actual IA lives on the public `/status` page, not `/admin/health` · §04 0% — no receipts screen, though `e_receipt_ref`/`e_receipt_status` columns exist unused on `transactions` · §05 withdrawals table serves the wrong money product (scanner-credit cash-outs, not referral payouts) and has no Bank-transfer method; analytics frame was built to a different design file entirely (`Admin-Platform` §02, per its own code comments) · §06 0% — `/admin/renewals` is subscription renewals, a different ledger · §07 missing a teacher-plan editor (zero teacher rows in `pricing_plans`) and a "new prices apply to new signups" note | no — **X2** ETA · **X3** ledgers · protected |
| 26 | **Verification-Payouts** 🔒 | 1/6 | **~9–10%** (full survey, 1 Aug — §01 0%, §02 0%, §03 0%, §04 ≈0.4 but the wrong money product, §05 0%, §06 ≈0.15, helpers only) — the most heavily blocked file in the whole 26-file catalog | — | — | §01–§03 0% — no Valify integration exists anywhere in `src/`, confirmed fresh · §04 the one live section serves **scanner-credit cash-outs, not referral-earnings payouts** — no bank/IBAN/holder columns exist (only `instapay_number`), and `fee_amount` is fetched but never rendered · §05 0% — `/my-teachers` is view-only, no payout action anywhere in the app · §06 0% as a screen, but the PDF-generation building blocks are real and stronger than previously claimed (`generatePayoutReceiptPdf`, live and working for referral payouts) | no — **V1**, **V4**, **X1** · protected |

🔒 = one of the six protected money/auth files.

---

## Why the order is what it is

**1–3 can finish today.** `Design-Patterns` has no routes because it is not screens — it is the six
shared pattern sheets (empty, loading, row actions), and `R4` is READY with nothing in front of it.
Building it first is also the highest-leverage move available, because every later file adopts those
components instead of reinventing them. `Admin-Accounts` has every section routed and its only two
gaps, `R5` and `R7`, are both READY, unprotected and Valify-free. `Admin-Platform` is fully routed
with no backlog entries at all, so it is a structure-and-restyle pass with nothing to unblock.

**4–7 have all been surveyed since this table was first produced**, and the un-measured signal that
used to put them here turned out to cut both ways. `Teacher-Home` (12/16) and `Teacher-Setup` (14/16)
confirmed the "probably fine" read. `Teacher-Students` came back nearly clean (one gap, D15).
`Teacher-Groups` did not — its survey (31 Jul, PR #273) found four live decision-blocked gaps
(D18–D21) plus an entirely unbuilt, legal-blocked fifth section, landing it at roughly 2.2/5 rather
than the "probably in the same class" this row used to carry. Route coverage alone would never have
surfaced that; it took reading the screen against the drawing.

**8–10 are all surveyed now too.** Center-Orders (3.5/4, PR #272) stays one decision away — F18 and
D7, its only two gaps, are both schema/decision items, not survey unknowns. Center-Insight (≈3.3/5,
PR #252, re-confirmed by batch-3) turned out to already carry a real, if closed, blocker set — most
of its shortfall is one root cause (D22's dead referral table) plus a CSRF gap (S7) that rides along
with it, not the "one decision" (D13) the original row implied; D13 and D9 turned out to be resolved
decisions correctly reflected in what's *not* built, not open questions. Center-WhatsApp (§01 3/5 after
this pass's search/preview build, §02 0/5, §03 0/4, PR #275) is the cleanest of the three — D4 and D5
are exactly the two decisions the original row named, nothing else surfaced.

**11–13 have all been re-verified now** (batch-4 sweep, 31 Jul, PRs #278/#277/#280), and the picture
has flipped from when this row-group was first written: back then all three were "token pass only"
and Center-Home was called out as the worst of the three, on the strength of an earlier, shallower
read. Re-verified section by section, it's the opposite — **Center-Home is the closest to done**
(§01 4/5, only the balance card genuinely blocked on V3/V4/V6; §02's remaining gap is D26/D27, not a
missing build). **Center-Groups is the roughest of the three** (~3.1/5) — its §04 Branches alone
carries D23, F11, and two freshly-found decision items (a fake branch-switcher would be worse than no
switcher; the address field has no schema). **Center-Students sits in between** (~2.45/4), with one
open item (F22's aging/next-due sub-line) that turned out to need a product decision on what "next due"
even means under a running-balance model, not a missing field.

**14–20 carry real blockers** that no amount of work removes.

**21–26 are protected.** Several could be finished technically; none of them auto-merges.

## What was measured, and how

- **Section counts** — the `mgd-num` bars in each `Merged-*.html`, counted directly.
- **Route coverage** — `INVENTORY.md`'s section→route table, which was itself produced by reading
  every `page.tsx`, not by inferring from names.
- **Entry mapping** — the `## X0 ·` headings in `BUILD-AFTER-REDESIGN.md`.
- **Center-Home's buildable list** — checked against `information_schema`: `sessions` (13 cols,
  including `scheduled_at`, `room`, `status`, `billed`), `payments` (12 cols, **including
  `method`**), `enrollments`, `invoices` (41 cols). No `payouts`, `center_balances` or `wallets`
  table exists, which is what makes the balance card genuinely blocked rather than merely unbuilt.
  Re-confirmed live 1 Aug — still true, plus `schedule_slots` (the Schedule section's real source,
  see **F17**) has exactly 1 row platform-wide, fixed with an empty-state, not a rebuild (**#296**).

- **Global app chrome (hamburger, top bar/`Sidebar`, `MobileTopBar`, `BottomTabBar`) is out of scope for
  every row in this table, on purpose, not by oversight.** It lives in `src/components/AppShell.tsx`,
  mounted once at the root `[locale]/layout.tsx`, wrapping every authenticated route — architecturally
  outside any single screen's own content. No `design/Merged-*.html` file draws it in any phone frame;
  each mockup's own `.topbar` is deliberately just the screen-specific header (center name/date, a
  back/menu icon, a title). The only place this project has ever raised an equivalent nav/IA question is
  the **admin** portal's five-item bottom nav vs. the live 17-item sidebar (`INVENTORY.md`, `NEW-FEATURES.md`
  Appendix C) — a real, still-open decision for that portal specifically. The Center-portal equivalent
  was checked once, 1 Aug, and correctly found to be a genuine scope boundary, not a gap — recorded here
  so a future pass doesn't re-raise it as a fresh miss.

- **Teacher-Groups' 2.2/5** — a section-level estimate (§01 ≈1, §02 ≈0.6 after this pass's avatar/banner
  work, §03 ≈0.2 since the review-gate premise D18 describes doesn't exist at all, §04 ≈0.4 given D19/D20,
  §05 = 0, unbuilt and legal-blocked), not a sub-element count like Teacher-Home's 12/16 or Teacher-Setup's
  14/16. Recorded coarse rather than invented precise, per PR #273.
- **Center-Orders' 3.5/4** — §01 and §02 counted whole (empty-state gap closed this pass, no other gaps
  found on a full re-read); §03 and §04 each carry one confirmed gap (F18's print toggle, D7's notify
  destination) and are counted at 0.75 each, per PR #272.
- **Center-Setup's §09 revised down, not just re-confirmed.** The original survey (#253) credited My
  Teachers' Slots tab as one of two tab bodies that "check out cleanly against the design," landing
  §09 at ~3.5/5. PR #282's independent re-read found the opposite: Slots is a structurally different
  feature (live confirms a proposed time on an already-attached group; the design draws an open
  marketplace multiple teachers can bid on) — logged as **F24**. Lowered to ~2.5/5 rather than left at
  the stale credit, since "checks out cleanly" was the specific claim this pass disproved.

**Not measured:** structure coverage for the 7 remaining files marked *not surveyed*. Producing that
number is step 1 of the per-file prompt, by design — see `PER-FILE-PROMPT.md`.

- **Design-Patterns (row 1)** moved from "not surveyed" to a measured adoption fraction, not a
  structure-coverage survey in the usual sense — there is no single live screen to read against the
  drawing, since this file is six shared components consumed across the other 25. "Surveyed" here means a
  full-codebase, per-file audit of which screens actually use each primitive versus rolling their own
  equivalent. See **R4** and `PATTERN-ADOPTION-LEDGER.md` for the full per-file breakdown — 200+
  individual files, none blocked, none built. This does not change any other row's own recorded fraction;
  a file can be structurally complete in its own row while still appearing on that ledger as a
  pattern-adoption non-adopter, since the two are different measurements.

- **Rows 21–26 (the six protected files) moved from "not surveyed" to real, section-by-section
  fractions, 1 August 2026.** Read-only surveys — no code touched, per the standing rule that these
  six never get built without coming to Eyad first. Each design file opened fresh in full; each live
  route (or its absence) confirmed fresh via grep/glob, not inferred from `INVENTORY.md`'s 26 July
  read. Full per-section detail, evidence and file citations for all 35 screens: `design/STATE-OF-THE-BUILD.md`.
