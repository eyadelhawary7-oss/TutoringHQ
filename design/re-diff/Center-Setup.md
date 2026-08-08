# Re-diff — `design/Merged-Center-Setup.html` vs LIVE app

**Date:** 8 August 2026 · **Session auth:** OWNER of "Test Center 333" · **Captures:** `/tmp/rediff/center-setup`
**Design file last touched:** `af1d995c design: sweep the dead model out of Center-Setup and Center-Home (#370)` — the file **was** edited since the previous pass, so the carried-forward residue list had to be re-checked against the bytes, not the note.

---

## 1. Frames drawn

```
$ grep -o 'class="phone"' design/Merged-Center-Setup.html | wc -l
41
```

Per section (`awk` over the same file, one counter per `mgd-bar`):

```
  01 -> 6      06 -> 2
  02 -> 4      07 -> 4
  03 -> 4      08 -> 4
  04 -> 4      09 -> 8
  05 -> 3      10 -> 2
TOTAL: 41
```

6+4+4+4+3+2+4+4+8+2 = **41**, equal to the `class="phone"` count.

---

## 2. The 10 screens

| # | Name | Design source attribution | Live counterpart |
|---|---|---|---|
| 01 | Onboarding | `Screen-Onboarding.html` | `/{loc}/onboarding` — different product (see §5) |
| 02 | Settings | `Screen-Settings.html` | `/{loc}/settings` → redirects to `/settings/general`, which **is** the hub |
| 03 | Settings Billing | `Screen-Settings-Billing.html` | `/{loc}/settings/billing` |
| 04 | Settings Center | `Screen-Settings-Center.html` | `/{loc}/settings/center` + `/settings/subjects` |
| 05 | Settings Notifications Support | `Screen-Settings-Notifications-Support.html` | `/{loc}/settings/notifications` + `/settings/support` |
| 06 | Settings Scanner | `Screen-Settings-Scanner.html` | `/{loc}/settings/scanner` |
| 07 | Settings Team | `Screen-Settings-Team.html` | `/{loc}/settings/team` |
| 08 | Center Team | `Screen-Center-Team-Verified.html` | same `/{loc}/settings/team` |
| 09 | My Teachers | `Screen - My Teachers.html` | `/{loc}/my-teachers` |
| 10 | InstaPay Settings | `Screen-InstaPay-Settings.html` | `/{loc}/settings/money` — **only partly** (see §4) |

---

## 3. Coverage

**`Drawn: 41 | Exercisable: 36 | Exercised: 20 | Blocked: 21`**

Exercisable = 41 drawn − 5 that have no live surface at all (`not-built`). Of the 36 exercisable, 20 were exercised and 16 blocked; plus the 5 `not-built` = **21 blocked total**. 20 + 21 = 41.

**Routes measured this pass — 23 of 23 requested/added, 0 capture failures.**
Batch 1 `measured 9/9`, batch 2 `measured 12/12`, batch 3 `measured 2/2`.

### Every blocked frame, named

**`not-built` (5)** — nothing in the app draws this surface:

| Frame | Why |
|---|---|
| §01 `EN · center details` | Live onboarding is a 4-step *activation* wizard (Student → Group → Scan → Results). There is no "center details" wizard step. |
| §01 `EN · subjects & grades` | Same — no such wizard step. |
| §01 `EN · accept payments` | Same — no payment-method step anywhere in live onboarding. |
| §01 `EN · done` | Live step 4 `router.replace('/dashboard')` — no "You're all set" screen is drawn. |
| §02 `EN · general` | There is **no General preferences page**. `/settings` and `/settings/general` return byte-identical hub text (both `chars=900`). `src/app/[locale]/settings/page.tsx` redirects to `/settings/general`; `src/app/[locale]/settings/general/page.tsx` *is* the hub. Language, currency, week-start, time format, date format, Eastern-Arabic-numerals and larger-text controls do not exist. |

**`tooling` (12)** — reachable in principle, not measured this pass:

