# Putting the 103 screens onto the live platform

**Written 25 July 2026. A plan, not a spec.**
Design reference: 26 `Merged-*.html` files, indexed in `MERGED-FILE-MAP.md`.
Work items already identified: `CLAUDE-CODE-HANDOFF.md`.

---

## What the constraint actually is

**It is not Claude Code's throughput.** An earlier version of this plan said 2.9 screens a day. That
was calendar arithmetic and it was the wrong frame. Corrected 25 July 2026.

Two things make the real pace much faster:

- **These are redesigns, not new builds.** The platform exists. Routing, data and business logic are already there for most of the 103. Applying a design to a working screen is mechanical.
- **65 of the 103 screens are layout only.** No money, no auth, no state machine.

So the 103 can plausibly be generated in one to three working days.

**The constraint is review, and it is yours.** You merge every PR yourself, on a phone.

| How the work is cut | PRs | At 5 min each | At 10 min each |
|---|---|---|---|
| One PR per screen | 103 | 8.6 hours | 17.2 hours |
| One PR per merged file | 26 | 2.2 hours | 4.3 hours |

**Cut it per merged file, not per screen.** One PR per file is 26 reviews, which is a long day rather
than an impossible week. Per screen is not reviewable at this pace, and a review you do not actually
perform is worse than no review, because it launders an error into something you approved.

**With one exception.** 38 screens across 7 files touch money or auth: `Merged-Public-App`,
`Merged-Center-Money`, `Merged-Teacher-Money`, `Merged-Admin-Money`, `Merged-Verification-Payouts`,
`Merged-Lifecycle`, `Merged-CEO`. Those stay small, go on the largest model, and get adversarial
review. The other 65 screens can move as fast as Claude Code can write them.

**So the ordering below is not about fitting a calendar any more.** It is about which surfaces get
built while your attention is fresh, and which can be batched. Money and auth should not be the last
thing you review at hour forty.

---

## Phase 0 comes before everything, and it is not building

**The platform already exists.** These 103 screens are a redesign, not a greenfield build. Nobody has
yet written down which designs replace something live, which are genuinely new, and which live
screens have no design at all.

Until that exists, every estimate below is a guess.

**Ask Claude Code for an inventory first.** Three lists:

1. Live routes that a design replaces. These are redesigns; the data layer already works.
2. Designs with no live route. These are new builds: the enrollment screen, lead capture, legal, referral, offline.
3. Live routes with no design. **This list is the dangerous one.** Anything on it either gets a design or gets deleted, and deciding that by accident during implementation is how screens quietly disappear.

Nothing else starts until that inventory is in front of you.

---

## Phase 1: foundations, before any screen

103 screens share one type scale, one colour set, one spacing grid, one set of RTL rules and about
a dozen components. Build those per screen and you get 103 slightly different implementations that
are impossible to change later.

Build once, from `Merged-Design-Patterns` and section 2 and 3 of `tutoringhq-public-design-system.md`:

- **Tokens.** Colour, spacing, radius, shadow. As CSS variables, not literals scattered through components.
- **Type.** IBM Plex Sans, IBM Plex Sans Arabic, IBM Plex Mono, and the rule that Mono is dropped on Arabic frames in favour of weight 600.
- **The language system.** This is the one that hurts if it is retrofitted. Arabic is not a translation layer: Eastern numerals, the Arabic currency mark, RTL, and directional icons that flip. Every screen depends on it.
- **The shared components.** Session row, provider card, form field, guard note, confirmation screen, buttons.

**This phase produces no visible screens and is the highest leverage work in the whole plan.**

---

## Phase A: the daily loop, 21 screens

`Merged-Center-Home` · `Students` · `Groups` · `Attendance` · `Money` · `WhatsApp`

This is what a pilot center touches every single day: load the students, put them in groups, take
attendance, send the fee, get paid, message the parent.

Your own success measure is centers running their real operation daily, not signups. **This phase is
that measure.** If only this phase ships by 30 August, the pilot still works.

