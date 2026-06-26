# Security Maintenance Schedule

## Secrets Rotation

### Every 6 Months (Semi-Annual)
- [ ] Rotate CSRF_SECRET
- [ ] Rotate Supabase ANON_KEY
- [ ] Review and rotate any third-party API keys

### Every 12 Months (Annual)
- [ ] Rotate Supabase SERVICE_ROLE_KEY (HIGH RISK - test thoroughly)
- [ ] Rotate SUPER_ADMIN_PHONES verification
- [ ] Full security audit

## Rotation Procedures

### Rotating Supabase ANON_KEY (Safe)

1. Go to Supabase Dashboard → Settings → API
2. Click "Generate new anon key"
3. Copy the new key
4. Update in Vercel: NEXT_PUBLIC_SUPABASE_ANON_KEY
5. Redeploy application
6. Monitor for 24 hours
7. Old key expires automatically after 30 days

**Risk:** LOW - Frontend only, public key
**Downtime:** None if done during low-traffic period
**Testing:** Verify login, signup, public queries work

### Rotating SERVICE_ROLE_KEY (High Risk)

⚠️ **WARNING:** This is a sensitive operation. Test thoroughly!

1. Schedule during maintenance window (announce 24h ahead)
2. Create backup of current production database
3. Test rotation in staging environment first
4. Go to Supabase Dashboard → Settings → API
5. Click "Generate new service role key"
6. Update in Vercel: SUPABASE_SERVICE_ROLE_KEY
7. Redeploy immediately
8. Test critical functions:
   - Admin login
   - Admin actions
   - Center creation
   - Payment approval
9. Monitor error logs for 1 hour
10. Keep old key for 24h in case of emergency rollback

**Risk:** HIGH - Full database access
**Downtime:** 2-5 minutes during deployment
**Testing:** Full regression test required

### Rotating CSRF_SECRET

1. Generate new 32-byte hex string:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
2. Update in Vercel: CSRF_SECRET
3. Redeploy
4. All existing sessions will need to refresh page once

**Risk:** LOW - Users just refresh
**Downtime:** None
**Testing:** Submit a form after deployment

## Rotation Tracking

| Secret | Last Rotated | Next Due | Responsible |
|--------|--------------|----------|-------------|
| CSRF_SECRET | 2026-02-17 | 2026-08-17 | Admin |
| ANON_KEY | 2026-02-17 | 2026-08-17 | Admin |
| SERVICE_ROLE_KEY | 2026-02-17 | 2027-02-17 | Admin |
| SUPER_ADMIN_PHONES | 2026-02-17 | 2027-02-17 | Admin |

**Note:** Update this table after each rotation. The `check-secrets` script parses "Next Due" dates from this table for reminders.

## Secret Inventory

### Drive / Backup

| Env var | Purpose | Notes |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service-account credentials JSON (single-line) used by `src/lib/googleDriveBackup.ts` to authenticate against the Drive API. | Scope: `https://www.googleapis.com/auth/drive.file`. |
| `BACKUP_DRIVE_FOLDER_ID` | Root folder ID inside the Shared Drive where weekly/monthly backup subfolders are created. | Must live inside the Shared Drive referenced by `BACKUP_DRIVE_SHARED_DRIVE_ID`. |
| `BACKUP_DRIVE_SHARED_DRIVE_ID` | Google Shared Drive ID that owns the backup destination. Required as of ADR-018 — Service Accounts have no personal Drive quota. | The Shared Drive **must list the service account's `client_email` as a Manager**, or all uploads fail with permission errors. |
| `BACKUP_NOTIFY_PHONE` | Optional WhatsApp phone number that receives backup-complete notifications. | Notification path gated by Meta template approval + `wa_sending_enabled` platform_config. |

## Emergency Rotation (Security Breach)

If a secret is compromised:

1. **Immediate Actions (5 minutes)**
   - Rotate the compromised secret immediately
   - Redeploy to production
   - Monitor all admin actions in audit log
   - Check for suspicious database changes

2. **Investigation (1 hour)**
   - Review audit logs for unauthorized access
   - Check Supabase auth logs
   - Review Sentry error logs
   - Identify scope of breach

3. **Communication (2 hours)**
   - Notify affected users if data exposed
   - Document incident in security log
   - Update this document with lessons learned

4. **Prevention (1 week)**
   - Implement additional security measures
   - Rotate all other secrets as precaution
   - Full security audit

