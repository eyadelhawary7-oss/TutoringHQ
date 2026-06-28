-- ============================================================================
-- Teacher non-payment → drop to FREE BASELINE (airtight enforcement, DB layer)
-- ----------------------------------------------------------------------------
-- A non-paying teacher keeps the FREE baseline (center monitoring + center cut)
-- and loses the PRIVATE-groups engine until they return to a paid plan. Data is
-- never deleted — it is hidden behind the paywall and restored on return.
--
-- The teacher-side chokepoint, mirroring the center auto_suspend path:
--
--   is_teacher_private_locked()  -- a subscription row exists AND no private access
--     = (the teacher is on the free baseline: past_due / suspended / expired-cancelled)
--
-- This migration makes the RLS layer airtight (defense-in-depth behind the
-- service-role API gate `requireTeacherPrivateAccess`):
--   1. New predicate is_teacher_private_locked().
--   2. get_auth_teacher_group_ids() excludes OWNED private groups when locked —
--      one change that gates every group-keyed private policy. Center groups and
--      the users.teacher_group_ids (center-monitoring) branch are untouched.
--   3. The directly-keyed private-only policies (student_groups own writes,
--      content_items/content_access, student_group_notes, student_credits) gain
--      `AND NOT is_teacher_private_locked()`. The center branches are untouched,
--      so center monitoring + invoice payment survive.
--   4. process_due_subscriptions no longer escalates past_due → suspended:
--      past_due is the terminal free-baseline state for non-payment. Suspension
--      becomes an admin-only disciplinary action.
--
-- Reversible: restore the prior function bodies and ALTER POLICY back to
-- NOT is_auth_teacher_suspended() (see git history for the prior definitions).
-- ============================================================================

-- 1) ── The chokepoint predicate ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_teacher_private_locked()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- A subscription row exists (so this is a teacher who had/has the private
  -- engine) AND they currently lack private access → on the free baseline.
  select exists (select 1 from public.teacher_subscriptions where teacher_id = auth.uid())
     and not public.teacher_private_access(auth.uid());
$function$;

-- RLS-helper function: must be executable by the roles the PUBLIC policies serve
-- (same posture as is_auth_teacher_suspended). Not an arbitrary-SQL path.
REVOKE EXECUTE ON FUNCTION public.is_teacher_private_locked() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_teacher_private_locked() TO anon, authenticated, service_role;

-- 2) ── Gate the teacher group-id resolver on private access (private groups only)
-- Returns every group the teacher owns or is linked to, EXCEPT owned private
-- groups are dropped when the teacher is on the free baseline. Center groups
-- (kind <> 'private') and center-monitoring links always remain.
CREATE OR REPLACE FUNCTION public.get_auth_teacher_group_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select array(
    select g.id
    from   public.student_groups g
    where  (
             g.teacher_id = auth.uid()
             or g.id = any (
               coalesce((select u.teacher_group_ids from public.users u where u.id = auth.uid()), '{}'::uuid[])
             )
           )
      and  (g.kind is distinct from 'private' or public.teacher_private_access(auth.uid()))
  )
$function$;

-- 3) ── Tighten the directly-keyed PRIVATE-only policies ─────────────────────
-- student_groups: own private group writes. Replace the weaker suspended check
-- with the free-baseline lock. First-group creation still works: a brand-new
-- teacher has NO subscription row, so is_teacher_private_locked() is false.
ALTER POLICY student_groups_teacher_insert ON public.student_groups
  WITH CHECK ((teacher_id = auth.uid()) AND (kind = 'private'::text) AND (center_id IS NULL) AND (NOT public.is_teacher_private_locked()));
ALTER POLICY student_groups_teacher_update ON public.student_groups
  USING ((teacher_id = auth.uid()) AND (kind = 'private'::text) AND (NOT public.is_teacher_private_locked()))
  WITH CHECK ((teacher_id = auth.uid()) AND (kind = 'private'::text) AND (center_id IS NULL) AND (NOT public.is_teacher_private_locked()));
ALTER POLICY student_groups_teacher_delete ON public.student_groups
  USING ((teacher_id = auth.uid()) AND (kind = 'private'::text) AND (NOT public.is_teacher_private_locked()));

-- content_items: teacher-owned content is private; center-owned is unchanged.
ALTER POLICY content_items_select ON public.content_items
  USING (((owner_teacher_id = auth.uid()) AND (NOT public.is_teacher_private_locked())) OR ((owner_center_id = get_auth_center_id()) AND has_center_role(ARRAY['owner'::text, 'admin'::text])));
ALTER POLICY content_items_insert ON public.content_items
  WITH CHECK (((owner_teacher_id = auth.uid()) AND (NOT public.is_teacher_private_locked())) OR ((owner_center_id = get_auth_center_id()) AND has_center_role(ARRAY['owner'::text, 'admin'::text])));
