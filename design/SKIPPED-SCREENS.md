# Skipped screens — what was passed over, and why

**Standing instruction, 28 July:** *"When you next hit a screen blocked on one of my
three open decisions, do not queue behind it. Skip it, note it, and keep going. I
would rather have a list of skipped screens than a stalled build."*

This is that list. One row per screen that was reached in build order and not built.
Every reason here is **verified**, not assumed — against `information_schema.columns`
for storage claims, against the code for behaviour claims.

A screen leaves this list when the blocking fact changes, not when someone feels
differently about it.

---

## Why a screen gets skipped

| Reason | Meaning |
|---|---|
| **No storage** | The design's control has no column. Building it means a migration, which is Eyad's call |
| **Money** | Renders or changes a money figure. Eyad's line is behaviour, not file — money comes to him |
| **Write** | Introduces a write, or changes what gets written |
| **Entitlement** | Gates on a plan, seat or verification state |
| **Ruled out** | A settled decision says the design is wrong here |
| **Verification** | Blocked on Valify / Adsero |

---

## Phase D

### `Merged-Center-Setup`

| § | Screen | Reason | Detail |
|---|---|---|---|
| 05 | Notifications | **No storage** | The whole preference model is absent. No column anywhere for the six "notify me about" categories, the Push/Email channel split, or the quiet-hours window. The only `notify_*` columns are `students.notify_on_absence`, `notify_on_balance`, `notify_on_scan` — those are **per-student parent** toggles controlling what a *parent* receives, not what the owner does. Different feature, not a partial one |
| 06 | Scanner | **No storage** + **Write** | `centers` carries exactly one scanner column, `scanner_default_mode` (`'camera'` default), which live already exposes. Nothing exists for camera facing, sound, vibrate, or the "ignore repeat scans within 5 min" window. Separately, **"Mark attendance automatically" changes what gets written** to `attendance_scans`, so it is Eyad's regardless of storage |
| 07 | Team seats | **No storage** + **Entitlement** | No column matching `%seat%` in any table. `pricing_plans` has no seat allowance. The design itself says the price is *"still to be set"* |
| 08 | Team Verified | **Verification** | Verified state end to end |

**Buildable in this file and not yet reached:** §01 Onboarding, §02 Settings,
§04 Center & Subjects, §09 My Teachers. §03 Settings Billing is **money**.

### `Merged-Center-Insight`

| § | Screen | Reason | Detail |
|---|---|---|---|
| 01 | Analytics | **Money** | MRR, month-end forecast, projected revenue, collection rate, P&L, aging |
| 03 | Referrals | **Ruled out** + **Money** + **Verification** | The design's rate ladder is **25% month 1 / 10% months 2–6 / 5% month 7+**. Live is **10% for twelve months**, and the 26 July decision settled it: *"People have been told a rate, so live wins and the design is wrong"* — already logged as design correction **D2**. The rest of the screen is recurring income, lifetime earned, a next-month projection, and a **withdraw-to-bank vs in-app-credit split gated on identity verification**. Almost nothing on it is layout |

§02 Benchmarks was **built** — #189.

### `Merged-Center-Orders`

| § | Screen | Reason | Detail |
|---|---|---|---|
| 01–03 | Orders, Detail, Checkout | **Money** | Price summary and a four-step checkout |
| 04 | Coming Soon | **No storage** | The notify-me registration has no destination. The only waitlist table is `waitlist_notifications (student_id, group_id, notified_at, response)` — the *group* waitlist, unrelated |

---

## Phase B — skipped wholesale

`Merged-Public-App`, `Merged-Lifecycle` and `Merged-Verification-Payouts` are three of
the **six protected money-and-auth files** and are never touched. Phase B is 18 screens
and none of it is available, which is why the build ran A → C/D rather than A → B.

---

## Earlier phases

| File | § | Reason |
|---|---|---|
| `Merged-Center-Home` | 01 Dashboard Verified | **Verification** — the entire screen is the verified state |
| `Merged-Center-Students` | 03 Students Verified | **Verification** |
| `Merged-Center-Attendance` | 01, 02 | **Verification** — the whole file. Digital/cash chip, collection-fee summary, payment links, and the Collect-For-Me opt-in itself |
| `Merged-Center-Groups` | 02 Groups Verified | **Ruled out** — 26 July decision locks the billing basis to `fee_per_class` only. The parent-price column is additionally verification-blocked |
| `Merged-Center-Groups` | 04 Branches | **Money** — `POST /api/branches` creates a **billable center**, copying `plan`, `billing_type`, `billing_amount` and `all_in_price` from the parent |
| `Merged-Center-WhatsApp` | 01 Templates | **No storage, effectively** — `center_message_templates.auto_send` exists but the table is **empty and referenced by no file in `src/`**. The live screen reads `wa_meta_templates` (45 rows), a different concept. Adopting the orphan table is a feature decision |
| `Merged-Center-WhatsApp` | 02, 03 | **Ruled out** — deferred as B5. Live is a per-parent monthly pack; the design is a one-time credit model |

---

## What unblocks what

| Eyad decides | Releases |
|---|---|
| `demo_requests` migration (`area`, `student_count`) | `Public-Marketing` §04 Lead Capture |
| WhatsApp auto-send: adopt the orphan table or drop the toggle | `Center-WhatsApp` §01 |
| Team seats: seat model and price | `Center-Setup` §07 |
| Card-order notify-me: where the write goes | `Center-Orders` §04 |
| Teacher referral model | `Teacher-Insight` §02 |
| A notification-preference model | `Center-Setup` §05 |
| Scanner preferences: which are per-centre and which are per-device | `Center-Setup` §06 |
| Adsero / Valify | 10 screens across 7 files |

**Needs no decision, only time:** `/admin/teachers` and `/admin/teachers/[id]` — the
data exists, the routes do not.
