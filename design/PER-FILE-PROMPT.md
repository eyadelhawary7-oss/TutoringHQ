# The per-file prompt

One prompt per merged file. Twenty-six of them, one at a time. Each one takes a single
`Merged-*.html` from wherever it is today to **100% of the design** — features and structure and
styling — or states precisely why it cannot get there.

Copy the block below, fill the three placeholders, send it.

---

## The prompt

```
FILE: Merged-<NAME>.html
FEATURES: <entry ids from BUILD-AFTER-REDESIGN.md, e.g. R5, R7 — or "none">
SECTIONS: <e.g. §01–§04, or "all">

Take this file to 100%. Features first, then structure, then styling. Do not
start styling until the structure is right.

STEP 1 — SURVEY BEFORE YOU TOUCH ANYTHING.
Read every section of the merged file against the live route that serves it.
For each section, list:
  - the design's sections in the design's order, and what data each one carries
  - which of those the live screen renders today, and in what order
  - structure coverage as a FRACTION: sections present / sections drawn
  - for every missing section: the exact table and columns it would need,
    CHECKED AGAINST information_schema, not assumed
Report the fraction before you write a line of code. If it is already high,
say so — a screen that already matches the design is done, and saying so is a
better outcome than a diff.

STEP 2 — BUILD THE FEATURES.
The entries in FEATURES are yours to build. Read each one in
BUILD-AFTER-REDESIGN.md first — the "do not improve away" notes are there
because the obvious shortcut was already considered and rejected.

STEP 3 — BUILD THE MISSING STRUCTURE.
Every section from step 1 whose data exists gets built, in the design's order.
Sections whose data does NOT exist are omitted entirely — never rendered
disabled, greyed, or "coming soon" — and logged with the specific column that
is missing. Never invent a figure to fill the shape of a card.

STEP 4 — RESTYLE TO THE DESIGN.
Only now. Tokens, spacing, type, radii, component shapes.

STEP 5 — REPORT.
  - structure coverage as a fraction, before and after
  - what was built, what was omitted and the exact reason
  - what is still blocked and by which entry id
  - a screenshot of one screen from this file, EN and Arabic
Never report "done". Report the fraction.

RULES THAT STILL APPLY.
  - Verify against the live catalog, never against a migration file or a
    summary. Confirm a column exists before querying it.
  - The six protected files — Public-App, Center-Money, Teacher-Money,
    Admin-Money, Verification-Payouts, Lifecycle — come to Eyad. Behaviour,
    not filename, decides: a WRITE, a MONEY FIGURE or an ENTITLEMENT CHECK
    comes to Eyad wherever it lives.
  - Own branch, own PR, one merged file per PR. Never merge red. Never edit a
    test to reach green.
  - Stop and ask if the same fix is needed in more than three files — that
    belongs in the foundations, not in this PR.
  - Log the PR in design/CHANGE-LOG.md and bump SW_VERSION.
```

---

## Why the prompt is shaped this way

**Features before structure before styling, in that order and enforced.** The three restyle PRs
that preceded this method — `#214` Center-Home, `#216` Center-Students, `#218` Center-Groups —
applied the design's tokens to the **existing layout** and were reported as restyled. Route coverage
was 2/2, 4/4 and 5/5, so nothing looked wrong. Center-Home's live screen renders Quick Actions, At a
glance, At-Risk Students and Trends; the design draws a balance card, an unpaid-links alert, four
Today KPIs, a digital-share meter and a schedule. Same route, different screen, correctly restyled.
Styling last is the only ordering that makes that failure impossible.

**Survey first, and report the fraction before writing code.** The gap above was found by Eyad
looking at the screen, not by me reading the design — because I never compared them section by
section. Step 1 forces the comparison to happen while it is still cheap.

**"Report the fraction, never report done."** "Restyled" and "done" both concealed a screen that was
missing most of its structure. A fraction cannot conceal that. If a file lands at 3/5, that is a
useful, honest result and the remaining 2/5 stays visible in the next report.

**Omit, never stub.** Unchanged from the original brief and worth keeping verbatim: a plausible fake
number is worse than a smaller card, because nobody questions it afterwards. The corollary the
restyle passes got wrong is that *omission is for missing data, not for missing effort* — four of
Center-Home's five sections have their data sitting in `sessions`, `payments.method`, `enrollments`
and `invoices`, and were skipped anyway.

**Check `information_schema` before querying a column.** Kept from `CLAUDE.md` because CI has no live
database, so a missing column passes every gate and fails in production. This is the rule that
caused the July 8 student-detail outage.

## Suggested order

`FILE-COMPLETION-TABLE.md` ranks all 26 by how close each is to completable. The first three can
reach 100% today:

1. **Design-Patterns** — `R4`. No routes because it is components, not screens. Highest leverage:
   every later file adopts these instead of reinventing them.
2. **Admin-Accounts** — `R5`, `R7`. Fully routed, both entries READY, unprotected.
3. **Admin-Platform** — no backlog entries at all. Structure and restyle only.

Center-Home, Center-Students and Center-Groups need **reopening**, not continuing. They are at
`token pass only` and their remaining work is structural.
