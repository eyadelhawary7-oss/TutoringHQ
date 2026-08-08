# Re-diff — Merged-Center-Attendance.html vs LIVE

**Date:** 8 August 2026 · **Tenant:** Test Center 333 (owner session) · **Server:** localhost:3000 dev
**File:** `/home/user/TutoringHQ/design/Merged-Center-Attendance.html`
**Captures:** `/tmp/rediff/center-attendance/`

---

## 1. Frames drawn

```
$ grep -o 'class="phone"' design/Merged-Center-Attendance.html | wc -l
13

$ awk 'NR<329'  design/Merged-Center-Attendance.html | grep -o 'class="phone"' | wc -l   # §01
5
$ awk 'NR>=329' design/Merged-Center-Attendance.html | grep -o 'class="phone"' | wc -l   # §02
8
```

**13 frames.** 5 (§01) + 8 (§02) = 13.

---

## 2. Screens in file

| # | Name | Source | Frames |
|---|---|---|---|
| 01 | Center Attendance | `Screen-Center-Attendance-Verified.html` | 5 |
| 02 | Attendance Payment Default | `Screen-InstaPay-Attendance.html` | 8 |

Frame captions, in file order:

§01 — `EN · in session` · `EN · tap a name` · `EN · end and bill` · `AR · أثناء الحصة` · `AR · الإنهاء والتحصيل`

§02 — `EN · default, nobody tapped` · `AR · الوضع الافتراضي` · `EN · one student switched to cash` · `AR · طالب واحد اتحوّل كاش` · `EN · cash, still convertible` · `AR · كاش، لسه ينفع يتحوّل` · `EN · InstaPay, locked and explained` · `AR · إنستاباي، مقفول ومكتوب ليه`

---

## 3. Tally

```
Drawn: 13 | Exercisable: 3 | Exercised: 3 | Blocked: 10
```

**Exercised (3)**

| Frame | Live counterpart | Evidence |
|---|---|---|
| §01 `EN · in session` | `/en/attendance?tab=checklist&group=…` roster | `checklist/en_attendance_tab_checklist_group_….png`, `en_picker_open.png` |
| §01 `AR · أثناء الحصة` | `/ar/attendance?tab=checklist&group=…` roster | `checklist/ar_attendance_tab_checklist_group_….png`, `ar_picker_open.png` |
| §01 `EN · tap a name` | `ActionSheet` on name tap | `en_name_sheet.png` |

**Blocked (10)** — all `not-built`

| Frame | Reason |
|---|---|
| §01 `EN · end and bill` | not-built — no end-session/billing sheet exists. DOM probe for `End session` / `Finish attendance` returned false in both locales (`exercise.json → en_globalControls`). |
| §01 `AR · الإنهاء والتحصيل` | not-built — same; `إنهاء الحصة` false. |
| §02 `EN · default, nobody tapped` | not-built |
| §02 `AR · الوضع الافتراضي` | not-built |
| §02 `EN · one student switched to cash` | not-built |
| §02 `AR · طالب واحد اتحوّل كاش` | not-built |
| §02 `EN · cash, still convertible` | not-built — probe `Change to InstaPay` false |
| §02 `AR · كاش، لسه ينفع يتحوّل` | not-built |
| §02 `EN · InstaPay, locked and explained` | not-built — probe `Cannot change to cash` false |
| §02 `AR · إنستاباي، مقفول ومكتوب ليه` | not-built |

3 + 10 = 13.

**No frame was blocked by tooling.** All 10 route captures returned `ok:true`, `redirectedToLogin:false`:

```
batch 1 (6 routes): /en/attendance /ar/attendance /en/scan /ar/scan /en/scanner /ar/scanner
batch 2 (4 routes): measured 4/4 routes -> /tmp/rediff/center-attendance/checklist
```

> Manifest caveat: batch 1 flags `stillSkeleton:true` on all six. This is a **false positive** — the selector matches `animate-pulse`, which in `ScanTab.tsx` is on the live connection-status dot (lines 1221, 1240, 1286, 1293), not a loading skeleton. The PNGs show fully-rendered content. These captures **were** measured.

`/en/scan`, `/ar/scan`, `/en/scanner`, `/ar/scanner` all resolve to `/{locale}/attendance` (`finalUrl` in the manifest) — intentional legacy redirect stubs, by-design.

---

## 4. Divergences ruled AGAINST THE APP (defects)

### D1 · `/{locale}/scanner` serves 200 to an unauthenticated request

