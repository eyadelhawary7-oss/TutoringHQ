-- Center-cut billing + group proposal negotiation (teacher -> center).
--
-- Repo-sync note: prod already carried student_groups.center_cut_egp, the
-- group_proposals / group_proposal_offers tables, the negotiation guard
-- triggers and the respond_group_proposal RPC (applied live, never committed
-- to the repo). This migration captures that live state verbatim and adds the
-- missing pieces: finish_center_class_and_bill, RLS on both proposal tables,
-- the set_updated_at trigger, the subject-length check, and an execute-grant
-- lockdown on respond_group_proposal (it was executable by anon/authenticated
-- while trusting p_actor_user_id - a cross-tenant hole). Every statement is
-- replay-safe / idempotent.

-- ---------------------------------------------------------------------------
-- 1a. student_groups.center_cut_egp (flat EGP cut per student per lesson).
--     Live CHECK is stronger than "cut >= 0": the cut can never exceed the
--     per-class fee when one is set.
-- ---------------------------------------------------------------------------
ALTER TABLE public.student_groups
  ADD COLUMN IF NOT EXISTS center_cut_egp numeric NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_groups_center_cut_valid'
  ) THEN
    ALTER TABLE public.student_groups
      ADD CONSTRAINT student_groups_center_cut_valid
      CHECK (center_cut_egp >= 0 AND (fee_per_class IS NULL OR center_cut_egp <= fee_per_class));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1b. group_proposals (live shape, includes responded_by / responded_at).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.group_proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id        uuid NOT NULL REFERENCES public.users(id),
  center_id         uuid NOT NULL REFERENCES public.centers(id),
  subject           text NOT NULL,
  grade_level       text,
  fee_per_class     numeric NOT NULL CHECK (fee_per_class > 0),
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','accepted','declined','withdrawn','expired')),
  accepted_offer_id uuid,
  opening_message   text,
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  responded_by      uuid REFERENCES public.users(id),
  responded_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Subject length check (added after CREATE so it also lands on the
-- pre-existing live table; both tables are empty so validation is instant).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_proposals_subject_len_chk'
  ) THEN
    ALTER TABLE public.group_proposals
      ADD CONSTRAINT group_proposals_subject_len_chk
      CHECK (char_length(subject) BETWEEN 1 AND 120);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1c. group_proposal_offers (append-only negotiation log).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.group_proposal_offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.group_proposals(id) ON DELETE CASCADE,
  made_by     text NOT NULL CHECK (made_by IN ('teacher','center')),
  cut_egp     numeric NOT NULL CHECK (cut_egp >= 0),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 1d. FK group_proposals.accepted_offer_id -> group_proposal_offers.id
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_proposals_accepted_offer_fk'
  ) THEN
    ALTER TABLE public.group_proposals
      ADD CONSTRAINT group_proposals_accepted_offer_fk
      FOREIGN KEY (accepted_offer_id) REFERENCES public.group_proposal_offers(id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Indexes (live names/definitions). The open-uniqueness key includes
-- grade_level (coalesced) so the same subject can be proposed for two grades;
-- it is strictly tighter than the spec's (teacher, center, subject).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS group_proposals_open_unique
  ON public.group_proposals (teacher_id, center_id, subject, COALESCE(grade_level, ''))
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS group_proposals_center_open_idx
  ON public.group_proposals (center_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS group_proposals_teacher_idx
  ON public.group_proposals (teacher_id);

CREATE INDEX IF NOT EXISTS group_proposal_offers_proposal_idx
  ON public.group_proposal_offers (proposal_id, created_at);

-- ---------------------------------------------------------------------------
-- Negotiation guard functions + triggers (live, captured verbatim).
-- ---------------------------------------------------------------------------

-- Closed proposals are immutable; fee_per_class (the student rate) is
-- immutable for the proposal's whole life - only the cut is negotiated.
CREATE OR REPLACE FUNCTION public.guard_group_proposals_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if new.fee_per_class is distinct from old.fee_per_class then
    raise exception 'group_proposals.fee_per_class is immutable' using errcode = '23514';
  end if;
  if old.status <> 'open' and new.status is distinct from old.status then
    raise exception 'closed proposals are immutable (status %)', old.status using errcode = '23514';
  end if;
  return new;
end $function$;

-- Every offer insert: proposal must be open, cut <= fee_per_class, and the
-- negotiation clock resets (expires_at = now() + 7 days).
CREATE OR REPLACE FUNCTION public.guard_group_proposal_offer()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
declare v_prop public.group_proposals%rowtype;
begin
  select * into v_prop from public.group_proposals where id = new.proposal_id for update;
  if not found then
    raise exception 'proposal % not found', new.proposal_id using errcode = 'P0002';
  end if;
  if v_prop.status <> 'open' then
    raise exception 'proposal % is not open (status %)', new.proposal_id, v_prop.status using errcode = '23514';
  end if;
  if new.cut_egp > v_prop.fee_per_class then
    raise exception 'cut % exceeds fee_per_class %', new.cut_egp, v_prop.fee_per_class using errcode = '23514';
  end if;
  update public.group_proposals
     set expires_at = now() + interval '7 days', updated_at = now()
   where id = new.proposal_id;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.block_group_proposal_offer_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  raise exception 'group_proposal_offers is append-only' using errcode = '23514';
end $function$;

CREATE OR REPLACE TRIGGER trg_guard_group_proposals_update
  BEFORE UPDATE ON public.group_proposals
  FOR EACH ROW EXECUTE FUNCTION public.guard_group_proposals_update();

CREATE OR REPLACE TRIGGER trg_guard_group_proposal_offer
  BEFORE INSERT ON public.group_proposal_offers
  FOR EACH ROW EXECUTE FUNCTION public.guard_group_proposal_offer();

CREATE OR REPLACE TRIGGER trg_group_proposal_offers_append_only
  BEFORE UPDATE OR DELETE ON public.group_proposal_offers
  FOR EACH ROW EXECUTE FUNCTION public.block_group_proposal_offer_mutation();

-- ---------------------------------------------------------------------------
-- 1e. updated_at trigger (set_updated_at() exists from 20260611000000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER set_updated_at_group_proposals
  BEFORE UPDATE ON public.group_proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 1f / 1g. RLS. centers has no owner_id column; the canonical center-side
-- scoping in this schema is get_auth_center_id() + has_center_role(...), the
-- same pattern as students / student_groups. API routes use the service role
-- (bypasses RLS); these policies are defense-in-depth for browser clients.
-- ---------------------------------------------------------------------------
ALTER TABLE public.group_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teacher_own_proposals" ON public.group_proposals;
CREATE POLICY "teacher_own_proposals" ON public.group_proposals
  FOR ALL TO authenticated
  USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS "center_own_proposals" ON public.group_proposals;
CREATE POLICY "center_own_proposals" ON public.group_proposals
  FOR ALL TO authenticated
  USING (
    center_id = public.get_auth_center_id()
    AND public.has_center_role(ARRAY['owner','admin'])
  );

ALTER TABLE public.group_proposal_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teacher_proposal_offers" ON public.group_proposal_offers;
CREATE POLICY "teacher_proposal_offers" ON public.group_proposal_offers
  FOR ALL TO authenticated
  USING (
    proposal_id IN (
      SELECT id FROM public.group_proposals WHERE teacher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "center_proposal_offers" ON public.group_proposal_offers;
CREATE POLICY "center_proposal_offers" ON public.group_proposal_offers
  FOR ALL TO authenticated
  USING (
    proposal_id IN (
      SELECT id FROM public.group_proposals
      WHERE center_id = public.get_auth_center_id()
        AND public.has_center_role(ARRAY['owner','admin'])
    )
  );

-- ---------------------------------------------------------------------------
-- respond_group_proposal (live, captured verbatim) - the single negotiation
-- state machine both API sides call. Turn order is enforced here (accept and
-- counter only by the party who did NOT make the latest offer); accept snaps
-- the latest opposing offer as accepted_offer_id and creates the center group.
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

  if p_action = 'withdraw' then
    if p_side <> 'teacher' then
      raise exception 'only the teacher can withdraw' using errcode = '23514';
    end if;
    update public.group_proposals
       set status = 'withdrawn', responded_by = p_actor_user_id, responded_at = now(), updated_at = now()
     where id = p_proposal_id;
    return query select 'withdrawn'::text, null::uuid;
    return;
  end if;

  if p_action = 'decline' then
    update public.group_proposals
       set status = 'declined', responded_by = p_actor_user_id, responded_at = now(), updated_at = now()
     where id = p_proposal_id;
    return query select 'declined'::text, null::uuid;
    return;
  end if;

  select * into v_latest
    from public.group_proposal_offers
   where proposal_id = p_proposal_id
   order by created_at desc, id desc
   limit 1;
  if not found then
    raise exception 'proposal % has no offers', p_proposal_id using errcode = '23514';
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

  -- accept
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

-- Lockdown: SECURITY DEFINER + trusted p_actor_user_id/p_side params means
-- this must NEVER be callable by anon/authenticated (it was). API routes call
-- it with the service role after doing the real authz.
REVOKE EXECUTE ON FUNCTION public.respond_group_proposal(uuid, uuid, text, text, numeric, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_group_proposal(uuid, uuid, text, text, numeric, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 1h. finish_center_class_and_bill: the center-group twin of
-- finish_class_and_bill (which hard-rejects kind <> 'private'). Bills every
-- billable attendee at the group's fee_per_class AND, when center_cut_egp > 0,
-- writes a second center_fee transaction per attendee for the center's cut.
-- Idempotent twice over: billed sessions no-op, and every charge carries a
-- per-session+student idempotency key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_center_class_and_bill(
  p_session_id uuid,
  p_actor_id   uuid DEFAULT NULL
)
RETURNS TABLE(session_id uuid, billed_now boolean, charges_created integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_session    public.sessions%rowtype;
  v_group      public.student_groups%rowtype;
  v_fee        numeric;
  v_cut        numeric;
  v_teacher_id uuid;
  v_center_id  uuid;
  v_count      int := 0;
  v_attendee   record;
  v_payer      text;
  v_payer_phone text;
  v_lesson_key text;
  v_center_key text;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session % not found', p_session_id USING errcode = 'P0002';
  END IF;

  IF v_session.billed THEN
    RETURN QUERY SELECT v_session.id, false, 0;
    RETURN;
  END IF;

  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'cannot bill a cancelled session %', p_session_id USING errcode = '23514';
  END IF;

  IF v_session.kind <> 'center' THEN
    RAISE EXCEPTION 'finish_center_class_and_bill is center-only; session % is kind %',
      p_session_id, v_session.kind USING errcode = '23514';
  END IF;

  SELECT * INTO v_group FROM public.student_groups
    WHERE id = v_session.group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'group % for session % not found',
      v_session.group_id, p_session_id USING errcode = 'P0002';
  END IF;

  v_fee        := v_group.fee_per_class;
  v_cut        := COALESCE(v_group.center_cut_egp, 0);
  v_teacher_id := v_group.teacher_id;
  v_center_id  := v_group.center_id;

  IF v_fee IS NULL THEN
    RAISE EXCEPTION 'group % has no fee_per_class; cannot bill', v_group.id
      USING errcode = '23514';
  END IF;
  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'group % has no teacher_id; cannot bill', v_group.id
      USING errcode = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teacher_profiles tp WHERE tp.user_id = v_teacher_id
  ) THEN
    RAISE EXCEPTION 'no teacher_profile for user %; cannot bill group %',
      v_teacher_id, v_group.id USING errcode = '23503';
  END IF;

  IF v_session.status <> 'finished' THEN
    PERFORM public.apply_session_transition(p_session_id, 'finished', p_actor_id);
  END IF;

  FOR v_attendee IN
    SELECT a.student_id FROM public.attendance_scans a
    WHERE a.session_id = p_session_id AND a.billable = true
  LOOP
    v_payer := NULL; v_payer_phone := NULL;

    SELECT e.payer INTO v_payer FROM public.enrollments e
      WHERE e.group_id = v_session.group_id AND e.student_id = v_attendee.student_id;

    IF v_payer = 'parent' THEN
      SELECT s.parent_phone INTO v_payer_phone FROM public.students s
        WHERE s.id = v_attendee.student_id;
    ELSIF v_payer = 'student' THEN
      SELECT s.phone INTO v_payer_phone FROM public.students s
        WHERE s.id = v_attendee.student_id;
    END IF;

    v_lesson_key := 'lesson:' || p_session_id::text || ':' || v_attendee.student_id::text;
    v_center_key := 'center_fee:' || p_session_id::text || ':' || v_attendee.student_id::text;

    INSERT INTO public.transactions (
      kind, session_id, enrollment_id, student_id, group_id,
      teacher_id, center_id, lesson_fee, amount_billed,
      payer_type, payer_phone, status, idempotency_key, created_by
    )
    SELECT 'lesson', p_session_id,
      (SELECT e.id FROM public.enrollments e
        WHERE e.group_id = v_session.group_id AND e.student_id = v_attendee.student_id),
      v_attendee.student_id, v_session.group_id,
      v_teacher_id, v_center_id, v_fee, v_fee,
      v_payer, v_payer_phone, 'pending', v_lesson_key, p_actor_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.transactions t WHERE t.idempotency_key = v_lesson_key
    );
    IF FOUND THEN v_count := v_count + 1; END IF;

    IF v_cut > 0 THEN
      INSERT INTO public.transactions (
        kind, session_id, enrollment_id, student_id, group_id,
        teacher_id, center_id, lesson_fee, amount_billed,
        status, idempotency_key, created_by
      )
      SELECT 'center_fee', p_session_id,
        (SELECT e.id FROM public.enrollments e
          WHERE e.group_id = v_session.group_id AND e.student_id = v_attendee.student_id),
        v_attendee.student_id, v_session.group_id,
        v_teacher_id, v_center_id, v_cut, v_cut,
        'pending', v_center_key, p_actor_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.transactions t WHERE t.idempotency_key = v_center_key
      );
    END IF;

  END LOOP;

  SET LOCAL app.allow_lifecycle_write = 'on';
  UPDATE public.sessions SET billed = true, billed_at = now() WHERE id = p_session_id;
  SET LOCAL app.allow_lifecycle_write = 'off';

  INSERT INTO public.audit_log (action, entity_type, entity_id, user_id, center_id, details)
  VALUES (
    'center_class_finished_billed', 'session', p_session_id, p_actor_id, v_center_id,
    jsonb_build_object(
      'charges_created', v_count,
      'fee_per_class', v_fee,
      'center_cut_egp', v_cut,
      'teacher_id', v_teacher_id
    )
  );

  RETURN QUERY SELECT p_session_id, true, v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finish_center_class_and_bill(uuid, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_center_class_and_bill(uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
