# Migration proposal 01 — `sessions` as the single class-occurrence log, `attendance_scans` consolidated onto it

**Status: APPROVED 4 August (all four decisions, §6). DDL WRITTEN, NOT APPLIED — `supabase/migrations/20260804120000_sessions_tenant_key_and_occurrence_uniqueness.sql`, see §7. Eyad applies it by hand (rule 5). §2.3 as originally written is SUPERSEDED — see §5. No code reads any of these columns until the apply is confirmed in `information_schema`.**

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

## 5. SUPERSEDED — corrections from `SESSIONS-MIGRATION-WARNINGS.md` (branch `claude/visual-identity-agent-pipeline-qp5dpn`, 5a1b008)

**Another session reproduced three failures against live in the obvious form of this migration. §2.3 above is wrong as written. Do not apply it.** Corrections, and one item that doc left open which I have now closed.

### 5.1 — My §2.3 index would double-charge students. Replace it.
I proposed a unique index on `(slot_id, session_date)`. The warning doc's objection applies to any key built on an **instant**: a slot time edit, or the Egypt DST transition (09:00 Cairo is `07:00Z` on 2026-04-23 and `06:00Z` on 2026-04-24), mints a second row → second `session_id` → different `lesson:<session_id>:<student_id>` idempotency key → `fee_per_class` and `center_cut_egp` both charged **twice**. Reproduced live.

My `session_date date` column would have masked but not fixed this, because nothing constrains it to agree with `scheduled_at`. Correct form, keyed on the **Cairo occurrence day** and excluding cancelled rows:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS sessions_generated_occurrence_uniq
  ON public.sessions (
       schedule_id,
       ((scheduled_at AT TIME ZONE 'Africa/Cairo')::date)
     )
  WHERE schedule_id IS NOT NULL
    AND status <> 'cancelled';