`/scanner` is absent from `AUTHENTICATED_ROUTE_PREFIXES` in `/home/user/TutoringHQ/src/proxy.ts` (lines 111–137). `pathRequiresAuthentication` matches on `cleanPath === prefix || cleanPath.startsWith(prefix + '/')`, so the `/scan` entry does **not** cover `/scanner`.

```
/en/attendance -> status=307 redirect='http://localhost:3000/en/login'
/en/scan       -> status=307 redirect='http://localhost:3000/en/login'
/en/scanner    -> status=200 redirect=''
```

Exposure is limited: `src/app/[locale]/scanner/page.tsx` is a client-side redirect stub that renders a spinner and `router.replace`s to `/attendance` (which is protected). The unauthenticated body carries app chrome only, no tenant data. But this is exactly the footgun `CLAUDE.md` names — *"When adding a new app route prefix, you must also add it to `AUTHENTICATED_ROUTE_PREFIXES` or it will appear unprotected."*

### D2 · English plural bug: "1 students need a payment method"

Rendered, `en_picker_open.png` — the amber chip in the summary card reads **`1 students need a payment method`**.

`messages/en.json → checklist.needsMethod = "{count} students need a payment method"` — no ICU plural form. The Arabic twin is correct (`{count} طالب بحاجة لاختيار طريقة الدفع`, rendered as `١ طالب…` in `ar_picker_open.png`).

### D3 · Arabic InstaPay spelling is the odd one out on this screen

`messages/ar.json → checklist.method_instapay = 'انستا باي'` — bare alef, split into two words. Rendered on the method picker in `ar_picker_open.png`.

Non-overlapping census of every InstaPay token in `messages/ar.json`:

```
10  'إنستاباي'
 8  'إنستا باي'
 6  'الإنستاباي'
 1  'انستا باي'
TOTAL 25 · with hamza (إ): 24 · bare alef (ا): 1
```

10 + 8 + 6 + 1 = 25. The single bare-alef spelling is this key, and it is the label a center reads at the moment of recording money. (Separately, the file is already split 10/8 between joined and spaced forms — worth a decision, but that is outside this screen.)

### D4 · "Verification unavailable" badge — confirmed present at diff time

Rendered in the header of `/en/attendance` and `/ar/attendance` (`en_attendance.png`, `ar_attendance.png`, `checklist/*`, `التحقق غير متاح` in AR). Per the brief a separate PR is removing it; reported as **confirmed-present-at-diff-time, not new**.

### D5 · The in-code justification for that badge cites a design element that does not exist

`src/app/[locale]/attendance/page.tsx` lines 61–73 state:

> *"`Merged-Center-Attendance` §01 draws a "Verified" pill in the topbar of all five of its frames…"*

It does not. Just-run against the file:

```
$ grep -c 'class="vbadge"' design/Merged-Center-Attendance.html
0
$ grep -n 'Verified' design/Merged-Center-Attendance.html
9:  01. Center Attendance   <-  Screen-Center-Attendance-Verified.html
157:<div class="mgd-bar">…<span class="mgd-src">Screen-Center-Attendance-Verified.html</span></div>
160:  <div class="pill0">Center attendance · Verified · Draft</div>
```

The `.vbadge` CSS rule is defined (line 52) and **never used in markup**. All three "Verified" hits are the source filename and the board's draft pill — none is inside a phone frame. This matters because that comment is the stated reason the badge occupies the attendance header at all, and verification is dead per SETTLED. The comment should go with the badge.

---

## 5. Divergences ruled AGAINST THE DRAWING (stale design)

### S1 · §01's AR "end and bill" frame encodes the dead 90/10 split and platform payout

The AR frame (lines 310–315) shows:

- `رسم التحصيل (١٠٪)` — collection fee **(10%)**
- `−٧٥` — a deduction
- `تستلم ٦٧٥ ج.م` — **"you receive 675"**

Its own EN twin (lines 245–250) shows the current model: `Processing fee · 5 × 10 = +50`, `Parents are invoiced 800 EGP`. The two frames of one screen contradict each other; the AR one is the pre-6-August model that NEW-MODEL.md kills (90/10 split, platform payouts, percentage markup). Stale.

### S2 · §01's AR footer still promises Thursday settlement

`الإنستاباي يدخل قيد الانتظار، ويُعالَج الخميس` — "InstaPay lands in Pending, **processed Thursday**". EN twin: "InstaPay lands in Pending, **recorded immediately**". Thursday settlement is dead (NEW-MODEL, *What died*). Stale.

### S3 · Both sections call the 10 EGP a "processing fee"

