-- Owner-initiated group proposals (bidirectional negotiation).
--
-- Today only a teacher can open a group_proposals negotiation; the center
-- accepts/counters/declines. This migration lets the OWNER start the same
-- negotiation object too, and makes withdraw symmetric. Two additive changes,
-- both backward-compatible with the live teacher-proposes flow:
--
--   1. group_proposals.initiated_by — records which side opened the
--      negotiation ('teacher' | 'center'). Additive, DEFAULT 'teacher' so every
--      pre-existing row reads correctly and the unchanged teacher POST (which
--      does not set it) still produces a teacher-initiated proposal.
--
--   2. respond_group_proposal — reworked so EITHER side can withdraw the offer
--      that is currently standing (the side that made the latest offer), and
--      decline is restricted to the recipient (the side that did NOT make the
--      latest offer). Previously withdraw was hard-coded teacher-only. The
--      go-live path on accept (create the student_groups row with the agreed
--      cut, kind='center', status='active') is unchanged — one path, whoever
--      accepts. Turn order for accept/counter is unchanged.
--
-- ADR 033 is preserved: an owner proposing a cut is only an offer; it becomes
-- binding (and the live group exists) solely on acceptance. The proposal stays
-- dormant — no student_groups, roster, attendance or money — until then.
--
-- Deploy ordering: additive column, safe to apply before the code that reads
-- it; but the GET routes start selecting initiated_by, so apply this migration
-- together with (or before) the deploy. Nothing is dropped or renamed.

-- ---------------------------------------------------------------------------
-- 1. group_proposals.initiated_by
-- ---------------------------------------------------------------------------
ALTER TABLE public.group_proposals
  ADD COLUMN IF NOT EXISTS initiated_by text NOT NULL DEFAULT 'teacher';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_proposals_initiated_by_chk'
  ) THEN
    ALTER TABLE public.group_proposals
      ADD CONSTRAINT group_proposals_initiated_by_chk
      CHECK (initiated_by IN ('teacher','center'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. respond_group_proposal — symmetric withdraw, recipient-only decline.
--    Captured in full (CREATE OR REPLACE) so the function reads as one unit.
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
  -- the side that made the latest offer. (Used to be teacher-only; owner-
  -- initiated proposals make this symmetric.)
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

-- Lockdown unchanged: service-role only (the API does the real authz and
-- passes trusted p_actor_user_id / p_side).
REVOKE EXECUTE ON FUNCTION public.respond_group_proposal(uuid, uuid, text, text, numeric, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_group_proposal(uuid, uuid, text, text, numeric, text)
  TO service_role;

-- Refresh PostgREST's schema cache so the new column is exposed immediately.
NOTIFY pgrst, 'reload schema';

-- Verify after applying:
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_name = 'group_proposals' AND column_name = 'initiated_by';
--   -- expect: initiated_by | 'teacher'::text
