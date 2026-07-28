# Faithfulness audit — `Merged-Public-App` §01, §02, §05, §06

**Written 28 July 2026.** Four screens, line by line, design against live code and the live catalog.

A previous pass established only that the routes **exist and are correctly shaped**. That is not a
faithfulness claim, and this file does not inherit one. Every row below was checked against the
actual file or `information_schema` / `pg_proc`, not against a summary.

**None of this is a build.** `Merged-Public-App` is one of the six protected money-and-auth files.
Everything here is a statement of what differs, for Eyad to price.

**Verdict in one line: none of the four is faithful.** §06 is closest — copy only. §05 points at a
different destination than the design does. §01 and §02 differ structurally.

---

## §01 Public Auth — `/signup`, `/teacher/signup`, `/login`

The design's opening claim is *"One flow for both customers… both walk the same five steps and only
two of them differ."* **Live has two separate flows with different step counts and different
orderings.** That is the headline difference; everything else follows from it.

| | Design | Live |
|---|---|---|
| Flow | one, 5 steps, role picked in-flow at S0 | **two routes** |
| Center | — | `/{locale}/signup` — `info → plan → payment → success`, progress reads *step N of 4* |
| Teacher | — | `/{locale}/teacher/signup` — `form → otp`, 2 phases |
| Role fork | S0 bottom sheet inside the flow, no close button | `components/landing/StartFreeChooser.tsx` on the **landing page**, routing to the two routes above |

The fork is live, just earlier and elsewhere — the same "already live, somewhere better" pattern
`SKIPPED-SCREENS.md` names. Here it is not merely placement: the chooser is *why* there are two
flows, so adopting S0 as drawn means merging two signup routes, not moving a sheet.

### Order of steps

Design: details → **code** → **PIN** → plan → review.

- **Center signup has neither step.** No OTP, no PIN anywhere in the flow. The owner's PIN is set
  *after* signup at `/{locale}/set-pin` (`POST /api/auth/set-initial-pin`), with a cross-device
  WhatsApp fallback (`request-pin-setup-link`, table `pin_setup_tokens`). None of that machinery is
  in the design.
- **Teacher signup inverts the design's order.** The PIN and its confirm field are collected in the
  **form** phase, *before* the OTP (`teacher/signup/page.tsx:39-41`, phase `'form'`); the account is
  created server-side only on OTP verify. Design puts the code first and the PIN second.

### S2 / S8 — the codes. Faithful where they exist

| Design | Live | |
|---|---|---|
| "Sent on WhatsApp" | template `chq_teacher_signup_otp` | ✓ |
| "The code lasts 10 minutes" | `TEACHER_SIGNUP_OTP_TTL_MS = 10 * 60 * 1000` | ✓ |
| S8 reset code, 10 minutes | `reset-pin/route.ts:86` — `Date.now() + 10 * 60 * 1000`, table `pin_reset_otps` | ✓ |
| S8 "Nobody at TutoringHQ can see your PIN" | reset stores a bcrypt hash; there is no read-back path | ✓ |
| "I forgot my PIN" | `/forgot-password`, linked from `/login` | ✓ |

S2's *"Only the newest one works"* is not enforced as drawn — the teacher OTP caps at
`TEACHER_SIGNUP_OTP_MAX_ATTEMPTS = 5` per row rather than invalidating prior codes. Minor, but it is
a sentence the screen says out loud.

### S7b / S7c — the lockout. Right idea, wrong numbers, and two sources

The lockout **is implemented**, but not where the design says, and not with the design's figures.

- **Live** — per-**phone**, in Upstash Redis: `LOGIN_LOCKOUT_MAX = 5`,
  `LOGIN_LOCKOUT_WINDOW_SECS = 900` (15 minutes), returning `423 ACCOUNT_LOCKED`. It fails **closed**
  (Redis error → 503), which is the correct inversion of the global helper's fail-open default.
  Cleared on successful sign-in.
- **Design** — six wrong PINs, locked **one hour**, "cannot be lifted early".