## Automation (Optional - Implement Later)

Consider implementing:
- GitHub Actions to remind about rotation deadlines
- Automated rotation for less critical secrets
- Monitoring for key usage patterns

## Checklist Template

Use this for each rotation:

- [ ] Backup current production database
- [ ] Test rotation in development
- [ ] Schedule maintenance window
- [ ] Announce to team
- [ ] Generate new secret
- [ ] Update environment variables
- [ ] Deploy changes
- [ ] Test critical functions
- [ ] Monitor for 24 hours
- [ ] Update rotation tracking table
- [ ] Document any issues encountered

---

## Phase 6 re-audit — conscious decisions & known caveats (2026-06-26)

This section records decisions from the 2026-06-26 re-audit cleanup so each is
on the record as deliberate, not an oversight.

### SECURITY DEFINER RPC grants (Fix A / B / F — fixed)

The over-granted business RPCs and global-recompute RPCs were locked down to
`service_role` only (tracked migrations `20260626000001`/`20260626000002`), and
the trigger functions had EXECUTE revoked from all roles (triggers fire as table
owner and never need it). See `supabase/migrations/2026062600000{1,2,3}_phase6*`.

**Intentionally still flagged by the Supabase linter** (`anon_/authenticated_security_definer_function_executable`):
the RLS-helper functions `get_auth_center_id`, `get_auth_center_group_ids`,
`get_auth_teacher_group_ids`, `has_center_role`, `is_auth_teacher_suspended`
(anon + authenticated), and `can_manage_students_fn`, `can_record_payments_fn`,
`is_super_admin`, `get_my_center_id` (authenticated only). These are referenced
inside RLS policies and MUST remain executable by the roles those policies serve,
or RLS evaluation errors. The first five are referenced by PUBLIC policies so
they keep `anon`; the rest had `anon`/PUBLIC revoked in Phase 6. These linter
warnings are therefore expected and accepted.

### Advisory items — acknowledged, NOT changed

- **Leaked-password protection is OFF in Supabase Auth — left OFF on purpose.**
  Authentication is a 6-digit numeric PIN, not a free-form password. HaveIBeenPwned
  leaked-password checking would flag essentially every 6-digit value as
  "compromised" and break PIN signup/reset for normal users. The control is
  designed for high-entropy passwords and does not fit a 6-digit PIN scheme.
  Re-evaluate only if auth ever moves to real passwords.
- **`pg_net` and `pg_trgm` live in the `public` schema** (linter `extension_in_public`).
  Moving an installed extension to another schema is risky (it can break objects
  that reference it by unqualified name, and Supabase provisions some of these out
  of band) and the security upside is low. Left in place by decision; watched by
  the live-drift gate.

### Offline scanner IndexedDB holds roster PII — by design (Fix H)

Correcting the record: the "no PII in browser storage" guarantee is accurate ONLY
for **localStorage / sessionStorage** (enforced by `src/lib/clientMemoryCache.ts`
and `tests/unit/clientMemoryCache.test.ts`). The **offline attendance scanner
deliberately caches roster data — student name, phone, balance_due, groups — in
IndexedDB** (`src/lib/db.ts`, DB `centerhq-offline`, store `students`) so scanning
keeps working with no network. This is required for the offline feature and is not
a leak.

- The cache is **wiped on EXPLICIT logout** via `clearOfflineData()` (wired into
  `signOutToLogin` in `src/lib/auth/sign-out-client.ts`), so a shared device does
  not retain a roster after a user signs out.
- It is **NOT** wiped on token/session expiry — that path does not call
  `signOutToLogin`, by design, so an expiry mid-session never destroys the roster
  out from under a scanner that is working offline.
- `clearOfflineData()` clears the PII/per-session stores (`students`,
  `today_history`, `todayPayments`, `scanner_meta`) but **preserves**
  `pending_scans`/`syncQueue` so an explicit logout never silently drops attendance
  that has not yet synced (those rows carry only ids, not roster PII).
- **Field minimization considered, deferred.** The cached fields (`name` for the
  scan display, `balance_due` for the offline payment check, `groups`/`fee` for the
  per-session fee, `phone`/`parent_phone` for offline parent notification,
  `qr_code`, `student_number`) all back offline behaviours. Dropping any is not
  clearly safe without risking an offline feature, so per the re-audit's "pause if
  minimization would break a feature" rule the field set is retained as-is.
