# Architecture Decision Records

## ADR 018 — Google Drive backup migrated to Shared Drive (May 18, 2026)

Context: The weekly-backup cron has been failing every run since at least May 3, 2026 with "Service Accounts do not have storage quota. Leverage shared drives or use OAuth delegation instead." Google revoked personal storage quotas for Service Accounts. The cron's `partial` status was misleading — zero of 35+ tables were actually backed up.

Decision: Migrate the cron to write to a Google Shared Drive (Workspace org-owned storage) rather than the Service Account's personal Drive. Service Account is added as a Manager of the Shared Drive; storage is billed to the EHG Intelligence Workspace org.

Alternatives considered:
1. Retire the cron entirely and rely solely on Supabase auto-backup — rejected. Supabase auto-backup does not cover Supabase Storage objects (invoice-pdfs bucket), and reliance on a single backup provider violates defense-in-depth principles relevant to Law 151 / PDPL compliance considerations.
2. OAuth delegation — rejected as more complex; requires Workspace admin domain-wide delegation setup with no clear advantage over Shared Drives for this use case.
3. Switch destination to S3 / R2 / B2 — rejected for now. Adds a new vendor and SDK. May reconsider if Workspace cost becomes meaningful.

Implementation: src/lib/googleDriveBackup.ts now requires BACKUP_DRIVE_SHARED_DRIVE_ID env var. Every Drive API call (files.create, files.list, etc.) passes supportsAllDrives: true. List operations also pass corpora: 'drive', includeItemsFromAllDrives: true, and driveId.

Operational requirement: The Shared Drive must have the GOOGLE_SERVICE_ACCOUNT_JSON's client_email added as a Manager. Documented in docs/SECURITY.md secret inventory.

## ADR 024 — Set-PIN trust anchor is a single-use webhook token (May 2026)

The set-PIN flow is sessionless. The server issues a short-lived (15-minute), single-use token scoped to one phone number and delivers it via WhatsApp. The token is the sole trust anchor — no session, cookie, or bearer token is accepted. The token is consumed on first verification and cannot be reused. See Rule 150.

## ADR 025 — Login lockout fails closed (May 2026)

The login rate limiter (5 wrong PINs per phone per 15 minutes) uses Upstash Redis. On Upstash outage the limiter returns a 423 Locked response rather than allowing the request through. PIN verification is a money-adjacent gate and must fail CLOSED per Rule 149.

## ADR 028 — Center status gate in requireCenterAuth (May 2026)

Suspended and blacklisted centers are blocked at the auth helper level, not at individual route level. requireCenterAuth returns a 403 CENTER_SUSPENDED or CENTER_BLACKLISTED code before any route handler runs. Reactivation routes opt in via allowSuspended: true so a suspended owner can still pay to come back online.

## ADR 029 — Identity resolution: JWT is authentication only (May 2026)

JWT claims are proof of authentication, not authorization. Role, center_id, and all permission decisions are derived from public.users via the admin client after verifying the bearer token. No route may read role or center_id from JWT claims directly. See Rule 151.

## ADR 030 — Admin-only login fallback (May 2026)

Admin accounts (admin_users table + SUPER_ADMIN_PHONES allowlist) can log in even when no public.users row exists for their phone. The login route checks admin_users membership after the standard user lookup fails, rather than returning 401 immediately. This allows support and founder access without a center row.

## ADR 031 — Cream design system as product-wide default (May 2026)

The cream token set (--paper #ece8df, --panel #fffdf8, teal #0e6b61, brass #9a6b1f) is the canonical product theme. The old light-white theme is removed. Dark mode remains available via the .dark class. All new UI surfaces follow cream. See Rule 144.

## ADR 032 — Teacher portal dual-shell architecture (June 2026)

Teachers are served by a single server-side gate (teacher_private_access) that decides which shell to render. Lapsed teachers (no active subscription, past current_period_end) see the center-only free zone with brass lock icons on private-engine nav items. Active/trialing teachers see the unified shell with full private-engine access. Private data is inaccessible at both the route level and the data layer for lapsed teachers. Model A (auto-created solo centers) was permanently rejected.

## ADR 033 — Center-cut is a flat EGP amount; group creation via two-sided proposal negotiation (June 11, 2026)

student_groups.center_cut_egp is a flat EGP amount per student per lesson (not a percentage). Groups between a teacher and center are created via a two-sided proposal flow: teacher proposes, center accepts or counter-proposes, teacher accepts. On acceptance the student_groups row is created atomically. The respond_group_proposal RPC is SECURITY DEFINER, service_role-only. All transitions are atomic with a turn-order check. Direct INSERT into student_groups for center-kind groups is blocked. Nightly cron expires proposals after 7 days.

## ADR 034 — Teacher resubscribe rides combined_payment_sessions with teacher identity in metadata (June 11, 2026)

A lapsed teacher reactivating at 299 EGP/month reuses the combined_payment_sessions table with session_type = 'teacher_resubscribe' and teacher identity stored in the metadata jsonb. center_id is nullable. No new table was added. The Paymob webhook finalizes the session and triggers apply_teacher_subscription_transition to 'active'.

## ADR 035 — Teacher two-tier pricing locked (June 2026)

Standard tier: 299 EGP/month, up to 8 groups, up to 60 students, 14-day trial. Pro tier: 699 EGP/month, unlimited groups and students, lifetime income history, advanced analytics, 100 EGP blast credits included monthly, student notes, CSV export. Trial is provisioned on first private group creation. Caps enforced in Phase 3. Cancel means access until current_period_end (standard SaaS end-of-period behavior).

## ADR 036 — Center-cut renegotiation is a teacher-initiated proposal (future feature) (June 13, 2026)

Context: when a teacher wants to change the center_cut_egp on an existing center group, the current system has no mechanism — the cut is fixed at group creation via the group_proposals flow (ADR 033).

Decision: center-cut renegotiation will be a future feature, not blocking Phase 3. When built, it will follow the same two-sided proposal pattern as group creation: teacher proposes a new cut, center accepts or declines, the cut is updated atomically on acceptance. Direct UPDATE of center_cut_egp remains blocked.

Status: DEFERRED. Build after Phase 3 ships and at least one center-teacher relationship exists in production.