```
`timezone(text, timestamptz)` is IMMUTABLE so this is directly indexable. `scheduled_at::date` is **STABLE** and Postgres rejects it. The `status <> 'cancelled'` predicate is **not cosmetic**: cancel-then-restart on the same Cairo day is a path that works in production today, and without the exclusion it starts failing with 23505.

**This also removes the need for my proposed `session_date` column.** Dropped from the proposal.

### 5.2 — `ADD CONSTRAINT` needs a guard
Migrations here are hand-applied, so a partial apply leaves a script that errors on re-run (42710, verified). Every `ADD CONSTRAINT` must sit in a `DO` block testing `pg_constraint`. `CREATE INDEX`/`ADD COLUMN` take `IF NOT EXISTS` directly.

### 5.3 — Two facts that change what a generator can be, both outside this migration
- **`schedule_exceptions.schedule_id` FKs to `group_schedule`, not `schedule_slots`.** A generator iterating `schedule_slots` holds the wrong id class, so exception lookups match **zero rows forever** and cancelled classes regenerate silently. This repo has already shipped that exact bug once (`src/lib/parentPack.ts` documents it). Consequence: **centre-side generation has no cancellation mechanism at all today**, and building one is its own schema change.
- **A generated `status='scheduled'` row is not inert.** `.../schedule/sessions/route.ts` checks the day window with no filter on status/kind/source/billed and returns `already_exists: true` **before** billing — so a placeholder would **suppress real billing**. A `source <> 'generated'` filter must land on that guard *and* the start route **before** any generator ships.
- **`scheduled → finished` is blocked by `trg_guard_sessions_lifecycle`, a trigger, not RLS.** Adding an UPDATE policy alone would ship and do nothing.

### 5.4 — `schedule_slots.parent_slot_id`: the open item, now closed
The warning doc flagged this as **examined by nobody** — its reviewer died mid-run. I checked it.

**Verified: it is a dead column.** Self-FK `REFERENCES schedule_slots(id) ON DELETE SET NULL`. Live: **1 slot, 0 with a parent**. Grep across `src/` and `supabase/`: **zero writers, zero readers** — it appears only in the baseline and in the archived migration that added it (`025_schedule_group_recurring.sql`, alongside `recurring` and `recurring_until`, under the heading "recurring slot support").

**So ignoring it does not cause duplicate occurrences today** — nothing populates it. That is the direct answer to the open question.

**But it is a latent duplicate-occurrence hazard, and the reason matters.** The column exists to support materialising a recurring slot into child *slot* rows. Recurrence today is expanded **at read time** by matching `day_of_week` — `src/app/[locale]/schedule/page.tsx:113` says so in its own comment: *"schedule_slots is a recurring weekly template with no per-occurrence…"*. If a `sessions` generator materialises occurrences **and** anyone later implements slot-expansion the way this column intends, there are two independent materialisation mechanisms for the same class-day, and they will collide.

**Recommendation: drop `parent_slot_id` in this migration.** It is dead, it is unreferenced, and leaving it is an invitation to build the second mechanism. If you would rather keep it, then the generator must explicitly filter `WHERE parent_slot_id IS NULL` and that filter needs a comment explaining why.

Also noted: the one live slot has `recurring = true` with `recurring_until = NULL` — an **unbounded** recurrence. A generator needs an explicit horizon; there is no natural end date in the data.

---

## 6. ANSWERS — four decisions, live-verified 4 August

Re-queried the live catalog before answering. **Two answers changed as a result**, and one question turned out to be already solved by an existing column.

### (a) `owner_scope` vs nullable `center_id` — ANSWER: **neither. `sessions.kind` already is the discriminator.**

I recommended adding `owner_scope`. That was wrong — the column already exists:

```
sessions_kind_chk  CHECK (kind = ANY (ARRAY['center', 'private']))
```

`kind` is **NOT NULL** and already constrained to exactly the two values I was about to re-invent. Adding `owner_scope` would create a second source of truth for the same fact, which is the `referral_reward_records` / `referral_commissions` failure shape (D22) — two columns meaning one thing, drifting apart.

**What live data proves, and why it kills the nullable-`center_id` option outright:** all 4 `sessions` rows are `kind='private'`, but **two of them sit on a group that HAS a `center_id`** (group `ewfinewfiew`, a test centre). So:

| session | kind | group has center_id |
|---|---|---|
| 887fbfda | private | **yes** |
| 17866373 | private | **yes** |
| acdf8142 | private | no |
| bc597d9c | private | no |

Backfilling `center_id` from `student_groups.center_id` would give two **private** sessions a non-null `center_id`. Under the "NULL means teacher-private" rule those two would read as centre sessions. **The semantic is already false on today's data** — not theoretically fragile, actually wrong.

**Recommendation:** add `center_id` purely as a **tenant key for RLS and indexing**, carrying no ownership meaning, and keep `kind` as the sole owner discriminator. RLS predicates read `kind = 'center' AND center_id = …`, never `center_id IS NULL`.

### (b) Eager cron vs lazy read-through — ANSWER: **lazy, unchanged.**

Reinforced by a fact from §5.4: the one live slot is `recurring = true` with `recurring_until = NULL` — an **unbounded** recurrence. An eager generator has no natural stopping point and would need an invented horizon. Lazy materialisation has no horizon problem: a row exists exactly when something real touched it.

### (c) Drop the duplicate `attendance_scans` columns — ANSWER: **yes, drop — but the sequencing matters more than I said, and I had one fact wrong.**

**Correction to §2.4.** I wrote that `attendance_scans.session_id` is "nullable, and nothing populates it as a rule." That is wrong as stated. Live: **3 of 3 scans have `session_id` populated.** The accurate statement is narrower and more useful:

- The **teacher-private** path populates `session_id` (every reader/writer of it lives under `api/teacher/private/*`).
- The **centre scanner** path — the 34-file `attendance_scans` surface — does **not**.
- All 3 live scans are teacher-private, which is why the column looks fully populated.

**Consequence:** `ALTER COLUMN session_id SET NOT NULL` must **not** be applied on the strength of "3/3 rows are populated." It would break the centre scanner the first time a centre scan is recorded. NOT NULL comes only after the centre path populates it too — which is Phase 1's dependency, not this migration's.

The duplicate pairs (`payment_method`/`method`, `payment_status_at_scan`/`status`) still get dropped, still only after the 34-call-site audit maps which writer uses which.

### (d) Drop dead `parent_slot_id` — ANSWER: **yes, drop. Re-verified 4 August, and this closes the question the dead reviewer left open.**

| check | result |
|---|---|
| `schedule_slots` total rows | **1** |
| rows with `parent_slot_id` set | **0** |
| writers/readers in `src/` | **zero** — appears only in `baseline.sql` and archived `025_schedule_group_recurring.sql` |
| `schedule_exceptions` rows | **0** |

**Direct answer to "does ignoring it cause duplicate occurrences?" — no, not today.** Nothing populates it, so a generator that ignores it cannot double-count anything.

**It is a latent hazard, not a live one.** Recurrence is expanded at *read* time by matching `day_of_week` (`src/app/[locale]/schedule/page.tsx:113` says so in its own comment: *"schedule_slots is a recurring weekly template with no per-occurrence…"*). The column exists to support materialising slots into child slot rows — a **second** materialisation mechanism. Build the `sessions` generator and leave this column, and a later implementation of slot-expansion collides with it. Dropping it now makes the generator the single mechanism by construction.

If you would rather keep it, the generator must carry an explicit `WHERE parent_slot_id IS NULL` with a comment saying why — strictly worse than deleting a column nothing reads.

### One more live fact that bears on the "pattern of record" question

`group_schedule` holds **6 rows**; `schedule_slots` holds **1**. The warnings doc flags that `schedule_exceptions.schedule_id` FKs to `group_schedule`, not `schedule_slots`. So the table the exceptions mechanism is actually wired to is also the one carrying six times more data. That is worth weighing before declaring `schedule_slots` the pattern of record — it is not part of this additive migration, but it will decide the generator's shape.

---

## 7. The DDL — written, not applied

All four answers approved by Eyad on 4 August. The DDL is:

**`supabase/migrations/20260804120000_sessions_tenant_key_and_occurrence_uniqueness.sql`**

Per rule 5 it is a **manual apply to production by Eyad**. Merging the file does not apply it. No code reads any column in it until it is applied and confirmed present in `information_schema.columns`.

### What is in it

| part | change | source |
|---|---|---|
| 1 | `sessions.center_id uuid` + FK + backfill + `(center_id, scheduled_at DESC)` index, documented as a **tenant key with no ownership meaning** | §6(a) |
| 1b | trigger deriving `center_id` from the group — **my addition, not one of the four; strike-able** | below |
| 2 | `sessions.started_at timestamptz` | §2.2 |
| 3 | `sessions_generated_occurrence_uniq` on `(schedule_id, Cairo occurrence day)` `WHERE schedule_id IS NOT NULL AND status <> 'cancelled'` | §5.1 |
| 4 | `DROP COLUMN schedule_slots.parent_slot_id` + the latent-hazard log | §6(d), F27 |

Every `ADD CONSTRAINT` sits in a `DO` block testing `pg_constraint` (§5.2); every `ADD COLUMN` / `CREATE INDEX` uses `IF NOT EXISTS`. The file re-runs cleanly after a partial apply.

### One change from the approved text: `slot_id` is not in the DDL

§2.3 asked for `sessions.slot_id uuid REFERENCES schedule_slots(id)`. **That column already exists under another name.** Live catalog, 4 August:

```
sessions_schedule_id_fkey
  FOREIGN KEY (schedule_id) REFERENCES schedule_slots(id) ON DELETE SET NULL
```

`sessions.schedule_id` **is** the slot reference. Adding `slot_id` would put two columns on one table pointing at the same table meaning the same thing — the D22 shape, and the same mistake §6(a) caught with `owner_scope`. The corrected §5.1 index already keys on `schedule_id`; part 3 matches it. Nothing §2.3 wanted `slot_id` for is lost.

### One thing I added that you did not approve — block 1b

The part-1 backfill is one-shot. Without a trigger, every `sessions` INSERT written from today leaves `center_id` NULL until application code is changed to set it, and a tenant key that is silently NULL on new rows is worse than no tenant key: a later RLS predicate reading it matches nothing, or — written the other way — everything. Block 1b derives it from the group the row is already FK'd to, so it cannot disagree with `student_groups.center_id`.

It is fenced with `-- END OF 1b`. Delete the block and the rest applies cleanly; the cost is that Phase 1 code must set `center_id` on every `sessions` INSERT itself. It touches no lifecycle rule and leaves `trg_guard_sessions_lifecycle` alone.

### Preconditions, re-queried live immediately before writing the file

`sessions.center_id` absent · `sessions.started_at` absent · `schedule_slots.parent_slot_id` present with **0** rows populated · 4 `sessions` rows, **0** with `schedule_id` (so part 3's partial index covers zero rows and cannot fail on creation) · **0** duplicate `(schedule_id, Cairo day)` pairs, checked not assumed · **2** sessions whose group has a `center_id`, which is what the backfill touches · **0** `attendance_scans` with a NULL `session_id`, which is explicitly *not* grounds for NOT NULL · all four object names free · `timezone(text, timestamptz)` IMMUTABLE, so the Cairo expression is directly indexable.

### Still outstanding after this lands

**§2.4's duplicate-column drops** (`payment_method`/`method`, `payment_status_at_scan`/`status`) are approved in principle but not written, and `ALTER COLUMN attendance_scans.session_id SET NOT NULL` is **held back on your instruction** until the centre scanner path populates it. Both are listed as deliberate omissions in part 5 of the DDL file. They come back as a second migration after the 34-call-site audit.
