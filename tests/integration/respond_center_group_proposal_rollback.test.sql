-- DB-level integration test for the Phase 1 combined-accept RPC
-- (respond_center_group_proposal). This proves the ATOMICITY guarantee at the
-- database level, not just that the route delegates to one RPC:
--
--   * Scenario A (positive control): a teacher's accept on a combined request
--     commits BOTH halves - the pending teacher_center link becomes active AND
--     the group is created - and clears carries_link.
--
--   * Scenario B (the headline): a mid-accept FAILURE (accepting an attach
--     proposal whose target group already has a teacher) rolls back FULLY. The
--     link activation done earlier inside the function is undone: no orphaned
--     ACTIVE link, the target group is untouched (no half-created/attached
--     group), and the proposal stays open with carries_link still true.
--
--   * Scenario C: decline tears the pending link down (no membership, no group).
--
-- Why this works: respond_center_group_proposal activates the link and then
-- DELEGATES the proposal mechanics to respond_group_proposal in the SAME
-- transaction (nested plpgsql calls share it). The test wraps the failing accept
-- in a BEGIN ... EXCEPTION block (an implicit savepoint), so when the delegate
-- raises, Postgres rolls back everything since that savepoint - including the
-- link write. Scenario B then asserts the link is still 'pending'.
--
-- HOW TO RUN (needs a throwaway DB - never run against production data):
--   * Supabase MCP: create_branch, then execute_sql with this file's contents
--     against the branch's project ref, then delete_branch.
--   * Or psql against a local/branch DB that has the Phase 1 migration applied:
--       psql "$DATABASE_URL" -f tests/integration/respond_center_group_proposal_rollback.test.sql
--
-- Self-contained and idempotent: fixed test UUIDs, pre-cleanup at the top and
-- post-cleanup at the end. A failing ASSERT raises (the run errors); on success
-- the trailing SELECT returns a single 'PASS' row.

DO $itest$
DECLARE
  -- Fixed fixture ids (deletable on re-run).
  t_teacher    uuid := '11111111-1111-1111-1111-111111111111';
  t_incumbent  uuid := '22222222-2222-2222-2222-222222222222';
  c1           uuid := 'c1c1c1c1-0000-0000-0000-000000000001';
  c2           uuid := 'c2c2c2c2-0000-0000-0000-000000000002';
  c3           uuid := 'c3c3c3c3-0000-0000-0000-000000000003';
  g_taken      uuid := '90000000-0000-0000-0000-0000000000aa';
  p_a          uuid := 'aaaa0000-0000-0000-0000-00000000000a';
  p_b          uuid := 'bbbb0000-0000-0000-0000-00000000000b';
  p_c          uuid := 'cccc0000-0000-0000-0000-00000000000c';

  v_new_group  uuid;
  v_caught     boolean;
  v_status     text;
  v_cut        numeric;
  v_count      int;
