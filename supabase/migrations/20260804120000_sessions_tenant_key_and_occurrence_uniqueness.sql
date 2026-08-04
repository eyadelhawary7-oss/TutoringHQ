-- ============================================================================
-- Migration proposal 01 — `sessions` tenant key, start time, and per-occurrence
-- uniqueness; plus the drop of dead `schedule_slots.parent_slot_id`.
--
-- ****************************************************************************
-- * NOT APPLIED. This file is the DDL for Eyad to read and apply by hand.     *
-- * CLAUDE.md rule 5: migrations are a manual apply to production. Merging    *
-- * this file does NOT apply it (tested 15 July 2026: PR #159 merged as       *
-- * 80f82ba and the columns were still absent 8 minutes later).               *
-- * NO CODE READS ANY COLUMN BELOW until this has been applied and confirmed  *
-- * present in information_schema.columns. Building first is F26.             *
-- ****************************************************************************
--
-- Approved by Eyad, 4 August 2026, as the four answers in
-- design/MIGRATION-PROPOSAL-01-sessions-consolidation.md §6:
--   (a) `sessions.kind` stays the sole owner discriminator. `center_id` is
--       added as a pure tenant key with NO ownership meaning.
--   (b) Occurrences materialise lazily, so no generator and no cron here.
--   (c) Duplicate `attendance_scans` columns get dropped LATER, after the
--       34-call-site audit. `session_id SET NOT NULL` is explicitly held back.
--   (d) `schedule_slots.parent_slot_id` is dropped.
--
-- PRECONDITIONS, re-queried live 4 August 2026 immediately before writing this:
--   sessions.center_id .................... absent  (0 rows in info_schema)
--   sessions.started_at ................... absent  (0)
--   schedule_slots.parent_slot_id ......... present (1), 0 rows populated
--   sessions total rows ................... 4
--   sessions with schedule_id NOT NULL .... 0   -> the partial unique index in
--                                                part 3 covers zero existing
--                                                rows and cannot fail on create
--   duplicate (schedule_id, Cairo day) .... 0   -> verified, not assumed
--   sessions whose group has a center_id .. 2   -> part 1's backfill touches 2
--   attendance_scans with session_id NULL . 0   -> see part 5, this is NOT
--                                                grounds for NOT NULL
--   timezone(text, timestamptz) IMMUTABLE . yes -> the Cairo expression in
--                                                part 3 is directly indexable
--
-- ONE CHANGE FROM THE APPROVED TEXT, and the reason (read this before applying)
-- ---------------------------------------------------------------------------
-- §2.3 of the proposal asked for `sessions.slot_id uuid REFERENCES
-- schedule_slots(id)`. THAT COLUMN IS NOT IN THIS FILE, because it already
-- exists under another name. Live catalog:
--     sessions_schedule_id_fkey
--       FOREIGN KEY (schedule_id) REFERENCES schedule_slots(id) ON DELETE SET NULL
-- `sessions.schedule_id` IS the slot reference. Adding `slot_id` would create
-- two columns pointing at the same table meaning the same thing — the D22
-- failure shape (referral_reward_records / referral_commissions), and the same
-- mistake §6(a) caught with `owner_scope`. The corrected §5.1 index already
-- keys on `schedule_id` for exactly this reason; part 3 below matches it.
-- Nothing is lost: every use §2.3 wanted `slot_id` for is served by
-- `schedule_id`.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO — see part 5.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. `sessions.center_id` — a tenant key, and nothing else
--
-- §6(a). This column exists so `sessions` can be RLS-scoped and indexed by
-- tenant. It carries NO ownership meaning. `kind` ('center' | 'private',
-- NOT NULL, already CHECK-constrained) is and stays the sole discriminator.
--
-- Why that matters concretely: 2 of the 4 live sessions are `kind='private'`
-- but sit on a group that HAS a center_id. Under a "NULL center_id means
-- teacher-private" rule those two would read as centre sessions. The semantic
-- is not fragile in theory — it is already false on today's data. Any predicate
-- of the form `center_id IS NULL` to mean "teacher-private" is a bug.
--
-- ON DELETE CASCADE matches every other center_id FK in the schema
-- (students, student_groups, schedule_slots, rooms, attendance_scans) and
-- changes no behaviour: deleting a centre already reaches these rows via
-- centers -> student_groups (CASCADE) -> sessions (CASCADE).
-- ----------------------------------------------------------------------------

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS center_id uuid;

