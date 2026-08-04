-- ============================================================================
-- S10 (d) — record WHERE an actor's authority came from on the logs that carry
-- authority: `db_row` (a real public.admin_users row) or `env_phone` (the
-- SUPER_ADMIN_PHONES environment variable alone).
--
-- ****************************************************************************
-- * NOT APPLIED — Eyad applies this by hand, AND APPLIES IT BEFORE MERGE.     *
-- * CLAUDE.md rule 5: migrations are a manual apply to production. Merging    *
-- * this file does NOT apply it (tested 15 July 2026: PR #159 merged as       *
-- * 80f82ba and the columns were still absent 8 minutes later). See §5.2 for  *
-- * why "before merge" and not merely "eventually".                           *
-- * NO CODE READS OR WRITES ANY COLUMN BELOW. Nothing in this PR references   *
-- * them. Do not add a writer until this has been applied and confirmed       *
-- * present in information_schema.columns — building first is F26, and F26 is *
-- * what caused the 8 July student-detail outage.                             *
-- ****************************************************************************
--
-- ****************************************************************************
-- * THE S10 ORDERING RULE — (a) BEFORE ANY GATE CHANGE. NOT NEGOTIABLE.       *
-- *                                                                           *
-- * S10 item (a) — create a real `admin_users` row with role='super_admin'    *
-- * for EVERY current SUPER_ADMIN_PHONES holder — must happen BEFORE any      *
-- * change that makes a gate stop accepting the env phone.                    *
-- *                                                                           *
-- * THIS BRANCH DOES NOT CHANGE THE GATE, AND MUST NOT. It renames a          *
-- * misleading function, adds a value check to `npm run check:env`, and       *
-- * proposes the two columns below. Authority resolution is byte-for-byte     *
-- * what it was: `adminRow || adminByPhone` still grants, everywhere it       *
-- * granted yesterday. Nobody gains access and nobody loses it.               *
-- *                                                                           *
-- * WHY, in one number, verified live on 4 August 2026: `admin_users` holds   *
-- * exactly 1 row with role='super_admin'. Tighten the gate before (a) and    *
-- * the single super-admin is locked out of the very surface needed to create *
-- * the missing rows. That change is the outage, not the fix. It is           *
-- * deliberately absent from this file and from this branch.                  *
-- ****************************************************************************
--
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------
-- `SUPER_ADMIN_PHONES` grants full super-admin authority on its own, with no
-- `admin_users` record: `admin-auth.ts` returns a session on
-- `adminRow || adminByPhone`, and `admin-access.ts` ORs `isSuperAdminPhone()`
-- into the second gate as well. Such an admin is FORENSICALLY ANONYMOUS — an
-- audit trail keyed to their uuid points at no row in any table, so "who did
-- this" has no answer from the database, only from whoever could read the
-- Vercel environment at that moment. That is not a historical record and it is
-- not versioned.
--
-- This migration does not close that hole. It makes the distinction PROVABLE
-- after the fact instead of inferred, which is S10 item (d) and the only part
-- of S10 that is safe to land before item (a).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO — and this is the whole ordering
-- discipline of S10, so read it before "finishing the job":
--   * It does not change who can do what. No gate, no policy, no grant.
--   * It does not make any column NOT NULL. See part 3.
--   * It does not stop `env_phone` authority from working anywhere.
-- Eyad's sequencing is (a)-first and is not negotiable: a real
-- `admin_users.role='super_admin'` row must exist for every current env-phone
-- holder BEFORE any gate stops accepting the env phone. Live catalog today:
-- `admin_users` holds 2 rows, exactly 1 of them `super_admin`. Tighten the
-- gate first and the only super-admin loses access to the surface needed to
-- create the missing rows.
--
-- PRECONDITIONS, queried live against lczmjpnbuhnsislcvzar on 4 August 2026
-- immediately before writing this (CLAUDE.md rule 2 — none of these is assumed
-- from a migration file or from code that references a column):
--   audit_log.authority_source ......................... absent (0)
--   withdrawal_requests.processed_by_authority_source .. absent (0)
--   audit_log_authority_source_check ................... absent (0)
--   withdrawal_requests_processed_by_authority_source_check  absent (0)
--   audit_log_env_phone_authority_idx .................. absent (0)
--   authority_source anywhere in public ................ absent (0 columns)
--   an `authority_source` enum TYPE .................... absent (0)  -> text
--                                                        + CHECK, matching the
--                                                        house style used by
--                                                        admin_users_role_check
--                                                        and the two *_status_check
--                                                        constraints on these
--                                                        very tables
--   public.audit_log rows .............................. 57
--   audit_log rows with user_id NOT NULL ............... 31
--     ...of which any are an admin_users id ............ 0
--     (audit_log.user_id FKs to public.users, NOT admin_users. So today the
--      table records no admin-authority action that is even identifiable as
--      one. That is exactly why NULL below must mean "not recorded" and must
--      NEVER be read as "db_row".)
--   public.admin_users rows ............................ 2 (1 super_admin)
--   public.withdrawal_requests rows .................... 0
--   withdrawal_requests rows with processed_by NOT NULL  0  -> the new column
--                                                        starts fully NULL on
--                                                        zero rows; it cannot
--                                                        disagree with history
--   trigger on audit_log ............................... audit_log_no_update_delete
--                                                        BEFORE DELETE OR UPDATE,
--                                                        EXECUTE audit_log_block_mutations()
--     -> A BACKFILL OF audit_log IS IMPOSSIBLE and none is attempted here. Any
--        UPDATE against that table is blocked by design. The 57 existing rows
--        keep authority_source NULL forever, which is the honest value: we do
--        not know, and inventing 'db_row' for them would be fabricating a
--        forensic record.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. audit_log.authority_source
--
-- NULLABLE, on purpose, and the reason is not squeamishness:
--   * 57 rows already exist and cannot be updated (the block trigger above);
--   * `audit_log` is written from ~33 call sites, most of them centre-side
--     actions where "authority source" is not a meaningful question;
--   * the dominant write pattern is
--       try { await supabaseAdmin.from('audit_log').insert(...) } catch {}
--     and supabase-js RETURNS `{error}` rather than throwing, so the catch
--     never fires. A NOT NULL column added today would turn every writer that
--     forgot the field into a silently-dropped audit row — strictly worse
--     forensics than the gap it was meant to close.
--
-- So: NULL means NOT RECORDED. It does not mean `db_row`. Any reader that
-- treats NULL as `db_row` has invented evidence.
-- ----------------------------------------------------------------------------

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS authority_source text;

