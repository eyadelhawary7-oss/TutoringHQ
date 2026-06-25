-- Teacher attaches a center to their OWN solo group (flip private -> center).
--
-- Additive change to respond_group_proposal: the accept branch that handles a
-- target_group_id now distinguishes TWO shapes of target group:
--   (a) a center's teacherless convenience shell (kind='center', teacher_id NULL)
--       -> attach this teacher (Phase 2 behaviour, byte-for-byte unchanged).
--   (b) the proposer's OWN solo private group (kind='private', teacher_id = the
--       proposing teacher, center_id NULL) -> plug the center in: set center_id +
--       agreed cut and flip kind->'center' so future sessions bill through the
--       center engine. Students/enrollments are keyed by group_id and never move.
--       Future-only by construction: past 'private' sessions keep their kind and
--       transactions; only sessions created after the flip bill with the cut.
--
-- Everything outside the target_group_id block is identical to the prior version.

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

  select * into v_latest
    from public.group_proposal_offers
   where proposal_id = p_proposal_id
   order by created_at desc, id desc
   limit 1;
  if not found then
    raise exception 'proposal % has no offers', p_proposal_id using errcode = '23514';
  end if;

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

  update public.group_proposals
     set status = 'accepted', accepted_offer_id = v_latest.id,
         responded_by = p_actor_user_id, responded_at = now(), updated_at = now()
   where id = p_proposal_id;

  if v_prop.target_group_id is not null then
    select * into v_group from public.student_groups
      where id = v_prop.target_group_id for update;
    if not found then
      raise exception 'target group % not found', v_prop.target_group_id using errcode = 'P0002';
    end if;

    if v_group.kind = 'center' then
      -- (a) Attach this teacher to the center's teacherless convenience shell.
      if v_group.center_id <> v_prop.center_id then
        raise exception 'target group % does not belong to center %',
          v_prop.target_group_id, v_prop.center_id using errcode = '23514';
      end if;
      if v_group.teacher_id is not null then
        raise exception 'target group % already has a teacher', v_prop.target_group_id using errcode = '23514';
      end if;

      update public.student_groups
         set teacher_id = v_prop.teacher_id, center_cut_egp = v_latest.cut_egp
       where id = v_prop.target_group_id;

      return query select 'accepted'::text, v_prop.target_group_id;
      return;

    elsif v_group.kind = 'private'
          and v_group.teacher_id = v_prop.teacher_id
          and v_group.center_id is null then
      -- (b) Flip the teacher's OWN solo group to center-attached: plug the
      -- center in + agreed cut and switch the billing engine (kind). The roster
      -- (enrollments / student_group_members) is keyed by group_id and untouched.
      update public.student_groups
         set center_id = v_prop.center_id,
             center_cut_egp = v_latest.cut_egp,
             kind = 'center'
       where id = v_prop.target_group_id;

      return query select 'accepted'::text, v_prop.target_group_id;
      return;

    else
      raise exception 'target group % is not attachable', v_prop.target_group_id using errcode = '23514';
    end if;
  end if;

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

REVOKE ALL ON FUNCTION public.respond_group_proposal(uuid,uuid,text,text,numeric,text) FROM public, anon, authenticated;

NOTIFY pgrst, 'reload schema';
