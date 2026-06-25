-- Teachers section: attach-to-existing-group proposals + owner-initiated links.
--
-- Two confirmed capabilities, both additive and backward-compatible with the
-- live teacher-proposes / teacher-requests flows. Nothing is dropped or renamed
-- that live code reads; the only index touched is recreated in the same
-- migration (sub-second uniqueness gap on a tiny table).
--
--   1. group_proposals.target_group_id — when set, the negotiation targets an
--      EXISTING plain center group (kind='center', teacher_id IS NULL) instead
--      of proposing a brand-new group. DEFAULT NULL, so every existing row and
--      the unchanged new-group flow are untouched.
--
--   2. respond_group_proposal — on accept, branch on target_group_id: if set,
--      ATTACH (UPDATE teacher_id + center_cut_egp on the existing row) after
--      re-validating eligibility under a row lock; otherwise the existing
--      new-group INSERT path runs verbatim. Future-only is automatic:
--      finish_center_class_and_bill reads center_cut_egp at bill-time, so past
--      transactions keep their amount_billed and only future sessions see the
--      new cut. No transaction/attendance/roster row is ever modified here.
--
--   3. teacher_center_requests.initiated_by — records which side opened the
--      link request ('teacher' | 'center'). DEFAULT 'teacher' so every existing
--      row and the unchanged teacher POST read correctly; the owner-initiated
--      "add by teacher code" flow sets it to 'center' and the teacher accepts.
--
-- ADR 033 preserved: a proposed cut is only an offer; it binds (and the group
-- gains its teacher/cut) solely on acceptance.
--
-- Deploy ordering: apply BEFORE the code that reads target_group_id /
-- initiated_by, or in lockstep. Replay-safe / idempotent throughout.

-- ---------------------------------------------------------------------------
-- 1. group_proposals.target_group_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.group_proposals
  ADD COLUMN IF NOT EXISTS target_group_id uuid REFERENCES public.student_groups(id);

-- The existing open-uniqueness key (teacher, center, subject, grade) was meant
-- for NEW-group proposals: two attach requests to different groups of the same
-- subject/teacher would falsely collide. Scope it to new-group proposals and add
-- a separate one-open-attach-per-group key. Recreated in-migration; no column
-- is dropped.
DROP INDEX IF EXISTS public.group_proposals_open_unique;
CREATE UNIQUE INDEX IF NOT EXISTS group_proposals_open_unique
  ON public.group_proposals (teacher_id, center_id, subject, COALESCE(grade_level, ''))
  WHERE status = 'open' AND target_group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS group_proposals_open_attach_unique
  ON public.group_proposals (target_group_id)
  WHERE status = 'open' AND target_group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. respond_group_proposal — accept branches on target_group_id.