| Frames | Why |
|---|---|
| §03 `AR · الفوترة والخطة`, `AR · الفواتير` | `/ar/settings/billing` not captured this pass. |
| §04 `AR · بيانات المركز`, `AR · المواد والصفوف` | `/ar/settings/center`, `/ar/settings/subjects` not captured. |
| §05 `AR · الإشعارات` | `/ar/settings/notifications` not captured. |
| §06 `AR · الماسح` | `/ar/settings/scanner` not captured. |
| §07 `EN · invite member`, `AR · دعوة عضو` | The "Invite Member" button is present on `/{loc}/settings/team`; the harness does not click, so the invite panel never opened. |
| §09 `EN · Requests`, `EN · Slots`, `EN · Add teacher`, `AR · RTL · counter-offer` | Tabs are client-side `useState` in `src/app/[locale]/my-teachers/page.tsx`; only the default `myTeachers` tab renders on load. |

**`no-data` (3)**

| Frame | Why |
|---|---|
| §08 `EN · reception permissions` | Test Center 333 has exactly one member. Live team page: `1 team members` … `Test Owner(You) · Full access · Owner` · "The owner keeps every permission". No non-owner card exists to open a permission editor on. |
| §08 `AR · صلاحيات الاستقبال` | Same, Arabic — `١ من أعضاء الفريق`, owner only. |
| §09 `EN · Empty` | The center has 1 teacher and 7 groups, so the empty state cannot render. |

**`by-design` (1)**

| Frame | Why |
|---|---|
| §09 `EN · Loading skeleton` | Transient render state; a 6000 ms settle deliberately captures past it. |

**One harness caveat, resolved by reading the PNG.** `/en/settings/billing` was tagged `[STILL-SKELETON: NOT MEASURED]` by the capture script, but `en_settings_billing.png` shows a fully painted page (plan card, platform balance, WhatsApp parent pack, invoice history with `INV-007-2026-07`, plan-change history, cancel block). The heuristic misfired on a leftover shimmer node. Counted as **exercised**, flag noted rather than hidden.

---

## 4. Does the "InstaPay Settings" screen exist live?

### **No. The screen does not exist, and the gate it is supposed to enforce does not exist either.**

What §10 draws (2 frames, EN + AR): a **Payment methods** page — `Cash · On`, `InstaPay · nileprep@instapay · On`, `Registered phone +20 10 123 4567`, and the one-way note "A cash record can be changed to InstaPay. The reverse is blocked, because the parent has already paid the fee." Its lead adds two rules: the account must be entered **before the method can be turned on**, and changing it **pauses auto-matching and flags every incoming receipt**.

What is live at `/{loc}/settings/money` (`en_settings_money.png`, `ar_settings_money.txt`):

- Card 1 — **"Financial Settings"**, subtitle **"Required for credit withdrawals via InstaPay"** (AR: `مطلوب لسحب الرصيد عبر الإنستاباي`). One field, **"InstaPay Number"**, placeholder `01XXXXXXXXX`. Save.
- Card 2 — "Physical QR cards" / "Enable card ordering" (off).
- Card 3 — link to "Billing & subscriptions".

Established precisely, from code:

1. **There is no method on/off switch, and no schema for one.** `grep -rn "instapay_enabled\|payment_methods\|cash_enabled\|accepts_instapay" src/` returns **zero** matches. Neither Cash nor InstaPay can be turned off by a center.
2. **The account does not gate the method.** `src/lib/validations.ts:93` is `method: z.enum(['cash','instapay'])` unconditionally. Every one of the `centers.instapay_number` call sites is a *withdrawal* path — `src/app/api/billing/withdrawal/route.ts`, `src/app/[locale]/settings/billing/page.tsx` (withdrawal panel), `src/app/[locale]/admin/withdrawals/page.tsx`, `src/app/api/referrals/payout/route.ts`, `src/lib/collectionPayout/requestPayout.ts`. **No attendance or payment path reads it.** A center with a blank InstaPay number can still record InstaPay payments today.
3. **It is not the default for every student.** `src/components/attendance/ChecklistTab.tsx:100` renders an explicit per-student method picker (`cash` / `instapay` / `exempt`) — the picker NEW-MODEL says should not exist.
4. **The field is the wrong shape.** The design's account is an InstaPay *handle* (`nileprep@instapay`) plus a separate registered phone. Live accepts only an 11-digit Egyptian mobile — `src/app/api/settings/instapay/route.ts:7-11` rejects anything that is not 11 digits starting `01`.
5. **The one-way rule and the auto-matching-pause rule appear nowhere** in `/settings/money` in either locale.