```
$ grep -o "10 EGP processing fee" design/Merged-Center-Attendance.html | wc -l
4
$ grep -o "رسوم معالجة" design/Merged-Center-Attendance.html | wc -l
2
$ grep -oi "service fee" design/Merged-Center-Attendance.html | wc -l
0
```

Six occurrences, zero correct ones. NEW-MODEL.md is explicit: 10 EGP is the **service fee** (parent-funded, one per confirmed receipt); 20 EGP is the **processing fee** (`lib/processingFee.ts`, platform→center only, *"must never be used for a parent charge"*), and conflating them is *"the collision that has already cost this project time once."* The drawings encode exactly that collision, in the copy staff and parents will read. This is the highest-value correction in the file.

### S4 · "bills InstaPayly"

§01 line 176: `Marks the room present and bills InstaPayly` — a find-and-replace artifact of "digitally". One occurrence.

### S5 · §01's "Covered" state assumes a fact the database does not carry

§01 draws a `Covered` chip and a row reading `Monthly plan · paid to 31/07`, plus a note about *"Groups on a monthly plan or a bundle."* Monthly is dead and per-lesson pricing is locked (SETTLED). Verified live against `lczmjpnbuhnsislcvzar`:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='student_groups';
-- 16 columns: id, center_id, name, subject, whatsapp_group_id, created_at,
-- max_capacity, kind, teacher_id, teacher_split_pct, fee_per_class,
-- approval_mode, is_self_enroll_open, status, capacity_cap, center_cut_egp
```

No `billing_type`, no `monthly_fee`, no `bundle_size`. There is no fact that could mark a student covered. The app's decision not to render the chip (documented at `ChecklistTab.tsx` lines 399–410) is **correct** and the drawing is stale.

### S6 · §01 and §02 disagree on which target switches the method

§01's legend: *"Tap the **chip** to switch InstaPay or cash."* §02 (the newer screen, per NEW-FEATURES §1): *"Tap a student if they paid cash."* Two different tap targets for one action inside one file. §02 is authoritative — §01's legend line is stale.

### S7 · §02 cannot mark attendance at all

```
$ awk 'NR>=329' design/Merged-Center-Attendance.html | grep -o 'class="tick' | wc -l
0
```

Zero present/absent controls in all eight §02 frames — rows are name + method pill only. Yet the card reads `7 of 8 present` while only 4 rows render and the pill counts `4 InstaPay`. §02's own numbers do not reconcile, and as drawn the screen replaces §01's roster without being able to do §01's job. It needs §01's box merged in, not to stand alone.

---

## 6. Does §02 "Attendance Payment Default" exist live?

# No. None of it.

Not partially, not behind a flag. Step 1 of the NEW-FEATURES build order is unstarted.

### 6a · InstaPay-as-default — ABSENT

Live, every student on an opened roster starts **`Not marked`** with **no method pill at all**. The summary chip reads `7 not marked`, never `4 InstaPay`.

Rendered proof: `checklist/en_attendance_tab_checklist_group_99e8ff21_b619_4b0d_a368_e38d081cc24c.png` — seven rows, each `Not marked`, no pills.

There is no "mark the room present" action. DOM text probe on the live roster, both locales (`exercise.json`):

```
"Select all": false   "Select All": false   "تحديد الكل": false
"Finish attendance": false   "End session": false   "خلّص التحضير": false   "إنهاء الحصة": false
"Everyone is InstaPay": false
```

The i18n namespace confirms it: `messages/en.json → checklist` has 30 keys and none of them is a select-all, a finish-attendance, or a default-method string.

### 6b · Tap-to-switch-one-student-to-cash — ABSENT, and the thing §02 replaces is what shipped

Tapping a row's box does **not** set InstaPay. It opens the two-button-picker-plus-one that NEW-FEATURES §1 says §02 replaces. Exercised live, first row of Physics 1:

```
en_tappedAria: "Mark Adam Sherif present"
en_pickerOptions: ["Adam Sherif\n#007-0015 · Choose method", "Cash", "InstaPay", "Exempt", "Cancel"]
ar_pickerOptions: ["Adam Sherif\n#007-0015 · اختر الطريقة", "نقدي", "انستا باي", "إعفاء", "إلغاء"]
```

Rendered: `en_picker_open.png`, `ar_picker_open.png` — three equally-weighted dark-teal buttons, no pre-selection, no default.

The code says so in its own words. `src/components/attendance/ChecklistTab.tsx` line 655:

> *"The chip is a state, not a switch — the design's digital/cash toggle is V3."*

And `src/lib/checklist.ts` line 11:

> *"Core rule … nothing is queued until a payment method is chosen. A bare tap with no method maps to a null payload and never calls `queueScan`."*

That is the exact inverse of §02. Live requires an explicit method per student before anything is recorded; §02 requires nothing and records InstaPay for everyone.

The live legend already states the shipped model: `legendMethod = "Then pick <b>how they paid</b>"` (EN) / `"ثم اختر <b>طريقة الدفع</b>"` (AR).

### 6c · The one-way lock — ABSENT at every layer

**UI:** no post-session method-change surface exists. Probes `Change to InstaPay` and `Cannot change to cash` both false in both locales. No such string exists in `messages/en.json` or `messages/ar.json`.

**Guard code:** none. Search across `src/` and `messages/` for `cannot change to cash | one-way | instapay_to_cash | cash_to_instapay | changeToInstapay | switchMethod | methodLocked | lockedMethod` returns six hits, all unrelated (a teacher onboarding-checklist latch, the teacher settings `toggleMethod`, a verification-route comment, `teacher/profile` dismiss latch, a `valifyClient` hash comment).

**Database:** verified live against `lczmjpnbuhnsislcvzar`.

`attendance_scans` has 17 columns. `payment_method text` **exists** — so the storage half of *"a payment method on the attendance record"* is there — but:

```
payment_method | data_type: text | column_default: null | is_nullable: YES
```

**No default of `'instapay'`.** And no guard:

```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.attendance_scans'::regclass;
```

Ten constraints. The three CHECKs are on `method` (`qr|tap|confirm`), `payment_status_at_scan` (`paid|unpaid`) and `status` (`present|absent`). **None on `payment_method`** — no value restriction, let alone a transition rule. Two triggers exist, both `AFTER INSERT` (`trg_recalc_lifecycle_on_scan`, `trigger_resolve_inactivity_on_scan`); there is **no `BEFORE UPDATE` trigger**, so nothing can refuse an InstaPay→cash edit.

**The fee that makes the guard enforceable does not exist either.** NEW-FEATURES §1: *"The fee attaches at invoice creation, not at method selection, which is what makes the guard enforceable."* There is no 10 EGP service-fee constant anywhere in `src/lib/` — the only service-fee constants are `parentPack.ts`'s `PACK_SERVICE_FEE_RATE = 0.06` and `BLAST_SERVICE_FEE_RATE = 0.06`, unrelated. `src/lib/processingFee.ts` is the 20 EGP platform fee and carries its own warning against being used for a parent charge.

### Verdict

`attendance_scans.payment_method` is the only piece of §02 present, and it is an inert column with no default and no constraint. Everything §02 specifies — the InstaPay default, the one-action room marking, the tap-to-cash switch, the one-way transition guard, and the on-screen reason for the block — is unbuilt. Since NEW-FEATURES names this step 1 and says *"everything downstream depends on a payment method existing on the record,"* steps 2–4 (invoice with the 10 EGP line, parent upload, view-and-confirm) have no foundation yet.

**Before building it, fix the drawing.** §02 as drawn cannot mark attendance (S7) and calls the 10 EGP a processing fee in four English and two Arabic strings (S3). Building §02 literally would ship the fee-name collision NEW-MODEL.md warns about, into the copy a parent reads on an invoice.

---

## Appendix · what was measured

| Artefact | Value | How |
|---|---|---|
| Frames in file | 13 (5 + 8) | `grep -o 'class="phone"' … \| wc -l` |
| Routes captured | 10, all `ok:true`, 0 login-redirects | `_manifest.json` ×2 |
| Test Center 333 | 7 groups, 16 students, 146 attendance_scans | live SQL |
| Physics 1 (roster used) | 7 members, 600 EGP/session | live SQL |
| `attendance_scans` | 17 columns, `payment_method` default NULL, 0 CHECKs on it, 0 BEFORE-UPDATE triggers | live catalog |
| `student_groups` | 16 columns, no billing-basis column | live catalog |
| InstaPay tokens in `ar.json` | 25 (24 hamza, 1 bare) | non-overlapping regex census |
| "10 EGP processing fee" in design | 4 EN + 2 AR = 6; "service fee" = 0 | `grep -o … \| wc -l` |
| `class="vbadge"` in design markup | 0 | `grep -c` |
| §02 present/absent controls | 0 | `awk NR>=329 \| grep -o 'class="tick' \| wc -l` |

Scratch scripts used to exercise the live screen (`exercise.mjs`, `exercise2.mjs`) live in `/tmp/rediff/center-attendance/` and touch no repository file.
