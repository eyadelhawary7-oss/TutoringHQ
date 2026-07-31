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
| 1 | **Design-Patterns** | 0/6 | not surveyed | **R4** | R4 | — | **YES** |
| 2 | **Admin-Accounts** | 4/4 | **3.5/4** (survey, 31 Jul; teacher half of §01 excluded, see below) | R5 (built, #221) | — | **V1** verified chip/Valify · no `branches` table · no impersonation mechanism (needs a new auth primitive) · **R7-CLOSED** — built 28 Jul, closed unmerged on Eyad's call ("one teacher console, not two") | no — V1, two schema-absence gaps, an auth-infra gap, and R7-CLOSED |
| 3 | **Admin-Platform** | 6/6 | **4.6/6** (survey, 31 Jul) | V1, D5, R7-CLOSED | §02 done (this pass) | **V1** unverified filter · **D5** WhatsApp-pack overview pricing · R7-CLOSED · 6 confirmed schema-absence gaps (no dedicated code) | no — V1, D5 |
| 4 | **Teacher-Home** | 2/2 | **12/16** (survey #225, 30 Jul; re-confirmed unchanged 31 Jul) | V1, V3, V4 | — | **V1** unverified promo card, "Let us collect for you / Verify my ID" (Valify identity verification not live) · **V3/V4** verified-state wallet card + recent payouts (no teacher-scoped payout ledger exists) | no — V1, V3/V4 |
| 5 | **Teacher-Students** | 2/2 | not surveyed | — | — | — | likely — survey first |
| 6 | **Teacher-Setup** | 2/2 | not surveyed | — | — | — | likely — survey first |
| 7 | **Teacher-Groups** | 5/5 | not surveyed | — | — | — | likely — survey first |
| 8 | **Center-Orders** | 4/4 | not surveyed | **R8**, D7 | R8 | **D7** notify-me has no destination | no — one decision |
| 9 | **Center-Insight** | 3/3 | not surveyed | **R6**, D13 | R6 | **D13** paid add-on model | no — one decision |
| 10 | **Center-WhatsApp** | 3/3 | not surveyed | D4, D5 | — | **D4** auto-send · **D5** pack top-up | no |
| 11 | **Center-Groups** | 5/5 | **token pass only** | D2, D12 | week strip, segmented control, stat row | **D2** weekday index · **D12** billing basis · §02 is Verified → **V2** | no |
| 12 | **Center-Students** | 4/4 | **token pass only** | D3 | §02–§04 structure | **D3** dead column · §03 is Verified → **V2** | no |
| 13 | **Center-Home** | 2/2 | **token pass only** | — | alert row, 4 Today KPIs, digital share, schedule | balance card → **V3/V4** · §01 is Verified → **V6** | no |
| 14 | **Center-Setup** | 9/9 | not surveyed | D8, D9, D10, D11 | §01, §02, §04, §09 | **D8** seats · **D9** notif prefs · **D10** scanner prefs · **D11** region · §08 → **V6** | no |
| 15 | **Public-Marketing** | 3/4 | not surveyed | **R1** | **R1 — unblocked 29 Jul** | §04 has no route yet | no — R1 is a build |
| 16 | **Center-Attendance** | 1/2 | not surveyed | — | — | **V6** — both sections are Verified states | no |
| 17 | **CEO** | 2/3 | not surveyed | — | — | **V5** verified benchmark | no |
| 18 | **Teacher-Insight** | 1/2 | not surveyed | D14 | — | **D14** teacher referral model | no |
| 19 | **Teacher-WhatsApp** | 0/1 | not surveyed | D6 | — | **D6** screen + allowance | no |
| 20 | **Public-Legal** | 1/1 | not surveyed | — | — | **X4** legal text from Adsero | no |
| 21 | **Lifecycle** 🔒 | 5/6 | not surveyed | **R2** | R2 | protected — comes to Eyad | no (routing) |
| 22 | **Public-App** 🔒 | 5/6 | not surveyed | — | — | **X5** minor consent · **X6** parent payment · protected | no |
| 23 | **Center-Money** 🔒 | 3/5 | not surveyed | R0 | — | **V3** online collection · protected | no |
| 24 | **Teacher-Money** 🔒 | 3/5 | not surveyed | **R3** | R3 | **V3** · protected | no (routing) |
| 25 | **Admin-Money** 🔒 | 3/7 | not surveyed | R0 | — | **X2** ETA · **X3** ledgers · protected | no |
| 26 | **Verification-Payouts** 🔒 | 1/6 | not surveyed | — | — | **V1**, **V4**, **X1** · protected | no |

🔒 = one of the six protected money/auth files.

---

## Why the order is what it is

**1–3 can finish today.** `Design-Patterns` has no routes because it is not screens — it is the six
shared pattern sheets (empty, loading, row actions), and `R4` is READY with nothing in front of it.
Building it first is also the highest-leverage move available, because every later file adopts those
components instead of reinventing them. `Admin-Accounts` has every section routed and its only two
gaps, `R5` and `R7`, are both READY, unprotected and Valify-free. `Admin-Platform` is fully routed
with no backlog entries at all, so it is a structure-and-restyle pass with nothing to unblock.

**4–7 are probably in the same class**, but I have not surveyed them and will not claim a number I
have not measured. Each is fully routed with no backlog entries pointing at it, which is the same
signal that puts Admin-Platform at 3 — but signal is not survey.

**8–10 are one decision away each.** They are otherwise fully routed and unblocked.

**11–13 are the three I already touched**, and they sit here rather than near the top precisely
because route coverage flattered them. Center-Home is the worst: four of its five design sections
are buildable from data that exists today — `sessions`, `payments.method`, `enrollments`,
`invoices` — and none of them is on the live screen. Only the balance card is genuinely blocked.

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

**Not measured:** structure coverage for the 23 files marked *not surveyed*. Producing that number
is step 1 of the per-file prompt, by design — see `PER-FILE-PROMPT.md`.