Order inside it: Students before Groups before Attendance. Attendance is the daily habit and the
thing most worth getting right.

---

## Phase B: getting in and staying in, 18 screens

`Merged-Public-App` · `Merged-Lifecycle` · `Merged-Verification-Payouts`

Signup, login, the clickwrap, joining by link, self enrollment, parent payment, the PIN screens,
account states, verification and payouts.

**Money and auth. Largest model, adversarial review, no exceptions.**

Contains two of the five new builds: self enrollment and referral. Self enrollment is blocked on the
`chq_enrollment_otp` template and on the Adsero question about a minor self enrolling without center
approval. Start the template now, it takes 24 to 48 hours for Meta to approve.

---

## Phase C: compliance, 1 screen

`Merged-Public-Legal`

One screen, listed separately because it is not a feature. Three footer links currently go nowhere,
and the PDPL data rights route is a legal obligation rather than a nicety.

The backend mostly exists: `/api/privacy-request` and the `privacy_requests` table. **Verify those
columns against the live schema before wiring anything.**

Blocked on Adsero for the document text. The design carries readable summaries with the real section
structure, not the full legal text. Pull the real text from one source so the page and the drafts
cannot drift apart.

**A+B+C is 40 screens.** Not because the rest cannot ship in the same week, but because these 40 are what a pilot center actually touches. If something goes wrong and only part of the work lands, this is the part you want landed.

---

## The remaining 59

| Phase | Screens | What it is |
|---|---|---|
| D | 16 | Week one of a new center: setup, insight, card orders |
| E | 19 | The whole teacher portal |
| F | 4 | Marketing surface, landing, audience, pricing, lead capture |
| G | 20 | Admin and CEO, internal only |

**F is worth arguing about.** The marketing pages already exist and already work. Redesigning them
does not help a pilot center run their day. The one piece of F with real urgency is **lead capture**,
because your sales machine has territory routing, claims and commission but no inbound feed at all.
Consider pulling that single screen forward and leaving the other three where they are.

**G goes last regardless of pace.** Twenty screens no customer will ever see. If review attention runs out, it should run out here and not on the money screens.

---

## How the work should be cut into PRs

You review and merge every PR yourself, on a phone, using the green button. That constrains PR size
more than anything technical.

- **One screen per PR**, or one tight group of states for the same screen. Never a whole surface.
- **The foundations phase is the exception** and should be several PRs: tokens, then type, then the language system, then components in small batches.
- **Anything touching money or auth goes on the largest model with adversarial review.** Phase B is almost entirely that.
- **A PR that changes a screen bumps `SW_VERSION` in `public/sw.js`.** Every one.
- **Migrations apply as a separate manual step after deploy**, in order. Never assume a merge applied them.
- **Verify every column against `information_schema.columns` before it goes into a query.** This rule exists because roughly fifteen screens once read a column that never existed.

---

## What not to do

**Do not copy the DOM out of the merged files.** They are built to be read, not shipped. Take the
layout, spacing, type scale and colour decisions. Rebuild the markup properly in your components.

**Do not let `.mgdN` reach the codebase.** It is scoping bookkeeping for the reference files. `.mgd4
.pins` means `.pins`.

**Do not treat sample data as fixtures.** Every name, amount and phone number in the designs is
illustrative.

**Do not start Phase A before Phase 1.** It is tempting, because Phase A produces visible progress
and foundations produce none. Retrofitting the language system across 21 built screens costs more
than building it first.

---

## The honest risk

Speed is not the risk. **Unreviewed speed is.**

If 103 screens land in three days, the thing that decides whether that was brilliant or a disaster is
whether the 38 money and auth screens got real scrutiny, or got waved through in the same rhythm as
the 65 layout ones.

The second risk is skipping Phase 0 and Phase 1 because they produce nothing visible. At this pace
the temptation is strongest, and retrofitting the language system across 103 built screens costs far
more than the day it takes to do first.