**Conclusion.** The single live InstaPay field is a **payout destination for referral-credit withdrawals**, not the tuition-collection account §10 describes. The InstaPay gating model — configure-then-enable, default-for-everyone — is **entirely unbuilt**, and the field that shares its name is wired to the dead model instead.

---

## 5. Divergences

### 5a. AGAINST THE APP (defects — app is wrong, design is right)

| # | Severity | Screen | Finding |
|---|---|---|---|
| D1 | **High** | §01 `/en/onboarding`, `/ar/onboarding` | The onboarding wizard **errors for a valid owner session**: red banner **"Could not load your center."** in both locales, over an otherwise-rendered step 1. Not a session problem — the same storage state renders `/settings` with "Test Center 333" fine. Cause: `src/app/[locale]/onboarding/page.tsx` reads `supabase.from('users').select('center_id')` through the **RLS-enforced browser client**, where every other page in this file uses `/api/me`. The AR string is untranslated too — the error renders in English inside the Arabic page. |
| D2 | **High** | §10 `/settings/money` | The InstaPay account is presented to the center as a **withdrawal destination** ("Required for credit withdrawals via InstaPay"). Under NEW-MODEL it is the account a **parent transfers tuition into**. Same field name, opposite direction of money. This is the single most misleading string in the file's live surface. |
| D3 | **High** | §07/§08 permissions | Live permission set is 8 keys (`can_record_payments`, `can_view_payments`, `can_manage_billing`, `can_edit_center_profile`, `can_delete_students`, `can_manage_academic_calendar`, `can_place_card_orders`, `can_request_referral_payouts` — `src/components/settings/StaffMemberCard.tsx:11-18`). It matches **neither** design set. Missing from live: take attendance, end-a-session-and-bill, switch-a-student-to-cash, void-an-unpaid-link, set-prices-and-billing-basis, send-reminders. Present in live and explicitly disowned by the design lead: **`can_request_referral_payouts`** (see §6). |
| D4 | **Medium** | §03 `/en/settings/billing` | Contradictory state rendered simultaneously on one card: `STATUS: Paid` next to a red **Suspended** pill and an **Overdue** warning banner. |
| D5 | **Medium** | §03 `/en/settings/billing` | Layout overlap at 390 px: the plan heading **"Starter"** is painted underneath the "Billing Period: Monthly" and "Suspended" pills. Visible in `en_settings_billing.png`. |
| D6 | **Medium** | §05 `/settings/notifications` | Live has **2** switches (Daily Summary, Summer Mode). Design draws three groups: NOTIFY ME ABOUT (5 rows), HOW (Push, Email), QUIET HOURS (Do not disturb 9 PM – 7 AM). No quiet hours, no channel choice, no per-event control. |
| D7 | **Medium** | §06 `/settings/scanner` | Live has **1** control (Default Mode: Camera / Bluetooth Scanner). Design draws SCAN INPUT (+ camera facing), ON EACH SCAN (Sound, Vibrate, Mark attendance automatically) and DUPLICATES (Ignore repeat scans within 5 min). The duplicate-scan window in particular is a correctness feature, not a nicety. |
| D8 | **Medium** | §02 hub | No **General** preferences page exists (see §3, `not-built`). The design's row is drawn in the hub; live has no such row and no such page. |
| D9 | **Medium** | §05 `/settings/support` | Live is missing the design's whole HELP group — Help center, Report a problem, Request a feature — and the App-version row. Live jumps from GET IN TOUCH straight to ABOUT (Terms, Privacy). |
| D10 | **Low** | §07 `/en/settings/team` | English plural bug: **"1 team members"**. Also no seat counter — design draws "3 of 5 seats used · Growth plan" with the extra-seat add-on card; live draws none of it. |
| D11 | **Low** | §09 `/ar/my-teachers` | Arabic plural bug: **`٧ مجموعة`** for seven groups. Arabic 3–10 takes the plural (`مجموعات`). Source: `messages/ar.json` → `teachersSection.headerCounts` = `'{teachers} مدرّس · {groups} مجموعة'`, a single form used for every count. EN twin has the same defect (`1 teachers · 7 groups`). |
| D12 | **Low** | §07 `/ar/settings/team` | Arabic register mixing: `مفيش طلبات انضمام معلّقة` (colloquial Egyptian) sits beside MSA everywhere else on the same screen (`المالك يحتفظ بكل الصلاحيات`). Arabic typography/register is a product rule regardless of `class="ar"`. |
| D13 | **Low** | §04 `/en/settings/subjects` | Live subject list shows **`physics` twice, lower-case**, alongside title-case `Biology / Chemistry / English / Mathematics`. Duplicate rows are creatable and no casing normalisation is applied. |
| D14 | **Low** | §02 hub, both locales | No app-version row. Design draws `TutoringHQ · v2.4.0` as the hub footer; live ends at Logout. |
| D15 | **Low** | proxy config | **`/onboarding` is absent from `AUTHENTICATED_ROUTE_PREFIXES`** (`src/proxy.ts:111-139`). Every other screen in this file is listed. The page self-gates by redirecting to `/login`, so it is not currently exploitable, but it is the exact omission CLAUDE.md warns about, and it is the only route in this file that relies on client-side gating alone. |