ALTER POLICY content_items_update ON public.content_items
  USING (((owner_teacher_id = auth.uid()) AND (NOT public.is_teacher_private_locked())) OR ((owner_center_id = get_auth_center_id()) AND has_center_role(ARRAY['owner'::text, 'admin'::text])))
  WITH CHECK (((owner_teacher_id = auth.uid()) AND (NOT public.is_teacher_private_locked())) OR ((owner_center_id = get_auth_center_id()) AND has_center_role(ARRAY['owner'::text, 'admin'::text])));
ALTER POLICY content_items_delete ON public.content_items
  USING (((owner_teacher_id = auth.uid()) AND (NOT public.is_teacher_private_locked())) OR ((owner_center_id = get_auth_center_id()) AND has_center_role(ARRAY['owner'::text, 'admin'::text])));

ALTER POLICY content_access_insert ON public.content_access
  WITH CHECK (((EXISTS ( SELECT 1 FROM content_items ci WHERE ((ci.id = content_access.content_item_id) AND (ci.owner_teacher_id = auth.uid())))) AND (NOT public.is_teacher_private_locked())) OR (EXISTS ( SELECT 1 FROM content_items ci WHERE ((ci.id = content_access.content_item_id) AND (ci.owner_center_id = get_auth_center_id()) AND has_center_role(ARRAY['owner'::text, 'admin'::text])))));

-- student_group_notes: private notes (teacher-owned only).
ALTER POLICY student_group_notes_teacher_select ON public.student_group_notes
  USING ((teacher_id = auth.uid()) AND (NOT public.is_teacher_private_locked()));
ALTER POLICY student_group_notes_teacher_insert ON public.student_group_notes
  WITH CHECK ((teacher_id = auth.uid()) AND (NOT public.is_teacher_private_locked()));
ALTER POLICY student_group_notes_teacher_update ON public.student_group_notes
  USING ((teacher_id = auth.uid()) AND (NOT public.is_teacher_private_locked()))
  WITH CHECK ((teacher_id = auth.uid()) AND (NOT public.is_teacher_private_locked()));
ALTER POLICY student_group_notes_teacher_delete ON public.student_group_notes
  USING ((teacher_id = auth.uid()) AND (NOT public.is_teacher_private_locked()));

-- student_credits: private-engine ledger.
ALTER POLICY student_credits_select ON public.student_credits
  USING ((teacher_id = auth.uid()) AND (NOT public.is_teacher_private_locked()));

-- 4) ── past_due is the terminal free-baseline state for non-payment ─────────
-- Non-payment must NEVER suspend a teacher (suspension is admin-only): a
-- non-paying teacher keeps center monitoring on the free baseline indefinitely.
CREATE OR REPLACE FUNCTION public.process_due_subscriptions(p_as_of timestamp with time zone DEFAULT now())
 RETURNS TABLE(action_taken text, subscription_id uuid)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_grace_days int;
  v_rec record;
begin
  select (value #>> '{}')::int into v_grace_days from public.platform_config where key='subscription_grace_period_days';
  v_grace_days := coalesce(v_grace_days, 7);

  for v_rec in
    select * from public.teacher_subscriptions
    where status in ('trialing','active','past_due')
    for update
  loop
    -- trialing past trial end -> past_due (drop to free baseline)
    if v_rec.status = 'trialing' and v_rec.trial_ends_at is not null and v_rec.trial_ends_at <= p_as_of then
      perform public.apply_teacher_subscription_transition(v_rec.id, 'past_due', null);
      update public.teacher_subscriptions
        set next_billing_at = p_as_of, grace_until = p_as_of + make_interval(days => v_grace_days)
        where id = v_rec.id;
      action_taken := 'trial_expired_to_past_due'; subscription_id := v_rec.id; return next;

    -- active past period end -> past_due (drop to free baseline)
    elsif v_rec.status = 'active' and v_rec.current_period_end is not null and v_rec.current_period_end <= p_as_of then
      perform public.apply_teacher_subscription_transition(v_rec.id, 'past_due', null);
      update public.teacher_subscriptions
        set grace_until = p_as_of + make_interval(days => v_grace_days)
        where id = v_rec.id;
      action_taken := 'period_ended_to_past_due'; subscription_id := v_rec.id; return next;

    -- past_due is TERMINAL for non-payment: stay on the free baseline (center
    -- monitoring preserved), never auto-suspend. Track dunning attempts only.
    elsif v_rec.status = 'past_due' then
      update public.teacher_subscriptions
        set dunning_attempts = dunning_attempts + 1
        where id = v_rec.id;
      action_taken := 'dunning_attempt'; subscription_id := v_rec.id; return next;
    end if;
  end loop;
  return;
end; $function$;

NOTIFY pgrst, 'reload schema';
