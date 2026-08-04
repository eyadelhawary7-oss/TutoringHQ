-- ============================================================================
-- PAYOUT-SYSTEM-SPEC.md §2.2 — the credit-withdrawal approval race.
--
-- ****************************************************************************
-- * NOT APPLIED — Eyad applies this by hand.                                 *
-- * CLAUDE.md rule 5: migrations are a manual apply to production. Merging   *
-- * this file does NOT apply it (tested 15 July 2026: PR #159 merged as      *
-- * 80f82ba and the objects were still absent from the production catalog    *
-- * 8 minutes later).                                                        *
-- *                                                                          *
-- * ORDER OF OPERATIONS MATTERS HERE. The route change that ships with this  *
-- * file calls public.process_withdrawal_request() and has NO fallback to    *
-- * the old racy path — if the function is absent it returns HTTP 500 with   *
-- * `cause: "withdrawal_rpc_missing"` and moves no money. That is deliberate *
-- * (a silent fallback would re-open the exact defect this fixes), but it    *
-- * means: APPLY THIS FIRST, confirm in pg_proc, THEN let the code deploy.   *
-- * Between the code deploy and the apply, admins cannot mark withdrawals    *
-- * paid or rejected. Nothing is lost or double-paid; the queue just stalls. *
-- ****************************************************************************
--
-- WHAT IS WRONG TODAY
-- -------------------
-- src/app/api/admin/withdrawals/[id]/route.ts did five un-transacted round
-- trips: a non-locking .select, a `status !== 'pending'` check in JavaScript,
-- cancel_reservation_atomic(), spend_credits_atomic(), then
-- .update({status:'paid'}).eq('status','pending').
--
--   * Two admins working the queue at once — or one operator double-clicking —
--     both pass the JS check, both release the reservation, both spend, and
--     both return {success:true}. A zero-row UPDATE is not an error in
--     PostgREST, so the loser is indistinguishable from the winner and BOTH
--     fire the "withdrawal processed" WhatsApp.
--   * If spend_credits_atomic() raises (it raises 'Insufficient credits' when
--     the non-expired `earned` ledger rows do not cover the amount) AFTER
--     cancel_reservation_atomic() has already released the reservation, the
--     release is already committed. The centre's full balance is restored and
--     immediately re-withdrawable while the cash has already been sent.
--
-- Both failures are structural: they exist because the read, the decision and
-- the writes are in different transactions. The fix is one transaction.
--
-- PRECONDITIONS, QUERIED LIVE against project lczmjpnbuhnsislcvzar on
-- 4 August 2026 immediately before writing this file. Not inferred, not read
-- off other code, not taken from schema_migrations:
--
--   public.withdrawal_requests columns (information_schema.columns, in order):
--     id uuid NOT NULL default gen_random_uuid()
--     center_id uuid NOT NULL
--     credits_deducted numeric NOT NULL
--     cash_amount numeric NOT NULL
--     fee_amount numeric NOT NULL
--     instapay_number text NOT NULL
--     status text NOT NULL default 'pending'
--     requested_at timestamptz NULL default now()
--     processed_at timestamptz NULL
--     processed_by uuid NULL
--     notes text NULL
--   -> there is NO updated_at column. This migration does not write one.
--
--   pg_constraint on withdrawal_requests:
--     withdrawal_requests_pkey             PRIMARY KEY (id)
--     withdrawal_requests_center_id_fkey   FK -> centers(id) ON DELETE CASCADE
--     withdrawal_requests_processed_by_fkey FK -> admin_users(id)   <-- note
--     withdrawal_requests_status_check     CHECK status IN
--                                          ('pending','paid','rejected')
--     withdrawal_requests_money_nonneg     CHECK cash_amount >= 0
--                                          AND credits_deducted >= 0
--                                          AND fee_amount >= 0
--
--   pg_constraint on audit_log:
--     audit_log_user_id_fkey   FK -> public.users(id) ON DELETE SET NULL <-- note
--     audit_log_center_id_fkey FK -> centers(id) ON DELETE RESTRICT
--   audit_log columns: id, center_id, user_id, action, entity_type, entity_id,
--     details jsonb default '{}', created_at timestamptz NOT NULL default now()
--
--   TWO FOREIGN-KEY FACTS THAT DRIVE THE DESIGN BELOW, both verified above:
--     (a) withdrawal_requests.processed_by references admin_users, NOT
--         auth.users and NOT public.users. A SUPER_ADMIN_PHONES super-admin
--         has no admin_users row at all (src/lib/admin-auth.ts sets
--         adminRole:null for them), so writing their auth uid into
--         processed_by raises 23503. The function therefore resolves the
--         actor against admin_users and stores NULL when absent — while
--         still recording the real actor uuid in the audit row, so
--         attribution is never lost.
--     (b) audit_log.user_id references public.users, which internal admins
--         also may not have a row in. The function therefore writes
--         user_id = NULL and puts the actor in details->>'actor_id'.
--         Do not "improve" this by setting user_id = p_actor_id; it will
--         raise 23503 for exactly the admins who process payouts.
--
--   pg_proc, existing composed functions (pg_get_functiondef read in full):
--     cancel_reservation_atomic(uuid,numeric) RETURNS void
--       SECURITY DEFINER, owner postgres, search_path=public
--       -> PERFORM assert_caller_center_access(p_center_id);
--          UPDATE centers SET credit_reserved =
--            GREATEST(0, COALESCE(credit_reserved,0) - p_amount) WHERE id=...
--     spend_credits_atomic(uuid,numeric,uuid,text) RETURNS boolean
--       SECURITY DEFINER, owner postgres, search_path=public
--       -> assert_caller_center_access; SELECT ... FROM centers FOR UPDATE;
--          walks non-expired `earned` credit_ledger rows oldest-first,
--          decrements them, inserts matching negative `spent` rows,
--          RAISES 'Insufficient credits' if it cannot cover p_amount,
--          then UPDATE centers SET credit_balance = GREATEST(0, ... )
--     assert_caller_center_access(uuid) RETURNS void
--       -> returns immediately when auth.uid() IS NULL (service-role /
--          server-side path), so composing from a service-role RPC is safe.
--   Grants on all three: {postgres=X/postgres, service_role=X/postgres}.
--   The new function matches that grant exactly — service_role only.
--
--   public.process_withdrawal_request .... ABSENT (0 rows in pg_proc)
--   one_pending_withdrawal_per_center .... ABSENT (0 rows in pg_class)
--
--   RLS: withdrawal_requests has relrowsecurity = true with 2 policies
--   (center_read_own_withdrawals SELECT, service_role_all_withdrawal_requests
--   ALL USING true). pg_roles.rolbypassrls is TRUE for postgres, so a
--   SECURITY DEFINER function owned by postgres is not blocked by them.
--
--   LIVE DATA, for the partial unique index in part 2:
--     withdrawal_requests total rows ........................... 0
--     rows with status='pending' ............................... 0
--     centres with MORE THAN ONE pending row ................... 0
--   -> The index covers zero existing rows and CANNOT fail on create. This
--      was queried, not assumed. Re-run the query in part 2's comment
--      immediately before applying, because the table is live.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- -------------------------------
-- It does not touch reserve/cancel/spend, does not add columns, does not
-- change the status CHECK, and does not address §2.1, §2.3, §2.4, §2.5 or
-- §2.7. §2.5 in particular (reservations never expire) is still open: this
-- function releases the reservation on both terminal outcomes, but an
-- abandoned pending request still fences credits forever.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PART 1 — one transactional, idempotent, lock-taking RPC.
--
-- Contract (the route in src/app/api/admin/withdrawals/[id]/route.ts and
-- src/lib/withdrawalProcessing.ts depend on these exact strings):
--
--   returns jsonb { outcome, status, ... }
--   outcome = 'transitioned'    this call performed the state change. It is
--                               the ONLY outcome that may send WhatsApp.
--   outcome = 'already_applied' the row is already in the status this action
--                               would have produced. Idempotent re-call —
--                               HTTP 200, no money moved, no WhatsApp.
--   outcome = 'conflict'        the row is terminal in the OTHER status
--                               (asked to pay something already rejected, or
--                               vice versa). HTTP 409, no money moved.
--   outcome = 'not_found'       no such row. HTTP 404.
--
-- Everything else raises, which rolls the whole transaction back: the
-- reservation stays reserved, no credits are spent, the status stays pending.
-- That is the point — the release and the spend can no longer disagree.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_withdrawal_request(
  p_withdrawal_id uuid,
  p_action        text,
  p_actor_id      uuid,
  p_notes         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row          public.withdrawal_requests%ROWTYPE;
  v_target       text;
  v_notes        text;
  v_processed_by uuid;
BEGIN
  IF p_action = 'mark_paid' THEN
    v_target := 'paid';
  ELSIF p_action = 'reject' THEN
    v_target := 'rejected';
  ELSE
    RAISE EXCEPTION 'process_withdrawal_request: invalid action %', p_action
      USING ERRCODE = '22023';
  END IF;

  -- Blank / whitespace-only notes must not clobber an existing note. This
  -- mirrors the behaviour the route had before (`notes.trim() ? … : null`).
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');

  -- THE LOCK. Every concurrent PATCH for this id serialises here. In READ
  -- COMMITTED the second transaction blocks until the first commits and then
  -- re-reads the updated row, so it sees status='paid' and falls into the
  -- idempotent branch below instead of paying again.
  SELECT * INTO v_row
  FROM public.withdrawal_requests
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'outcome', CASE WHEN v_row.status = v_target
                      THEN 'already_applied'
                      ELSE 'conflict' END,
      'status',            v_row.status,
      'center_id',         v_row.center_id,
      'credits_deducted',  v_row.credits_deducted,
      'cash_amount',       v_row.cash_amount,
      'instapay_number',   v_row.instapay_number,
      'notes',             v_row.notes
    );
  END IF;

  IF v_row.credits_deducted IS NULL OR v_row.credits_deducted <= 0 THEN
    RAISE EXCEPTION
      'process_withdrawal_request: withdrawal % has non-positive credits_deducted',
      p_withdrawal_id
      USING ERRCODE = '22023';
  END IF;

  -- Release the reservation. On BOTH outcomes: a paid request converts the
  -- reservation into a spend, a rejected one hands it back.
  PERFORM public.cancel_reservation_atomic(v_row.center_id, v_row.credits_deducted);

  IF v_target = 'paid' THEN
    -- If this raises ('Insufficient credits'), the release above is rolled
    -- back with it. That is the whole fix for the second half of §2.2: the
    -- balance is never restored-and-re-withdrawable behind a sent payment.
    PERFORM public.spend_credits_atomic(
      v_row.center_id,
      v_row.credits_deducted,
      p_withdrawal_id,
      'withdrawal'
    );
  END IF;

  -- processed_by FKs to admin_users. SUPER_ADMIN_PHONES super-admins have no
  -- row there; store NULL rather than raising 23503, and keep the true actor
  -- in the audit row below. See precondition note (a).
  SELECT au.id INTO v_processed_by
  FROM public.admin_users au
  WHERE au.id = p_actor_id;

  UPDATE public.withdrawal_requests
  SET status       = v_target,
      processed_at = now(),
      processed_by = v_processed_by,
      notes        = COALESCE(v_notes, notes)
  WHERE id = p_withdrawal_id
    AND status = 'pending';   -- belt and braces; we hold the row lock

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'process_withdrawal_request: lost row % under FOR UPDATE', p_withdrawal_id
      USING ERRCODE = '40001';
  END IF;

  -- audit_log.user_id FKs to public.users, which internal admins may not have.
  -- NULL there, real actor in details. See precondition note (b).
  INSERT INTO public.audit_log (
    center_id, user_id, action, entity_type, entity_id, details
  ) VALUES (
    v_row.center_id,
    NULL,
    'withdrawal_' || v_target,
    'withdrawal_request',
    p_withdrawal_id,
    jsonb_build_object(
      'actor_id',            p_actor_id,
      'actor_is_admin_user', (v_processed_by IS NOT NULL),
      'action',              p_action,
      'previous_status',     'pending',
      'new_status',          v_target,
      'credits_deducted',    v_row.credits_deducted,
      'cash_amount',         v_row.cash_amount,
      'fee_amount',          v_row.fee_amount,
      'instapay_number',     v_row.instapay_number,
      'notes',               v_notes
    )
  );

  RETURN jsonb_build_object(
    'outcome',           'transitioned',
    'status',            v_target,
    'center_id',         v_row.center_id,
    'credits_deducted',  v_row.credits_deducted,
    'cash_amount',       v_row.cash_amount,
    'instapay_number',   v_row.instapay_number,
    'notes',             COALESCE(v_notes, v_row.notes)
  );
