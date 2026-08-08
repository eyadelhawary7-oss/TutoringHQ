# Re-diff — Merged-Lifecycle.html vs LIVE app

**File:** `/home/user/TutoringHQ/design/Merged-Lifecycle.html` (PROTECTED — not modified)
**Scratch:** `/tmp/rediff/lifecycle`, `/tmp/rediff/lifecycle-b2`
**Date:** 8 August 2026 · Tenant: Test Center 333 (owner session, `/tmp/state333.json`)
**Tenant mutations performed: NONE.** No suspend, blacklist, or billing write was issued.

---

## 1. Frames drawn — command output

```
$ grep -o 'class="phone"' design/Merged-Lifecycle.html | wc -l
18
```

Per-section, from a single pass over the file:

```
$ awk '/id="S-1"/{s=1} /id="S-2"/{s=2} /id="S-3"/{s=3} /id="S-4"/{s=4} \
       /id="S-5"/{s=5} /id="S-6"/{s=6} \
       {n=gsub(/class="phone"/,"&"); if(n>0) c[s]+=n} \
       END{t=0; for(i=1;i<=6;i++){print "S-"i": "c[i]; t+=c[i]} print "TOTAL: "t}' \
       design/Merged-Lifecycle.html
S-1: 5
S-2: 4
S-3: 2
S-4: 2
S-5: 2
S-6: 3
TOTAL: 18
```

---

## 2. All 6 screens — frames per section

| § | Name | Frames | The drawn states |
|---|---|---|---|
| 01 | Lifecycle Access | 5 | EN set PIN · EN set PIN revealed · EN accept invite · AR set PIN · AR set PIN revealed |
| 02 | Lifecycle States | 4 | EN suspended · EN reactivate · EN session expired · AR suspended |
| 03 | Lifecycle Status | 2 | EN status · AR status |
| 04 | Center Resubscribe | 2 | EN reactivate · AR reactivate |
| 05 | Teacher Resubscribe | 2 | EN trial ended · AR trial ended |
| 06 | Coming Soon | 3 | EN coming-soon screen · EN locked entry row · AR coming-soon screen |

**5 + 4 + 2 + 2 + 2 + 3 = 18** — matches the total above.

---

## 3. Exercise tally

```
Drawn: 18 | Exercisable: 5 | Exercised: 5 | Blocked: 13
```

`5 + 13 = 18`. Blocked splits **no-data 5 · tooling 3 · credential 2 · not-built 3** (`5+3+2+3 = 13`).

### Exercised (5)

| Frame | Route | Evidence |
|---|---|---|
| §02 EN suspended | `/en/suspended` | `en_suspended.png` |
| §02 AR suspended | `/ar/suspended` | `ar_suspended.png` |
| §02 EN session expired | `/en/session-expired` | `en_session_expired.png` |
| §03 EN status | `/en/status` | `en_status.png` |
| §03 AR status | `/ar/status` | `ar_status.png` |

### Blocked (13) — every frame named

**`no-data` — 5 frames (§01, all of them)**

| Frame | Route reached | State the frame needs |
|---|---|---|
| §01 EN set PIN | `/en/set-pin` rendered the **"Get a Set-PIN link"** fallback | A live `chq_pin_setup_link` token in `?t=`, **or** a `chq_signup_session` cookie for a paid + activated signup. Without either, `page.tsx` deliberately serves the request-a-link form, never the keypad. |
| §01 EN set PIN revealed | same | same, plus 2+ digits entered |
| §01 AR set PIN | `/ar/set-pin` — same fallback | same |
| §01 AR set PIN revealed | same | same |
| §01 EN accept invite | `/en/accept-invite` rendered **step 1: phone + "Send OTP"** | A pending team invite for the phone entered, then a verified OTP. The drawn "You're invited / Accept & join / Decline" card is the post-verification state. |

**`tooling` — 3 frames (§02 EN reactivate, §04 EN, §04 AR)**

