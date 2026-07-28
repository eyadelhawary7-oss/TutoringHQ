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
| 05 | Notifications | **No storage** — *decided 28 July: do not build* | The whole preference model is absent. No column anywhere for the six "notify me about" categories, the Push/Email channel split, or the quiet-hours window. The only `notify_*` columns are `students.notify_on_absence`, `notify_on_balance`, `notify_on_scan` — those are **per-student parent** toggles controlling what a *parent* receives, not what the owner does. Different feature, not a partial one. Eyad: *"Do not build a preference model to satisfy a restyle."* Logged as **B15**; live screen untouched |
| 06 | Scanner | **No storage** + **Write** — *decided 28 July: do not build* | `centers` carries exactly one scanner column, `scanner_default_mode` (`'camera'` default), which live already exposes. Nothing exists for camera facing, sound, vibrate, or the "ignore repeat scans within 5 min" window. Separately, **"Mark attendance automatically" changes what gets written** to `attendance_scans`, so it is Eyad's regardless of storage. Logged as **B16**; live screen untouched |
| 07 | Team seats | **No storage** + **Entitlement** | No column matching `%seat%` in any table. `pricing_plans` has no seat allowance. The design itself says the price is *"still to be set"* |
| 08 | Team Verified | **Verification** | Verified state end to end |

#### §04 Center details & Subjects — center half is FAITHFUL, grades half is blocked

Surveyed 28 July. **The Center details half needs no work.** The design asks for logo, centre name,
area/city, contact phone; live `/{locale}/settings/center` already has logo, name, phone, **governorate
and district** — the last two together being the design's "Area / city". It reads and writes
`centers.district`, so the Benchmarks screen's *"set your district in settings"* prompt does lead
somewhere real.

Two design elements do not land, neither worth building:

- **Street address.** The only address column is `centers.delivery_address`, and it is **`jsonb` for
  card-order shipping**, not a display address for families. Repurposing it would be the same class of
  mistake as reusing the parent `notify_*` toggles for owner preferences. `centers.city` exists as
  plain text and is unexposed, but city is already covered by governorate + district.
- **"Manage branches · 3"** — a link to `Center-Groups` §04, which is **money**: `POST /api/branches`
  creates a billable centre.

**The Subjects half is blocked.** Subjects CRUD exists and matches. **Grades do not.** The design says
*"Only the grades you turn on show up in student sign-up"*, which needs a per-centre enabled-grades
list. Verified: `grade_level` exists only as **free text on `students` and `group_proposals`**, plus an
array on `teacher_profiles.grade_levels`. There is **no per-centre grades configuration anywhere** —
nothing to turn on or off. Same shape as §05 and §06: a restyle that quietly requires a new model.

**Still to survey in this file:** §01 Onboarding, §02 Settings, §09 My Teachers.
§03 Settings Billing is **money**.

### `Merged-Center-Insight`

| § | Screen | Reason | Detail |
|---|---|---|---|
| 01 | Analytics | **Money** | MRR, month-end forecast, projected revenue, collection rate, P&L, aging |
| 03 | Referrals | **Not a restyle — reclassified as a feature, 28 July** | See below |

§02 Benchmarks was **built** — #189.

#### §03 Referrals — out of the layout queue entirely

**Eyad's ruling, 28 July:** *"With the 25/10/5 ladder stripped per D2, what remains is money plus a
verification gate. It is not a restyle, it is a feature, and it goes to me."*

It arrived in build order looking like a restyle — `/{locale}/referrals` is live and the design is a
referrals screen. It is not one. Taking it apart:

| The design shows | Status |
|---|---|
| Rate ladder **25% month 1 / 10% months 2–6 / 5% month 7+** | **Ruled out.** Live is **10% for twelve months**. The 26 July decision: *"People have been told a rate, so live wins and the design is wrong."* Logged as design correction **D2** |
| Recurring this month · next month (est.) · lifetime earned | **Money** |
| Per-referral: current %, monthly pay, days until it drops | **Money**, and the countdown is against a ladder that does not exist |
| **Withdraw to bank vs use as in-app credit** | **Money** + **verification-gated** — *"Identity verified · withdraw to your bank or spend as credit"* vs *"Verify to unlock"* |
| Share link and code | The only layout-shaped element on the screen |

Remove what is ruled out and what is money, and one share button is left. **Building it is designing a
new earnings product, not restyling an existing one.** It belongs with **B8** (referral earnings:
credit versus withdrawal), which already covers the withdraw/credit half.

The verified data does exist for a *display* of the live 10%/12-month arrangement —
`referral_commissions` carries `commission_rate`, `period_month`, `months_since_activation`,
`referred_plan_fee` and `commission_amount`. That is a money screen and Eyad's to specify, not a gap
to fill from the design.

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
| A per-centre enabled-grades list | `Center-Setup` §04, subjects half |
| Adsero / Valify | 10 screens across 7 files |

**Answered 28 July — do not build, logged and closed:** a notification-preference model
(`Center-Setup` §05 → **B15**) and scanner behaviour preferences (`Center-Setup` §06 → **B16**). Both
live screens are left exactly as they are.

## A pattern worth naming

Four Phase D screens — §04 grades, §05, §06, and `Center-Orders` §04 — look like restyles and are not.
Each renders one or two controls whose storage does not exist, so "make it match the design" silently
means "design and build a new model". The tell is always the same: **a toggle or a chip with nothing
behind it.** Checking the catalog before starting is what separates a restyle from a feature, and it
costs one query.

**Needs no decision, only time:** `/admin/teachers` and `/admin/teachers/[id]` — the
data exists, the routes do not.
