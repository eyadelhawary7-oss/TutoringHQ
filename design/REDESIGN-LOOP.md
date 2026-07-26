# Running the redesign as a loop

**Written 26 July 2026.** Companion to `IMPLEMENTATION-PLAN.md` and `START-CLAUDE-CODE.md`.

104 screens across 26 merged files. **66 of them, in 19 files, are safe to loop. 38 of them, in 7
files, are not.** This document is the loop, its gates, and the list of what stays out of it.

---

## Before the loop, two sessions that are not loopable

### Session 1, the inventory

Without it the loop guesses which designs replace a live route, which are new builds, and which live
routes have no design at all. Prompt is in `START-CLAUDE-CODE.md`.

**Read list 3 yourself before the loop starts.** Live routes with no design either get one or get
deleted, and that is a scope decision, not a build decision.

### Session 2, foundations

Every one of the 66 screens inherits these. Four PRs, reviewed individually:

1. Tokens. Colour, spacing, radius, shadow, as CSS variables.
2. Type. IBM Plex Sans, Plex Sans Arabic, Plex Mono, including the rule that Mono is dropped on Arabic frames in favour of weight 600.
3. **The language system.** Eastern Arabic numerals, Arabic currency mark, RTL, directional icons that flip. This is the one that is genuinely painful to retrofit.
4. Shared components, from `Merged-Design-Patterns`. Row actions, quick menu rows, group actions, expand sheet, **and the empty state**.

**The empty state is a component, not a per-screen drawing.** Section 01 of `Merged-Design-Patterns`
has the pattern and the binding rules. Build it once here. If it gets reimplemented per screen you
will end up with nineteen versions of it.

---

## The 19 files the loop may touch, in order

Daily loop first, because that is what a pilot center actually uses.

```
Merged-Center-Home            Merged-Center-Students
Merged-Center-Groups          Merged-Center-Attendance
Merged-Center-Insight         Merged-Center-WhatsApp
Merged-Center-Orders          Merged-Center-Setup
Merged-Teacher-Home           Merged-Teacher-Students
Merged-Teacher-Groups         Merged-Teacher-Insight
Merged-Teacher-WhatsApp       Merged-Teacher-Setup
Merged-Public-Marketing       Merged-Public-Legal
Merged-Admin-Accounts         Merged-Admin-Platform
Merged-Design-Patterns
```

## The 7 files the loop must never touch

```
Merged-Public-App             Merged-Center-Money
Merged-Teacher-Money          Merged-Admin-Money
Merged-Verification-Payouts   Merged-Lifecycle
Merged-CEO
```

38 screens. Money, auth, account state. These go one at a time, largest model, adversarial review.
A full day was spent on one route in this family and it turned up a live billing fault where a
paid-up center was told to use the Downgrade tab on its due date. A loop would not have found that.

---

## The loop prompt

```
Redesign loop. You may work through the file list below without stopping between
files, EXCEPT at the gate described in step 4.

BEFORE YOU START, confirm all four or stop and tell me which is missing:
  - design/INVENTORY.md exists and I have approved it
  - the four foundation PRs are merged: tokens, type, language system, components
  - the empty state component exists and is reusable, built from section 01 of
    design/Merged-Design-Patterns.html
  - master is green

FILE ORDER (19 files, 66 screens):
  Merged-Center-Home, Merged-Center-Students, Merged-Center-Groups,
  Merged-Center-Attendance, Merged-Center-Insight, Merged-Center-WhatsApp,
  Merged-Center-Orders, Merged-Center-Setup,
  Merged-Teacher-Home, Merged-Teacher-Students, Merged-Teacher-Groups,
  Merged-Teacher-Insight, Merged-Teacher-WhatsApp, Merged-Teacher-Setup,
  Merged-Public-Marketing, Merged-Public-Legal,
  Merged-Admin-Accounts, Merged-Admin-Platform, Merged-Design-Patterns

NEVER TOUCH THESE, they are money or auth and I handle them separately:
  Merged-Public-App, Merged-Center-Money, Merged-Teacher-Money,
  Merged-Admin-Money, Merged-Verification-Payouts, Merged-Lifecycle, Merged-CEO

FOR EACH FILE:
  1. Read design/<file>.html. Its header lists every screen and the section it
     is in. Work through them in order.
  2. Use the existing tokens, type scale and components. Do not introduce new
     ones. If a screen needs something the component set does not have, STOP and
     ask me rather than inventing it.
  3. Strip the .mgdN scoping prefix. It must never reach the codebase.
  4. Do not copy the DOM. Take layout, spacing, type scale and colour, and write
     the markup properly.
  5. Sample data is placeholder, never fixtures or seed data.
  6. Verify every column against information_schema.columns before it enters a
     query. Migration files are not proof.
  7. Bump SW_VERSION in public/sw.js.
  8. One PR per file, held branch, do not merge.

THE GATE: after the FIRST TWO files, stop the loop completely and tell me they
are ready. Do not start the third until I say continue. If the pattern is wrong
I would rather fix two files than nineteen.

AFTER THE GATE: continue through the remaining files without stopping, but stop
immediately and tell me if any of these happen:
  - a screen needs a component that does not exist
  - a column you need is not in the live schema
  - a design contradicts what is already built
  - you are about to touch one of the seven forbidden files
  - the same fix is needed in more than three files, which means it belongs in
    the foundations rather than in each screen

Report after each file: which screens, the PR number, and anything you had to
decide that I did not specify.
```

---

## What to look for at the gate

Two files, roughly seven screens. Read them properly, because everything after
inherits whatever you accept here.

- **Arabic is a separate screen, not a translation layer.** Eastern numerals, Arabic currency mark, chevrons flipped. If the Arabic side is the English DOM with strings swapped, stop the loop.
- **The empty state is the shared component**, not a fresh one written into that screen.
- **No `.mgd` anywhere** in the diff.
- **Sample data did not become seed data.**
- The markup is written properly rather than lifted out of the reference file.

## Review burden, so you can plan the day

19 loop PRs plus 7 careful ones is 26 reviews. At ten minutes each that is a bit over four hours,
and the seven money ones take longer than ten minutes. Do not try to do all of it in one sitting;
the money files deserve fresh attention rather than whatever is left at the end.