`/en/reactivate` and `/ar/reactivate` **redirected to `/{locale}/login`** on every attempt — 3 of 3 across two batches (`finalUrl=/en/login`, `redirectedToLogin=true`). The page's `authHeader()` calls `supabase.auth.getUser()` and sends the visitor to `/login` when it returns no user; the same storage state authenticated `/suspended` successfully in the same run, so this is a capture-session artifact, not a product state. **NOT MEASURED.**

Stated plainly so this is not read as more than it is: even with working auth these frames would still be blocked, and then as `no-data` — `/api/reactivate/info` returns `400 "Center is not suspended"` unless `centers.status='suspended'`, and a further `400 "Missing suspension timestamp"` unless `centers.suspended_at` is set. Test Center 333 has `status='active'` and would fail the first gate.

**`credential` — 2 frames (§05 EN, AR)**

`/en/teacher/resubscribe` → `/en/dashboard`; `/ar/teacher/resubscribe` → `/ar/dashboard`. `src/app/[locale]/teacher/(portal)/layout.tsx:50-52` redirects any `users.role !== 'teacher'` to `/dashboard`. We are the centre **owner**. Needs a teacher-role account whose subscription is neither `trialing` nor `active`.

**`not-built` — 3 frames (§06, all of them)**

`src/components/shared/ComingSoon.tsx` exists and its docblock cites *"`Merged-Lifecycle` §06"* — but it has **zero render call sites**:

```
$ grep -rn "ComingSoon" src/ --include=*.tsx --include=*.ts
src/components/shared/index.ts:14:export { default as ComingSoon } from './ComingSoon';
src/components/shared/ComingSoon.tsx:22:export default function ComingSoon({
src/components/orders/CardOrdersTeaser.tsx:10: * `ComingSoon` card at this one gate - `ComingSoon` stays generic for every
src/components/teacher/TeacherPlanSection.tsx:74:          toast.info(t('intervalComingSoon'));
```

One definition, one re-export, one prose mention, one unrelated i18n key — no `<ComingSoon …>` anywhere. There is no route that renders it, so no screenshot is obtainable.

The **locked entry row** is documented as deliberately unbuilt in the component's own docblock: *"Not built alongside it: the design's locked list row… hidden-versus-locked is a decision about whether to advertise a feature we do not have yet."*

The one live "coming soon" surface is `src/components/orders/CardOrdersTeaser.tsx`, which serves `Merged-Center-Orders` §04, not §06.

### Routes measured that have no drawn frame in this file

`/ar/session-expired`, `/en/offline`, `/ar/offline` all rendered cleanly but §02 draws only an **EN** session-expired frame and this file draws **no offline frame at all**. Reported below as a divergence against the drawing, not scored above.

---

## 4. Do the live lock/suspend screens match the drawing, and are the reason codes handled?

### The reason codes line up exactly

`src/proxy.ts` emits three lock redirects:

| Line | Redirect | Reason |
|---|---|---|
| 386 | `${suspendedPath}?reason=center_suspended` | `centers.status === 'suspended'` |
| 405 | `${suspendedPath}?reason=payment_overdue` | `isCenterLockedForEnforcement(...)` under an active lockout policy |
| 430 | `${suspendedPath}` — **no reason param** | `subscriptions.status === 'suspended'` fallback |

`suspended/page.tsx:60-61` reads exactly `center_suspended` and `payment_overdue`; anything else (including absent) falls to a default branch. **All three middleware paths are handled — there is no unhandled reason code.**

### But the screen barely reacts to them

I exercised both reason codes by URL alone (no tenant write). `/en/suspended`, `?reason=center_suspended` and `?reason=payment_overdue` produced **byte-identical body text**, all three 244 chars:

> Account temporarily suspended / Your subscription payment is overdue. Please pay to restore full access.

`t('title')` and `t('desc')` are reason-independent. The reason only switches four secondary things: the invoice card, the WhatsApp prefill, the CTA target (`/pay` vs `/reactivate`), and Fawry visibility. So a centre suspended by an **admin action** is still told *"Your subscription payment is overdue"* — the screen asserts a payment cause for a non-payment suspension.

