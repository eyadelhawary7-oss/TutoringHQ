-- Teacher resubscribe payment sessions: combined_payment_sessions rows for
-- session_type='teacher_resubscribe' carry no center (the payer is a teacher;
-- teacher_id lives in metadata jsonb because the table has no teacher_id
-- column). center_id was NOT NULL, which made such rows impossible to insert.
-- All existing write paths (upgrade / reactivation tiers) still provide
-- center_id; every read path null-guards center_id already.
ALTER TABLE public.combined_payment_sessions
  ALTER COLUMN center_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
