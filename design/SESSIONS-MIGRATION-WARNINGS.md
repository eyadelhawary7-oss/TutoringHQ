# Sessions migration — three findings before you key that index

**Written 3 August 2026. Read this before applying any migration to `public.sessions`
or designing a generator that writes occurrence rows from a recurrence pattern.**

These came out of an adversarial review of a session-generation proposal. Every
fact below was read from the **live catalog** (`pg_constraint`, `pg_policies`,
`pg_indexes`, `information_schema`) on project `lczmjpnbuhnsislcvzar`, not from a
migration file and not from a summary. Two of the three were **reproduced on the
live server**. The proposal that triggered this review got all three wrong.

---

## 1. Keying on `(schedule_id, scheduled_at)` double-charges students

**The obvious idempotency key is the wrong key.** `scheduled_at` is an *instant*.
The billable unit is a **Cairo class-day**.

Two ways the same class-day yields two different instants:

- **A slot time edit.** A 09:00 slot moved to 10:00 changes `scheduled_at` for the
  same class day. A generator re-run inserts a second row.
- **An Egypt DST transition.** Probed against the server's own tzdata: 09:00
  Africa/Cairo is `07:00Z` on 2026-04-23 and `06:00Z` on 2026-04-24. Same wall
  clock, same slot, different instant.

**Why that costs money.** A second `sessions` row means a second `session_id`,
which means a different `lesson:<session_id>:<student_id>` idempotency key, which
means `transactions_idempotency_key_key` never fires. The student is charged
`fee_per_class` twice and `center_cut_egp` is taken twice.

**Reproduced** on the live server in a `TEMP` table: three inserts for one slot —
`2026-08-10 06:00Z` twice, then `07:00Z` representing a 09:00→10:00 edit — left
**2 rows on 1 distinct Cairo day** under the naive index.

**Use the Cairo occurrence day instead:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS sessions_generated_occurrence_uniq
  ON public.sessions (
       schedule_id,
       ((scheduled_at AT TIME ZONE 'Africa/Cairo')::date)
     )
  WHERE schedule_id IS NOT NULL
    AND status <> 'cancelled';
```

`timezone(text, timestamptz)` is `provolatile='i'` (IMMUTABLE), so this expression
is directly indexable — no generated column needed. Do **not** write
`scheduled_at::date`: `date(timestamptz)` is STABLE and Postgres rejects it.

---

## 2. `schedule_exceptions` points at a different table than you think

There are **two schedule tables**, and they use the same column name for ids from
different parents:

| | FK target | `day_of_week` |
|---|---|---|
| `sessions.schedule_id` | **`schedule_slots(id)`** `ON DELETE SET NULL` | `schedule_slots.day_of_week` is **text** |
| `schedule_exceptions.schedule_id` | **`group_schedule(id)`** `ON DELETE CASCADE` | `group_schedule.day_of_week` is **smallint** |

A generator that iterates `schedule_slots` holds a `schedule_slots.id`. Looking up
`schedule_exceptions` by that id **matches zero rows on every run, forever** — so
every cancellation is silently ignored and cancelled classes are regenerated.

This repo has already been bitten by this exact failure mode. `src/lib/parentPack.ts`
carries the comment that a previous version *"matched zero rows on every run, so the
parent absence alert never fired once while looking like a working feature."*

`schedule_exceptions` is empty today (0 rows), so nothing is visibly broken. The
defect is that the algorithm **cannot ever work**, not that it currently misbehaves.

**The consequence is bigger than a bug:** centre-side generation has **no
cancellation mechanism at all** today. Building one is itself a schema change, and
it belongs in the "which table is the pattern of record" decision — not in a
generator PR.

---

## 3. The index needs `AND status <> 'cancelled'` or you break a working path

This one is not cosmetic and it is easy to miss — neither of the two independent
reviewers caught it.

`.../schedule/sessions/[sessionId]/cancel/route.ts` transitions an existing row to
`status='cancelled'` via `apply_session_transition`. The start route then looks only
for `live`/`finished`/`scheduled`, so it creates a **fresh row on the same Cairo
day**. That cancel-then-restart sequence succeeds in production today.

**Reproduced:** with a unique index on `(group_id, Cairo day)` and no cancelled
exclusion, inserting a `cancelled` row for 2026-08-10 and then a `live` row for the
same Cairo day fails with **SQLSTATE 23505**.

Any occurrence-uniqueness index must exclude cancelled rows, or it ships a
regression on a path that works.

---

## Four things that are the owner's decision, not a correctness call

1. **Which table is the pattern of record** — `schedule_slots` (centre schedule
   board) or `group_schedule` (private/teacher money path)? This decides everything
   downstream, including whether a cancellation mechanism has to be designed.
2. **Is a generated session billable, or a display placeholder?** If display-only,
   most of the money blast radius evaporates. If billable, the generator makes
   `finish_center_class_and_bill` reachable **for the first time in production** —
   it has no caller in the repo and has never executed.
3. **Whose teacher is authoritative?** On the only live slot, `schedule_slots.teacher_id`
   and its group's `student_groups.teacher_id` are **different people**. Billing pays
   the group's teacher unconditionally.
4. **Should `(group_id, Cairo day)` become a hard constraint?** Both write paths
   already enforce it in application code. Making it a DB constraint converts some
   requests that return 200 today into 23505 errors — a behaviour change, not an
   additive one.

---

## Three more traps, briefly

- **A generated `status='scheduled'` row is not inert.**
  `.../schedule/sessions/route.ts` queries the day window with **no filter on
  status, kind, source or billed** and returns `charges_created: 0,
  already_exists: true` *before* billing. A generated placeholder would **suppress
  real billing** for that class. Any generator needs a `source <> 'generated'`
  filter added to that guard and to the start route **before** it ships.
- **`ADD CONSTRAINT` has no `IF NOT EXISTS`.** Re-running raises 42710 (verified).
  Since migrations are hand-applied to production, guard it in a `DO` block on
  `pg_constraint` or a partial apply leaves a script that errors on re-run.
- **The `scheduled → finished` transition is blocked by a TRIGGER, not just RLS.**
  `trg_guard_sessions_lifecycle` raises 23514 on any change to `status`, `billed`,
  `billed_at` or `finished_at` outside `apply_session_transition` /
  `finish_class_and_bill`. Adding an RLS UPDATE policy alone would ship and do
  nothing. (`sessions` has only `sessions_select` and `sessions_insert` — no UPDATE
  and no DELETE policy at all.)

---

## One caveat on this review

Three reviewers were dispatched; the **migration-correctness reviewer died mid-run**
with a server error. The adjudicator independently re-covered most of that ground —
index immutability, `CONCURRENTLY`, re-runnability, DST. **`schedule_slots.parent_slot_id`
was examined by nobody.** Whether ignoring it causes duplicate occurrences is still
unchecked.