### Reason-specific copy is authored but never wired

Eight `suspended.*` keys exist in `messages/` with **zero references anywhere in `src/`** — each checked individually:

`suspendedHeading`, `suspendedSubtitle`, `centerSuspendedTitle`, `centerSuspendedMessage`, `overdueMessage`, `goToBilling`, `renewButton`, `contactUs`

Two of those are precisely what the drawing asks for: `centerSuspendedTitle` = *"Your Account Has Been Suspended"* is the per-reason headline the screen is missing, and `goToBilling` = *"Go to Billing"* is the drawn CTA label. The copy was written; the component never reads it.

### Screen-by-screen against §02

| | Drawing | Live | Verdict |
|---|---|---|---|
| Suspended icon | Red padlock in `#f4e5e2` tile | Amber `!` in a circle | differs |
| Status pill | "Suspended" pill | none | missing |
| Headline | "Your center is paused" | "Account temporarily suspended" | differs |
| Primary CTA | "Go to billing", teal `#0E6B61` | "Pay now", **orange** | differs — colour and label |
| Secondary | "Contact support" | "Contact support" (WhatsApp) | matches |
| Third action | — | "Logout" | extra |
| Reassurance | copy only | students/groups summary card | extra, and see §6 |
| Session expired | clock icon, brass tint, "Sign in again" | clock icon, **teal** tint, "Log in again" | close match; tint + label differ |

`/en/session-expired` is the **closest match in the file** — same layout, same icon, same one-button structure.

### The Fawry ref code is correct per NEW-MODEL but currently unreachable

NEW-MODEL keeps the Fawry ref code on `/suspended`, and the code is still there (`suspended/page.tsx:162-166`). It is not stale model and I am not reporting it as such. It is, however, **unreachable today**, for two independent reasons:

1. It renders only when the reason is neither `center_suspended` nor `payment_overdue` — i.e. only via the bare line-430 redirect.
2. It reads `subscriptions.fawry_reference`, and the `subscriptions` table is **empty platform-wide**:

```sql
select count(*) as total_subs,
       count(*) filter (where fawry_reference is not null) as with_fawry
from subscriptions;
-- total_subs = 0, with_fawry = 0
```

The same emptiness means the line-430 middleware branch can never fire either. Classified `no-data`, not dead code.

---

## 5. `centers.status` vs `centers.subscription_status`

**I read `src/proxy.ts` rather than trusting the column name, and the warning holds.**

The middleware's centre read selects five columns and `subscription_status` is not among them:

```
src/proxy.ts:360
  .select('status, billing_status, auto_suspend_at, next_payment_due, is_blacklisted')
```

The lock branches on `center?.status === 'suspended'` (line 384). The separate subscription check (lines 422-435) queries the **`subscriptions` table**, not the similarly-named column on `centers`.

Catalog — both columns are real, both default `'active'`, and `subscription_status` is `NOT NULL`:

| column | type | default | nullable |
|---|---|---|---|
| `status` | text | `'active'` | YES |
| `subscription_status` | text | `'active'` | **NO** |

Test Center 333:

```
status = 'active'   subscription_status = 'suspended'
billing_status = 'paid'   is_blacklisted = false
auto_suspend_at = 2026-07-29   next_payment_due = 2026-10-27
subscriptions rows for this center_id = 0
```

So all three gates pass it: line 384 sees `active`; the overdue check sees `billing_status='paid'` with `next_payment_due` three months out; and line 422's fallback is skipped outright because it is guarded by `center?.status !== 'active'`. **Test Center 333 is not suspended in any sense the app acts on**, exactly as briefed — confirmed independently, not assumed.

### The open question: does `subscription_status` have any live reader?

**Yes — it is emphatically not dead.** It is a genuine third source of truth. Twelve filter-reads across nine files:

```
$ grep -rn "\.\(eq\|in\|neq\|gt\|lt\)('subscription_status'" src/ --include=*.ts --include=*.tsx | wc -l
12
```

