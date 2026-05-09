# Parent pack billing cron — diagnostics

## Expected wiring

- **Schedule:** `vercel.json` registers `/api/cron/parent-pack-billing` with `1 0 1 * *` (UTC: 00:01 on the 1st of each month).
- **Handler:** `src/app/api/cron/parent-pack-billing/route.ts` exists and uses `requireCronSecret` at the top of `POST`.

## If `/admin/health` reports it never ran

1. **`CRON_SECRET`** — Vercel invokes cron jobs with `Authorization: Bearer <CRON_SECRET>`. A missing env var or mismatch yields **401** before any DB work (same as all `/api/cron/*` routes).
2. **`cron_paused`** — When `platform_config.cron_paused` is `true`, the handler exits early with `{ skipped: 'cron_paused' }` and HTTP 200.
3. **UTC vs local date** — The schedule is UTC; “May 1” in Cairo may still be April 30 UTC depending on time.
4. **Vercel dashboard** — Confirm the cron job is listed under the project’s Cron tab and inspect invocation logs for 401/403/5xx.

No separate application bug was identified that would prevent registration when `CRON_SECRET` and Vercel cron are configured correctly.