-- A bare ADD CONSTRAINT raises 42710 on a re-run, and a hand-applied migration
-- must survive a partial apply.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_log_authority_source_check'
      AND conrelid = 'public.audit_log'::regclass
  ) THEN
    ALTER TABLE public.audit_log
      ADD CONSTRAINT audit_log_authority_source_check
      CHECK (authority_source IS NULL
             OR authority_source IN ('db_row', 'env_phone'));
  END IF;
END $$;

COMMENT ON COLUMN public.audit_log.authority_source IS
  'Where the acting admin''s authority came from at the moment of the action: '
  '''db_row'' = a real public.admin_users row; ''env_phone'' = the '
  'SUPER_ADMIN_PHONES environment variable alone, with no row anywhere. '
  'NULL means NOT RECORDED — either the row predates this column, or the '
  'action was not an admin-authority action. NULL IS NOT ''db_row''; reading '
  'it that way fabricates a forensic record. Written server-side only, derived '
  'from the resolved session, never from a request body. See S10 in '
  'design/BUILD-AFTER-REDESIGN.md.';

-- "Show me every action ever taken by an off-catalog admin" should be one
-- cheap query, not a scan someone declines to run. Partial: the interesting
-- set is small by construction and stays small if S10 (a) succeeds.
CREATE INDEX IF NOT EXISTS audit_log_env_phone_authority_idx
  ON public.audit_log (created_at DESC)
  WHERE authority_source = 'env_phone';

-- ----------------------------------------------------------------------------
-- 2. withdrawal_requests.processed_by_authority_source
--
-- This is the one authority-bearing MONEY log that exists in the catalog
-- today: `PATCH /api/admin/withdrawals/[id]` is the gate that marks a
-- withdrawal paid, and it stamps `processed_at` / `processed_by`. Named to
-- pair with `processed_by` so the two are obviously one fact in two columns.
--
-- Nullable for the same reason as part 1, plus: no writer exists yet, and the
-- column must not break the route the moment it is applied. 0 live rows.
--
-- ################ A LIVE HAZARD THIS COLUMN DOES NOT FIX #################
-- # Derived from the live catalog plus a read of the route — NOT from an   #
-- # executed transaction, so treat it as a strong prediction, not a        #
-- # reproduced incident, and confirm before acting on it:                  #
-- #                                                                        #
-- #   withdrawal_requests_processed_by_fkey                                #
-- #     FOREIGN KEY (processed_by) REFERENCES admin_users(id)              #
-- #                                                                        #
-- # and src/app/api/admin/withdrawals/[id]/route.ts writes                 #
-- # `processed_by: auth.userId` unconditionally. An env-phone super-admin   #
-- # HAS NO admin_users ROW, so that UPDATE should raise 23503 — and it      #
-- # runs AFTER cancel_reservation_atomic and spend_credits_atomic have      #
-- # already committed (the un-transacted sequence logged as §2.2 of         #
-- # PAYOUT-SYSTEM-SPEC.md). The centre's credits would be spent, the row    #
-- # would stay 'pending', and the operator would see a 500.                 #
-- #                                                                        #
-- # NOT FIXED HERE. It is a code + transaction problem, it belongs to the   #
-- # §2.2 work, and fixing it inside a schema proposal would be exactly the  #
-- # scope creep S10's ordering rule exists to prevent. Recorded so the      #
-- # next person does not rediscover it at 2am with real money in flight.    #
-- ##########################################################################
-- ----------------------------------------------------------------------------

ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS processed_by_authority_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'withdrawal_requests_processed_by_authority_source_check'
      AND conrelid = 'public.withdrawal_requests'::regclass
  ) THEN
    ALTER TABLE public.withdrawal_requests
      ADD CONSTRAINT withdrawal_requests_processed_by_authority_source_check
      CHECK (processed_by_authority_source IS NULL
             OR processed_by_authority_source IN ('db_row', 'env_phone'));
  END IF;
END $$;

COMMENT ON COLUMN public.withdrawal_requests.processed_by_authority_source IS
  'Where `processed_by`''s authority came from: ''db_row'' (a real '
  'public.admin_users row) or ''env_phone'' (SUPER_ADMIN_PHONES alone, no row). '
  'NULL means not recorded, never ''db_row''. Note that processed_by itself '
  'FKs to admin_users, so an env-phone admin cannot currently be recorded '
  'there at all — see the block comment in the migration that added this '
  'column. S10 (d).';

COMMIT;

-- ============================================================================
-- 3. WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- Every item was considered and held back. Absence is a decision.
--
-- 3.1  NOT NULL on either column. PAYOUT-SYSTEM-SPEC.md §7.5 asks for
--      authority_source "as a NOT NULL column", and that is right — for a
--      payout approval log built from scratch, where every writer is known on
--      day one and there is no history. It is wrong for these two tables:
--      audit_log has 57 unbackfillable rows and ~33 fire-and-forget writers
--      whose insert failures are already swallowed. NOT NULL here converts a
--      missing field into a dropped audit row. The sequence, when someone
--      wants it: land the writers, verify zero NULLs among rows written after
--      the writers shipped, then a separate SET NOT NULL migration.
--
-- 3.2  Any column on `payout_requests`. It has no approver column of any kind
--      (verified: id, center_id, amount_requested, status, payment_method,
--      payment_details, requested_at, processed_at — and 0 rows) because it has
--      no approval path at all in the application; that is §2.1 of the payout
--      spec, not S10. Adding an authority column to a table nothing can
--      approve through would be decoration.
--
-- 3.3  Any new payout approval log table. That belongs to the payout build
--      (PAYOUT-SYSTEM-SPEC.md §3, §7.4), which is gated on decisions and on
--      Paymob, and it should carry authority_source NOT NULL from birth.
--
-- 3.4  A backfill of either column. Impossible on audit_log (blocked by
--      audit_log_no_update_delete) and meaningless on withdrawal_requests
--      (0 rows). Writing 'db_row' onto history we did not record would be
--      manufacturing the exact evidence this column exists to make honest.
--
-- 3.5  Any change to a gate, policy, grant or trigger. S10 (a) comes first.
--
-- ============================================================================
-- 4. POST-APPLY VERIFICATION — run this, do not assume (CLAUDE.md rule 2)
--
--   SELECT 'audit_log.authority_source' AS o, count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='audit_log' AND column_name='authority_source'
--   UNION ALL SELECT 'wr.processed_by_authority_source', count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='withdrawal_requests'
--       AND column_name='processed_by_authority_source'
--   UNION ALL SELECT 'audit_log check', count(*) FROM pg_constraint
--     WHERE conname='audit_log_authority_source_check'
--   UNION ALL SELECT 'wr check', count(*) FROM pg_constraint
--     WHERE conname='withdrawal_requests_processed_by_authority_source_check'
--   UNION ALL SELECT 'env_phone index', count(*) FROM pg_indexes
--     WHERE schemaname='public' AND indexname='audit_log_env_phone_authority_idx'
--   UNION ALL SELECT 'audit_log rows unchanged (want 57)', count(*) FROM public.audit_log
--   UNION ALL SELECT 'non-null authority_source (want 0)', count(*) FROM public.audit_log
--     WHERE authority_source IS NOT NULL;
--
-- Expect 1,1,1,1,1,57,0.
--
-- ============================================================================
-- 5. SCHEMA SNAPSHOT, AND THE ONE THING EYAD MUST DO — READ BEFORE MERGING
--
-- Two different gates read two different things. Conflating them is how the
-- earlier draft of this section got it backwards, so they are separated here.
--
-- 5.1  db/schema.snapshot IS REGENERATED IN THIS BRANCH. Not deferred.
--
--      The Schema Drift Gate (.github/workflows/schema-drift.yml) rebuilds a
--      fresh throwaway database from EVERY file in supabase/migrations/ and
--      diffs the result against db/schema.snapshot. It never touches
--      production and never reads it. A migration file added without its
--      snapshot delta therefore turns that gate RED for as long as the PR is
--      open, which is not a useful signal — it is a broken gate that reviewers
--      learn to scroll past.
--
--      Regenerating the snapshot is NOT applying a migration. It is an offline
--      rebuild into a disposable local Postgres 17 (`npm run schema:snapshot`).
--      The committed delta for this file is exactly five lines:
--        COLUMN     audit_log.authority_source
--        COLUMN     withdrawal_requests.processed_by_authority_source
--        CONSTRAINT audit_log_authority_source_check
--        CONSTRAINT withdrawal_requests_processed_by_authority_source_check
--        INDEX      audit_log_env_phone_authority_idx
--
--      Repo precedent, checked rather than assumed: PR #307 (commit fb054d4b),
--      the migration PR immediately before this one, shipped its snapshot
--      delta in the same commit as its migration file. This branch follows it.
--
-- 5.2  THE HARD REQUIREMENT ON EYAD: APPLY TO PRODUCTION BY HAND *BEFORE*
--      MERGE. This one is not a preference, and it is the reason the ordering
--      matters at all.
--
--      .github/workflows/schema-drift-live.yml runs daily at 06:17 UTC and
--      compares the COMMITTED SNAPSHOT against the LIVE PRODUCTION catalog.
--      The moment this branch is on master, that job starts asserting that
--      production has these two columns, these two constraints and this index.
--
--      So merge-before-apply does not merely leave a gate red — it makes the
--      committed snapshot claim a shape production does not have, and turns
--      the live drift job into a false alarm that has to be explained away
--      every morning until the apply happens. A drift alarm nobody believes is
--      worse than no drift alarm, and it is the same failure shape as CLAUDE.md
--      rule 5 (PR #159 / 80f82ba: merged, assumed applied, columns absent).
--
--      Correct order, and the only correct order:
--        1. Apply this file by hand to production.
--        2. Run the §4 post-apply verification. Expect 1,1,1,1,1,57,0.
--        3. Only then merge the PR.
--
--      Nothing in the application reads or writes these columns, so step 3 can
--      wait indefinitely with no consequence. Step 3 before step 1 has one.
-- ============================================================================
