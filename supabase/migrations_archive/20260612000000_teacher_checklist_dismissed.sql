-- Onboarding checklist dismissal flag for teachers. Server-side (no browser
-- storage) so a teacher who dismisses the checklist keeps it dismissed across
-- devices. Defaults to false; the home page hides the card once all steps are
-- complete OR this is true.
ALTER TABLE public.teacher_profiles
  ADD COLUMN IF NOT EXISTS checklist_dismissed boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