--    Captured in full (CREATE OR REPLACE) so the state machine reads as one
--    unit. Withdraw/decline/counter turn order is unchanged from
--    20260615130000 (symmetric withdraw, recipient-only decline).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_group_proposal(
  p_proposal_id   uuid,
  p_actor_user_id uuid,
  p_side          text,
  p_action        text,
  p_cut_egp       numeric DEFAULT NULL,
  p_note          text DEFAULT NULL
)
RETURNS TABLE(proposal_status text, group_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_prop public.group_proposals%rowtype;
  v_latest public.group_proposal_offers%rowtype;
  v_group public.student_groups%rowtype;
  v_group_id uuid;
  v_name text;
begin
  if p_side not in ('teacher','center') then
    raise exception 'invalid side %', p_side using errcode = '22023';
  end if;
  if p_action not in ('accept','counter','decline','withdraw') then
    raise exception 'invalid action %', p_action using errcode = '22023';
  end if;

  select * into v_prop from public.group_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal % not found', p_proposal_id using errcode = 'P0002';
  end if;
  if v_prop.status <> 'open' then
    raise exception 'proposal is not open (status %)', v_prop.status using errcode = '23514';
  end if;

  -- The standing offer (latest). Every open proposal has at least its opening
  -- offer, so this is always present.
  select * into v_latest
    from public.group_proposal_offers
   where proposal_id = p_proposal_id
   order by created_at desc, id desc
   limit 1;
  if not found then
    raise exception 'proposal % has no offers', p_proposal_id using errcode = '23514';
  end if;

  -- Withdraw: either side may pull the offer that is currently standing, i.e.
  -- the side that made the latest offer.
  if p_action = 'withdraw' then
    if v_latest.made_by <> p_side then
      raise exception 'can only withdraw your own standing offer' using errcode = '23514';
    end if;
    update public.group_proposals
       set status = 'withdrawn', responded_by = p_actor_user_id, responded_at = now(), updated_at = now()
     where id = p_proposal_id;
    return query select 'withdrawn'::text, null::uuid;
    return;
  end if;

  -- Decline: the recipient (the side that did NOT make the latest offer)
  -- rejects the standing offer and closes the negotiation.
  if p_action = 'decline' then
    if v_latest.made_by = p_side then
      raise exception 'not your turn: latest offer was made by %', v_latest.made_by using errcode = '23514';
    end if;
    update public.group_proposals
       set status = 'declined', responded_by = p_actor_user_id, responded_at = now(), updated_at = now()
     where id = p_proposal_id;
    return query select 'declined'::text, null::uuid;
    return;
  end if;

  -- accept/counter only by the party who did NOT make the latest offer
  if v_latest.made_by = p_side then
    raise exception 'not your turn: latest offer was made by %', v_latest.made_by using errcode = '23514';
  end if;

  if p_action = 'counter' then
    if p_cut_egp is null then
      raise exception 'counter requires cut_egp' using errcode = '22023';
    end if;
    insert into public.group_proposal_offers (proposal_id, made_by, cut_egp, note)
    values (p_proposal_id, p_side, p_cut_egp, p_note);
    return query select 'open'::text, null::uuid;
    return;
  end if;

  -- accept: snap the standing opposing offer and go live. One path regardless
  -- of who accepts.
  update public.group_proposals
     set status = 'accepted', accepted_offer_id = v_latest.id,
         responded_by = p_actor_user_id, responded_at = now(), updated_at = now()
   where id = p_proposal_id;

  -- Attach-to-existing: target_group_id set => UPDATE the existing plain center
  -- group instead of creating a new one. Re-validate under a row lock: same
  -- center, kind='center', and still teacher-less (reject a group that already
  -- has a teacher). Only teacher_id + center_cut_egp change; fee_per_class,
  -- roster, attendance and every past transaction are untouched. Future-only is
  -- automatic because billing reads center_cut_egp at bill-time.
  if v_prop.target_group_id is not null then
    select * into v_group from public.student_groups
      where id = v_prop.target_group_id for update;
    if not found then
      raise exception 'target group % not found', v_prop.target_group_id using errcode = 'P0002';
    end if;
    if v_group.center_id <> v_prop.center_id then
      raise exception 'target group % does not belong to center %',
        v_prop.target_group_id, v_prop.center_id using errcode = '23514';
    end if;
    if v_group.kind <> 'center' then
      raise exception 'target group % is not a center group', v_prop.target_group_id using errcode = '23514';
    end if;
    if v_group.teacher_id is not null then
      raise exception 'target group % already has a teacher', v_prop.target_group_id using errcode = '23514';
    end if;

    update public.student_groups
       set teacher_id = v_prop.teacher_id, center_cut_egp = v_latest.cut_egp
     where id = v_prop.target_group_id;

    return query select 'accepted'::text, v_prop.target_group_id;
    return;
  end if;

  -- New-group path (unchanged).
  v_name := v_prop.subject || case when v_prop.grade_level is not null and v_prop.grade_level <> ''
                                   then ' - ' || v_prop.grade_level else '' end;

  insert into public.student_groups
    (center_id, teacher_id, kind, name, subject, fee_per_class, center_cut_egp, status)
  values
    (v_prop.center_id, v_prop.teacher_id, 'center', v_name, v_prop.subject,
     v_prop.fee_per_class, v_latest.cut_egp, 'active')
  returning id into v_group_id;

  return query select 'accepted'::text, v_group_id;
end $function$;

-- Lockdown unchanged: service-role only (the API does the real authz and passes
-- trusted p_actor_user_id / p_side).
REVOKE EXECUTE ON FUNCTION public.respond_group_proposal(uuid, uuid, text, text, numeric, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_group_proposal(uuid, uuid, text, text, numeric, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. teacher_center_requests.initiated_by
-- ---------------------------------------------------------------------------
ALTER TABLE public.teacher_center_requests
  ADD COLUMN IF NOT EXISTS initiated_by text NOT NULL DEFAULT 'teacher';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teacher_center_requests_initiated_by_chk'
  ) THEN
    ALTER TABLE public.teacher_center_requests
      ADD CONSTRAINT teacher_center_requests_initiated_by_chk
      CHECK (initiated_by IN ('teacher','center'));
  END IF;
END $$;

-- Refresh PostgREST's schema cache so the new columns are exposed immediately.
NOTIFY pgrst, 'reload schema';

-- Verify after applying:
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_name = 'group_proposals' AND column_name = 'target_group_id';
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_name = 'teacher_center_requests' AND column_name = 'initiated_by';
--   -- expect: target_group_id | (null) ; initiated_by | 'teacher'::text
