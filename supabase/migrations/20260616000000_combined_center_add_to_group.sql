-- Phase 1: combined center-initiated "add teacher to a group" request.
--
-- The owner adds a teacher to a group (new or existing plain center group) in
-- ONE request that bundles BOTH the teacher<->center link AND the group/cut
-- proposal. The teacher then makes a single decision that resolves both
-- atomically.
--
-- Two additive pieces, both backward-compatible. Nothing is dropped or renamed
-- that live code reads.
--
--   1. group_proposals.carries_link — when true, this center-initiated proposal
--      also carries an UNCOMMITTED teacher<->center link (a teacher_center row
--      in status='pending', created by the combined-create route). DEFAULT
--      false, so every existing row and the unchanged teacher-proposes /
--      already-linked center-proposes flows read correctly and behave exactly
--      as before. The flag flips to false the moment the link commits (the
--      teacher's first accept/counter), after which the proposal is an ordinary
--      negotiation between a center and one of its members.
--
--   2. respond_center_group_proposal — the teacher's single, atomic decision on
--      a combined request. A thin SECURITY DEFINER wrapper that (a) commits or
--      tears down the link and then (b) DELEGATES the proposal mechanics to the
--      canonical respond_group_proposal in the SAME transaction. Nested plpgsql
--      calls share the transaction, so if either half raises, BOTH roll back -
--      there is never a half-state (linked-but-proposal-lost, or
--      group-created-but-link-missing). Billing is untouched: the delegate sets
--      student_groups.center_cut_egp and finish_center_class_and_bill reads it
--      at bill-time, so future-only is automatic (ADR preserved).
--
--   - accept  : commit the link (pending -> active, idempotent), clear
--               carries_link, then delegate accept (create/attach the group at
--               the standing center cut).
--   - counter : commit the link, clear carries_link, then delegate counter (the
--               link STICKS; the cut keeps negotiating).
--   - decline : delete the still-pending link (no membership), then delegate
--               decline (closes the negotiation). No link, no group.
--
-- Deploy ordering: apply BEFORE the code that reads/writes carries_link or calls
-- respond_center_group_proposal, or in lockstep. Replay-safe / idempotent.

-- ---------------------------------------------------------------------------
-- 1. group_proposals.carries_link
-- ---------------------------------------------------------------------------
ALTER TABLE public.group_proposals
  ADD COLUMN IF NOT EXISTS carries_link boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. respond_center_group_proposal — atomic link + proposal resolution.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_center_group_proposal(
  p_proposal_id   uuid,
  p_actor_user_id uuid,
  p_action        text,            -- 'accept' | 'counter' | 'decline'
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
  v_status text;
  v_group_id uuid;
begin
  if p_action not in ('accept','counter','decline') then
    raise exception 'invalid action %', p_action using errcode = '22023';
  end if;

  -- Lock the proposal for the whole decision. The teacher must be its target;
  -- it must be a center-initiated request that still carries an uncommitted
  -- link, and still be open. carries_link=true guarantees the teacher has not
  -- acted yet (the standing offer is the center's opening), so accept/counter/
  -- decline are all the teacher's valid first move - the delegate re-checks turn
  -- order regardless.
  select * into v_prop from public.group_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal % not found', p_proposal_id using errcode = 'P0002';
  end if;
  if v_prop.teacher_id <> p_actor_user_id then
    -- No existence oracle: a foreign proposal looks the same as a missing one.
    raise exception 'proposal % not found', p_proposal_id using errcode = 'P0002';
  end if;
  if v_prop.initiated_by <> 'center' or coalesce(v_prop.carries_link, false) = false then
    raise exception 'proposal % does not carry a pending link', p_proposal_id using errcode = '23514';
  end if;
  if v_prop.status <> 'open' then
    raise exception 'proposal is not open (status %)', v_prop.status using errcode = '23514';
  end if;

  if p_action = 'decline' then
    -- Tear down the still-pending link (created solely for this combined
    -- request) BEFORE delegating. If the delegate's decline raises (e.g. turn
    -- order), this delete rolls back with it. An already-active membership is
    -- never touched - carries_link=true means the link is pending, not active.
    delete from public.teacher_center
      where teacher_id = v_prop.teacher_id
        and center_id  = v_prop.center_id
        and status = 'pending';

    select pr.proposal_status, pr.group_id into v_status, v_group_id
      from public.respond_group_proposal(
        p_proposal_id, p_actor_user_id, 'teacher', 'decline', null, null) as pr;
    return query select v_status, v_group_id;
    return;
  end if;

  -- accept / counter: COMMIT the link first (pending -> active). Idempotent: flip
  -- an existing pending row to active, else ensure an active row exists. Then
  -- clear carries_link so every later round is a plain member<->center
  -- negotiation. If the delegate raises below, all of this rolls back.
  update public.teacher_center
     set status = 'active', accepted_at = now()
   where teacher_id = v_prop.teacher_id
     and center_id  = v_prop.center_id
     and status = 'pending';
  if not exists (
    select 1 from public.teacher_center
     where teacher_id = v_prop.teacher_id and center_id = v_prop.center_id
  ) then
    insert into public.teacher_center (teacher_id, center_id, status, accepted_at)
    values (v_prop.teacher_id, v_prop.center_id, 'active', now());
  end if;

  update public.group_proposals
     set carries_link = false, updated_at = now()
   where id = p_proposal_id;

  -- Delegate the proposal mechanics (turn check, offer snapshot, group
  -- create/attach on accept) to the canonical state machine, in THIS
  -- transaction. Atomicity of link + proposal rests entirely on this nested
  -- call sharing the transaction with the link writes above.
  select pr.proposal_status, pr.group_id into v_status, v_group_id
    from public.respond_group_proposal(
      p_proposal_id, p_actor_user_id, 'teacher', p_action, p_cut_egp, p_note) as pr;
  return query select v_status, v_group_id;
end $function$;

-- Service-role only: the API does the real authn/authz and passes a trusted
-- p_actor_user_id (the teacher's own id, re-checked against the proposal here).
REVOKE EXECUTE ON FUNCTION public.respond_center_group_proposal(uuid, uuid, text, numeric, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_center_group_proposal(uuid, uuid, text, numeric, text)
  TO service_role;

-- Refresh PostgREST's schema cache so the new column + function are exposed.
NOTIFY pgrst, 'reload schema';

-- Verify after applying:
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_name = 'group_proposals' AND column_name = 'carries_link';
--   -- expect: carries_link | false
--   SELECT proname FROM pg_proc WHERE proname = 'respond_center_group_proposal';
--   -- expect: one row