### 5b. AGAINST THE DRAWING (stale design — design is wrong, app is right or model has moved)

| # | Severity | Location | Finding |
|---|---|---|---|
| S1 | **Critical** | §01 `EN · accept payments`, L534-538 | **The dead model survives here in full, and the frame is visibly corrupted.** Five method toggles are drawn: `Cash`, `Instapay`, `InstaPay`, `InstaPay`, `Card`. The three InstaPay-ish rows keep their original distinct icons and brand colours — a paper-plane in teal `#0e6b61`, a **wallet in Fawry gold `#9a6b1f`**, a **phone handset in Vodafone red `#9c3322`**. This is a blind `Fawry → InstaPay` / `Vodafone Cash → InstaPay` string replacement with the icons left behind, introduced in `cd92da4c "Add files via upload"` (`git log -S Vodafone` matches `cd92da4c`, not the sweep). NEW-MODEL: **two tuition methods only**. Drawn: five rows, two of them ghosts, one of them `Card`, which is dead. |
| S2 | **Critical** | §01, L539 | The green banner still sells platform collection verbatim: *"Let parents pay online too — **We invoice each parent, collect the payment and process the money to your own account.** You enter your price and keep every pound of it. Parents see one price plus **a small processing fee**."* Every clause is dead: the platform does not invoice the parent for tuition, does not collect it, does not process money to the center's account, and there is no parent-side percentage processing fee (replaced by the flat 10 EGP service fee, which is a *service* fee and rides the parent's tuition invoice). The sweep commit edited the sub-caption underneath ("Needs your InstaPay account") but never touched the paragraph above it. |
| S3 | **Critical** | §01, L542 | Footer disclaimer reads **"Instapay, InstaPay, InstaPay and cards are processed securely by Paymob."** Same botched replacement as S1, and it asserts Paymob-processed *tuition*, which is dead. Paymob's one surviving role is the center's own subscription — correctly drawn in §03 and correctly live. |
| S4 | Medium | §01 `EN · accept payments` | "Set it up" / "Later" CTA pair implies an onboarding payment-account step. No such step exists live and, per §4, no such gate exists at all. |
| S5 | Medium | §02 `AR · RTL · الإعدادات` | The Arabic hub is drawn shorter than its English twin — it omits Scanner (`الماسح`), Notifications (`الإشعارات`), the whole PLAN group (Billing, Referrals), HELP/Support and the version row. The live Arabic hub is a **complete 1:1 mirror** of the English one, so the app is right and the drawing is short. |
| S6 | Low | §07 team list | "Scanner · **Coming soon**" badge in the §02 hub and the seat-add-on price rendered as literal `•• EGP` / `•• ج.م`. Scanner settings ship today; the placeholder price is undrawn pricing, not a design decision. |
| S7 | Low | §09 `EN · Add teacher` | Design draws the short link `thq.eg/t/ALNAHDA`. No such host, route or redirector exists — already documented as deliberately undrawn in `src/components/teachers/AddTeacherPanel.tsx`. Also draws "Or invite by phone", likewise not built. |

