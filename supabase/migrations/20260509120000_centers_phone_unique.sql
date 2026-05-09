-- Phone uniqueness for centres (F-B21). DEFERRABLE allows batched upserts within one transaction.
-- Run duplicate audit before applying (see STOPPED.md).

ALTER TABLE public.centers
  ADD CONSTRAINT centers_phone_unique UNIQUE (phone) DEFERRABLE INITIALLY DEFERRED;
