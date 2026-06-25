-- Teacher invoice parity: make the existing `invoices` table owner-polymorphic
-- (center | teacher) so teachers get FULL invoice records through the SAME table,
-- finalizer, pay route and page that centers use. Additive + non-destructive:
-- `invoices` is empty in prod and every center invoice keeps owner_type='center'
-- with its existing center_id semantics, so centers are entirely unaffected.
--
-- Sibling tables `saved_cards` and `card_charge_intents` are already
-- owner-polymorphic (owner_type ∈ {center, teacher}) and `card_charge_intents`
-- already FKs `invoice_id -> invoices(id)`, so the charge engine was built
-- expecting teachers to flow through `invoices`; this closes that gap.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'center',
  ADD COLUMN IF NOT EXISTS teacher_id uuid;

-- owner_type domain
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_owner_type_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_owner_type_check CHECK (owner_type = ANY (ARRAY['center'::text, 'teacher'::text]));

-- teacher_id mirrors teacher_subscriptions.teacher_id -> teacher_profiles.user_id
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_teacher_id_fkey;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES public.teacher_profiles(user_id) ON DELETE CASCADE;

-- center_id was NOT NULL; teacher invoices have no center. Relax to nullable.
ALTER TABLE public.invoices ALTER COLUMN center_id DROP NOT NULL;

-- Exactly one owner, matching owner_type (XOR). Belt-and-braces against bad inserts.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_owner_xor_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_owner_xor_check CHECK (
    (owner_type = 'center'  AND center_id IS NOT NULL AND teacher_id IS NULL) OR
    (owner_type = 'teacher' AND teacher_id IS NOT NULL AND center_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_invoices_teacher_id
  ON public.invoices (teacher_id) WHERE teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_teacher_status
  ON public.invoices (teacher_id, status) WHERE owner_type = 'teacher';

-- RLS: a teacher may read ONLY her own invoices (mirrors
-- teacher_subscriptions_select_own). Service-role writes bypass RLS; this is
-- defence-in-depth for any client-side read. The existing
-- invoices_select_own_center policy never matches teacher rows (center_id IS NULL).
DROP POLICY IF EXISTS invoices_select_own_teacher ON public.invoices;
CREATE POLICY invoices_select_own_teacher ON public.invoices
  FOR SELECT USING (owner_type = 'teacher' AND teacher_id = auth.uid());

COMMENT ON COLUMN public.invoices.owner_type IS
  'Invoice owner kind: center (default) or teacher. Teachers reach full invoice parity through the same table + finalizer.';
COMMENT ON COLUMN public.invoices.teacher_id IS
  'Teacher owner (teacher_profiles.user_id) when owner_type=teacher; NULL for center invoices.';

NOTIFY pgrst, 'reload schema';
