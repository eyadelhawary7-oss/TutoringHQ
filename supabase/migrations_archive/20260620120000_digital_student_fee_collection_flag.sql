-- The single switch for DIGITAL STUDENT-FEE COLLECTION.
--
-- This governs ONLY the collection of STUDENT session fees through Paymob: the
-- markup, the customer/teacher commission, the 90/10 split, and the Paymob
-- payment links sent to parents/students. When false, that whole feature is
-- dormant: hidden from the UI, no active billing writes, no errors. Flip to
-- true to restore the full digital-collection feature with no rebuild.
--
-- This is DISTINCT from PAYMOB_ENABLED, which gates the teacher's OWN
-- subscription billing (the tier fee charged to the teacher's card/wallet).
-- That path stays fully working and is NOT governed by this flag.
--
-- Default OFF. ON CONFLICT DO NOTHING so re-running never clobbers a deliberate
-- restore (a true value set later survives a replay of this migration).
INSERT INTO public.platform_config (key, value)
VALUES ('digital_student_fee_collection.enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
