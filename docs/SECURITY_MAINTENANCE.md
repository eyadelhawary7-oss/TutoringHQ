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
