-- Phase 3: slot picking after the cut is agreed.
--
-- The cut/attach machinery (Phases 1-2 + the teacher-brings-own-group flip) ends
-- at attachment: respond_group_proposal sets student_groups.teacher_id +
-- center_cut_egp + kind='center' and stops. No time is placed. Phase 3 adds the
-- final step: the attached teacher PROPOSES a weekly time slot; the center
-- CONFIRMS it, which books a real schedule_slots row (the existing center
-- timetable the schedule page reads) for the group.
--
-- INTERIM by design: the center schedule has no "open availability" model (every
-- schedule_slots row is an already-assigned group session). So rather than pick
-- from open slots, the teacher proposes a concrete day/time (optionally a room)
-- and the center confirms. The confirm step is the ONLY writer of schedule_slots
-- here and carries the conflict guard the schedule page only had client-side.
--
-- Additive only. Touches nothing in the cut/attach/billing path. Future-only is
-- untouched: this places a (recurring) schedule slot; it never bills or rewrites
-- any transaction.

-- ── Pending proposed slots ──────────────────────────────────────────────────
create table if not exists public.group_slot_proposals (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.student_groups(id) on delete cascade,
  proposed_by     uuid not null references public.users(id),
  day_of_week     smallint not null check (day_of_week between 0 and 6),
  start_time      time without time zone not null,
  end_time        time without time zone not null,
  room_id         uuid references public.rooms(id),
  note            text,
  status          text not null default 'pending'
                    check (status in ('pending','confirmed','declined','withdrawn')),
  created_slot_id uuid references public.schedule_slots(id),
  responded_by    uuid references public.users(id),
  responded_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists idx_group_slot_proposals_group on public.group_slot_proposals(group_id);
create index if not exists idx_group_slot_proposals_status on public.group_slot_proposals(status);
-- At most one pending proposal per group at a time.
create unique index if not exists uq_group_slot_proposals_one_pending
  on public.group_slot_proposals(group_id) where status = 'pending';

-- Service-role only (writes go through SECURITY DEFINER RPCs; gates live in the
-- API routes). RLS on with no policies => no anon/authenticated access.
alter table public.group_slot_proposals enable row level security;

-- ── Teacher proposes a slot for their own center attachment ──────────────────
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

-- ── Center confirms a pending slot -> books it to the group's schedule ───────
create or replace function public.confirm_group_slot(
  p_slot_proposal_id uuid,
  p_center_id        uuid,
  p_actor_user_id    uuid,
  p_room_id          uuid default null
)
returns public.schedule_slots
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_p     public.group_slot_proposals%rowtype;
  v_group public.student_groups%rowtype;
  v_room  uuid;
  v_dow   text;
  v_slot  public.schedule_slots%rowtype;
begin
  select * into v_p from public.group_slot_proposals where id = p_slot_proposal_id for update;
  if not found then
    raise exception 'slot proposal % not found', p_slot_proposal_id using errcode = 'P0002';
  end if;
  if v_p.status <> 'pending' then
    raise exception 'slot proposal is not pending (status %)', v_p.status using errcode = '23514';
  end if;

  select * into v_group from public.student_groups where id = v_p.group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;
  -- Center scoping: the proposal's group must belong to the acting center.
  if v_group.center_id is distinct from p_center_id then
    raise exception 'slot proposal % not found', p_slot_proposal_id using errcode = 'P0002';
  end if;
  if v_group.kind <> 'center' then
    raise exception 'group is no longer center-attached' using errcode = '23514';
  end if;

  v_room := coalesce(p_room_id, v_p.room_id);
  if v_room is not null then
    perform 1 from public.rooms where id = v_room and center_id = p_center_id;
    if not found then
      raise exception 'room % not in this center', v_room using errcode = '23514';
    end if;
  end if;
  v_dow := v_p.day_of_week::text;

  -- Conflict guard (the schedule page only had this client-side): no room
  -- double-booking - same room, same day, overlapping time.
  if v_room is not null then
    perform 1 from public.schedule_slots s
      where s.center_id = p_center_id
        and s.room_id = v_room
        and s.day_of_week = v_dow
        and s.start_time < v_p.end_time
        and s.end_time   > v_p.start_time;
    if found then
      raise exception 'room is already booked at this time' using errcode = '23P01';
    end if;
  end if;
  -- No teacher double-booking - the teacher cannot be in two places at once.
  if v_group.teacher_id is not null then
    perform 1 from public.schedule_slots s
      where s.teacher_id = v_group.teacher_id
        and s.day_of_week = v_dow
        and s.start_time < v_p.end_time
        and s.end_time   > v_p.start_time;
    if found then
      raise exception 'teacher is already booked at this time' using errcode = '23P01';
    end if;
  end if;

  -- Book the slot on the center timetable the schedule page reads.
  insert into public.schedule_slots
    (center_id, room_id, group_id, teacher_id, subject, day_of_week, start_time, end_time, recurring)
  values
    (p_center_id, v_room, v_group.id, v_group.teacher_id, v_group.subject, v_dow,
     v_p.start_time, v_p.end_time, true)
  returning * into v_slot;

  update public.group_slot_proposals
     set status = 'confirmed',
         created_slot_id = v_slot.id,
         responded_by = p_actor_user_id,
         responded_at = now(),
         room_id = v_room,
         updated_at = now()
   where id = p_slot_proposal_id;

  return v_slot;
end $function$;

-- ── Center declines a pending slot (frees it; nothing booked) ────────────────
create or replace function public.decline_group_slot(
  p_slot_proposal_id uuid,
  p_center_id        uuid,
  p_actor_user_id    uuid
)
returns public.group_slot_proposals
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_p     public.group_slot_proposals%rowtype;
  v_group public.student_groups%rowtype;
  v_row   public.group_slot_proposals%rowtype;
begin
  select * into v_p from public.group_slot_proposals where id = p_slot_proposal_id for update;
  if not found then
    raise exception 'slot proposal % not found', p_slot_proposal_id using errcode = 'P0002';
  end if;
  if v_p.status <> 'pending' then
    raise exception 'slot proposal is not pending (status %)', v_p.status using errcode = '23514';
  end if;

  select * into v_group from public.student_groups where id = v_p.group_id;
  if not found or v_group.center_id is distinct from p_center_id then
    raise exception 'slot proposal % not found', p_slot_proposal_id using errcode = 'P0002';
  end if;

  update public.group_slot_proposals
     set status = 'declined', responded_by = p_actor_user_id, responded_at = now(), updated_at = now()
   where id = p_slot_proposal_id
  returning * into v_row;

  return v_row;
end $function$;

revoke all on function public.propose_group_slot(uuid,uuid,smallint,time,time,uuid,text) from public, anon, authenticated;
revoke all on function public.confirm_group_slot(uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.decline_group_slot(uuid,uuid,uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