| File | Use |
|---|---|
| `src/app/api/ceo/financials/route.ts:118` | `.in(['active','overdue'])` |
| `src/app/api/ceo/dashboard/route.ts:37` | `.in(['active','overdue'])` **and** `.eq('status','active')` — reads both columns in one query |
| `src/app/api/ceo/command-strip/route.ts:77` | `.eq('active')` |
| `src/app/api/admin/renewals/route.ts:88` | `.in(['active','overdue','suspended'])` |
| `src/app/api/cron/daily-summary/route.ts:336` | `.eq('active')` |
| `src/app/api/cron/parent-absence-alerts/route.ts:62` | `.eq('active')` |
| `src/app/api/cron/parent-balance-alerts/route.ts:45` | `.eq('active')` |
| `src/lib/nudges/store.ts:142` | `.eq('active')` |
| `src/lib/whatsapp/flows/ceoBriefing.ts:100,102,104,113` | four filters |

**The operational consequence, for this tenant specifically.** Test Center 333 is fully usable in the UI (`status='active'`) yet carries `subscription_status='suspended'`, so it is silently excluded from every outbound automation gated on `subscription_status='active'` — daily summary, parent absence alerts, parent balance alerts, and nudges. A centre in this split state works perfectly for its owner and quietly sends nothing. Nothing surfaces the contradiction.

`ceo/dashboard/route.ts:37` is the sharpest illustration: it filters on both columns in a single call, so it is already treating them as two independent facts.

Worth noting the codebase knows the columns drift: `proxy.ts:418-421` carries a comment explaining that a *"stale `subscriptions.status='suspended'` row must NOT keep redirecting the owner"* — the drift was handled for the `subscriptions` table but the `centers.subscription_status` column has no equivalent reconciliation.

---

## 6. Divergences AGAINST THE APP

Things the live app gets wrong or does that the drawing would not sanction.

**A. `/suspended` reports 0 students and 0 groups for a centre that has 16 and 7.**
The screenshot shows "Total students **0** / Total groups **0**". The catalog disagrees:

```sql
select (select count(*) from students where center_id='fcd5c5ef-…') as students,
       (select count(*) from student_groups where center_id='fcd5c5ef-…') as groups;
-- students = 16, groups = 7
```

Root cause in the render path — `suspended/page.tsx:51`:

```ts
setSummary({ students: studentsRes.count ?? 0, groups: groupsRes.count ?? 0 });
```

A failed or blocked count is `null`, and `?? 0` turns it into a confident **0**. Why the count came back null (stale capture token vs RLS) is not established and I am not claiming it — but the coalesce is wrong either way: it makes "we could not read this" indistinguishable from "you have none", on the one screen whose job is to reassure an owner their data survived. The drawn §04 equivalent says *"Your students, teachers, groups, and full history are safe."*

**B. `/status` understates uptime by dividing by 90 regardless of how many days were measured.**
The captured page reads **API 3.33%, Scanner 0%, Payments 3.33%** with an overall banner of "Degraded". `src/app/api/status/route.ts:54` always emits exactly 90 day buckets, filling unmeasured days with `'unknown'`:

```ts
for (let d = 0; d < 90; d++) { … uptimeByDay[dayStr][s] = worst; }
```

The client then divides by every bucket (`status/page.tsx:57`):

```ts
return (operationalDays / dayKeys.length) * 100;
```

`dayKeys.length` is always 90, so a service healthy on all 3 days it was actually observed reports 3.33%. Days with no data count as downtime. This is a public status page — it currently tells the world the platform is at 3% uptime.

**C. Dead placeholder in the same function returns a comma, not an em dash.**
`status/page.tsx:67`, under a comment reading *"em dash when there is no day-level history yet"*:

```
$ sed -n '60,69p' src/app/[locale]/status/page.tsx | cat -A | grep -n return
8:  if (dayKeys.length === 0) return ',';$
```

`cat -A` shows a bare ASCII comma with no UTF-8 em-dash bytes. Unreachable in practice (the API always returns 90 keys), so this is latent, not live — but it is wrong where it sits.

