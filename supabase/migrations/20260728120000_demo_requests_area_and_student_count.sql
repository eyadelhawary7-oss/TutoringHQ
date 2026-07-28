-- D1 · demo_requests: the two columns the lead capture form needs.
-- Approved by Eyad, 28 July 2026.
-- See design/BUILD-AFTER-REDESIGN.md §2 D1 (the decision) and §1 R1 (what it
-- unblocks), and design/DATA-GAPS.md §0.5 (how the gap was found).
--
-- MANUAL APPLY TO PRODUCTION. Supabase Branching auto-applies to preview
-- branches only, never to production on merge — tested 2026-07-15, when PR #159
-- merged as 80f82ba and the columns were still absent from the production
-- catalog eight minutes later. Apply this by hand, confirm both columns are in
-- information_schema.columns, and only then let the code deploy.
--
-- Verified against the live catalog before writing: demo_requests has 12
-- columns and neither `area` nor `student_count` is among them. 0 rows, so
-- there is nothing to backfill.

-- ── Why both are NULLABLE ────────────────────────────────────────────────────
-- POST /api/demo-request is live today and sends neither field. A NOT NULL
-- column without a default would 500 that endpoint the moment this is applied.
-- Merged-Public-Marketing §04 is explicit that area is load-bearing and not
-- optional, and that stays true — but it is enforced at the API boundary, where
-- the form is, not by the column. The column can be tightened once /talk-to-us
-- replaces the current 55-line stub and the old insert path is gone.

ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS student_count integer;

-- `anon` holds an INSERT grant on this table. RLS is enabled and there is no
-- INSERT policy, so the grant is inert today and every write goes through the
-- service role — but the constraint is cheap insurance against that changing.
-- A CHECK passes on NULL, so this does not conflict with the nullability above.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'demo_requests_student_count_nonneg'
  ) THEN
    ALTER TABLE public.demo_requests
      ADD CONSTRAINT demo_requests_student_count_nonneg CHECK (student_count >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.demo_requests.area IS
  'Governorate or district the lead teaches in. Routes the lead to a rep via center_assignments.territory_city. Free text at the column level; the form offers a fixed list.';
COMMENT ON COLUMN public.demo_requests.student_count IS
  'Rough student count as typed by the lead. Indicative only — never billed on, never used in a money calculation.';
