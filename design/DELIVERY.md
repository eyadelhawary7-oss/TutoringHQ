# How the redesign ships

**Written 26 July 2026. Replaces `REDESIGN-LOOP.md`, which was deleted.**

## The process

**One PR per screen, or per tight group of states for the same screen. Claude Code opens. Eyad
merges. Nothing self-merges.**

Order comes from `IMPLEMENTATION-PLAN.md`: **the daily loop first**, then getting in and staying in,
then legal, then the rest. Admin and CEO last, because no customer sees them.

One branch per PR.

## Why the loop was scrapped

`REDESIGN-LOOP.md` split 105 screens into 70 that self-merged and 35 that did not, cutting the line
at **file** level. `INVENTORY.md` then tagged every screen individually, and the file-level guess did
not survive it.

Applying the real rule — **a screen loops only if it is layout-only and touches no money, no auth and
no account state** — leaves **12 screens**, not 70. Money is spread across nearly every merged file;
`Merged-Center-Setup` alone holds three money or auth screens beside three clean ones.

Twelve self-merging against ninety-three manual is overhead, not leverage. Two of those twelve
(Offline, Lifecycle Status) also sit inside files marked never-touch, and carving an exception into
that rule costs more than it saves.

Two screens the file-level split would have looped were wrong on inspection, which is the clearest
argument against cutting the line at file level at all:

- **CEO Dashboard** was called read-only with *"zero buttons"*. `ceo/page.tsx` PATCHes `platform_config` — the announcement banner and the ops kill-switches. A kill switch changes what every center can do.
- **Admin Privacy Requests** looks like a list. It completes PDPL **deletion** requests. That destroys personal data.

## The rule that decides scrutiny

**Touches money, auth or account state — not merely changes it.** Read-only is not safe: a wrong
number on a screen that only displays is still a decision made on bad data.

Under the looser "changes money or access" reading, seven more screens would have qualified —
Branches, Admin Overview, Admin Analytics, CEO Teachers, Admin Finance Health, Teacher Students,
Teacher Analytics. All are read-only money or state displays. They are **manual** too.

## Rules that carry over unchanged

- **Never open the six money-and-auth files casually**: `Merged-Public-App` · `Merged-Center-Money` · `Merged-Teacher-Money` · `Merged-Admin-Money` · `Merged-Verification-Payouts` · `Merged-Lifecycle`. Largest model, adversarial review. No carve-outs — a rule with one exception gets carved again.
- **Strip the `.mgdN` prefix.** It must never reach the codebase.
- **Do not copy the DOM.** Take layout, spacing, type scale and colour.
- **Sample data is placeholder**, never fixtures or seed data.
- **Verify every column against `information_schema.columns`** before it enters a query. Migration files are not proof. One `SELECT` per MCP call.
- **Bump `SW_VERSION` in `public/sw.js`** on any PR that changes what renders.
- **Red CI never merges.** Never disable a test, never edit a test to go green.

## Stop and ask when

- a screen needs a component that does not exist
- a column you need is not in the live schema
- a design contradicts something already built
- the same fix is needed in more than three files — it belongs in foundations
- you are about to edit a test rather than the code

## Foundations first

Four PRs, merged before any screen: tokens, type, the language system, shared components including
the empty state and loading state from `Merged-Design-Patterns` §01 and §02.

**Audit-and-fill, not build.** PR 1 found the token layer already carries the cream system — eleven
of seventeen design tokens were present and only five were missing. Confirm the same for each
remaining PR before writing it, and **if a PR turns out to be a no-op, say so and skip it rather
than manufacturing a diff.**