**D. `/offline` — low-contrast scanner note.**
`offline/page.tsx:39` puts `text-teal-300` on `bg-teal-900/20`. Since the teal scale was remapped for the cream surface (`globals.css:529-534` records the removal of the old `.text-teal-400/300` patches in favour of source-level mapping), both now resolve to light tints, so the text sits pale-on-pale. Visible in `en_offline.png`. Unlike `text-white` and `text-slate-3/400`, teal has **no** remediation shim, so nothing rescues it.

**E. `/reactivate` tier copy still promises fees the engine no longer charges.**
`getReactivationAmount` (`src/lib/billingEngine.ts:71-82`) was deliberately neutered to the single-day lock model and returns `fine: 0, reactivationFee: 0, total: nextPeriodAmount`, breakdown `'Plain subscription (no reactivation fee)'`. The screen renders `t('tier.' + info.tier)`, and those strings were never updated:

```
en  tier1: "Within 30 days (small late fee)"
    tier2: "30 to 90 days (3% reactivation fee)"
ar  tier1: "خلال 30 يوماً (غرامة بسيطة)"
    tier2: "بين 30 و 90 يوماً (3% رسوم إعادة تفعيل)"
```

A returning owner is told they owe a late fee or 3%, while the engine bills zero. This contradicts the engine **and** the drawing's *"No reactivation fee."* Money copy on a payment screen.

**F. `/set-pin` renders inside the full authenticated dashboard shell.**
`en_set_pin.png` shows the hamburger, notification bell, cart, sidebar and the Home/Students/Attend/Fees bottom bar wrapped around the PIN form. The drawing gives §01 a clean full-screen with a single back chevron. A credential-setup screen carrying the whole app's navigation is the wrong chrome for the moment.

**Checked and cleared — not a divergence.** `/suspended` and `/offline` both use `text-white` / `text-slate-400` over `--color-surface-0`, which is `#ece8df` cream. That looks like white-on-cream, but `globals.css:1244` maps `.text-white` to `--color-text-primary` and `:525-527` maps the slate greys to `--color-text-muted`. The screenshots confirm dark ink on cream. The shim is doing the work — the markup is still dark-theme markup — but nothing is broken today. Flagged because it is a latent trap, not a live bug.

---

## 7. Divergences AGAINST THE DRAWING

Things the drawing asks for that the app does not do.

**A. §06 Coming Soon is drawn but unreachable — all 3 frames.**
Component built and documented against §06; zero call sites; no route renders it. The locked entry row is explicitly deferred by design decision (hidden-vs-locked), which is a reasonable answer, but the two full-screen frames have no such justification.

**B. §01 draws a custom 12-key numeric keypad; the app has none.**
`SetPinClient.tsx` uses six `<input maxLength={1} inputMode="numeric">` boxes and relies on the OS keyboard — a grep for rendered digit keys / `grid-cols-3` returns nothing. The drawn 1-9 / 0 / backspace pad does not exist. The **reveal eye does** (`Eye`/`EyeOff`, `show` state, `type={show ? 'text' : 'password'}`), matching the drawn `pineye`, though the live control also carries a text label.

**C. §03 draws 5 services; the app ships 3.**
Drawn: App & dashboard · Attendance · Payment recording · WhatsApp messages · Sign-in. Live `SERVICES`: **API · Scanner · Payments**. Attendance, WhatsApp and Sign-in are not represented, and "API"/"Scanner" are engineering names rather than the drawing's user-facing ones.

**D. §03 incident section differs in window and framing.**
Drawn: "RECENT INCIDENTS" + *"No other incidents in the last 30 days."* Live: "Last 5 Incidents" + "No incidents recorded". Live also adds a **90-day uptime history grid** the drawing does not contain.

**E. §04 draws a Monthly | Annual toggle; `/reactivate` has none.**
The drawn frame carries a segmented control plus *"Switch to annual and get 2 months free"*. The live page renders a flat plan list keyed off the centre's existing `billingPeriod` with no period switch. (Live `/teacher/resubscribe` **does** have the toggle with a "2 months free" badge — so the pattern exists in the codebase, just not on the centre path.)

