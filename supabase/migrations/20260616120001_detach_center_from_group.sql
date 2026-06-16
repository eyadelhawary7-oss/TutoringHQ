-- Teacher removes a center from their own group (flip center -> private).
--
-- The teacher on a center-attached group flips it back to a solo private group:
-- clear center_id, zero the cut, flip kind->'private'. The private shape
-- constraint requires approval_mode NOT NULL, so default it ('manual') if a
-- center-origin group never had one. fee_per_class is always present on a
-- billable group. NO past record is touched (transactions, attendance, sessions
-- keep their 'center' kind and the cut already taken) - future-only in reverse.
-- Future sessions, created as 'private', bill on the private engine with no cut.
--
-- The teacher's own action on their own group: no center approval. Ownership is
-- enforced here (service-role bypasses RLS); a foreign/unknown group is a 404
-- with no existence oracle.

CREATE OR REPLACE FUNCTION public.detach_center_from_group(
  p_group_id      uuid,
  p_actor_user_id uuid
)
RETURNS TABLE(group_id uuid, group_kind text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_group public.student_groups%rowtype;
begin
  select * into v_group from public.student_groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;
  -- Only the group's teacher can flip it. Foreign/unknown is indistinguishable.
  if v_group.teacher_id is distinct from p_actor_user_id then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;
  if v_group.kind <> 'center' or v_group.center_id is null then
    raise exception 'group % is not center-attached', p_group_id using errcode = '23514';
  end if;

  update public.student_groups
     set kind = 'private',
         center_id = null,
         center_cut_egp = 0,
         approval_mode = coalesce(approval_mode, 'manual')
   where id = p_group_id;

  return query select p_group_id, 'private'::text;
end $function$;

REVOKE ALL ON FUNCTION public.detach_center_from_group(uuid,uuid) FROM public, anon, authenticated;

NOTIFY pgrst, 'reload schema';
