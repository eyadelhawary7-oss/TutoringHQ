# STOPPED — pricing rollout checkpoints

## Post-deploy verification

Eyad runs manually after deploy:

```sql
SELECT id, name, plan_key, monthly_price, status
FROM public.centers
WHERE plan_key = 'enterprise'
  AND is_test = false
  AND monthly_price != 18499;
```

Any rows indicate live Enterprise centres whose stored monthly inclusive price does not match the fixed Enterprise tier (`18499` EGP/mo per pricing spec baseline). Investigate before treating pricing/MRR as authoritative.

## Top Centers (`plan_key = top_centers`)

Centres **must** have `monthly_price` set. Application code calls `requireTopCentersMonthlyPrice` where tier pricing is resolved; missing values trigger Sentry and throw.