### 5c. Dead-model residue previously flagged in this design file — status now

`git log --oneline -3 -- design/Merged-Center-Setup.html` shows the file **was** edited (`af1d995c`). Verified against the current bytes, not the commit message:

| Item | `grep -c` now | Status |
|---|---|---|
| "Verify to enable payouts" (welcome/done screen) | **0** | **Removed.** |
| "Teacher payout requests" notify-me row | **0** | **Removed.** |
| Two team permissions "Withdraw money" / "Change payout account" | **0** / **0** | **Removed**, and the §08 lead now states the opposite explicitly: *"there is no withdrawal right and no payout account to delegate."* |
| §10 lead "…the same rule as a payout destination" | **0** | **Removed.** |
| Arabic settings row `التحقق من الهوية` | **0** | **Removed** — L602/AR slot now reads `حساب إنستاباي`, matching the English `InstaPay account`. |
| `Screen-Center-Team-Verified` variant | **2** | **PARTIALLY present.** The *verified variant* is gone (no verified pill, no "Center team, verified" title, no owner-only warn note — `grep -c "verify"` = 0). What survives is the **filename attribution**, twice: line 16 in the CONTENTS comment and line 1255 in the on-page `mgd-src` label, which renders visibly in the browser as `Screen-Center-Team-Verified.html`. A reader of the rendered file still sees the word "Verified" naming a screen. |

**And the sweep missed an entire frame.** `af1d995c`'s message claims the dead model was swept out; §01 `EN · accept payments` (S1–S3 above) was never opened. `grep -o 'Card'` returns 2 hits — L538 (the dead tuition toggle) and L961 (a legitimate "Card orders" notification row). `grep -o 'Paymob'` returns 6 — L542 (dead: tuition via Paymob) and L703/716/731/797/812 (all legitimate: the center's own subscription, explicitly preserved by NEW-MODEL). So exactly **one** `Card` and **one** `Paymob` occurrence are stale, both inside the one un-swept frame.

---

## 6. Dead-model residue in the LIVE APP

Identity verification, payout destinations and money-out permissions are all still shipping.

### Visible to a centre owner right now

