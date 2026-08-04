-- ============================================================================
-- Migration proposal — `payout_requests` approval path
-- PAYOUT-SYSTEM-SPEC.md §2.1 (second-highest priority defect)
--
-- ****************************************************************************
-- * NOT APPLIED — Eyad applies this by hand.                                  *
-- * CLAUDE.md rule 5: migrations are a manual apply to production. Merging    *
-- * this file does NOT apply it (tested 15 July 2026: PR #159 merged as       *
-- * 80f82ba and the columns were still absent from the production catalog     *
-- * 8 minutes later).                                                         *
-- *                                                                           *
-- * THE CODE SHIPPED ALONGSIDE THIS FILE NEVER READS A COLUMN BELOW.          *
-- * `GET /api/admin/payout-requests` selects only the eight columns that      *
-- * exist today. `PATCH /api/admin/payout-requests/[id]` calls ONLY the RPC   *
-- * defined in part 4 and, when that RPC is absent, returns HTTP 503          *
-- * `payout_approval_migration_not_applied` naming this file. It fails        *
-- * visibly; it does not degrade to a non-atomic update. That is deliberate:  *
-- * building against columns that do not exist is F26.                        *
-- ****************************************************************************
--
-- WHAT IS WRONG TODAY
-- -------------------
-- `payout_requests` has no approval path whatsoever. Six files reference the
-- table (googleDriveBackup backup list, generateInvoicePdf receipt,
-- /api/referral read, /api/payouts/[id]/pdf read, /api/referrals/payout insert,
-- /api/admin/centers/[id] read) and NONE of them can move `status`. A centre
-- can submit a referral payout request today and its status can never leave
-- 'pending' through any code path in the application.
--
-- PRECONDITIONS, QUERIED LIVE AGAINST lczmjpnbuhnsislcvzar ON 4 AUGUST 2026
-- IMMEDIATELY BEFORE WRITING THIS FILE (information_schema / pg_constraint /
-- pg_proc / pg_trigger / pg_policies — not from a migration file, not from
-- code that references a column):
--
--   public.payout_requests columns present (8, in ordinal order):
--     id uuid NOT NULL default gen_random_uuid()
--     center_id uuid NOT NULL
--     amount_requested numeric NOT NULL
--     status text NOT NULL default 'pending'
--     payment_method text NULL
--     payment_details jsonb NULL
--     requested_at timestamptz NULL default now()
--     processed_at timestamptz NULL
--
--   COLUMNS ABSENT (0 rows in information_schema.columns) — this is why the
--   migration exists:
--     approved_by, approved_at, rejected_by, rejected_at, rejection_reason,
--     paid_by, paid_at, decision_authority_source, processed_by, notes
--
--   Constraints on payout_requests:
--     payout_requests_pkey                      PRIMARY KEY (id)
--     payout_requests_center_id_fkey            FK -> centers(id) ON DELETE CASCADE
--     payout_requests_amount_requested_nonneg   CHECK (amount_requested >= 0)
--     payout_requests_status_check              CHECK (status IN
--                                               ('pending','approved','paid','rejected'))
--     -> the four target states ALREADY pass the CHECK. No CHECK change needed.
--
--   Triggers on payout_requests ................ none (pg_trigger, non-internal)
--   RLS on payout_requests ..................... enabled, ONE policy:
--     payout_requests_select (SELECT, role public):
--       center_id IN (SELECT users.center_id FROM users WHERE users.id = auth.uid())
--     -> no INSERT/UPDATE policy exists; every writer is service_role or a
--        SECURITY DEFINER function, both of which bypass RLS. The new columns
--        become readable by the owning centre automatically under that policy,
--        which is intended (§7.5: requests must age visibly and honestly).
--   payout_requests live rows .................. 0
--
--   public.referral_reward_records — the coverage source read by part 4's
--   approval guard. RE-VERIFIED LIVE against information_schema.columns,
--   pg_constraint and pg_indexes on 4 August 2026, because a guard that reads
--   a column which does not exist is F26 with a money consequence:
--     referrer_center_id uuid NOT NULL, FK -> centers(id) ON DELETE CASCADE
--     reward_amount      numeric NOT NULL
--     status             text NOT NULL default 'pending'
--   referral_reward_records_status_check
--     CHECK (status IN ('pending','held','available','paid'))
--     -> 'available' is a real member of that domain; the guard's filter can
--        match. 'paid' is where PATCH /api/admin/referral-rewards moves rows.
--   referral_reward_records_money_nonneg
--     CHECK (base_amount >= 0 AND reward_amount >= 0)
--     -> the coverage sum can never be dragged down by a negative row.
--   idx_referral_reward_records_referrer  btree (referrer_center_id)
--   idx_payout_requests_center            btree (center_id)
--     -> both guard reads are index-supported; no new index needed.
--   referral_reward_records live rows .......... 0
--
--   public.audit_log columns: id, center_id, user_id, action, entity_type,
--     entity_id, details jsonb, created_at
--   audit_log constraints:
--     audit_log_center_id_fkey  FK -> centers(id) ON DELETE RESTRICT
--     audit_log_user_id_fkey    FK -> public.users(id) ON DELETE SET NULL
--
--   *** LANDMINE FOUND LIVE, AND THE REASON PART 4 GUARDS THE AUDIT WRITE ***
--   `audit_log.user_id` references public.users, but `admin_users.id`
--   references auth.users, and NEITHER admin_users row has a public.users row:
--       33af7171-… role=super_admin   has_public_users_row = false
--       3a8d81ab-… role=sales_manager has_public_users_row = false
--   So `INSERT INTO audit_log (user_id) VALUES (<the CEO's admin id>)` violates
--   audit_log_user_id_fkey and ABORTS THE WHOLE TRANSACTION. A naive
--   "write the audit row in the same transaction" implementation would make
--   approval impossible for the only super_admin that exists. Part 4 therefore
--   writes `user_id` only when a matching public.users row exists and ALWAYS
--   records the approver as `details.actor_admin_user_id`.
--
--   public.admin_users: id uuid PK -> auth.users(id) ON DELETE CASCADE,
--     role text CHECK (role IN ('super_admin','admin','internal_admin',
--     'internal_viewer','sales_manager','sales_rep','support_agent',
--     'accountant','custom')); live rows: 1 super_admin, 1 sales_manager.
--
--   Existing SECURITY DEFINER money RPCs used as the style precedent:
--     reserve_credits_atomic(uuid,numeric), spend_credits_atomic(uuid,numeric,
--     uuid,text), earn_credits_atomic(uuid,numeric,uuid,text) — all plpgsql,
--     all prosecdef = true.
--   `transition_payout_request` does NOT exist (pg_proc: 0 rows).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ---------------------------------------
--   * It does not touch the REQUEST-CREATION side. `/api/referrals/payout` and
--     its `can_request_referral_payouts` gate are §2.7, a separate change.
--     In particular there is NO
--       UNIQUE INDEX ... ON payout_requests(center_id) WHERE status='pending'
--     here: that would change what centre-side request creation is allowed to
--     do, and it is not this defect. The protection is applied on the APPROVAL
--     side only, inside the RPC, where it cannot break request creation: a
--     coverage check that refuses to approve a request whose amount, added to
--     everything the centre is already committed for in status 'approved' OR
--     'paid', would exceed its currently-available referral rewards. Read the
--     block above that check in part 4 for what it does and does not promise —
--     in particular it is a check, not a hold.
--   * It does not implement §7's delegated approval cap, the `permissions`
--     key `can_approve_payouts`, step-up auth, or the §7.4 hash chain. Those
--     are the payout build, not the missing-approval-path defect. What it does
--     do is refuse an approver who has no real `admin_users` row (§7.5 / S10)
--     and record the authority source so that decision is provable later.
--   * It adds no ledger. §3's double-entry ledger is the payout build.
-- ============================================================================

