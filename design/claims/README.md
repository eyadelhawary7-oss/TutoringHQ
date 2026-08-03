# Claim-file mutex

One claim file per **target source file**, not per merged design file. A pipeline
claims every file it intends to write before any of its agents touch anything.

## Protocol

1. **Check before starting.** Read `design/claims/<slug>.claim`. If it exists and
   its `released` field is empty, the file is held by another pipeline. **Stop and
   report.** Do not wait, do not force.
2. **Write before touching.** Create the claim with the agent name and an ISO-8601
   UTC timestamp before the first edit.
3. **Release after the PR opens.** Set `released` to the release timestamp. A claim
   is not released while its worktree is still live.

## Format

```
file: src/app/[locale]/dashboard/page.tsx
pipeline: Merged-Center-Home §01
worktree: /abs/path/to/worktree
branch: pipeline/<slug>
claimed_by: <agent name>
claimed_at: <ISO-8601 UTC>
released: <ISO-8601 UTC or empty>
```

## What is never claimed, because it is never written

- The six protected files (Public-App, Center-Money, Teacher-Money, Admin-Money,
  Verification-Payouts, Lifecycle) — behaviour decides, not filename. A WRITE, a
  MONEY FIGURE or an ENTITLEMENT CHECK goes to Eyad wherever it lives.
- `supabase/migrations/**` — a schema change stops the pipeline and is reported.
- Shared components under `src/components/patterns/` and `src/components/ui/`.
- Tracking docs, except to append the pipeline's own row.

A second pipeline that needs a shared migration, component or table **stops and
reports**. It does not queue and it does not fork the primitive.
