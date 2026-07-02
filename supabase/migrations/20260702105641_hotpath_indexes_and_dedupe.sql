-- ============================================================================
-- M8 + L4 — Add missing hot-path FK indexes; drop confirmed duplicate indexes
-- ----------------------------------------------------------------------------
-- All CONCURRENTLY so this is lock-light on the live table. CONCURRENTLY cannot
-- run inside a transaction block; each statement autocommits (psql -f / the
-- Supabase migration runner apply these one statement at a time).
--
-- M8: the hot unindexed FKs from the audit (users.center_id — every
-- get_auth_center_id() tenancy join; the transactions.* money-ledger FKs;
-- pending_enrollments.*). transactions.student_id/teacher_id are already
-- indexed and are left alone.
--
-- L4: 7 byte-identical duplicate index pairs (the advisor's duplicate_index
-- set). For each pair the redundant copy is dropped and the canonical name
-- kept; for mrr_snapshots the constraint-backed unique index is kept and only
-- the standalone duplicate is dropped. Verified: no dropped index backs a
-- constraint. (Looser prefix-redundant indexes are deferred to the later
-- performance pass, per the brief's Parked list.)
-- ============================================================================

-- M8 — missing hot-path FK indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_center_id ON public.users (center_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_center_id ON public.transactions (center_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_group_id ON public.transactions (group_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_enrollment_id ON public.transactions (enrollment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_created_by ON public.transactions (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_marked_paid_by ON public.transactions (marked_paid_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pending_enrollments_center_id ON public.pending_enrollments (center_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pending_enrollments_group_id ON public.pending_enrollments (group_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pending_enrollments_student_id ON public.pending_enrollments (student_id);

-- L4 — drop confirmed duplicate indexes (redundant copy of each pair)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_attendance_student;          -- keep idx_attendance_student_scanned
DROP INDEX CONCURRENTLY IF EXISTS public.idx_audit_action;                -- keep idx_audit_log_action
DROP INDEX CONCURRENTLY IF EXISTS public.idx_payments_center_paid;        -- keep idx_payments_center_paid_at
DROP INDEX CONCURRENTLY IF EXISTS public.idx_students_payment;            -- keep idx_students_center_payment
DROP INDEX CONCURRENTLY IF EXISTS public.idx_wa_center_month;             -- keep idx_wa_messages_center_month
DROP INDEX CONCURRENTLY IF EXISTS public.in_app_notifications_user_created_idx; -- keep in_app_notifications_user_recent_idx
DROP INDEX CONCURRENTLY IF EXISTS public.mrr_snapshots_date_unique;       -- keep constraint-backed mrr_snapshots_snapshot_date_key

NOTIFY pgrst, 'reload schema';
