# Disaster Recovery Plan

## Overview
This document outlines procedures for recovering from data loss, system failures, or security incidents.

## Backup Strategy

### Automated Backups (Supabase)
- **Frequency:** Daily at 2:00 AM UTC
- **Retention:** 7 days (free tier) / 30 days (pro tier)
- **Location:** Supabase managed backup storage
- **Includes:** Full database snapshot, auth data

### Manual Backups
Perform manual backups before:
- Major migrations
- Bulk data operations
- Production deployments with schema changes
- Secret rotations

## Backup Verification Schedule

### Monthly Verification (1st of each month)
1. Download latest backup from Supabase
2. Restore to test database
3. Run verification script: `npm run verify-backup`
4. Document results in backup log

### Quarterly Full Recovery Test (Every 3 months)
1. Complete database restore
2. Test all critical functions
3. Verify data integrity
4. Document recovery time

## Recovery Procedures

### Level 1: Single Record Recovery (5 minutes)
**Scenario:** User accidentally deleted a student/payment/group

**Steps:**
1. Go to Supabase Dashboard → Database → Table Editor
2. Find record in backup (if within 7 days)
3. Copy record data
4. Insert back into production table
5. Verify with user

**Alternative:** Check audit_log for deleted data in details field

### Level 2: Table Recovery (30 minutes)
**Scenario:** Entire table corrupted or accidentally truncated

**Steps:**
1. Go to Supabase Dashboard → Database → Backups
2. Click "Restore" on latest backup
3. Select "Restore to new project" (creates temporary database)
4. Export affected table from restored database
5. Import into production database
6. Verify record counts match
7. Test critical functions
8. Cleanup temporary database

### Level 3: Full Database Recovery (2-4 hours)
**Scenario:** Complete database corruption or security breach

**Steps:**
1. **STOP ALL OPERATIONS** - Put site in maintenance mode
2. Create new Supabase project
3. Restore from latest backup
4. Update environment variables:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY
5. Redeploy application to Vercel
6. Run verification suite: `npm run verify-backup` (point to new project)
7. Announce restoration complete
8. Monitor for 24 hours

**Estimated RTO (Recovery Time Objective):** 4 hours
**Estimated RPO (Recovery Point Objective):** 24 hours (last backup)

## Verification Queries

Run these after any restore to verify data integrity (in Supabase SQL Editor):

```sql
-- Check record counts
SELECT 
  'centers' as table_name, COUNT(*) as count FROM centers
UNION ALL
SELECT 'users', COUNT(*) FROM users
UNION ALL
SELECT 'students', COUNT(*) FROM students
UNION ALL
SELECT 'payments', COUNT(*) FROM payments
UNION ALL
SELECT 'student_groups', COUNT(*) FROM student_groups
UNION ALL
SELECT 'attendance_scans', COUNT(*) FROM attendance_scans
UNION ALL
SELECT 'audit_log', COUNT(*) FROM audit_log;

-- Check for orphaned records
SELECT COUNT(*) as orphaned_students
FROM students
WHERE center_id IS NOT NULL
  AND center_id NOT IN (SELECT id FROM centers);

SELECT COUNT(*) as orphaned_payments
FROM payments
WHERE student_id NOT IN (SELECT id FROM students);

-- Check date integrity
SELECT 
  MIN(created_at) as oldest_record,
  MAX(created_at) as newest_record
FROM centers;

-- Verify critical centers exist
SELECT id, name, status, plan
FROM centers
WHERE status = 'active'
ORDER BY created_at
LIMIT 10;
```

## Verification Script

For automated verification, run against a restored test database:

```bash
TEST_SUPABASE_URL=https://xxxx.supabase.co TEST_SUPABASE_SERVICE_KEY=your-key npm run verify-backup
```

## Manual Backup Procedure

### Creating Manual Backup

**Option 1: Supabase Dashboard**
1. Go to Database → Backups
2. Click "Create backup now"
3. Add label: "pre-migration-YYYY-MM-DD" or reason
4. Wait for completion

**Option 2: pg_dump (Advanced)**
```bash
# Get connection string from Supabase Dashboard → Database → Connection String
pg_dump "postgresql://postgres:[YOUR-PASSWORD]@[PROJECT-REF].supabase.co:5432/postgres" > backup-$(date +%Y%m%d).sql
```

### Storing Backups Securely

1. Never commit backups to git
2. Store in encrypted cloud storage (Google Drive, Dropbox)
3. Keep local copy on encrypted drive
4. Retention: Keep monthly backups for 1 year

## Backup Verification Log

### Template for Monthly Verification

| Field | Value |
|-------|-------|
| Date | YYYY-MM-DD |
| Performed by | [Name] |
| Backup date | YYYY-MM-DD HH:MM |
| Restoration successful | YES / NO |
| Issues found | None / [Description] |
| Record counts verified | YES / NO |
| Critical functions tested | YES / NO |
| Recovery time | [X] minutes |
| Next verification | [Date] |

### Example Log Entry

| Field | Value |
|-------|-------|
| Date | 2026-02-17 |
| Performed by | Eyad |
| Backup date | 2026-02-17 02:00 AM |
| Restoration successful | YES |
| Issues found | None |
| Record counts verified | YES (2 centers, 2 students, 0 payments) |
| Critical functions tested | YES (login, admin panel, signup) |
| Recovery time | 12 minutes |
| Next verification | 2026-03-17 |

## Testing Checklist

After any restore, verify these functions work:

**Authentication:**
- [ ] User login with OTP
- [ ] Admin login
- [ ] Session persistence

**Center Functions:**
- [ ] Dashboard loads
- [ ] Student list displays
- [ ] QR scanner works
- [ ] Payment recording
- [ ] Schedule displays

**Admin Functions:**
- [ ] Overview tab loads
- [ ] Centers tab shows data
- [ ] Pending signups visible
- [ ] Audit log accessible
- [ ] Can approve payments

**Data Integrity:**
- [ ] All centers present
- [ ] Student counts match
- [ ] Payment totals correct
- [ ] No orphaned records
- [ ] Dates are logical

## Emergency Contacts

**Primary:** Your phone number
**Backup:** Your co-founder (if applicable)
**Supabase Support:** support@supabase.io
**Vercel Support:** support@vercel.com

## Incident Response

If data loss occurs:

1. **Assess** (5 minutes)
   - What data is affected?
   - How many users impacted?
   - When did it happen?

2. **Contain** (10 minutes)
   - Stop any ongoing deletions
   - Put site in maintenance mode if needed
   - Preserve audit logs

3. **Recover** (1-4 hours)
   - Follow appropriate recovery level
   - Verify data integrity
   - Test critical functions

4. **Communicate** (1 hour)
   - Notify affected users
   - Explain what happened
   - Confirm resolution

5. **Document** (1 day)
   - Write incident report
   - Update procedures
   - Implement preventions

## Prevention Measures

- [ ] Enable Supabase Point-in-Time Recovery (Pro plan)
- [ ] Implement soft deletes (deleted_at column instead of DELETE)
- [ ] Require confirmation for bulk operations
- [ ] Add "Undo" feature for recent deletes (24-hour window)
- [ ] Regular backup verification (monthly)
- [ ] Staff training on recovery procedures

## Monthly Reminder

Set a recurring calendar event:
- **Title:** Verify CenterHQ Database Backup
- **Frequency:** Monthly (1st of each month)
- **Duration:** 30 minutes
- **Description:** Follow docs/DISASTER_RECOVERY.md monthly verification procedure. Run `npm run verify-backup` against restored test database.
