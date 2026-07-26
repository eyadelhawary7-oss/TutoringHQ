# Running the redesign as a self-merging loop

**Revised 26 July 2026.** Supersedes the earlier version where Claude Code opened PRs and stopped.

**70 of the 105 screens run in a loop that merges itself. 35 stay manual.**

---

## Why merging is acceptable now, and when it stops being

The rule that nothing merges without review exists to protect customers. **There are no customers.**
Production holds two test centers, Paymob is in test mode, and nothing charges anyone. A bad merge
today is a revert, not an incident.

That stops being true the moment a pilot center is running their real operation on this. **When the
first real center loads real student data, this loop goes back to opening PRs and stopping.**

Three things replace your review in the meantime:

- **CI must be green.** It is the gate. No green, no merge, no exceptions.
- **One PR per file.** A revert is then one file, not the whole redesign.
- **The gate after the first two files.** Cheap, and it catches a wrong pattern at file 2 rather than file 20.

---

## The split

**LOOP, 20 files, 70 screens.** Claude Code builds, opens, waits for green, merges, continues.

```
Merged-Center-Home          Merged-Center-Students
Merged-Center-Groups        Merged-Center-Attendance
Merged-Center-Insight       Merged-Center-WhatsApp
Merged-Center-Orders        Merged-Center-Setup
Merged-Teacher-Home         Merged-Teacher-Students
Merged-Teacher-Groups       Merged-Teacher-Insight
Merged-Teacher-WhatsApp     Merged-Teacher-Setup
Merged-Public-Marketing     Merged-Public-Legal
Merged-Admin-Accounts       Merged-Admin-Platform
Merged-CEO                  Merged-Design-Patterns
```

**MANUAL, 6 files, 35 screens.** Largest model, adversarial review, you merge.

```
Merged-Public-App           Merged-Center-Money
Merged-Teacher-Money        Merged-Admin-Money
Merged-Verification-Payouts Merged-Lifecycle
```

The line is not "shows money", it is **changes money or access**. Those six contain record payment,
void, withdraw, approve, verify, set PIN, checkout, upgrade and downgrade. CEO displays revenue and
has zero buttons, so it loops.

A full day went on one route in that family and it turned up a live billing fault where a paid-up
center was told to use the Downgrade tab on its own due date. That was found by adversarial review.
A loop would have shipped it.

---

## Before the loop, two sessions that do not loop

**The inventory.** Prompt in `START-CLAUDE-CODE.md`. Read list three yourself, live routes with no
design, because that is a scope decision rather than a build one.

**Foundations, four PRs, and you merge these yourself even though the loop merges later.** Tokens,
type, the language system, shared components. All 70 screens inherit them, so an error here is an
error everywhere. The language system is the one that is genuinely painful to retrofit.

`Merged-Design-Patterns` sections 01 and 02 are the empty state and the loading state. Both are
components built once in this pass, never per screen.

---

## The prompt

```
Self-merging redesign loop.

You may build, open, merge and continue without stopping, except at the gate in
step 9. You have merge permission for this loop. If gh cannot merge, stop and
tell me rather than working around it.

BEFORE YOU START, confirm all four or stop:
  - design/INVENTORY.md exists and I have approved it
  - the four foundation PRs are merged: tokens, type, language system, components
  - the empty state and loading state components exist and are reusable, built
    from sections 01 and 02 of design/Merged-Design-Patterns.html
  - master is green

FILE ORDER, 20 files, 70 screens:
  Merged-Center-Home, Merged-Center-Students, Merged-Center-Groups,
  Merged-Center-Attendance, Merged-Center-Insight, Merged-Center-WhatsApp,
  Merged-Center-Orders, Merged-Center-Setup,
  Merged-Teacher-Home, Merged-Teacher-Students, Merged-Teacher-Groups,
  Merged-Teacher-Insight, Merged-Teacher-WhatsApp, Merged-Teacher-Setup,
  Merged-Public-Marketing, Merged-Public-Legal,
  Merged-Admin-Accounts, Merged-Admin-Platform, Merged-CEO,
  Merged-Design-Patterns

NEVER TOUCH THESE. They change money or access and I review them myself:
  Merged-Public-App, Merged-Center-Money, Merged-Teacher-Money,
  Merged-Admin-Money, Merged-Verification-Payouts, Merged-Lifecycle

FOR EACH FILE:
  1. Read design/<file>.html. Its header lists every screen and its section.
  2. Use the existing tokens, type scale and components. Do not introduce new
     ones. If a screen needs something that does not exist, STOP and ask.
  3. Strip the .mgdN prefix. It must never reach the codebase.
  4. Do not copy the DOM. Take layout, spacing, type scale and colour.
  5. Sample data is placeholder, never fixtures or seed data.
  6. Verify every column against information_schema.columns before it enters a
     query. Migration files are not proof. One SELECT per MCP call.
  7. Bump SW_VERSION in public/sw.js.
  8. One PR per file. Wait for CI. GREEN MEANS MERGE, RED MEANS STOP AND TELL
     ME. Never merge red, never disable a test, never change a test to go green.
  9. THE GATE: after the first TWO files are merged, stop completely and tell
     me. Do not start the third until I say continue.

AFTER THE GATE, continue through the rest without stopping, but stop immediately
and tell me if any of these happen:
  - CI goes red and the cause is not obvious and trivial
  - a screen needs a component that does not exist
  - a column you need is not in the live schema
  - a design contradicts something already built
  - you are about to touch one of the six forbidden files
  - the same fix is needed in more than three files, which means it belongs in
    the foundations rather than in each screen
  - you find yourself editing a test rather than the code

Report after each file: which screens, the PR number, CI result, merged yes or
no, and anything you decided that I did not specify.

When all 20 are done, run the full suite on master and give me the test count.
```

---

## What to look at when the gate fires

Two files, roughly eight screens, already on master. Read them properly, because the other eighteen
inherit whatever you accept.

- **Arabic is a separate screen, not a translation layer.** Eastern numerals, Arabic currency mark, chevrons flipped. If it is the English DOM with strings swapped, stop the loop.
- **Empty and loading states are the shared components**, not fresh ones written into that screen.
- **No `.mgd` anywhere** in the diff.
- **Sample data did not become seed data.**
- The markup is written properly rather than lifted out of the reference file.

---

## The honest risk

You are trading the ability to catch a mistake per file for finishing in a fraction of the time. The
gate buys most of that back, because a wrong pattern shows up at file two rather than file twenty.

What the gate does not catch is slow drift: file eleven quietly stops using the shared empty state
and writes its own. Nothing fails, CI stays green, and you find it much later. Worth skimming the
diffs even on files you are not formally reviewing.

**The one rule with no flexibility: red CI never merges.** The moment a test gets changed to make a
build pass, this loop has stopped being safe. That is exactly how the billing fault survived as long
as it did, and it was found because a test was left red rather than quietly adjusted.
