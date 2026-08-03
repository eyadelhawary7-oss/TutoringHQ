# Migration proposal 01 — `sessions` as the single class-occurrence log, `attendance_scans` consolidated onto it

**Status: PROPOSED, NOT APPLIED. Needs Eyad's approval before anything is applied or built against.**

Eyad, 3 August: *"Sessions migration and attendance_scans consolidation first. It is a foundation — Groups §05, Attendance, and Center-Home's schedule all depend on it. Nothing else starts until it lands."* and *"STILL COMES TO ME, never auto-merged: … any new column, table, or migration. Propose, I approve, you apply."*

Those two instructions meet here: the foundation everything waits on is itself a migration, so it cannot be self-applied. This is the proposal. **No code in this PR reads any column below** — building against unapplied columns is exactly F26, four instances of which are live in production right now.

---

## 1. What is actually true today (live catalog, 3 Aug, not migration files)

| table | rows | what it really is |
|---|---:|---|
| `sessions` | 4 | **Teacher-private billing engine only.** Confirms **F17**. |
| `attendance_scans` | 3 | Center-side attendance events. 34 files touch it. |
| `schedule_slots` | 1 | Center-side **recurring template**, not occurrences. |
| `student_groups` | 4 | — |

**`sessions` columns:** `id, group_id NOT NULL, schedule_id, kind NOT NULL, scheduled_at NOT NULL, room text, location jsonb, status, finished_at, billed, billed_at, created_by, created_at`

**Every caller of `sessions` is teacher-private**, verified by grep: 10 routes under `src/app/api/teacher/private/`, plus `teacher/center-attendance/route.ts`, `lib/teacherAnalytics.ts`, `lib/centerAccountMetrics.ts`, `lib/teacherPrivate.ts`. **No center-side route reads it at all.**

**Three facts that decide the design:**
1. **`sessions` has no `center_id`.** It reaches a center only through `group_id → student_groups.center_id`, and `student_groups.center_id` is **nullable**. A teacher-private group has no center. So `sessions` cannot currently be RLS-scoped by center at all.
2. **`sessions` has no `started_at`.** Teacher-Groups' live elapsed timer and Teacher-Insight's "average session time" both need it. `finished_at` exists; the start does not.
3. **`attendance_scans` already has `session_id`, nullable, and nothing populates it as a rule.** The link column exists; the discipline does not.

---

## 2. The consolidation, four parts

### 2.1 Give `sessions` a real tenant key
```sql
ALTER TABLE public.sessions ADD COLUMN center_id uuid REFERENCES public.centers(id);
CREATE INDEX sessions_center_id_scheduled_at_idx ON public.sessions (center_id, scheduled_at DESC);
```
Backfill from `student_groups.center_id`; stays NULL for teacher-private rows, which is correct and meaningful — **NULL center_id *is* the teacher-private marker.**

> **Decision needed (a):** keep `center_id` nullable with NULL meaning teacher-private, or add an explicit `owner_scope text CHECK (owner_scope IN ('center','teacher_private'))`? **Recommendation: the explicit column.** A nullable FK carrying semantic meaning is how `students.center_id` bugs happen, and RLS predicates read far more safely against an enum than against `IS NULL`.

### 2.2 Add the missing time fields
```sql
ALTER TABLE public.sessions ADD COLUMN started_at timestamptz;
```
Unblocks the Teacher-Groups elapsed timer and Teacher-Insight average-duration metric. Nullable: a scheduled-but-not-started session genuinely has no start.

### 2.3 Make `sessions` the occurrence log for center classes
Today center classes have **no occurrence row at all** — only the `schedule_slots` template. Center-Home's schedule derives "billed / next / later" by comparing `end_time` to the clock, which is why the design's "Billed" chip is a *guess*, not a fact (already recorded in `TodayScheduleRow.status`' own comment).

```sql
ALTER TABLE public.sessions ADD COLUMN slot_id uuid REFERENCES public.schedule_slots(id);
ALTER TABLE public.sessions ADD COLUMN session_date date;
CREATE UNIQUE INDEX sessions_slot_date_uniq ON public.sessions (slot_id, session_date) WHERE slot_id IS NOT NULL;
```
The partial unique index is the whole point: it makes materialising an occurrence **idempotent**, so a cron or a lazy read-through can create today's rows without ever double-creating.

> **Decision needed (b):** materialise occurrences **eagerly** (a nightly cron creates today's rows for every active slot) or **lazily** (created on first scan/first view)? **Recommendation: lazy, read-through.** Eager needs a new cron, a `maxDuration` entry, and it manufactures rows for classes that never happen. Lazy means a session row exists exactly when something real touched it.

### 2.4 Consolidate the duplicate columns on `attendance_scans`
`attendance_scans` carries **two pairs that mean the same thing**:

| pair | columns | verdict |
|---|---|---|
| payment method | `payment_method`, `method` | duplicate |
| payment state | `payment_status_at_scan`, `status` | overlapping |

This is the actual "consolidation". It cannot be done blind — **which column each of the 34 call sites writes must be established first**, and that is code work, not a migration. Proposed sequencing:
1. Audit all 34 call sites, map every read/write. *(No approval needed — I can do this now.)*
2. Pick the survivor of each pair, backfill, repoint code, **then** drop.
3. `ALTER TABLE public.attendance_scans ALTER COLUMN session_id SET NOT NULL` only *after* every writer populates it.

> **Decision needed (c):** with only 3 live rows, is a `DROP COLUMN` acceptable, or do you want the losers kept and marked deprecated? **Recommendation: drop.** Three rows, all test data (`is_test`), and a column that half the code writes is worse than no column.

---

## 3. What this unblocks, and what it does not

**Unblocks:** Teacher-Groups §05 elapsed timer + recorded duration · Teacher-Insight average session time and dropout/enrolment trends · Center-Home Schedule's "Billed" chip becoming a fact rather than a clock comparison · Attendance session-scoped queries · a real per-occurrence attendance join.

**Does not unblock, and is not pretended to:** anything needing verification/Valify columns (10 of 19 files), online collection, or the payout ledger. Those are separate proposals.

---

## 4. Risk

Low on data (4 + 3 + 1 rows, all test), **moderate on code**: 34 files touch `attendance_scans`, and §2.4 repoints some of them. Everything in §2.1–2.3 is **additive** — new nullable columns and indexes, no drops, no NOT NULL, no constraint changes. §2.1–2.3 can be applied and is safe with zero code changes; **§2.4 is the only part that must not be applied until the call-site audit is done.**

Per CLAUDE.md rule 5 this is a **manual apply to production**, then confirm in `information_schema`, then deploy code. Not merge-and-assume — that was tested on 15 July and Branching did not apply it.

---

## 5. What I need from you

1. Approve or amend **§2.1–2.3** (additive, safe, unblocks three files immediately).
2. Answer **(a)** nullable `center_id` vs explicit `owner_scope` — I recommend `owner_scope`.
3. Answer **(b)** eager cron vs lazy read-through — I recommend lazy.
4. Answer **(c)** drop the duplicate columns vs deprecate — I recommend drop.
5. **§2.4 is deliberately not specified as final SQL** until the 34-call-site audit runs. I am starting that audit now; it needs no approval and produces the column-by-column map that makes §2.4 safe.