| | Design | Live |
|---|---|---|
| Attempts | 6 | **5** |
| Window | 1 hour | **15 minutes** |
| Counter shown to user | "**Three tries left**" | not returned, not rendered — `/login` shows a generic `invalidCredentials` |
| "Set a new PIN now… unlocks the account straight away" | promised | **false.** `verify-pin-reset` establishes no session, and neither it nor `reset-pin` clears the Redis counter. A user who resets while locked still gets 423 until the window expires |

**The two-sources problem, on this screen.** `users.pin_attempts` (`integer`, default `0`) and
`users.pin_locked_until` (`timestamptz`) **exist in the live catalog** — the design's note is right
that they are there. They are also **completely dead**:

- zero references in any `.ts` / `.tsx` file (only `pin_set_at` is used);
- zero Postgres functions reference either (`pg_proc.prosrc` scan, both names, empty);
- **0 of 4 rows** have ever carried a non-zero attempt count or a lock timestamp.

So lock state has one live source (Redis) and one dead source (two `users` columns) that looks
authoritative to anyone reading the schema. The design's *"Verified in the live database"* is true of
the columns and false of the behaviour they imply — which is exactly how a column gets trusted.
**Worth a decision on its own: either wire the columns or drop them.**

### S4 — center plans. Prices right, three caps wrong

Prices match live exactly. **Three of six capacities do not.**

| Plan | Design price | Live | Design cap | Live cap |
|---|---|---|---|---|
| Solo | 999 | 999 ✓ | 50 / wk | 50 ✓ |
| Nano | 1,999 | 1,999 ✓ | 120 / wk | 120 ✓ |
| Starter | 4,499 | 4,499 ✓ | **300 / wk** | **200** ✗ |
| Pro | 7,999 | 7,999 ✓ | **600 / wk** | **500** ✗ |
| Business | 12,999 | 12,999 ✓ | **1,200 / wk** | **1,000** ✗ |
| Enterprise | 18,499 | 18,499 ✓ | 2,000 / wk | 2,000 ✓ |

The design's own caption says *"Widened caps"*, so this is a **proposal**, not a description of live —
but it is drawn as a live screen and reads as one. **Money, so Eyad's.**

**Where the numbers come from, and whether the two sources agree.** Display reads
`usePublicPlanPrices` (live-editable, server) and falls back to the `SUBSCRIPTION_PLAN_DEFINITIONS`
constant; server math (billing, MRR) reads `PLANS[].quarterlyAllIn`. **Checked both today: the live
`pricing_plans` rows and the TS constants agree exactly on all six prices and all six caps.** They
agree now; nothing enforces that they keep agreeing, which is the risk worth naming.

Two smaller notes:

- **Starter's "15.00 a student" is derived, not stored** — 4,499 ÷ 300, the design's own widened cap.
  Against the live cap of 200 the same division gives **22.50**. One figure, two ways to compute it,
  and the design ships the one live cannot reproduce.
- `PLANS[].quarterlyAllIn` is a **misleading name, not a mismatch** — it is documented as the per-month
  rate charged for both monthly and quarterly (`pricing.ts:41`). The design's "EGP / MO" is correct.

### S4b — teacher plans. Scale is wrong on two figures

| Plan | Design | Live (`TEACHER_PLANS`) |
|---|---|---|
| Standard | 499 · 20 a week · 14-day trial | 499 ✓ · cap 20 ✓ · `trialDays: 14` ✓ |
| Pro | 999 · 50 a week · analytics included | 999 ✓ · cap 50 ✓ · `proFeatures: true` ✓ |
| Scale | 2,499 · **150 a week, then 16 each** | 2,499 ✓ · cap **100** ✗ · overage **+20 EGP** ✗ |

Two errors on one row, both money. Plus two unit problems that apply to all three:

- **"a week" is the wrong unit for teachers.** Live enforces the cap on **active students per billing
  month** (`countActiveStudentsThisMonth` — a student who checked in at least once that month counts
  once). Center caps genuinely are weekly; teacher caps are not. The design uses one word for two
  different things.