-- §5.2: hand-applied migrations must survive a partial apply. A bare
-- ADD CONSTRAINT raises 42710 on re-run (verified).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_center_id_fkey'
      AND conrelid = 'public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_center_id_fkey
      FOREIGN KEY (center_id) REFERENCES public.centers(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Backfill from the owning group. Idempotent and re-runnable. Touches 2 rows
-- today. Deliberately does NOT skip `kind='private'` rows: the tenant of a
-- teacher-private session held on a centre's group IS that centre.
UPDATE public.sessions s
SET center_id = g.center_id
FROM public.student_groups g
WHERE g.id = s.group_id
  AND g.center_id IS NOT NULL
  AND s.center_id IS DISTINCT FROM g.center_id;

CREATE INDEX IF NOT EXISTS sessions_center_id_scheduled_at_idx
  ON public.sessions (center_id, scheduled_at DESC);

COMMENT ON COLUMN public.sessions.center_id IS
  'TENANT KEY ONLY. Which centre''s data this row is, for RLS scoping and '
  'indexing. It does NOT say who owns the session — `kind` does that, and is '
  'NOT NULL and CHECK-constrained to (center|private). NEVER write a predicate '
  'that reads `center_id IS NULL` as "teacher-private": 2 of the 4 rows live '
  'at the time this column was added are kind=''private'' on a group that has '
  'a center_id, so that reading is already wrong on real data. Correct form: '
  '`kind = ''center'' AND center_id = <caller centre>`.';

-- ----------------------------------------------------------------------------
-- 1b. BEYOND THE FOUR APPROVED DECISIONS — strike this block if you don't want it
--
-- The backfill above is one-shot. Without this trigger, every INSERT written
-- from today leaves `center_id` NULL until application code is changed to set
-- it, and a tenant key that is silently NULL on new rows is worse than no
-- tenant key: a future RLS predicate reading it would quietly match nothing
-- (or, written the other way, everything).
--
-- This derives the key from the group the session is already FK'd to, so it
-- cannot disagree with `student_groups.center_id`. It never overrides an
-- explicitly supplied value on INSERT; on UPDATE it only follows a group
-- change. It touches no other column and no lifecycle rule — the existing
-- trg_guard_sessions_lifecycle trigger is untouched.
--
-- Eyad: this is my addition, not one of the four things you approved. Delete
-- from here to the END OF 1b marker and the rest of the file still applies
-- cleanly; the cost of deleting it is that Phase 1 code must set center_id on
-- every sessions INSERT itself. (If you strike it, db/schema.snapshot needs
-- regenerating — `npm run schema:snapshot` — or the schema-drift gate goes
-- red on the function and trigger lines. Say the word and I'll do it.)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sessions_derive_center_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.center_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.group_id IS DISTINCT FROM OLD.group_id)
  THEN
    SELECT g.center_id INTO NEW.center_id
    FROM public.student_groups g
    WHERE g.id = NEW.group_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sessions_derive_center_id ON public.sessions;
CREATE TRIGGER trg_sessions_derive_center_id
  BEFORE INSERT OR UPDATE OF group_id, center_id ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.sessions_derive_center_id();

COMMENT ON FUNCTION public.sessions_derive_center_id() IS
  'Keeps sessions.center_id agreeing with student_groups.center_id so the '
  'tenant key cannot drift NULL on rows written before application code sets '
  'it. Derives only; asserts nothing about ownership (see the column comment).';

-- A SECURITY DEFINER function is EXECUTE-able by PUBLIC by default. Postgres
-- checks EXECUTE at CREATE TRIGGER time, not at fire time, so revoking it does
-- not stop the trigger — it only removes a definer-rights function from the
-- callable surface. (It returns `trigger`, so it is not directly callable and
-- PostgREST will not expose it; this is belt-and-braces, and matches the
-- standing "revoke anonymous EXECUTE on SECURITY DEFINER helpers" rule.)
REVOKE ALL ON FUNCTION public.sessions_derive_center_id() FROM PUBLIC;

-- END OF 1b ------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 2. `sessions.started_at` — the missing half of the session clock
--
-- §2.2. `finished_at` exists; the start does not, so the Teacher-Groups live
-- elapsed timer (F10) and Teacher-Insight's average session duration have
-- nothing to compute from. Nullable on purpose: a session that is scheduled
-- but not yet started genuinely has no start time.
--
-- No CHECK tying it to `finished_at` is added here. `status` transitions are
-- already policed by trg_guard_sessions_lifecycle, and a constraint added
-- before any writer exists would be guessing at the writer's ordering.
-- ----------------------------------------------------------------------------

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

COMMENT ON COLUMN public.sessions.started_at IS
  'When the class actually began, as opposed to scheduled_at (when it was '
  'meant to). NULL while status=''scheduled''. Pairs with finished_at for '
  'recorded duration.';

-- ----------------------------------------------------------------------------
-- 3. One occurrence row per slot per Cairo day
--
-- §5.1, the correction that matters most in this file. The obvious form of
-- this index — unique on (slot, instant) or on a free-standing `session_date`
-- column — DOUBLE-CHARGES STUDENTS, reproduced live by a parallel session:
-- a slot time edit, or the Egypt DST transition (09:00 Cairo is 07:00Z on
-- 2026-04-23 and 06:00Z on 2026-04-24), mints a second row -> a second
-- session_id -> a different `lesson:<session_id>:<student_id>` idempotency key
-- -> fee_per_class and center_cut_egp both charged twice.
--
-- Keyed on the CAIRO OCCURRENCE DAY, which is the thing that must be unique.
-- `timezone(text, timestamptz)` is IMMUTABLE so this is directly indexable;
-- `scheduled_at::date` is STABLE and Postgres rejects it in an index.
--
-- The `status <> 'cancelled'` predicate is NOT cosmetic. Cancel-then-restart
-- on the same Cairo day is a path that works in production today; without the
-- exclusion it starts failing with 23505.
--
-- The proposal's `session_date date` column is dropped from the design: it
-- would have masked the bug rather than fixed it, since nothing constrains it
-- to agree with scheduled_at.
--
-- Covers 0 existing rows (all 4 sessions have schedule_id NULL), and the
-- duplicate check above returned 0, so creation cannot fail.
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS sessions_generated_occurrence_uniq
  ON public.sessions (
       schedule_id,
       ((scheduled_at AT TIME ZONE 'Africa/Cairo')::date)
     )
  WHERE schedule_id IS NOT NULL
    AND status <> 'cancelled';

COMMENT ON INDEX public.sessions_generated_occurrence_uniq IS
  'Idempotency guard for lazy occurrence materialisation: one live session per '
  'schedule_slot per Cairo calendar day. Keyed on the Cairo day, never on the '
  'instant — a DST shift or a slot time edit would otherwise mint a second row '
  'with a second session_id and bill the lesson twice. Excludes cancelled rows '
  'so cancel-then-restart on the same day still works.';

-- ----------------------------------------------------------------------------
-- 4. Drop `schedule_slots.parent_slot_id`
--
-- §6(d). Verified dead 4 August: self-FK REFERENCES schedule_slots(id)
-- ON DELETE SET NULL; 1 slot row live, 0 with a parent; zero readers and zero
-- writers across src/ and supabase/ — it appears only in baseline.sql and in
-- the archived 025_schedule_group_recurring.sql that added it.
--
-- ################## LATENT SECOND-MATERIALISATION MECHANISM #################
-- # Eyad, 4 August: "log the latent second-materialisation mechanism         #
-- # explicitly. A generator built later must not resurrect it."              #
-- #                                                                          #
-- # This column is not being dropped because it is merely unused. It is      #
-- # being dropped because of what it was FOR. `parent_slot_id` exists to     #
-- # materialise a recurring slot into CHILD SLOT ROWS — a second, parallel   #
-- # way of turning one recurring template into many concrete class-days.     #
-- #                                                                          #
-- # Recurrence today is expanded at READ time by matching day_of_week; see   #
-- # src/app/[locale]/schedule/page.tsx, whose own comment says               #
-- # "schedule_slots is a recurring weekly template with no per-occurrence".  #
-- # Part 3 of this migration makes `sessions` the ONE place a class-day is   #
-- # materialised, keyed uniquely per Cairo day.                              #
-- #                                                                          #
-- # THE HAZARD, stated for whoever builds the generator: if slot-expansion   #
-- # is ever reimplemented — child schedule_slots rows, one per occurrence,   #
-- # linked by a parent pointer — then each child slot is a distinct          #
-- # schedule_id, the unique index in part 3 sees them as DIFFERENT slots,    #
-- # and the same class-day gets two session rows with two session_ids and    #
-- # two `lesson:<session_id>:<student_id>` idempotency keys. That is the     #
-- # double-charge in §5.1 arriving through a door the index does not watch.  #
-- # The index cannot defend against it; only not having two mechanisms can.  #
-- #                                                                          #
-- # DO NOT re-add this column, or any equivalent parent/child pointer on     #
-- # schedule_slots, as part of building a sessions generator. Occurrences    #
-- # live in `sessions`. Slots stay templates. If a future requirement seems  #
-- # to need per-occurrence SLOT rows, that is a schema decision that must be #
-- # taken deliberately and must reconcile with part 3 first — it is not an   #
-- # implementation detail of a generator.                                    #
-- #                                                                          #
-- # Also logged as F27 in design/BUILD-AFTER-REDESIGN.md.                    #
-- ############################################################################
--
-- Dropping the column drops schedule_slots_parent_slot_id_fkey with it.
-- ----------------------------------------------------------------------------

ALTER TABLE public.schedule_slots
  DROP COLUMN IF EXISTS parent_slot_id;

COMMENT ON TABLE public.schedule_slots IS
  'Recurring weekly TEMPLATES for centre classes, not occurrences. One row = '
  'one repeating slot; recurrence is expanded at read time by day_of_week. '
  'Concrete class-days are materialised as `sessions` rows, uniquely per Cairo '
  'day (sessions_generated_occurrence_uniq). Do NOT add a parent/child slot '
  'pointer to build a second materialisation path — the dropped '
  '`parent_slot_id` was exactly that, and reviving it reintroduces the '
  'double-charge this schema is shaped to prevent. See F27.';

COMMIT;

-- ============================================================================
-- 5. WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- Every item here was considered and held back on purpose. Absence is a
-- decision, not an oversight.
--
-- 5.1  `ALTER TABLE public.attendance_scans ALTER COLUMN session_id SET NOT NULL`
--      HELD BACK, on Eyad's instruction of 4 August: "hold SET NOT NULL on
--      session_id until the centre scanner path populates it. Adding NOT NULL
--      to a column a live write path leaves empty breaks that path."
--      All 3 live scans have session_id populated, and that is NOT evidence
--      for NOT NULL — all 3 were written by the teacher-private path, which
--      does populate it. The centre scanner (the 34-file attendance_scans
--      surface) does not. NOT NULL today breaks the first real centre scan.
--
-- 5.2  Dropping the duplicate attendance_scans pairs — payment_method/method
--      and payment_status_at_scan/status. Approved in principle (§6(c)), but
--      not safe to write until the 34-call-site audit maps which writer uses
--      which column. Separate migration, after that audit.
--
-- 5.3  `sessions.slot_id`. Not added: `sessions.schedule_id` already FKs to
--      schedule_slots(id). See the header.
--
-- 5.4  `sessions.session_date`. Not added: superseded by the Cairo-day
--      expression index in part 3 (§5.1).
--
-- 5.5  Any RLS policy change. `sessions` runs RLS with two policies today
--      (sessions_select, sessions_insert), both scoped through group_id
--      membership helpers, and this migration does not touch either. Adding
--      center_id does not by itself change who can read what. Rewriting those
--      policies to use the new tenant key is a separate, reviewed change.
--
-- 5.6  Any occurrence generator, cron, or backfill of sessions rows from
--      schedule_slots. §6(b) chose lazy read-through. Before any generator
--      ships, three things from §5.3 of the proposal must be handled, and
--      none of them is schema:
--        - schedule_exceptions.schedule_id FKs to `group_schedule`, NOT
--          schedule_slots, so a generator iterating slots holds the wrong id
--          class and exception lookups match zero rows forever.
--        - a status='scheduled' row is not inert: the schedule/sessions route
--          returns already_exists BEFORE billing, with no filter on
--          status/kind/source, so a placeholder SUPPRESSES real billing.
--        - the one live slot is recurring=true with recurring_until=NULL, an
--          unbounded recurrence with no natural horizon.
--
-- ============================================================================
-- 6. POST-APPLY VERIFICATION — run this, do not assume (CLAUDE.md rule 2)
--
--   SELECT 'sessions.center_id'  AS o, count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='sessions' AND column_name='center_id'
--   UNION ALL SELECT 'sessions.started_at', count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='sessions' AND column_name='started_at'
--   UNION ALL SELECT 'parent_slot_id GONE (want 0)', count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='schedule_slots' AND column_name='parent_slot_id'
--   UNION ALL SELECT 'occurrence index', count(*) FROM pg_indexes
--     WHERE schemaname='public' AND indexname='sessions_generated_occurrence_uniq'
--   UNION ALL SELECT 'center_id fkey', count(*) FROM pg_constraint
--     WHERE conname='sessions_center_id_fkey'
--   UNION ALL SELECT 'backfilled rows (want 2)', count(*) FROM public.sessions
--     WHERE center_id IS NOT NULL
--   UNION ALL SELECT 'derive trigger (0 if you struck 1b)', count(*) FROM pg_trigger
--     WHERE tgname='trg_sessions_derive_center_id'
--   UNION ALL SELECT 'PUBLIC execute revoked (want 0)', count(*)
--     FROM information_schema.routine_privileges
--     WHERE routine_name='sessions_derive_center_id' AND grantee='PUBLIC';
--
-- Expect 1,1,0,1,1,2,1,0 — or 1,1,0,1,1,2,0,0 if block 1b was struck.
--
-- This whole file was rebuilt from scratch on a clean Postgres 17.10 and
-- introspected before being pushed, so it is known to parse and apply; the
-- resulting diff against db/schema.snapshot is exactly the eight added and
-- three removed lines this migration intends, and nothing else.
-- ============================================================================
