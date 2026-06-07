-- 20260607000005_lesson_commission_resolver.sql
-- Lesson commission resolver + zero-seeded rate config.
-- Applied to prod via Supabase MCP; this file is the repo record.

insert into public.platform_config (key, value)
select 'lesson_commission',
       '{"customer_pct": 0, "teacher_pct": 0, "processing_flat": 0, "vat_pct": 0.14}'::jsonb
where not exists (select 1 from public.platform_config where key = 'lesson_commission');

create or replace function public.compute_lesson_money(
  p_lesson_fee numeric,
  p_method     text
)
returns table (
  lesson_fee              numeric,
  customer_commission_amt numeric,
  processing_fee_amt      numeric,
  amount_billed           numeric,
  teacher_commission_amt  numeric,
  teacher_net             numeric,
  platform_gross          numeric,
  platform_net            numeric,
  snap_vat_amount         numeric,
  snap_customer_pct       numeric,
  snap_teacher_pct        numeric,
  snap_processing_flat    numeric
)
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_cp  numeric;
  v_tp  numeric;
  v_pf  numeric;
  v_vat numeric;
  v_fee numeric := round(coalesce(p_lesson_fee, 0), 2);
begin
  if v_fee < 0 then
    raise exception 'lesson_fee cannot be negative (got %)', v_fee using errcode = '22023';
  end if;

  -- Cash and instapay never touch Paymob, so they carry no cut.
  if p_method not in ('card','wallet','apple_pay','google_pay') then
    lesson_fee := v_fee; customer_commission_amt := 0; processing_fee_amt := 0;
    amount_billed := v_fee; teacher_commission_amt := 0; teacher_net := v_fee;
    platform_gross := 0; platform_net := 0; snap_vat_amount := 0;
    snap_customer_pct := 0; snap_teacher_pct := 0; snap_processing_flat := 0;
    return next; return;
  end if;

  -- Rates live in one config row. Anything missing reads as 0.
  select value into v_cfg from public.platform_config where key = 'lesson_commission';
  v_cp  := coalesce((v_cfg->>'customer_pct')::numeric, 0);
  v_tp  := coalesce((v_cfg->>'teacher_pct')::numeric, 0);
  v_pf  := coalesce((v_cfg->>'processing_flat')::numeric, 0);
  v_vat := coalesce((v_cfg->>'vat_pct')::numeric, 0);

  if v_cp < 0 or v_cp >= 1 then
    raise exception 'customer_pct must be in [0,1) (got %)', v_cp using errcode = '22023';
  end if;
  if v_tp < 0 or v_tp > 1 then
    raise exception 'teacher_pct must be in [0,1] (got %)', v_tp using errcode = '22023';
  end if;
  if v_pf < 0 then
    raise exception 'processing_flat must be >= 0 (got %)', v_pf using errcode = '22023';
  end if;
  if v_vat < 0 then
    raise exception 'vat_pct must be >= 0 (got %)', v_vat using errcode = '22023';
  end if;

  snap_customer_pct    := v_cp;
  snap_teacher_pct     := v_tp;
  snap_processing_flat := v_pf;

  lesson_fee         := v_fee;
  processing_fee_amt := round(v_pf, 2);

  -- Customer cut is taken out of the billed total, grossed up so tuition + processing stay whole:
  --   amount_billed = (tuition + processing) / (1 - customer_pct)
  amount_billed           := round((v_fee + processing_fee_amt) / (1 - v_cp), 2);
  -- Derive the cut as the remainder so lesson_fee + customer_commission + processing = amount_billed exactly.
  customer_commission_amt := amount_billed - v_fee - processing_fee_amt;

  -- Teacher cut is a straight deduction from tuition.
  teacher_commission_amt := round(v_fee * v_tp, 2);
  teacher_net            := v_fee - teacher_commission_amt;

  -- Your money is both cuts. Processing is pass-through to Paymob, not yours.
  platform_gross  := customer_commission_amt + teacher_commission_amt;
  -- VAT carved out of your cut (VAT-inclusive): gross * vat / (1 + vat).
  snap_vat_amount := round(platform_gross * v_vat / (1 + v_vat), 2);
  platform_net    := platform_gross - snap_vat_amount;

  return next;
end;
$$;

revoke execute on function public.compute_lesson_money(numeric, text) from public, anon, authenticated;
grant  execute on function public.compute_lesson_money(numeric, text) to service_role;

notify pgrst, 'reload schema';