- The design omits Pro's **"Best for Part-Time"** label, which `teacherPlans.ts` calls the only label
  anywhere on the ladder.

### S5 — review and consent. Dates exact, agreement missing

**The dates are faithful and correctly sourced** — both read `platform_config`:

| Design | Live config | |
|---|---|---|
| "Free until **16 Aug 2026**" | `summer.free_until` = `2026-08-16` | ✓ exact |
| "First invoice **30 Aug 2026**" | `summer.first_charge_floor` = `2026-08-30` | ✓ exact |
| "Today **0.00**", "No card is stored and nothing is taken automatically" | `SignupForm.tsx:536` — *"Trial-first: no payment at signup"* | ✓ |
| Annual · "2 months free" | `pricing.interval.annual_label_en`, multiplier `10` | ✓ |
| Two consent tickboxes, button inactive until both | `termsAccepted` + `privacyAccepted`, both required, PDPL-separated | ✓ |

**What is missing is the whole agreement block.** `"Provider Agreement"` returns **zero hits across
the entire repository** — `.ts`, `.tsx`, `.json`, `.md`. So none of this exists:

- the version row *"Provider Agreement v1.0 · Published 24/07/2026"* and its "Read it all" link;
- the two agent clauses — *"You set your own prices"* and *"You teach, and you answer for it"*.

Live consent links to `/legal/terms` and `/legal/privacy` only. The two clauses are the
agency-disclosure position, so this is **legal, not layout** — it belongs with Adsero, not in a
restyle.

### S6 and S9 — one thin, one absent

- **S6 "Nile Prep Academy is open"** with the login method restated. Live has a `success` stage, but
  the trial-first path redirects straight to `/set-pin` before it renders. The design's reassurance —
  *"No more codes. Your number and PIN get you in from any phone"* — lands nowhere, which is a real
  loss given the PIN is the thing the flow just spent a step explaining.
- **S9 "This number has had its free trial"** does not exist. Zero hits for any trial-used concept.
  Live returns `errorPhoneExists` — an **inline form error**, not a screen, and it says nothing about
  a trial or a price. The design's version is a priced offer with a CTA; the live one is a dead end.

---

## §02 Public Join — `/{locale}/join/[center_code]/[group_id]`

Live is **one card**: center name, group name · subject, then the form. States are
`loading / notFound / submitted / form`. The design has **six**.

| # | Design state | Live |
|---|---|---|
| 1 | **The invitation** — who invited you, what you are joining, what happens next | **Absent.** No separate screen; the form is the landing state |
| 2 | The form, four fields | Present, **two differences** — below |
| 3 | Request sent | Present but thin — no summary card, no WhatsApp button |
| 4 | **Link closed** | **Absent.** Only a generic `notFound` |
| 5 | **Already enrolled** | **Absent** |
| 6 | **`/parents` trust page** | **Route does not exist** |

### The invitation card has no data behind it

`GET /api/join/[center_code]/[group_id]` selects `centers(id, name)` and `groups(id, name, subject)`
and returns exactly `center_id, center_name, group_id, group_name, group_subject`. Every remaining
element of the design's card is unsourced:

| Design element | Status |
|---|---|
| **"Verified" chip** | **C1** — no verification column on `centers` |
| "Tutoring center · **Nasr City**" | `centers.city` / `district` / `governorate` exist; simply not selected |
| Teacher **"Aly Shady"** | `groups.teacher_name` exists; not selected |
| **"Per session · 168.75 EGP"** | **No source at render time** — below |
| "What happens next", 3 steps | Copy only, buildable |

**The per-session fee cannot be computed when this screen renders.** `fee_per_class` exists on
**`student_groups`** and `group_proposals` only — it is a property of an **enrollment**. On a public
join page the enrollment does not exist yet; creating it is what the visitor is requesting. The
nearest per-group figure is `groups.monthly_fee`, a **different basis** (monthly, not per session),
so substituting it would put a number on the screen that no later invoice reproduces.