BEGIN;

-- ── Part 1 — decision columns ───────────────────────────────────────────────
-- All ADD COLUMN are IF NOT EXISTS so a partial apply can be re-run.
ALTER TABLE public.payout_requests
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS paid_by uuid,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_authority_source text;

COMMENT ON COLUMN public.payout_requests.approved_by IS
  'admin_users.id of the approver. Written only by transition_payout_request().';
COMMENT ON COLUMN public.payout_requests.decision_authority_source IS
  'PAYOUT-SYSTEM-SPEC §7.5: how the approver''s authority was established. '
  'Only ''db_row'' is ever written today — an env-phone-only super admin '
  '(SUPER_ADMIN_PHONES, no admin_users row) is refused by the RPC. The column '
  'exists so the distinction is provable after the fact rather than inferred.';

-- ── Part 2 — constraints (DO-block guarded; ADD CONSTRAINT has no IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payout_requests'::regclass
      AND conname = 'payout_requests_decision_authority_source_check'
  ) THEN
    ALTER TABLE public.payout_requests
      ADD CONSTRAINT payout_requests_decision_authority_source_check
      CHECK (decision_authority_source IS NULL
             OR decision_authority_source IN ('db_row', 'env_phone'));
  END IF;
END $$;

-- The three actor FKs point at admin_users, NOT public.users: approval
-- authority is platform-side and the payee identity domain (public.users) is
-- disjoint from it by construction (spec §7.1).
--
-- ON DELETE RESTRICT is deliberate and has a consequence worth reading before
-- applying: because admin_users.id cascades from auth.users, deleting the auth
-- user of someone who has approved a payout will FAIL rather than silently
-- erase who approved it. If you would rather be able to delete such a user,
-- change these three to ON DELETE SET NULL — the approver id is also written
-- into audit_log.details.actor_admin_user_id, which survives either way.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payout_requests'::regclass
      AND conname = 'payout_requests_approved_by_fkey'
  ) THEN
    ALTER TABLE public.payout_requests
      ADD CONSTRAINT payout_requests_approved_by_fkey
      FOREIGN KEY (approved_by) REFERENCES public.admin_users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payout_requests'::regclass
      AND conname = 'payout_requests_rejected_by_fkey'
  ) THEN
    ALTER TABLE public.payout_requests
      ADD CONSTRAINT payout_requests_rejected_by_fkey
      FOREIGN KEY (rejected_by) REFERENCES public.admin_users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payout_requests'::regclass
      AND conname = 'payout_requests_paid_by_fkey'
  ) THEN
    ALTER TABLE public.payout_requests
      ADD CONSTRAINT payout_requests_paid_by_fkey
      FOREIGN KEY (paid_by) REFERENCES public.admin_users(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ── Part 3 — queue index ────────────────────────────────────────────────────
-- The admin queue lists by status, newest first. 0 live rows, so this builds
-- instantly; CONCURRENTLY is not needed and would forbid the surrounding
-- transaction.
CREATE INDEX IF NOT EXISTS idx_payout_requests_status_requested_at
  ON public.payout_requests (status, requested_at DESC);

-- ── Part 4 — the sole writer of approval state ──────────────────────────────
-- Everything the route needs happens here, in ONE transaction:
--   * per-centre advisory lock, then SELECT ... FOR UPDATE      (§2.2's lesson)
--   * approver must hold a real admin_users super_admin row     (§7.5 / S10)
--   * legal-transition table, idempotent re-call                (double-click)
--   * compare-and-swap UPDATE guarded on the observed status
--   * audit_log row in the SAME transaction — if the log fails, the state
--     change fails (§7.4), which is the opposite of the fire-and-forget
--     `try { insert } catch {}` pattern used at 33 other call sites.
--
-- Domain refusals are RETURNED as {ok:false, code:…} rather than raised, so the
-- caller can map them to 404/409/403 without depending on SQLSTATE text passing
-- through PostgREST. Nothing has been written when a refusal is returned.
CREATE OR REPLACE FUNCTION public.transition_payout_request(
  p_payout_id uuid,
  p_action    text,
  p_actor_id  uuid,
  p_reason    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_center_id  uuid;
  v_row        public.payout_requests%ROWTYPE;
  v_next       text;
  v_now        timestamptz := now();
  v_reason     text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor_role text;
  v_actor_is_center_user boolean;
  v_committed  numeric;
  v_available  numeric;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('approve', 'reject', 'mark_paid') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_action');
  END IF;

  -- §7.5 / S10. An approver minted purely by appending a phone to
  -- SUPER_ADMIN_PHONES has no row in any table, so the log would record an
  -- approver uuid matching nothing. Release authority requires a real row.
  SELECT role INTO v_actor_role FROM public.admin_users WHERE id = p_actor_id;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden_actor');
  END IF;

  SELECT center_id INTO v_center_id
    FROM public.payout_requests WHERE id = p_payout_id;
  IF v_center_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- Lock order is always: advisory (centre) -> row. One order everywhere means
  -- two concurrent approvals for the same centre serialize instead of deadlock.
  PERFORM pg_advisory_xact_lock(hashtext('payout_request:' || v_center_id::text));

  SELECT * INTO v_row FROM public.payout_requests
    WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- Idempotent re-call: already in the state this action produces. No second
  -- audit row, no error, no side effect. A double-click and a retried request
  -- are indistinguishable from the first call, by design.
  IF (p_action = 'approve'   AND v_row.status = 'approved')
     OR (p_action = 'reject'    AND v_row.status = 'rejected')
     OR (p_action = 'mark_paid' AND v_row.status = 'paid') THEN
    RETURN jsonb_build_object(
      'ok', true, 'idempotent', true, 'id', p_payout_id,
      'status', v_row.status, 'previous_status', v_row.status);
  END IF;

  v_next := CASE
    WHEN p_action = 'approve'   AND v_row.status = 'pending'                    THEN 'approved'
    WHEN p_action = 'reject'    AND v_row.status IN ('pending', 'approved')     THEN 'rejected'
    WHEN p_action = 'mark_paid' AND v_row.status = 'approved'                   THEN 'paid'
    ELSE NULL
  END;

  IF v_next IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_transition',
                              'status', v_row.status);
  END IF;

  -- ── Coverage: a centre may not be committed for more than it has earned ────
  --
  -- WHAT WAS HERE BEFORE AND WHY IT WAS WRONG. The previous guard counted this
  -- centre's OTHER requests in status 'approved' and refused if any existed.
  -- It was described as blocking a double draw. It does not. 'paid' is not
  -- 'approved', so the counter falls back to zero the instant the first request
  -- is marked paid:
  --     approve #1  -> counter 0, allowed
  --     mark_paid #1 -> #1 is no longer 'approved'
  --     approve #2  -> counter 0 again, allowed
  -- and the same reward balance has been drawn twice, in sequence, with every
  -- check passing. Concurrency was never the hole; sequence was.
  --
  -- WHAT IS ENFORCED NOW — exactly this and nothing stronger:
  --
  --     SUM(amount_requested) over this centre's OTHER payout_requests
  --                             in status 'approved' OR 'paid'     -- committed
  --   + v_row.amount_requested                                     -- this one
  --   <= SUM(reward_amount) over referral_reward_records
  --        WHERE referrer_center_id = v_center_id
  --          AND status = 'available'                              -- available
  --
  -- 'paid' being inside the committed sum is the whole fix: a request that has
  -- already been paid keeps consuming coverage permanently, so the second draw
  -- has nothing left to draw against.
  --
  -- WHY IT HOLDS ON THIS PATH. The committed sum only ever grows here — approve
  -- adds a row to it, and mark_paid moves a row from 'approved' to 'paid'
  -- without changing the total, so the figure is stable across the whole
  -- approve → paid lifecycle. This function never writes
  -- referral_reward_records, so nothing it does can inflate the available side.
  -- Both reads happen under the per-centre advisory lock taken above, so two
  -- concurrent approvals for one centre serialize and the second sees the
  -- first's commitment.
  --
  -- WHAT IT IS *NOT*, stated plainly rather than implied away:
  --   * It is a CHECK, not a HOLD. No reward row is reserved or consumed, so it
  --     is only as good as its two inputs at the moment of approval.
  --   * It does not constrain request CREATION. A centre can still hold several
  --     'pending' requests drawn on the same balance (§2.7, out of scope here);
  --     what changes is that only the covered subset can ever be approved.
  --   * PATCH /api/admin/referral-rewards flips reward records from 'available'
  --     to 'paid' outside this function. When an operator settles the reward
  --     records behind a payout that is already counted as committed, the
  --     available side shrinks while the committed side does not, and this
  --     guard then REFUSES approvals it would previously have allowed. That is
  --     the safe direction to fail — a refusal, never an over-pay — but it is a
  --     real operational edge with no code fix inside this defect's scope. The
  --     durable answer is the §3 ledger, where a payout and the rewards behind
  --     it are one posting instead of two tables kept in step by hand.
  --
  -- Both reads are index-supported live (idx_payout_requests_center,
  -- idx_referral_reward_records_referrer — verified in pg_indexes 4 Aug 2026).
  IF v_next = 'approved' THEN
    SELECT coalesce(sum(amount_requested), 0) INTO v_committed
      FROM public.payout_requests
     WHERE center_id = v_center_id
       AND id <> p_payout_id
       AND status IN ('approved', 'paid');

    SELECT coalesce(sum(reward_amount), 0) INTO v_available
      FROM public.referral_reward_records
     WHERE referrer_center_id = v_center_id
       AND status = 'available';

    IF v_committed + v_row.amount_requested > v_available THEN
      RETURN jsonb_build_object(
        'ok',        false,
        'code',      'insufficient_reward_coverage',
        'status',    v_row.status,
        'requested', v_row.amount_requested,
        'committed', v_committed,
        'available', v_available);
    END IF;
  END IF;

  UPDATE public.payout_requests SET
    status                    = v_next,
    approved_by               = CASE WHEN v_next = 'approved' THEN p_actor_id ELSE approved_by END,
    approved_at               = CASE WHEN v_next = 'approved' THEN v_now      ELSE approved_at END,
    rejected_by               = CASE WHEN v_next = 'rejected' THEN p_actor_id ELSE rejected_by END,
    rejected_at               = CASE WHEN v_next = 'rejected' THEN v_now      ELSE rejected_at END,
    rejection_reason          = CASE WHEN v_next = 'rejected' THEN v_reason   ELSE rejection_reason END,
    paid_by                   = CASE WHEN v_next = 'paid'     THEN p_actor_id ELSE paid_by END,
    paid_at                   = CASE WHEN v_next = 'paid'     THEN v_now      ELSE paid_at END,
    processed_at              = CASE WHEN v_next IN ('paid', 'rejected') THEN v_now ELSE processed_at END,
    decision_authority_source = 'db_row'
  WHERE id = p_payout_id
    AND status = v_row.status;   -- compare-and-swap on the status we locked

  IF NOT FOUND THEN
    -- Unreachable while the row lock is held; kept so a future refactor that
    -- drops the lock degrades to a refusal rather than to a silent no-op
    -- update — the shape that made §2.2's double-pay invisible.
    RETURN jsonb_build_object('ok', false, 'code', 'conflict', 'status', v_row.status);
  END IF;

  -- audit_log.user_id -> public.users(id). Internal admins have no public.users
  -- row (verified live: neither admin_users row does), so writing the approver
  -- there would violate the FK and roll the approval back. Write it only when
  -- it is legal; the approver is recorded unconditionally in details.
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id)
    INTO v_actor_is_center_user;

  INSERT INTO public.audit_log
    (center_id, user_id, action, entity_type, entity_id, details)
  VALUES (
    v_center_id,
    CASE WHEN v_actor_is_center_user THEN p_actor_id ELSE NULL END,
    'payout_request.' || p_action,
    'payout_request',
    p_payout_id,
    jsonb_build_object(
      'previous_status',      v_row.status,
      'new_status',           v_next,
      'amount_requested',     v_row.amount_requested,
      'payment_method',       v_row.payment_method,
      'payment_details',      v_row.payment_details,
      'reason',               v_reason,
      'authority_source',     'db_row',
      'actor_admin_user_id',  p_actor_id,
      'actor_admin_role',     v_actor_role,
      'decided_at',           v_now
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'id', p_payout_id,
    'status', v_next, 'previous_status', v_row.status, 'decided_at', v_now);
END;
$$;

COMMENT ON FUNCTION public.transition_payout_request(uuid, text, uuid, text) IS
  'PAYOUT-SYSTEM-SPEC §2.1. Sole writer of payout_requests approval state. '
  'Locks per centre then FOR UPDATE, requires a real admin_users super_admin '
  'row, is idempotent on re-call, and writes audit_log in the same transaction. '
  'Before approving it checks COVERAGE: the centre''s other requests in status '
  '''approved'' OR ''paid'', plus this one, must not exceed the sum of its '
  'referral_reward_records in status ''available''. Counting ''paid'' is what '
  'stops a sequential re-draw of the same balance. It is a check, not a hold — '
  'no reward row is reserved, and it can start refusing if reward records are '
  'settled to ''paid'' out of band. Failing closed is intended.';

-- service_role only. The browser must never reach this directly.
REVOKE ALL ON FUNCTION public.transition_payout_request(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_payout_request(uuid, text, uuid, text)
  TO service_role;

COMMIT;

-- ── Post-apply verification (run these, do not assume) ──────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='payout_requests'
--    AND column_name IN ('approved_by','approved_at','rejected_by','rejected_at',
--                        'rejection_reason','paid_by','paid_at',
--                        'decision_authority_source');   -- expect 8 rows
-- SELECT proname, prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND proname='transition_payout_request'; -- 1 row, t
-- Then re-load /admin/payout-requests: the 503 banner naming this file must be
-- gone. While it is still showing, no approval has happened and none can.
