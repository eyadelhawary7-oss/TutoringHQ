# Schema ghost inventory (Phase 0 capture)

> Point-in-time record: this is the Phase-0 ghost capture. Its "at capture" counts
> (139 tables / 106 app functions +31 pg_trgm / 41 triggers / 221 policies / 489
> indexes / 2 views) are the Phase-0 snapshot and are preserved as history — do NOT
> read them as current. Synced against live 2026-07-18: current live catalog holds
> 142 base tables (all RLS-enabled) · 141 functions in `public` (52 SECURITY
> DEFINER) · 42 triggers · 220 RLS policies · 512 indexes · 2 views (counted live
> 2026-07-18, project lczmjpnbuhnsislcvzar). The ghost lists below (the specific
> object names captured then) are unchanged historical fact.

A **ghost** is a database object that exists in the live production database but
was never created by a tracked migration **and** never appeared in git history.
They accumulated because schema changes were applied directly to prod (Supabase
dashboard / MCP / psql) instead of through migrations. Phase 0 captures every
one of them AS-IS in `supabase/migrations/00000000000000_baseline.sql`.

Detection method: for every live object, check for a `CREATE TABLE/FUNCTION/
TRIGGER` of that name across all 217 migration files and all git history. The
counts below are the objects with **no** such creating statement anywhere.

Live `public` totals at capture: **139 tables · 106 app functions (+31 from
`pg_trgm`) · 41 triggers · 221 RLS policies · 489 indexes · 2 views**, all 139
tables RLS-enabled. Migration ledger held **211 rows for 217 files** (6
unrecorded) — a pre-existing incoherence the baseline supersedes.

## Ghost tables — 47 of 139

These include the core of the product. Their columns, constraints, indexes, RLS
policies and grants were all untracked until now:

```
access_attempts            announcement_blasts        assessment_scores
assessments                attendance_scans           bookings
card_order_status_transitions  center_assignments     center_metrics_daily
centers                    ceo_action_queue           chargebacks
commission_audit_log       commission_payouts         commissions
content_access             content_access_log         content_items
dead_letter_queue          delivery_fees              enrollments
group_join_links           groups                     parent_pack_billing
payments                   pending_enrollments        phone_verifications
platform_config            privacy_requests           referral_codes
referral_commissions       sessions                   staff
student_credits            students                   subjects
subscriptions              system_settings            teacher_center
teacher_profiles           teacher_subscriptions      transactions
users                      vendors                    wa_messages
webhook_inbox              webhook_outbox
```

## Ghost functions — 41 (app functions with no tracked `CREATE`)

Includes the live RLS-helper functions and the security guards. The audit's
"~23" was a curated subset; the catalog cross-check finds 41:

```
accept_teacher_center_invite        append_commission_pause
apply_center_subscription_transition apply_chargeback_transition
approve_student_rpc                 assign_center_code
assign_teacher_to_group             audit_log_block_mutations
can_manage_students_fn              can_record_payments_fn
chq_block_pack_billing_write        chq_prevent_blast_tampering
chq_prevent_card_order_tampering    chq_prevent_center_escalation
chq_prevent_user_escalation         close_commission_pause
complete_onboarding_step_rpc        compute_active_days
compute_lesson_money                deduct_blast_balance_rpc
enforce_payout_status_transition    get_auth_center_group_ids
get_auth_center_id                  get_auth_teacher_group_ids
get_my_center_id                    has_center_role
invite_teacher_to_center            is_auth_teacher_suspended
is_super_admin                      log_card_order_status_transition
process_due_subscriptions           process_payment_rpc
record_subscription_payment         remove_teacher_from_center
resolve_or_create_student           set_privacy_requests_updated_at
set_staff_updated_at                set_teacher_commission_override
set_updated_at_now                  update_updated_at_column
validate_reports_to
```

Core RLS helpers (`get_auth_center_id`, `is_super_admin`, `has_center_role`,
`get_auth_center_group_ids`, `get_auth_teacher_group_ids`, `get_my_center_id`)
and the lifecycle/finance RPCs (`process_due_subscriptions`,
`process_payment_rpc`, `record_subscription_payment`, `resolve_or_create_student`,
`validate_reports_to`) are all here — they govern access and money and were
entirely untracked.

## Ghost triggers — 15

Including the five `chq_*` tamper guards and the append-only `audit_log` guard:

```
trg_chq_prevent_blast_tampering     audit_log_no_update_delete
card_order_carts_set_updated_at     card_orders_log_status_transition
trg_chq_prevent_card_order_tampering auto_assign_center_code
trg_chq_prevent_center_escalation   ceo_action_queue_updated_at
payout_status_guard                 trg_chq_block_pack_billing_write
trg_privacy_requests_updated_at     sales_leads_updated_at
check_reports_to                    staff_updated_at_trigger
trg_chq_prevent_user_escalation
```

## Why this matters

Several ghosts are **live security controls**: the `chq_prevent_*_escalation`
guards stop privilege escalation on `centers`/`users`; `audit_log_no_update_delete`
makes the audit log append-only; `chq_prevent_card_order_tampering` /
`chq_prevent_blast_tampering` / `chq_block_pack_billing_write` protect billing
integrity. Because they were untracked, a `supabase db reset` or a from-scratch
rebuild would have silently dropped them. The baseline now pins them in code, and
the two drift checks ensure they can never silently diverge again.

> Phase 0 captures these **exactly as they are**, including any that are
> mis-calibrated or over-permissioned. Corrections are deliberate, tracked work
> in Phases 1–5 — never here.

## Current RLS coverage — zero-policy tables (current-state addendum)

Not part of the Phase-0 capture; recorded here so the zero-policy count is stated
with its recount query rather than a bare number that goes stale. RLS is enabled on
every base table, but some tables have RLS on with **0 policies** (locked to
service-role only). **22 such tables live 2026-07-18** (verified live, project
lczmjpnbuhnsislcvzar). This count moves as tables land — recount, don't trust the
number:

```sql
WITH rls_tables AS (
  SELECT c.relname AS tablename FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=true),
policy_counts AS (
  SELECT tablename, count(*) npol FROM pg_policies WHERE schemaname='public' GROUP BY tablename)
SELECT count(*) FROM rls_tables r LEFT JOIN policy_counts p ON p.tablename=r.tablename
WHERE COALESCE(p.npol,0)=0;
```

The 22 tables (2026-07-18): attendance_overrides, billing_lockout_events,
billing_nudges, billing_reconciliation_reports, card_charge_intents,
card_order_status_transitions, card_order_status_wa_dedupe, chargebacks,
enrollment_otps, group_slot_proposals, pending_enrollments, pending_signups,
phone_verifications, pin_setup_tokens, promo_code_requests, recurring_charge_declines,
saved_card_consents, saved_card_events, saved_cards, teacher_assignments,
teacher_signup_otps, trial_claims. (Prior notes saying 18 or 21 are stale snapshots.)
