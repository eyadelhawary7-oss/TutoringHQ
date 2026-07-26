# Claude Code handoff

**Written 25 July 2026 from the design session of 24 to 25 July.**
**Nothing in this document is built. All of it is work.**

Design reference: the 26 `Merged-*.html` files, indexed in `MERGED-FILE-MAP.md`.
What changed and why: `DESIGN-CHANGE-RECORD-2026-07-25.md`.
Commission decision: `DECISION-house-accounts-2026-07-25.md`.

---

## How to read the design files

Each merged file opens with a comment block that repeats this. The short version:

- **CSS is scoped.** `.mgd4 .pins { }` means `.pins { }`. The `.mgdN` prefix is bookkeeping for the reference file. **It must never reach the codebase.**
- **One section is one screen.** Each section bar names the original screen file. That filename is the screen's identity.
- **Each phone is a state**, not a page. The caption names the state.
- **English and Arabic are separate screens**, never a translation overlay. Arabic uses Eastern Arabic numerals and the Arabic currency mark; English uses Western numerals and EGP. Chevrons flip with language.
- **Sample data is placeholder.** Not fixtures, not seed data.
- **Take layout, spacing, type scale and colour. Do not copy the DOM wholesale.**

---

## Before anything else: verification discipline

Unchanged and non negotiable.

- **Check every column against `information_schema.columns` before using it.** Migration files and code references are not proof. This rule exists because roughly 15 screens once read `students.balance_due`, a column that never existed.
- **One `SELECT` per Supabase MCP call.** Multi statement blocks silently drop all results but the last.
- **Migrations apply as a separate step after deploy**, manually, in order. Auto apply has caused incidents.
- **Draft PRs cannot be merged.** Confirm PR status before reporting a merge.
- Money and auth work goes on the largest model with adversarial review.

---

## Priority 1 - Database, before reps start in September

These carry a real deadline. A wrong commission row is very hard to unwind after someone has been
told what they earned.

### 1.1 Unique constraint on `center_assignments`

**There is no unique constraint on the center identifier.** Two reps can both mark themselves
primary on the same center, which is two T1 payouts on one customer, caught only by eye.

This is the most dangerous gap in the commission tables. Fix first.

Verify the current state, then add the constraint. Check for existing duplicates before adding it,
because the constraint will fail if any exist.

### 1.2 Claim expiry does not exist

There is **no claim expiry field anywhere**. The house account rule now depends on a claim having an
expiry, so this went from nice to have to load bearing.

Needs: an expiry timestamp on the claim, and a config key for the window. Suggested 60 days, in
config so it can move without a deploy.

### 1.3 `sourced_by` cannot express the new states

`center_assignments.sourced_by` allows only `eyad`, `sm`, `sr`. It needs:

- a value for **house account** (marketing sourced, no rep)
- a value for **team leader** (`tl`), which the constraint rejects outright today

Also: `assignment_status` still allows `pending_sm_approval`, pointing at a role that no longer exists.

### 1.4 Commission table gaps

Carried from the commission document, still true:

- No tier column. Add it.
- No stamped close rate or loyalty rate columns. Add both, per customer.
- No base amount column. Add it.
- No promo field. Add it.
- `loyalty_bonus_amount` defaults to a flat 200, which contradicts a percentage design.

### 1.5 Clawback logic is inverted

It fires on cancellations rather than chargebacks. Code, not schema. Must be correct before any gate
is trusted.

---

## Priority 2 - The house account rule

From `DECISION-house-accounts-2026-07-25.md`.

- A center with **no live claim at first payment** is a house account: pays no commission, and **does not count toward the rep's monthly close count.**
- A center with a **live claim** at first payment is that rep's close, counting for both pay and the rate ladder.
- Ad or UTM source is stored as evidence. **The claim is the verdict.** Do not build attribution on UTM alone: an owner can click an ad in June, meet a rep in August, and sign up by typing the URL.
- Commission rates should move from app code into config, so a rate change is not a deploy.
- **There is no quota and no rate ladder yet.** Until reps have run a couple of real months, every close pays a flat **30% close rate and 1% loyalty**. Build the ladder, but drive it from config and ship it switched off behind a flat rate.
- Those interim closes **stamp at 30% and 1% for life**, like any other close. Nothing recalculates when the ladder is later switched on. Do not build a restamp path.

**Decided: no cap on open claims per rep.** Do not build one. It is a known, sized risk that Eyad has accepted for now. If it is revisited, the fix is a logged contact requirement on every claim rather than a cap.

---

## Priority 3 - New screens to build

### 3.1 Self enrollment by one time code

Design: `Merged-Public-App`, section "Public Self Enrollment", from `Screen-Public-Enroll.html`.
Route: `/join/g/[groupId]`.

Flow: invitation, details, code, enrolled.

Requirements the design fixes:

- Three fields: student name, student mobile, **parent mobile**. Parent mobile is required.
- Six digit code, sent on WhatsApp, **ten minute expiry, newest code only**.
- Resend with a visible countdown.
- The student is in the group immediately. No approval step. This does not replace `/j/[code]`, which still waits for center approval.
- Nothing is billed before the first session.
- The anti-phishing line stays: this is the only code ever sent for joining, and attendance and fees never ask for a code.

Blocked on: WhatsApp template `chq_enrollment_otp`, not yet created, needs Meta approval (24 to 48 hours).

**Ask before building:** a student self enrolling is usually a minor. Confirm with Adsero whether
self enrollment without center approval changes the consent position, given that the center is the
controller. The design collects the parent number, which helps, but does not by itself constitute
parent consent.

### 3.2 Lead capture

Design: `Merged-Public-Marketing`, section "Lead Capture", from `Screen-Public-Lead.html`.
Route: `/talk-to-us`.