END;
$function$;

-- Match the grants on the three functions this composes with, exactly:
-- {postgres=X/postgres, service_role=X/postgres}. No authenticated, no anon —
-- this function moves money and has no per-caller authorisation of its own;
-- the gate is requireSuperAdminApi + requireSuperAdminRow + CSRF in the route.
REVOKE ALL ON FUNCTION public.process_withdrawal_request(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_withdrawal_request(uuid, text, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.process_withdrawal_request(uuid, text, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_withdrawal_request(uuid, text, uuid, text) TO service_role;

COMMENT ON FUNCTION public.process_withdrawal_request(uuid, text, uuid, text) IS
  'PAYOUT-SYSTEM-SPEC.md 2.2. Atomically approves or rejects a withdrawal: '
  'SELECT FOR UPDATE, release reservation, spend on paid, flip status, audit. '
  'Idempotent: re-calling for an already-terminal row returns '
  'already_applied/conflict and moves nothing. service_role only.';

-- ---------------------------------------------------------------------------
-- PART 2 — at most one pending withdrawal per centre.
--
-- /api/billing/withdrawal already does a check-then-insert for this, which is
-- itself racy; the index is what actually enforces it. Its insert-error path
-- already calls cancel_reservation_atomic, so a 23505 here releases the
-- reservation rather than stranding it.
--
-- RE-RUN THIS IMMEDIATELY BEFORE APPLYING — it returned 0 on 4 August 2026,
-- but the table is live:
--
--   SELECT center_id, count(*)
--   FROM public.withdrawal_requests
--   WHERE status = 'pending'
--   GROUP BY center_id
--   HAVING count(*) > 1;
--
-- If that returns any row, DO NOT apply part 2. Resolve the duplicates first
-- (each one is a doubly-fenced reservation and needs a human decision about
-- which request is real), then re-run and apply.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS one_pending_withdrawal_per_center
  ON public.withdrawal_requests (center_id)
  WHERE status = 'pending';

COMMENT ON INDEX public.one_pending_withdrawal_per_center IS
  'PAYOUT-SYSTEM-SPEC.md 2.2. A centre may have at most one pending '
  'withdrawal request. Verified 0 violating centres before creation.';

COMMIT;

-- ============================================================================
-- POST-APPLY VERIFICATION — run this and read the output before deploying the
-- code. Both counts must be 1.
--
--   SELECT
--     (SELECT count(*) FROM pg_proc p
--        JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname = 'process_withdrawal_request') AS fn,
--     (SELECT count(*) FROM pg_class
--       WHERE relname = 'one_pending_withdrawal_per_center') AS idx;
--
-- And confirm the grant is service_role-only:
--
--   SELECT p.oid::regprocedure::text, p.proacl::text
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'process_withdrawal_request';
--
-- ROLLBACK, if it comes to that:
--   DROP INDEX IF EXISTS public.one_pending_withdrawal_per_center;
--   DROP FUNCTION IF EXISTS public.process_withdrawal_request(uuid,text,uuid,text);
-- Reverting the function alone will make the route return
-- withdrawal_rpc_missing 500s; revert the code deploy with it.
-- ============================================================================
