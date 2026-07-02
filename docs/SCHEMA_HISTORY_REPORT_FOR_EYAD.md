# Your database can now be rebuilt from scratch — plain-language report

**In one line:** your code repository can now recreate the entire live database
from nothing, the version mismatch between the code and the database is fixed, and
the old unused `pin_code` login column has been safely removed. Production was
**not** re-run — the only change made to the live database was removing that one
dead column.

Nothing has been merged. This is on a branch waiting for your review. No pull
request has been opened.

---

## What was wrong

1. **The database's full history was missing from the code.** The live database
   was built up over ~217 changes, but the code repository only kept the last few
   weeks of them. If you had ever tried to rebuild the database from the code
   alone, it would **not** have matched what's live — big pieces (core tables,
   security rules) existed only in production. (Phase 0, earlier, had already
   photographed the old history into one "baseline" file; this job confirmed that
   baseline is correct and finished the reconciliation on top of it.)

2. **The code and the database disagreed on version numbers.** The recent change
   files in the code were labelled with made-up timestamps, while the live
   database recorded the real ones. Because of that mismatch, an automated
   "push" of the code to the database could have tried to re-run changes that
   were already applied — risky.

3. **The old `pin_code` column was still in production.** A change to remove it
   had been written but never applied, so the dead column lingered on the live
   `users` table.

4. **(Found during the work) Two database functions had drifted.** Two functions
   on the live database differed from the code — but only by **comments**. The
   actual logic (including the summer/teacher billing routine) was identical. So
   there was no behaviour difference, just a cosmetic mismatch that would have
   stopped a clean rebuild from matching. I fixed it in the code only; I did not
   change anything on the live database.

---

## What I did

- **Confirmed the full picture against the live database first**, then wrote down
  exactly what was missing, what had drifted, and what wasn't recorded.
- **Fixed the version mismatch** by renaming the recent code files to the real
  timestamps the database recorded. After this, a "push" to the database would do
  **nothing** — proven, zero changes (see below).
- **Recorded two housekeeping entries** in the database's change-log so it now
  matches reality: one for the `pin_code` removal, and one for a set of
  performance indexes that were already live but had never been logged. Neither
  touched the schema or any data.
- **Removed the dead `pin_code` column** from the live `users` table — the single
  production change — but only after proving it was safe:
  - No code reads or writes it any more (the real "has a PIN" signal is a
    different field, `pin_set_at`).
  - Nothing inside the database (functions, security rules, indexes) referenced
    it.
  - It was empty for every user; `pin_set_at` is filled in for all real users.
  - Sign-in does not use it (login checks the Supabase account password), so
    sign-in is unaffected — all automated tests pass.
- **Tidied the two drifted functions in the code** (moved comments out of the
  function bodies) so the code recreates them exactly as they are live — with no
  change to their behaviour and no change to production.
- **Regenerated the schema fingerprint** and proved everything lines up.

---

## Proof it all works

- **Rebuild from zero equals live.** I built the whole database from an empty
  server using only the code's change files, then compared it to the live
  database's fingerprint. They are **identical, down to the byte** (matching
  fingerprint `7378a91e…`). So the database can now be recreated from the code
  alone.
- **A "push" to production would change nothing** — verified: 0 pending changes.
- **Production was never re-run.** The only live change in this whole job was
  removing the `pin_code` column, and it's confirmed gone.
- **Everything green:** all 1081 automated tests pass, the type-check passes, and
  both database drift guards are satisfied.

---

## What needs your review

- This is on branch `claude/db-history-rebuild-pin-code-hnbhpv`, **no pull
  request opened** — waiting for your go-ahead.
- One thing worth a look: the two functions that had drifted include
  `process_due_subscriptions`, part of the teacher billing routine. The change I
  made was **comment-only** (the code now matches the live logic exactly), and I
  did not touch production for it — but since it's near billing, I'm flagging it
  so you're aware.

Full technical detail (the three inventory lists, the exact fingerprints, the
safety checks, and the reconciliation) is in `docs/SCHEMA_HISTORY_TECHNICAL.md`.
