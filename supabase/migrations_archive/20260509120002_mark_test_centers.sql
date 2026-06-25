-- Flag known QA / audit / Playwright centers so admin aggregates exclude them by default.
UPDATE public.centers
SET is_test = true
WHERE LOWER(TRIM(name)) IN (
  LOWER(TRIM('NewTestcenter')),
  LOWER(TRIM('Test Center 1234')),
  LOWER(TRIM('Test Owner Center')),
  LOWER(TRIM('Playwright Test Center')),
  LOWER(TRIM('1234center')),
  LOWER(TRIM('center123'))
)
OR id IN (
  'cccccccc-1111-1111-1111-111111111111'::uuid,
  'cccccccc-2222-2222-2222-222222222222'::uuid
);