**F. §05 draws three teacher plans; the app has one.**
Drawn: Standard 499 · Pro 999 (Popular) · Scale 2,499, each with a feature list. Live is documented as *"One fixed plan (teacher_standard, price from platform_config)"*. The drawn Pro/Scale tiers and their feature bullets have no live counterpart.

**G. §05 draws an EGP referral credit; the app shows free months.**
Drawn: *"You have **900 EGP** referral credit. It applies at checkout."* Live renders `status.free_months_credit` through `t('freeMonths', …)` with a gift icon — a **count of months**, not a currency balance. Different unit for the same idea.

**H. §05 "Analytics & verified collection" is stale against NEW-MODEL.**
The drawn Pro feature bullet reads *"Analytics & verified collection"* (AR: *"التحليلات والتحصيل الموثّق"*). NEW-MODEL retires identity verification and platform collection outright, and its rule is explicit: *"Never claim the platform verified a payment."* This is a **drawing** defect, not an app one — the app does not render the phrase.

**I. §02's suspended/reactivate split does not exist live.**
The drawing gives suspended and paused-and-reactivatable two distinct screens with different icons, pills, headlines and CTAs. Live, `/suspended` shows one headline for every reason, and `/reactivate` is a separate plan-picker rather than the drawn "Welcome back / Reactivate center / Sign out" card.

**J. `/offline` and `/ar/session-expired` are live screens with no drawn frame.**
`/en/offline` and `/ar/offline` render a complete, translated offline state (including the scanner-works-offline note). §02 draws only an **EN** session-expired frame — no AR counterpart — while the app serves both. The file under-covers what ships.

**K. Confirmed matching — the §04 plan ladder.**
Every drawn plan name, weekly limit and price matches `src/lib/pricing/plans.ts` exactly: Solo 999/50, Nano 1,999/120, Starter 4,499/200, Pro 7,999/500, Business 12,999/1,000, Enterprise 18,499/2,000. The live field is named `quarterlyAllIn`, which reads like a quarterly figure, but `pricing.ts:3` defines it as *"EGP/month when billed quarterly (×3 = one quarter invoice)"* — so the drawing's "EGP/mo" label is correct. No divergence; recorded because the field name invites the opposite conclusion.

---

## Capture manifests

Batch 1 — `/tmp/rediff/lifecycle/_manifest.json`, measured **10 of 12**:

```
/en/suspended            OK  final=/en/suspended
/ar/suspended            OK  final=/ar/suspended
/en/reactivate           OK  final=/en/login   [REDIRECTED-TO-LOGIN: NOT MEASURED]
/ar/reactivate           OK  final=/ar/login   [REDIRECTED-TO-LOGIN: NOT MEASURED]
/en/session-expired      OK  final=/en/session-expired
/ar/session-expired      OK  final=/ar/session-expired
/en/status               OK  final=/en/status
/ar/status               OK  final=/ar/status
/en/teacher/resubscribe  OK  final=/en/dashboard   [role redirect: NOT MEASURED]
/ar/teacher/resubscribe  OK  final=/ar/dashboard   [role redirect: NOT MEASURED]
/en/offline              OK  final=/en/offline
/ar/offline              OK  final=/ar/offline
```

Batch 2 — `/tmp/rediff/lifecycle-b2/_manifest.json`, measured **6 of 7**:

```
/en/suspended?reason=center_suspended   OK  chars=244
/en/suspended?reason=payment_overdue    OK  chars=244
/ar/suspended?reason=payment_overdue    OK  chars=238
/en/reactivate                          OK  final=/en/login  [REDIRECTED-TO-LOGIN: NOT MEASURED]
/en/set-pin                             OK  final=/en/set-pin
/ar/set-pin                             OK  final=/ar/set-pin
/en/accept-invite                       OK  final=/en/accept-invite
```

No route was still-skeleton; no HTTP or page errors were recorded on any measured route. The two reason-code variants were reached by **URL parameter only** — no account state was altered to produce them.
