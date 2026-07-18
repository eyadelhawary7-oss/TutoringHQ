# Step 0 — Findings: Teacher non-payment → drop to free baseline (airtight)

> Dated Step-0 record; the build has since shipped (migration `20260628135521_teacher_free_baseline_gate.sql`). Synced against the live database on 2026-07-18: the `teacher_subscriptions.status` CHECK is confirmed `IN ('trialing','active','past_due','suspended','cancelled')` and `billing_interval` CHECK is `IN ('monthly','annual')` (verified live 2026-07-18). The build plan (sections A–E) is preserved as the plan of record.

Follow-up to the summer-2026 branch. Replaces the best-effort teacher hard-lock with a reliable
drop-to-free-baseline whose enforcement is airtight at every layer. Centers are untouched.

## The reference pattern (centers)

Centers freeze reliably because **every** center request passes one chokepoint: `src/proxy.ts`
loads `auto_suspend_at` / `billing_status` and `billingAccessGate.centerIsLockedNow()` gates the
read-only `/suspended` screen. One gate, every route.

## Teacher model today (what exists)

- **Subscription states** (`teacher_subscriptions.status`, text+CHECK): `trialing | active | past_due | suspended | cancelled`. Transitions are guarded — direct `UPDATE status` is blocked by trigger `guard_teacher_subscriptions_lifecycle`; all changes go through `apply_teacher_subscription_transition(id, new_status, actor)`. Allowed: trialing→{active,past_due,cancelled}; active→{past_due,suspended,cancelled}; past_due→{active,suspended,cancelled}; suspended→{active,cancelled}; cancelled→active.
- **Access predicate** `teacher_private_access(uid)` → TRUE for `trialing`/`active`/(`cancelled` in grace); **FALSE for `past_due`, `suspended`, expired `cancelled`, and no-row.** This already denies private access for `past_due` — the free-baseline state.
- **Portal state** (`teacherPrivateView.ts`): `unified`(access)→`records`; `lapsed`(row, no access)→`resubscribe`; `center_only`(no row)→`upsell`. So **`past_due` already = free baseline** (private hidden, row preserved, resubscribe view).
- **Center monitoring (free)**: center group reads via `get_auth_center_group_ids()` and the `users.teacher_group_ids` branch of `get_auth_teacher_group_ids()`; served by `/api/teacher/center-cuts|center-attendance|center-schedule` (service role). Independent of private access.

## The gaps (why it's not airtight)

1. **API loophole.** Private routes are the real chokepoint because they use the **service-role** admin client (RLS bypassed). Most call `requireTeacherPrivateAccess` (403 `NO_PRIVATE_ACCESS`), but several private routes only call `requireTeacherAuth`, so a `past_due` teacher can drive them directly:
   - `GET /api/teacher/private/schedule`, `…/schedule/exceptions` (POST), `…/schedule/sessions` (GET/POST), `…/schedule/sessions/[id]` (GET), `…/sessions/[id]/finish|cancel|attendance|start`
   - `GET /api/teacher/private/groups/[groupId]/classes`, `…/groups/[groupId]/schedule`
2. **RLS loophole (browser-client path).** Private RLS write policies gate on `NOT is_auth_teacher_suspended()` — which is TRUE only for `status='suspended'`, so a `past_due` teacher passes. SELECT of private groups flows through `get_auth_teacher_group_ids()`, which returns private + center groups indiscriminately (no access gate). A few tables key directly on `teacher_id`/`owner_teacher_id` (`content_items`, `student_group_notes`, `student_credits`, `group_schedule`, `schedule_exceptions`, `transactions`).
3. **Dunning escalates to `suspended`.** `process_due_subscriptions` walks `past_due` → `suspended` after max attempts. `suspended` is the disciplinary state; for *non-payment* the brief wants the teacher to **stay on the free baseline and keep center monitoring**, never be suspended.
4. **Best-effort lock.** `summerBillingCron` "lock" calls the transition to `past_due` in a bare try/catch with no shared, reliable helper.

## The build (only the gaps)

**A. API chokepoint (primary, server-side).** Flip every private route that serves private data from `requireTeacherAuth` → `requireTeacherPrivateAccess`. Add a **no-loophole unit test** that scans `src/app/api/teacher/private/**` and fails if any route omits the private gate. This is the airtight server gate (every route, service-role boundary).

**B. RLS chokepoint (defense-in-depth, browser path).** One predicate `is_teacher_private_locked()` = (a subscription row exists) AND NOT `teacher_private_access(uid)`. Then:
- Rewrite `get_auth_teacher_group_ids()` to **exclude owned `kind='private'` groups when locked** (center groups and the `teacher_group_ids` branch untouched). This single change gates all group-keyed private policies (student_groups, enrollments, sessions, assessments, assessment_scores, attendance_scans, group_join_links, students).
- Add `AND NOT is_teacher_private_locked()` to the directly-keyed **private-only** policies: `student_groups` insert/update/delete (replacing the weaker suspended check — first-group trial still works because no-row ⇒ not locked), `content_items`(+`content_access`), `student_group_notes`, `student_credits`.
- Leave center/payment/free tables (`transactions` center-cut branch, `invoices`, `teacher_center*`, `group_proposals`) untouched so center monitoring + invoice payment survive.

**C. Reliable drop-to-free-baseline.** A shared `dropTeacherToFreeBaseline()` helper (transition to `past_due`, idempotent, audit). Use it from the summer cron (replacing the best-effort call) — and make `past_due` the **terminal** non-payment state: `process_due_subscriptions` no longer escalates to `suspended` (suspension becomes admin-only).

**D. Data preserved + honest message.** No deletes anywhere in this flow (RLS hides, never deletes). The free-baseline (resubscribe) view shows the honest Option A message: data is safe, return to a paid plan anytime and pick up where you left off — **no deletion claim, no countdown**.

**E. Tests.** No-loophole route scan; `is_teacher_private_locked`/access-by-status truth table; gate-restore logic; honest-message copy has no deletion wording. Plus a SQL-level assertion (throwaway PG) that the RLS functions/policies reference the lock predicate.

Conventions: text+CHECK only, `NOTIFY pgrst` after DDL, Africa/Cairo, logical CSS, snapshot regenerated + both drift alarms green.