| # | Evidence | What it is |
|---|---|---|
| L1 | `en_checklist.png` — a **"Verification unavailable"** chip renders in the tab strip beside "QR scan" and "Checklist" on `/attendance`. Rendered text confirms it. | Identity verification, on screen, in production, to an owner. Source: `VerificationBadge` + `useVerificationState` → `/api/verification/status`, mounted from `src/app/[locale]/dashboard/page.tsx:22-24,603`. It reads "unavailable" only because the Valify credentials are placeholders and the `verification_records` table does not exist — the component is wired, not removed. |
| L2 | `en_settings_money.png` / `ar_settings_money.txt` — **"Required for credit withdrawals via InstaPay"** / `مطلوب لسحب الرصيد عبر الإنستاباي`. | A payout destination, owner-editable, in Settings. See D2/§4. |
| L3 | `/en/settings/billing` — "Platform balance … You have 0 EGP available", backed by the withdrawal panel at `src/app/[locale]/settings/billing/page.tsx:1116,1974-2080` which gates on `center?.instapay_number`. | Withdraw-money UI to a centre owner. NEW-MODEL: referral credit **"cannot be withdrawn as cash"**, and cash-out is listed under *Still open*. Shipping it ahead of that decision is the divergence. |
| L4 | `can_request_referral_payouts` in the live permission set (`src/components/settings/StaffMemberCard.tsx:18,28`; `src/lib/centerPermissions.ts:11,31`). | A **delegable money-out permission** — precisely the shape the §08 lead says must not exist. `centerPermissions.ts:216` records it true on 1 of 4 rows as of 2026-08-04. Nothing named `can_withdraw`, `withdraw_money`, `change_payout` or `payout_account` exists (grep: **0** matches), so the two *design* permissions were never built — but their cousin was. |

### Not owner-visible, but live in the tree

| # | Path | Note |
|---|---|---|
| L5 | `src/lib/collectionPayout/` — 12 modules incl. `verificationGate.ts`, `payoutEngine.ts`, `requestPayout.ts`, `enableCollection.ts`, `payoutAging.ts`, `payoutCaps.ts`, `payoutStates.ts` | The whole platform-collection-and-payout engine, including a Valify verification gate. Its own header describes gating "online collection" on identity verification — the exact model NEW-MODEL kills. |
| L6 | `src/app/api/payouts/request/`, `api/collection/enable/`, `api/collection/status/`, `api/webhooks/payout-provider/`, `api/cron/payout-reconciliation/`, `api/admin/center-payouts/{route,[id]/approve,[id]/release}` | Nine live route files implementing tuition payouts. |
| L7 | `src/lib/valifyConfig.ts` | Identity-verification vendor config. |
| L8 | `src/lib/teacherFeeReminder.ts:47` — `const PAYMENT_METHODS = ['cash','instapay','vodafone_cash','other']`, with `METHOD_LABEL_AR.vodafone_cash = 'فودافون كاش'` and a `wallet_phone` handle | **Vodafone Cash still ships as a tuition method** in teacher fee-reminder messages, sent by `api/cron/fee-reminders` and `api/teacher/.../send-reminder`. NEW-MODEL: two tuition methods only. This is the same ghost as S1, alive in code rather than in a drawing. |

**Mitigating, and worth saying plainly:** L5–L7 are all fail-closed behind `src/lib/collectionPayout/config.ts`, which ships six placeholder credentials and refuses with a named cause rather than moving money, and `verificationGate.ts` returns `verification_state_not_in_schema` because the identity tables genuinely are not in the database. Nothing here can move a pound today. **But `MethodBadge.tsx` shows the pattern that should have been applied**: its header cites `design/NEW-MODEL.md` and it hard-codes two methods. The collection/payout tree was left standing instead of cut, and L1–L4 are the part of it that reaches a real owner's screen.

---

## Appendix — routes measured

Batch 1 (9/9): `/en/settings` `/ar/settings` `/en/settings/general` `/en/settings/center` `/en/settings/team` `/ar/settings/team` `/en/settings/notifications` `/en/settings/scanner` `/en/settings/support`
Batch 2 (12/12): `/en/settings/notifications` `/en/settings/scanner` `/en/settings/support` `/en/settings/subjects` `/en/settings/account` `/en/settings/money` `/ar/settings/team` `/en/onboarding` `/ar/onboarding` `/en/my-teachers` `/ar/my-teachers` `/en/checklist`
Batch 3 (2/2, added — §03 needs `/settings/billing`, which the route list omitted): `/en/settings/billing` `/ar/settings/money`

`/en/checklist` is a deliberate legacy redirect to `/attendance?tab=checklist` (`src/app/[locale]/checklist/page.tsx`) and draws no frame in this file; it is reported only as the evidence for L1.