This is the same class as the upgrade fault and the balance helper, in its worst form: not one number
with two sources, but **one number with no source at the moment of display**.

**And the specific figure is the wrong one for this audience.** `168.75` is not arbitrary — it is
the **provider price** under the locked B1 rate card: `X + markup` where markup is `0.075X + 7.5`,
worked from `X = 150`. B1 states the 10% collection fee and the 7.5% + 7.5 markup are
*"provider-visible; neither is ever rendered to a parent"*, and that the parent's own total —
`172.78`, being `168.75 + 4.03` parent processing fee — appears on **the parent payment page only**.

Public Join is a **parent- and student-facing** screen showing a **provider** figure. It is neither
what the provider quotes internally nor what the parent will actually pay, so it understates the
parent's cost by the 4.03 processing fee. B1's presentation rule names the inverse case explicitly
(*"if a screen shows a provider the parent total, that is a bug"*) but does not cover this direction.
**That is a gap in the rule, not a settled breach of it** — so it is Eyad's to decide, and it should
be decided before any join screen quotes a number at all.

The same 168.75 appears on `Merged-Center-Money` §05, where it is **correct**: that screen is
provider-facing and quotes the provider price exactly as B1 requires. One figure, two screens, two
audiences — right on one, wrong-audience on the other.

### The form contradicts the design on the field the design argues hardest for

The design's lede: *"Parent phone is **not optional**, because that is where every payment link goes,
and a student without one is a student who cannot be billed."*

**Live treats it as optional.** `page.tsx:102` validates `studentName` and `studentPhone` only, and
posts `parent_phone: parentPhone.trim() || null`. A join request with no parent phone is accepted.

Conversely, **live has a required control the design does not draw at all**: `parentConsent`, blocking
submit with `consentRequired`. That is the guardian-consent gate (`docs/GUARDIAN_CONSENT.md`,
`docs/PARENT_SELF_ENROLL_CONSENT.md`) — minors' data. **A restyle that took this design literally
would delete a legally-required checkbox.** Worth stating plainly since the design is otherwise the
more careful document here.

### "Link closed" is a state live has no concept of

`groups.is_active` (boolean) exists, so the state is *buildable*. But today the API 404s only on a
missing center or group, and the page renders one `notFound` for every failure. The design's version
names the group and explains the two reasons — filled, or link turned off — and neither is
distinguishable live.

---

## §05 Referral Landing — `/{locale}/refer/[code]`

The route is live and it does name the inviter, which the design calls the whole point. **The rest
diverges, including where the button goes.**

| Design | Live |
|---|---|
| "Karim Samir invited you to **TutoringHQ**" | `invitedBy` — *"You've been invited by {centerName} to try TutoringHQ"* ✓ same intent |
| CTA **"Start free trial"** | **`ctaButton` = "Book your demo"** ✗ |
| "**14-day free trial, no card needed**" | absent |
| "**A welcome credit on your first bill**" | absent — and unsourced, below |
| "Already have an account? **Log in**" | absent |
| — | `autoApplyNote` — *"Your referral will be automatically applied"* |
| — | `invalidLink` state; design draws none |

**The CTA is the substantive difference.** The design's stated purpose is to drop the visitor
*"straight into the free trial rather than a sign-up wall"*. Live sends them to **book a demo** — a
slower, sales-mediated path. That is a funnel decision, not a layout one, and it also collides with
the open `/demo-request` vs `/talk-to-us` question in `NEEDS-DESIGN.md` #17.

**The welcome credit has no model.** Checked all four referral tables:

- `referrals` — `referrer_center_id`, `referred_center_id`, `referral_code`, `status`,
  `referred_first_paid_at`, `converted_at`
- `referral_rewards` — `referring_center_id`, `referred_center_id`, `first_month_fee`,
  `reward_amount`, `reward_status`
