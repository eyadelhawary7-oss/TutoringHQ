# Schema ghost inventory (Phase 0 capture)

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
