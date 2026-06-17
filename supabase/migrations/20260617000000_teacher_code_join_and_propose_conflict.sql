-- Teacher-flow refinements: (Ref 1) propose-time slot conflict guard, and
-- (Ref 2 & 3) center-acceptor atomic join + attach for teacher-by-code requests.
--
-- Two additive CREATE OR REPLACE changes. Nothing is dropped or renamed; no
-- table/column changes. The teacher-by-code request reuses the EXISTING
-- carries_link primitive on group_proposals (and the pending teacher_center
-- link), so no new table is needed - only the mirror of
-- respond_center_group_proposal with the CENTER as the acceptor.
--
-- ---------------------------------------------------------------------------
-- 1. propose_group_slot - reject an overlapping proposal at PROPOSE time.
-- ---------------------------------------------------------------------------
-- Phase 3 only guarded conflicts at confirm time (center side). A teacher could
-- propose a clashing time and only learn of it when the center failed to
-- confirm. This adds the SAME room/teacher overlap guard (errcode 23P01, which
-- the route maps to the friendly SLOT_CONFLICT message) to propose, so the
-- teacher is told plainly and immediately to pick another time. confirm keeps
-- its own guard (defence in depth: the timetable can change between propose and
-- confirm). schedule_slots.day_of_week is TEXT, so the smallint day is cast.
create or replace function public.propose_group_slot(
  p_group_id      uuid,
  p_actor_user_id uuid,
  p_day_of_week   smallint,
  p_start_time    time without time zone,
  p_end_time      time without time zone,
  p_room_id       uuid default null,
  p_note          text default null
)
returns public.group_slot_proposals
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_group public.student_groups%rowtype;
  v_row   public.group_slot_proposals%rowtype;
  v_dow   text;
begin
  select * into v_group from public.student_groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;
  -- Only the attached teacher proposes for their own attachment. A foreign/unknown
  -- group is indistinguishable from a non-existent one (no existence oracle).
  if v_group.teacher_id is distinct from p_actor_user_id then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;
  if v_group.kind <> 'center' or v_group.center_id is null then
    raise exception 'group % is not center-attached', p_group_id using errcode = '23514';
  end if;
  if p_day_of_week is null or p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'invalid day_of_week' using errcode = '22023';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'end_time must be after start_time' using errcode = '22023';
  end if;
  if p_room_id is not null then
    perform 1 from public.rooms where id = p_room_id and center_id = v_group.center_id;
    if not found then
      raise exception 'room % not in this center', p_room_id using errcode = '23514';
    end if;
  end if;

  -- Conflict guard at propose time (mirrors confirm_group_slot). schedule_slots
  -- stores day_of_week as text, so compare against the cast day.
  v_dow := p_day_of_week::text;
  -- No room double-booking: same room, same day, overlapping time.
  if p_room_id is not null then
    perform 1 from public.schedule_slots s
      where s.center_id = v_group.center_id
        and s.room_id = p_room_id
        and s.day_of_week = v_dow
        and s.start_time < p_end_time
        and s.end_time   > p_start_time;
    if found then
      raise exception 'room is already booked at this time' using errcode = '23P01';
    end if;
  end if;
  -- No teacher double-booking: the teacher cannot be in two places at once.
  if v_group.teacher_id is not null then
    perform 1 from public.schedule_slots s
      where s.teacher_id = v_group.teacher_id
        and s.day_of_week = v_dow
        and s.start_time < p_end_time
        and s.end_time   > p_start_time;
    if found then
      raise exception 'teacher is already booked at this time' using errcode = '23P01';
    end if;
  end if;

  -- One pending proposal per group: supersede any prior pending one.
  update public.group_slot_proposals
     set status = 'withdrawn', updated_at = now()
   where group_id = p_group_id and status = 'pending';

  insert into public.group_slot_proposals
    (group_id, proposed_by, day_of_week, start_time, end_time, room_id, note)
  values
    (p_group_id, p_actor_user_id, p_day_of_week, p_start_time, p_end_time, p_room_id, p_note)
  returning * into v_row;

  return v_row;
end $function$;