- `referral_reward_records` — `referrer_center_id`, `referred_center_id`, `reward_percentage`,
  `base_amount`, `reward_amount`, `status`, `held_until`, `paid_at`
- `referral_codes` — `center_id`, `code`

**Every reward column is referrer-side.** There is no column anywhere for a credit granted **to** the
referred center, and signup confirms it: applying a code yields only
`"Referral code applied: {code}"` — no discount, no credit, no changed total.

So *"your first month comes with a welcome credit"* and *"A welcome credit on your first bill"* are a
**money promise on a public page with nothing behind it** — the same shape as the five 28 July noes,
and worse for being a promise to a stranger. The design's 14-day trial claim is fine
(`summer.trial_days = 14`); the credit is not.

---

## §06 Offline — `/{locale}/offline`

**The one screen where the design's factual claim holds.** `CLAUDE-CODE-HANDOFF.md` set the
condition: *"The claim that already taken attendance is saved locally and syncs on reconnect must be
true before this ships, or the screen is lying."*

**It is true.** `public/sw.js` carries the `centerhq-offline` IndexedDB store with
`savePendingScan` / `getAllPendingScans` / `deletePendingScan` and a `sync` listener on tag
`sync-scans`; the app side is wired — `queueScan` is called from `ScanTab.tsx` (five call sites) and
`ChecklistTab.tsx`, and `syncQueuedScans` is imported by both. The screen may say it.

Differences are **copy only**, and live is the weaker text:

| Design | Live |
|---|---|
| "You are offline" | `title` — "No internet connection" |
| "TutoringHQ needs a connection for this. The moment you are back online it will load." | `desc` — "Check your connection and try again" |
| "Good to know" heading + "**Attendance you already took is saved on this device and will sync automatically when the connection returns.**" | `scannerNote` — "QR scanner works offline. Attendance is saved automatically." (no heading) |
| "Try again" | `retry` — "Retry" |

Live **drops the sync-on-reconnect half** — the one sentence that answers what an owner in a basement
classroom is actually worried about, and the half that is verifiably true.

### A live bug found while reading it

`offline/page.tsx` is **dark-mode leftovers on a cream background**: `text-white` on the heading,
`text-slate-400` on the body, `bg-amber-900/20`, `border-teal-800/40`, `bg-slate-700` on the button —
over `bg-[var(--color-surface-0)]`, which is **`#ece8df`, cream** (`globals.css:92`). White heading
text on cream paper is effectively invisible.

Dark mode was removed in July (`docs/DARK_MODE_REMOVAL_2026-07-05.md`,
`DARK_MODE_LEFTOVERS_CLEANUP_2026-07-06.md`); this page was missed. **Not a design gap — a live
rendering fault**, and the only thing in these four screens that is broken rather than merely
different. Logged, not fixed: this file is protected and nothing in it is being built this pass.

---

## Summary

| § | Screen | Faithful? | The one thing |
|---|---|---|---|
| 01 | Public Auth | **No** | One flow in the design, two live; lockout is 5/15min not 6/1hr; Provider Agreement absent everywhere; 3 of 6 center caps and 2 Scale figures wrong |
| 02 | Public Join | **No** | 6 states vs 1; the per-session fee has no source at render time; parent phone required in design, optional live; live's consent checkbox is undrawn |
| 05 | Referral Landing | **No** | CTA goes to a demo booking, not the trial; the welcome credit has no model |
| 06 | Offline | **Close** | Copy only, and the offline-sync claim is verified true. Live page has a dark-mode rendering bug |

**Money items for Eyad:** center plan caps (3), teacher Scale cap and overage (2), Starter's
per-student figure, the §02 per-session fee, the §05 welcome credit.

**Not money, still his:** the two-flow signup shape, the dead `pin_attempts` / `pin_locked_until`
columns, the missing Provider Agreement and its two agent clauses, the §05 CTA destination.

**C1-blocked:** the §02 "Verified" chip.

**Live faults found, not fixed:** `/offline` dark-mode leftovers; PIN reset does not clear the login
lockout counter.