BEGIN
  -- ---- pre-cleanup (idempotent) ----------------------------------------
  DELETE FROM public.group_proposals WHERE id IN (p_a, p_b, p_c);
  DELETE FROM public.student_groups WHERE name LIKE 'ITEST_%';
  DELETE FROM public.centers WHERE id IN (c1, c2, c3);
  DELETE FROM auth.users WHERE id IN (t_teacher, t_incumbent);

  -- ---- fixtures --------------------------------------------------------
  -- Users (auth.users requires only id; public.users requires id + role).
  INSERT INTO auth.users (id) VALUES (t_teacher), (t_incumbent);
  INSERT INTO public.users (id, role) VALUES (t_teacher, 'teacher'), (t_incumbent, 'teacher');
  INSERT INTO public.teacher_profiles (user_id, referral_code)
    VALUES (t_teacher, 'ITESTCODE1');

  INSERT INTO public.centers (id, name) VALUES
    (c1, 'ITEST Center 1'), (c2, 'ITEST Center 2'), (c3, 'ITEST Center 3');

  -- One PENDING combined link per center for the teacher.
  INSERT INTO public.teacher_center (teacher_id, center_id, status) VALUES
    (t_teacher, c1, 'pending'),
    (t_teacher, c2, 'pending'),
    (t_teacher, c3, 'pending');

  -- Scenario A: a NEW-group combined proposal (center c1).
  INSERT INTO public.group_proposals (id, teacher_id, center_id, subject, fee_per_class, initiated_by, carries_link, status)
    VALUES (p_a, t_teacher, c1, 'ITEST_A_GROUP', 100, 'center', true, 'open');
  INSERT INTO public.group_proposal_offers (proposal_id, made_by, cut_egp) VALUES (p_a, 'center', 20);

  -- Scenario B: an ATTACH combined proposal whose target group ALREADY has a
  -- teacher (the incumbent). Accepting must fail and roll back fully.
  INSERT INTO public.student_groups (id, center_id, teacher_id, kind, name, fee_per_class, center_cut_egp, status)
    VALUES (g_taken, c2, t_incumbent, 'center', 'ITEST_TAKEN', 100, 7, 'active');
  INSERT INTO public.group_proposals (id, teacher_id, center_id, subject, fee_per_class, initiated_by, carries_link, target_group_id, status)
    VALUES (p_b, t_teacher, c2, 'ITEST_B', 100, 'center', true, g_taken, 'open');
  INSERT INTO public.group_proposal_offers (proposal_id, made_by, cut_egp) VALUES (p_b, 'center', 30);

  -- Scenario C: a NEW-group combined proposal the teacher will DECLINE (center c3).
  INSERT INTO public.group_proposals (id, teacher_id, center_id, subject, fee_per_class, initiated_by, carries_link, status)
    VALUES (p_c, t_teacher, c3, 'ITEST_C_GROUP', 100, 'center', true, 'open');
  INSERT INTO public.group_proposal_offers (proposal_id, made_by, cut_egp) VALUES (p_c, 'center', 25);

  -- ===== Scenario A: positive accept commits both halves ================
  SELECT group_id INTO v_new_group
    FROM public.respond_center_group_proposal(p_a, t_teacher, 'accept');

  SELECT status INTO v_status FROM public.teacher_center WHERE teacher_id = t_teacher AND center_id = c1;
  ASSERT v_status = 'active', 'A: link must be ACTIVE after accept (got ' || coalesce(v_status,'NULL') || ')';
  ASSERT v_new_group IS NOT NULL, 'A: accept must return the new group id';
  SELECT count(*) INTO v_count FROM public.student_groups
    WHERE id = v_new_group AND teacher_id = t_teacher AND center_id = c1 AND center_cut_egp = 20;
  ASSERT v_count = 1, 'A: a group must be created with the teacher and the agreed cut';
  SELECT status, carries_link INTO v_status, v_caught FROM public.group_proposals WHERE id = p_a;
  ASSERT v_status = 'accepted', 'A: proposal must be accepted';
  ASSERT v_caught = false, 'A: carries_link must clear once the link commits';

  -- ===== Scenario B: mid-accept failure rolls back FULLY ================
  BEGIN
    PERFORM public.respond_center_group_proposal(p_b, t_teacher, 'accept');
    v_caught := false;
  EXCEPTION WHEN others THEN
    v_caught := true;  -- the delegate raised "target group already has a teacher"
  END;
  ASSERT v_caught, 'B: accepting an attach to a group that already has a teacher must raise';

  -- The link activation done BEFORE the delegate must be rolled back.
  SELECT status INTO v_status FROM public.teacher_center WHERE teacher_id = t_teacher AND center_id = c2;
  ASSERT v_status = 'pending', 'B: link must remain PENDING (no orphaned active link) - got ' || coalesce(v_status,'NULL');
  -- The target group must be untouched (no half-attach).
  SELECT teacher_id, center_cut_egp INTO v_new_group, v_cut FROM public.student_groups WHERE id = g_taken;
  ASSERT v_new_group = t_incumbent, 'B: target group teacher must be unchanged';
  ASSERT v_cut = 7, 'B: target group center_cut_egp must be unchanged';
  -- The proposal must still be open and still carry the link.
  SELECT status, carries_link INTO v_status, v_caught FROM public.group_proposals WHERE id = p_b;
  ASSERT v_status = 'open', 'B: proposal must remain open after a failed accept';
  ASSERT v_caught = true, 'B: carries_link must remain true after a failed accept';

  -- ===== Scenario C: decline tears down the pending link ================
  PERFORM public.respond_center_group_proposal(p_c, t_teacher, 'decline');
  SELECT count(*) INTO v_count FROM public.teacher_center WHERE teacher_id = t_teacher AND center_id = c3;
  ASSERT v_count = 0, 'C: decline must delete the pending link (no membership)';
  SELECT status INTO v_status FROM public.group_proposals WHERE id = p_c;
  ASSERT v_status = 'declined', 'C: proposal must be declined';
  SELECT count(*) INTO v_count FROM public.student_groups WHERE center_id = c3;
  ASSERT v_count = 0, 'C: decline must not create a group';

  -- ---- post-cleanup ----------------------------------------------------
  DELETE FROM public.group_proposals WHERE id IN (p_a, p_b, p_c);
  DELETE FROM public.student_groups WHERE name LIKE 'ITEST_%';
  DELETE FROM public.centers WHERE id IN (c1, c2, c3);
  DELETE FROM auth.users WHERE id IN (t_teacher, t_incumbent);

  RAISE NOTICE 'respond_center_group_proposal rollback test: ALL ASSERTIONS PASSED';
END
$itest$;

SELECT 'PASS' AS result;