revoke all on function public.propose_group_slot(uuid,uuid,smallint,time,time,uuid,text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. respond_teacher_code_group_proposal - the CENTER's atomic decision on a
--    teacher-by-code request (the mirror of respond_center_group_proposal).
-- ---------------------------------------------------------------------------
-- A teacher reached this center by its center_code (not yet a member). The
-- by-code routes created an UNCOMMITTED teacher<->center link (a teacher_center
-- row, status='pending') and a group_proposals row marked carries_link=true,
-- initiated_by='teacher'. The center now decides once, atomically:
--
--   accept  : commit the link (pending -> active, idempotent), clear
--             carries_link, then DELEGATE accept to the canonical
--             respond_group_proposal with side='center' (create/attach the group
--             at the agreed cut) - in the SAME transaction. Membership + group
--             land together, or neither does.
--   counter : commit the link, clear carries_link, then delegate counter (the
--             link STICKS; the cut keeps negotiating as an ordinary member).
--   decline : delete the still-pending link (no membership), then delegate
--             decline. No link, no group.
--
-- A center code alone never attaches anything: the link is pending and the group
-- is dormant until the CENTER acts here. Nested plpgsql calls share the
-- transaction, so if the delegate raises, the link writes roll back too - never
-- a half-state (joined-but-no-group, or group-without-membership).
create or replace function public.respond_teacher_code_group_proposal(
  p_proposal_id   uuid,
  p_center_id     uuid,
  p_actor_user_id uuid,
  p_action        text,            -- 'accept' | 'counter' | 'decline'
  p_cut_egp       numeric default null,
  p_note          text default null
)
returns table(proposal_status text, group_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prop public.group_proposals%rowtype;
  v_status text;
  v_group_id uuid;
begin
  if p_action not in ('accept','counter','decline') then
    raise exception 'invalid action %', p_action using errcode = '22023';
  end if;

  select * into v_prop from public.group_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal % not found', p_proposal_id using errcode = 'P0002';
  end if;
  -- Center scoping: the proposal must belong to the acting center (no existence
  -- oracle - a foreign proposal looks the same as a missing one).
  if v_prop.center_id is distinct from p_center_id then
    raise exception 'proposal % not found', p_proposal_id using errcode = 'P0002';
  end if;
  -- Must be a teacher-initiated request still carrying an uncommitted link.
  if v_prop.initiated_by <> 'teacher' or coalesce(v_prop.carries_link, false) = false then
    raise exception 'proposal % does not carry a pending link', p_proposal_id using errcode = '23514';
  end if;
  if v_prop.status <> 'open' then
    raise exception 'proposal is not open (status %)', v_prop.status using errcode = '23514';
  end if;

  if p_action = 'decline' then
    -- Tear down the still-pending link BEFORE delegating. If the delegate's
    -- decline raises, this delete rolls back with it. An already-active
    -- membership is never touched - carries_link=true means the link is pending.
    delete from public.teacher_center
      where teacher_id = v_prop.teacher_id
        and center_id  = v_prop.center_id
        and status = 'pending';

    select pr.proposal_status, pr.group_id into v_status, v_group_id
      from public.respond_group_proposal(
        p_proposal_id, p_actor_user_id, 'center', 'decline', null, null) as pr;
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
    insert into public.teacher_center (teacher_id, center_id, status, invited_by, accepted_at)
    values (v_prop.teacher_id, v_prop.center_id, 'active', p_actor_user_id, now());
  end if;

  update public.group_proposals
     set carries_link = false, updated_at = now()
   where id = p_proposal_id;

  -- Delegate the proposal mechanics (turn check, offer snapshot, group
  -- create/attach on accept) to the canonical state machine with side='center',
  -- in THIS transaction. Atomicity rests on this nested call sharing the
  -- transaction with the link writes above.
  select pr.proposal_status, pr.group_id into v_status, v_group_id
    from public.respond_group_proposal(
      p_proposal_id, p_actor_user_id, 'center', p_action, p_cut_egp, p_note) as pr;
  return query select v_status, v_group_id;
end $function$;

revoke execute on function public.respond_teacher_code_group_proposal(uuid, uuid, uuid, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.respond_teacher_code_group_proposal(uuid, uuid, uuid, text, numeric, text)
  to service_role;

notify pgrst, 'reload schema';

-- Verify after applying:
--   SELECT proname FROM pg_proc WHERE proname = 'respond_teacher_code_group_proposal';
--   -- expect: one row
--   SELECT pg_get_functiondef('public.propose_group_slot(uuid,uuid,smallint,time,time,uuid,text)'::regprocedure)
--     LIKE '%already booked at this time%' AS has_guard;
--   -- expect: true
