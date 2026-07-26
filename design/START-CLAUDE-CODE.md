# Starting Claude Code

Everything below is meant to be copied straight into Claude Code, in order.
Do not skip to session 3. Sessions 1 and 2 produce almost nothing visible and decide whether the
other 103 screens go well.

---

## First, put the files where Claude Code can read them

Create `design/` at the repo root and put in it:

- The **26 `Merged-*.html` files**, 2.5 MB total
- `MERGED-FILE-MAP.md`
- `CLAUDE-CODE-HANDOFF.md`
- `IMPLEMENTATION-PLAN.md`
- `tutoringhq-public-design-system.md`
- `TutoringHQ-Screen-Tracker.md`
- `DECISION-house-accounts-2026-07-25.md`

Leave `_originals/` out. It is another 2.5 MB and 103 single screen files that would only give Claude
Code two sources of truth for the same screen. Keep it where it is, as your archive.

Commit that folder on its own, before any code changes, so the reference has a clean history.

---

## Session 1 - Inventory. Build nothing.

> Read `design/MERGED-FILE-MAP.md` and `design/IMPLEMENTATION-PLAN.md` first.
>
> This session builds nothing and changes nothing. It produces one document.
>
> The platform is live and these 103 designs are a redesign, not a new build. I need to know exactly
> how the design maps onto what already exists before any of it gets applied.
>
> Go through the codebase and produce `design/INVENTORY.md` with three lists:
>
> 1. **Live routes that a design replaces.** For each: the route, the file that serves it, and which merged file plus section number holds its design. These are restyles; the data layer already works.
> 2. **Designs with no live route.** These are new builds. I expect at least five: self enrollment `/join/g/[groupId]`, lead capture `/talk-to-us`, the legal surface, the referral landing `/refer/[code]`, and the offline fallback.
> 3. **Live routes with no design.** For each: the route and what it does. This is the list I care most about, because anything on it either needs a design or needs deleting, and I do not want that decided by accident while screens are being built.
>
> For each entry in list 1, also say whether it is layout only or whether it touches money, auth, or
> account state. I need to know which screens need real scrutiny.
>
> Do not modify any application file. Do not open a PR that changes behaviour. The only new file is
> `design/INVENTORY.md`.

**Read list 3 yourself before session 2 starts.** That is the one that decides scope.

---

## Session 2 - Foundations. Still almost nothing visible.

> Read `design/tutoringhq-public-design-system.md` and `design/Merged-Design-Patterns.html`.
>
> All 103 screens share one type scale, one colour set, one spacing system, one set of RTL rules and
> about a dozen components. Build those once, now, before any screen is touched.
>
> Four separate PRs, in this order:
>
> **PR 1, tokens.** Colour, spacing, radius, shadow, as CSS variables. No literals scattered through
> components.
>
> **PR 2, type.** IBM Plex Sans, IBM Plex Sans Arabic, IBM Plex Mono. Note the rule that Mono is
> dropped on Arabic frames in favour of weight 600.
>
> **PR 3, the language system.** This is the one that is painful to retrofit, so it gets built
> properly now. Arabic is not a translation layer over English. Eastern Arabic numerals, the Arabic
> currency mark, RTL layout, and directional icons that flip with language. Every screen depends on
> this.
>
> **PR 4, shared components.** Session row, provider card, form field, guard note, confirmation
> screen, buttons. Take these from `Merged-Design-Patterns`.
>
> Rules that apply to all four: the merged files scope every CSS rule with a `.mgdN` prefix, which is
> bookkeeping for the reference file only. `.mgd4 .pins` means `.pins`. **That prefix must never
> appear in the codebase.** Do not copy the DOM out of the merged files; they are built to be read,
> not shipped. Take the layout, spacing, type scale and colour decisions and write the markup
> properly. Bump `SW_VERSION` in `public/sw.js` on any PR that changes what renders.

---

## Session 3 onward - The screens

Cut one PR per merged file, not per screen. 26 reviews is a long day; 103 is not reviewable, and a
review you do not really perform is worse than none.

**These 7 files are the exception.** They touch money or auth, so they go in smaller PRs, on the
largest model, with adversarial review:

`Merged-Public-App` · `Merged-Center-Money` · `Merged-Teacher-Money` · `Merged-Admin-Money` ·
`Merged-Verification-Payouts` · `Merged-Lifecycle` · `Merged-CEO`

The other 19 files are layout only and can move at whatever pace Claude Code writes them.

Order, from `IMPLEMENTATION-PLAN.md`: the daily loop first, then getting in and staying in, then
legal, then the rest. Admin and CEO last, because no customer will ever see them, so if attention
runs out it should run out there.

### The prompt for a layout-only file

> Apply the design in `design/Merged-Center-Students.html` to the live screens it covers.
>
> That file names each screen and the section number it sits in. Work through them in order.
>
> Foundations are already built, so use the existing tokens, type scale and components rather than
> introducing new ones. If a screen needs something the component set does not have, tell me before
> inventing it.
>
> Strip the `.mgdN` scoping prefix. Do not copy the DOM. Sample data in the design is placeholder,
> not fixtures.
>
> Verify every column against `information_schema.columns` before it goes into a query. Not migration
> files, not code references, the live catalog.
>
> Bump `SW_VERSION` in `public/sw.js`.
>
> One PR, held branch, do not merge.

### The prompt for a money or auth file

> Same as above, plus:
>
> This file touches money and auth, so use the largest model and review your own work adversarially
> before opening the PR. Specifically: try to find the case where the amount shown to a parent differs
> from the amount charged, the case where a locked account can still reach something, and the case
> where the Arabic and English screens disagree about a number.
>
> Split this into smaller PRs, one per screen or per tight group of states. Tell me what the split is
> before you start.

---

## Repeat these every session

Claude Code loses context between sessions and these are the ones that cost real money when they slip.

> - Check every column against `information_schema.columns` before using it. Migration files are not proof.
> - One `SELECT` per Supabase MCP call. Multi statement blocks silently drop all results but the last.
> - Migrations apply as a separate manual step after deploy, in order. A merge does not apply them.
> - Work on a held branch. Never merge. I merge every PR myself.
> - Any UI or branding change bumps `SW_VERSION` in `public/sw.js`.
> - Supabase project `lczmjpnbuhnsislcvzar`, eu-west-2.

---

## Two things to hand Claude Code separately from the screens

These are in `CLAUDE-CODE-HANDOFF.md` and are not screen work. They have a September deadline and
should not wait behind the redesign.

**The unique constraint on `center_assignments`.** There is none on the center identifier today, so
two reps can both mark themselves primary on one center. That is two payouts on one customer, caught
only if someone notices. Check for existing duplicates first, because the constraint will fail if any
exist.

**Claim expiry does not exist as a field.** The commission rules decided on 25 July depend on a claim
having an expiry entirely. Right now it has nowhere to live.

---

## What not to say

Do not tell Claude Code to "build all 103 screens." It will, and you will get 26 PRs in a day that
you cannot meaningfully review, and the money screens will land in the same rhythm as the layout ones.

The whole point of the ordering is that the screens which can quietly lose you money get built and
reviewed while you are still paying attention.
