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

## ADR 036 — Center-cut renegotiation is a teacher-initiated proposal (future feature) (June 13, 2026)

Context: when a teacher wants to change the center_cut_egp on an existing center group, the current system has no mechanism — the cut is fixed at group creation via the group_proposals flow (ADR 033).

Decision: center-cut renegotiation will be a future feature, not blocking Phase 3. When built, it will follow the same two-sided proposal pattern as group creation: teacher proposes a new cut, center accepts or declines, the cut is updated atomically on acceptance. Direct UPDATE of center_cut_egp remains blocked.

Status: DEFERRED. Build after Phase 3 ships and at least one center-teacher relationship exists in production.