Five fields: name, mobile, center name, **area**, rough student count.

- **Area is the field that matters.** It routes the lead to the territory rep and gives the claim something to attach to. Store it structured enough to route on, not as free text if that can be avoided.
- Creates a lead record. This is the inbound feed the sales machine currently does not have.
- Submitted state keeps the free trial call to action visible.
- Do not add fields. Five is the ceiling.

**Decided 25 July 2026: submitting the form automatically creates a claim for the rep who owns that
area.** The reasoning is that a call is real sales work, and the house account rule exists to avoid
paying for work that was not done, not to avoid paying for work that was.

Three things must be true or the rule leaks badly.

**a. The claim lapses if the rep does not make contact.** This is the important one. Without it, a
rep is paid in full for leads he never called, because the person starts the free trial on their own
and pays anyway while his claim is still live.

- A lead form claim has a **5 day contact deadline**, separate from the 60 day rep initiated claim expiry. **Put it in config, not in code.** The number is provisional and will be reset from real contact logs after the first cohort, so it must move without a deploy.
- The rep must log contact to hold the claim. No contact logged by the deadline, the claim lapses and the center reverts to a house account.
- Size of the hole if this is skipped, one month one city: a rep who works 4 centers while 8 more submit the form and are never called is paid **28,182 EGP** more than he earned, and the 8 uncalled leads push him from the 10% band to the 30% band, repricing the 4 he did work.

**b. If the center already has a live claim, do not create a second one.** The existing claim wins.
Two claims on one center is the same double payout risk as item 1.1.

**c. If no rep owns that area, it is a house account.** In September most of Egypt has no rep. Do not
fall back to the Team Leader: his bag is capped at half quota and is explicitly his own leads only,
never from the rep pool. An unowned area produces a lead with no claim, which is exactly what a house
account is.

---

## Priority 4 - PIN changes

### 4.1 PIN is six digits everywhere

The app lock previously specified four. It is now six across all surfaces, matching the account PIN
and the privacy policy.

Check: PIN validation, the hashing path, and any length constant. Confirm nothing still expects four.

### 4.2 Show PIN toggle

Design: `Merged-Public-App` (Auth) and `Merged-Lifecycle` (Access).

- Applies to all four Auth fields: set PIN, confirm, login, wrong PIN. And to the app lock PIN.
- Defaults to masked.
- Icon is borderless and muted, changes colour while revealed, and switches to a crossed out eye.
- Tap target at least 32px.
- **Never log or persist the revealed state.**

This is a UI change: **bump `SW_VERSION` in `public/sw.js`.**

---

## Priority 5 - Legal surface

Design: `Merged-Public-Legal`.

- Four document readers: Privacy Policy, Terms and Conditions, Cookie Policy, Data Processing Agreement.
- These three footer links currently go nowhere and must now resolve.
- Public PDPL data rights form. The backend already exists: `/api/privacy-request` with tests and a `privacy_requests` table (`full_name`, normalized `phone`, `email`, `request_types` array, `description`). **Verify those columns against the live schema before wiring.**
- The form routes students and parents to their center first. Center is controller, platform is processor.
- **The form never asks for a PIN, and says so on screen.** Do not remove that line.
- Thirty day window, acknowledgement within five business days, no charge.

The document text in the design is a readable summary with the real section structure, **not the full
legal text.** The complete text lives in the Adsero drafts. Pull from one source at build time so the
page and the drafts cannot drift apart.

Blocked on: Adsero review. All four documents are still marked draft.

---

## Priority 6 - Smaller items

- **Referral landing** `/refer/[code]`. Design in `Merged-Public-App`. Names the inviter, states the reward, goes to the free trial. Distinct from the staff invite in `Merged-Lifecycle`.
- **Offline fallback**. Design in `Merged-Public-App`. PWA fallback. The claim that already taken attendance is saved locally and syncs on reconnect must be true before this ships, or the screen is lying.
- **Routes to delete, not build:** `/blog`, `/features/*`, `/compare/spreadsheets`, the persona splash at `/`, and `/demo-request` as a page.

---

## Things that are NOT Claude Code's to decide

Flagged so they do not get quietly invented in code.

| Open item | Owner | When |
|---|---|---|
| Quota number, from real close counts, outbound only | Eyad | after a couple of months of closes |
| Firing rule, seasonality, center lifetime | Eyad | after a couple of months of closes |
| Class reminder: parent pack or center bundle | Eyad | before the schedule feature ships |
| Child safety position on self enrollment | Adsero | before 3.1 ships |
| All four legal documents | Adsero | before the legal surface ships |

---

## External blockers, none of them code

- **VAT registration. Overdue since 31 March 2026. Penalties 20,000 EGP plus 1,000 per day.** This is the only item that costs money for every day it waits.
- Paymob live credentials and one real test transaction. `PAYMOB_RECURRING_INTEGRATION_ID` is still a placeholder, so billing lockout is inert.
- Meta WhatsApp: live number, plus template approvals including the new `chq_enrollment_otp`.
- Bosta merchant account.
- **External penetration test before any real tenant with student data.**
- Adsero: legal drafts, plus the agency agreement still has a blank commercial registration number and registered office.

---

## Standing rules

- Eyad merges every PR himself, on the GitHub mobile green button only.
- Claude Code works on a held branch. Nothing merges without review.
- `master` auto deploys to `tutoringhq.app`.
- Any UI or branding change bumps `SW_VERSION` in `public/sw.js`.
- Supabase project `lczmjpnbuhnsislcvzar`, eu-west-2. Database is in London, users are in Egypt.
- Cairo is UTC+3 from the last Friday of April to the last Thursday of October, UTC+2 otherwise. Crons run in UTC, so the offset is manual.
- No real customers yet. Paymob is in test mode. Nothing charges anyone.
