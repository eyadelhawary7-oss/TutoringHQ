// src/lib/teacherPrivateView.ts
//
// Decides what a teacher sees in the PRIVATE-ENGINE area, mirroring the center
// lock (src/lib/billingLifecycle.ts) on the teacher side. The free zone (center
// monitoring) is never affected by this — it is always available.
//
//   hasPrivateAccess (teacher_private_access RPC) true  -> 'records'
//   locked but previously subscribed (state 'lapsed')   -> 'lock_summary'
//   never subscribed (state 'center_only')              -> 'upsell'
//
// 'lock_summary' is the teacher equivalent of the center /suspended screen:
// headline numbers (total private students, total private groups) + a pay button,
// with NO access to the private records until paid.

export type TeacherPortalState = 'center_only' | 'unified' | 'lapsed';
export type TeacherPrivateView = 'records' | 'lock_summary' | 'upsell';

export function resolveTeacherPrivateView(opts: {
  hasPrivateAccess: boolean;
  state: TeacherPortalState;
}): TeacherPrivateView {
  if (opts.hasPrivateAccess) return 'records';
  return opts.state === 'lapsed' ? 'lock_summary' : 'upsell';
}

/** A locked (lapsed) teacher sees the summary screen instead of the records. */
export function isTeacherPrivateLocked(opts: {
  hasPrivateAccess: boolean;
  state: TeacherPortalState;
}): boolean {
  return resolveTeacherPrivateView(opts) === 'lock_summary';
}
