# Secret Rotation Log

> Reviewed 2026-07-18: no secret rotation has been logged since the 2026-02-17 initial
> setup. This matches the rotation-tracking table in `docs/SECURITY_MAINTENANCE.md`,
> where every secret still shows "Last Rotated: 2026-02-17". CSRF_SECRET / ANON_KEY are
> next due 2026-08-17 per that table. Append a dated entry here whenever a rotation runs.

## 2026-02-17 - Initial Setup
- Created CSRF_SECRET
- Created initial security documentation
- Set rotation schedule
- Next rotation: 2026-08-17

## Template for Future Rotations

### YYYY-MM-DD - [Secret Name] Rotation
**Performed by:** [Name]
**Reason:** Scheduled / Emergency
**Duration:** [X] minutes downtime
**Issues:** None / [Description]
**Testing:** All passed / [Issues found]
**Next rotation:** [Date]
